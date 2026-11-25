import { describe, it, expect } from 'vitest'
import {
  normalizeAnswer, normalizeFeedback, feedbackGroups, answerScore, stepOf, groupSignal, feedbackPlan, mesoStartPlan, rampOn,
} from './muscle-feedback.js'
import { nudgeProposal, applyProposal, MAX_STEP } from './ai-actions.js'
import { plannedVolume } from './volume.js'

// Inline exercise metadata (ids not in the catalogue): a primary counts 1, a secondary 0.4.
const bench = sets => ({ id: 'x-bench', tg: 'chest', sm: ['triceps'], sets })
const fly = sets => ({ id: 'x-fly', tg: 'chest', sets })
const curl = sets => ({ id: 'x-curl', tg: 'biceps', sets })
const done = n => Array.from({ length: n }, () => ({ w: 50, r: 10, done: true }))

// Full body: one microcycle = 3 sessions, the one routine trained three times. The volume ramp is
// off unless a test turns it on, so the feedback is read on its own.
const fullBody = (ex, workouts = [], extra = {}) => ({
  program: { on: true, seq: ['A'], anchor: '2026-09-01', strategy: 'full-body' },
  routines: [{ id: 'A', name: 'Full A', ex }],
  workouts, meso: null, volumeRamp: false,
  ...extra,
})
const session = (d, feedback, entries = [{ ...bench(), sets: done(3) }]) =>
  ({ id: 'w' + d, d, start: Date.parse(d + 'T10:00:00'), routineId: 'A', entries, ...(feedback ? { feedback } : {}) })

const EASY = { pump: 0, work: 0, sore: 0 }       // under-dosed: +2.5
const FINE = { pump: 1, work: 1, sore: 1 }       // right where it should be: 0
const WRECKED = { pump: 2, work: 2, sore: 2 }    // over-dosed: −3.5

describe('answers', () => {
  it('keeps only 0–2 values of the known fields', () => {
    expect(normalizeAnswer({ pump: 2, work: 5, sore: '1', x: 1 })).toEqual({ pump: 2 })
    expect(normalizeAnswer({ work: 3 })).toBeNull()
    expect(normalizeAnswer(null)).toBeNull()
  })

  it('drops groups the panel does not know', () => {
    expect(normalizeFeedback({ chest: { pump: 1 }, wings: { pump: 2 }, biceps: {} })).toEqual({ chest: { pump: 1 } })
  })

  it('weighs recovery and workload above pump', () => {
    expect(answerScore(EASY)).toBe(2.5)
    expect(answerScore(FINE)).toBe(0)
    expect(answerScore(WRECKED)).toBe(-3.5)
    // A great pump alone does not cut volume; still being sore does.
    expect(stepOf(answerScore({ pump: 2, work: 1, sore: 1 }))).toBe(0)
    expect(stepOf(answerScore({ pump: 1, work: 1, sore: 2 }))).toBe(-1)
    // Recovered early and the work felt easy: two more sets.
    expect(stepOf(answerScore({ pump: 1, work: 0, sore: 0 }))).toBe(2)
    // Only recovered early: one more.
    expect(stepOf(answerScore({ pump: 1, work: 1, sore: 0 }))).toBe(1)
  })

  it('treats unanswered fields as neutral', () => {
    expect(answerScore({ sore: 0 })).toBe(1)
    expect(answerScore({})).toBeNull()
    expect(stepOf(null)).toBe(0)
  })
})

describe('feedbackGroups', () => {
  it('asks about the groups the session trained, primary or secondary, in panel order', () => {
    const w = session('2026-09-02', null, [{ ...curl(), sets: done(2) }, { ...bench(), sets: done(3) }])
    const keys = feedbackGroups(w).map(g => g.key)
    expect(keys).toEqual(['chest', 'biceps', 'triceps'])   // triceps: 3 × 0.4 = 1.2 sets
  })

  it('skips a group only brushed by the session, and warm-ups never count', () => {
    const w = session('2026-09-02', null, [{ ...bench(), sets: [{ w: 20, r: 10, done: true, phase: 'warmup' }, ...done(2)] }])
    expect(feedbackGroups(w).map(g => g.key)).toEqual(['chest'])   // triceps 0.8 < 1
  })
})

describe('groupSignal', () => {
  it('averages the sessions that answered and names what pushed it', () => {
    const ws = [session('2026-09-02', { chest: EASY }), session('2026-09-04', { chest: FINE }), session('2026-09-06')]
    const sig = groupSignal(ws, 'chest')
    expect(sig.sessions).toBe(2)
    expect(sig.score).toBe(1.25)
    expect(sig.step).toBe(1)
    // Each field's most frequent answer — ties go to the first — when it is not the neutral one.
    expect(sig.reasons).toEqual([{ f: 'pump', v: 0 }, { f: 'work', v: 0 }, { f: 'sore', v: 0 }])
  })

  it('is empty for a group nobody answered', () => {
    expect(groupSignal([session('2026-09-02', { chest: EASY })], 'biceps')).toEqual({ sessions: 0, score: null, step: 0, reasons: [] })
  })
})

describe('nudgeProposal', () => {
  it('adds about the asked sets, spread over the exercises, listed in routine order', () => {
    // One routine, one session per microcycle (custom sequence of one step).
    const S = { ...fullBody([bench(3), fly(2)]), program: { on: true, seq: ['A'], anchor: '2026-09-01', strategy: 'custom' } }
    expect(plannedVolume(S).groups.chest).toBe(5)
    const p = nudgeProposal(S, 'chest', 2)
    expect(p.after).toBe(7)
    expect(p.changes).toEqual([
      { routineId: 'A', routineName: 'Full A', idx: 0, exId: 'x-bench', from: 3, to: 4 },
      { routineId: 'A', routineName: 'Full A', idx: 1, exId: 'x-fly', from: 2, to: 3 },
    ])
  })

  it('takes the exercise with the fewest sets first', () => {
    const S = { ...fullBody([bench(3), fly(2)]), program: { on: true, seq: ['A'], anchor: '2026-09-01', strategy: 'custom' } }
    expect(nudgeProposal(S, 'chest', 1).changes).toEqual([{ routineId: 'A', routineName: 'Full A', idx: 1, exId: 'x-fly', from: 2, to: 3 }])
  })

  it('takes one overshooting step when nothing smaller can move', () => {
    // Trained three times a microcycle: one set moves chest by 3.
    const p = nudgeProposal(fullBody([bench(3)]), 'chest', 1)
    expect(p.changes).toEqual([{ routineId: 'A', routineName: 'Full A', idx: 0, exId: 'x-bench', from: 3, to: 4 }])
    expect(p.after - p.before).toBe(3)
  })

  it('stops at the MRV and never takes a secondary mover', () => {
    // Chest MRV (classic) is 22: 3 × 7 = 21 already, one more set would be 24.
    expect(nudgeProposal(fullBody([bench(7)]), 'chest', 2)).toBeNull()
    // Triceps only gets bench as a secondary: nothing to nudge.
    expect(nudgeProposal(fullBody([bench(3)]), 'triceps', 1)).toBeNull()
  })

  it('removes below the band if asked, but never an exercise’s last set, and at most MAX_STEP', () => {
    const S = { ...fullBody([bench(4)]), program: { on: true, seq: ['A'], anchor: '2026-09-01', strategy: 'custom' } }
    const p = nudgeProposal(S, 'chest', -2)
    expect(p.changes[0]).toMatchObject({ from: 4, to: 2 })
    expect(4 - p.changes[0].to).toBeLessThanOrEqual(MAX_STEP)
    expect(nudgeProposal({ ...S, routines: [{ id: 'A', name: 'Full A', ex: [bench(1)] }] }, 'chest', -1)).toBeNull()
  })

  it('does nothing without programming or without a step', () => {
    expect(nudgeProposal({ ...fullBody([bench(3)]), program: null }, 'chest', 1)).toBeNull()
    expect(nudgeProposal(fullBody([bench(3)]), 'chest', 0)).toBeNull()
  })
})

describe('feedbackPlan', () => {
  const ex = [bench(3), curl(3)]

  it('proposes a step per group from the microcycle’s answers, merged for applyProposal', () => {
    const S = fullBody(ex, [
      session('2026-09-02', { chest: EASY, biceps: WRECKED }),
      session('2026-09-03', { chest: EASY, biceps: FINE }),
    ])
    const plan = feedbackPlan(S)
    expect(plan.blocked).toBeNull()
    const byKey = Object.fromEntries(plan.groups.map(g => [g.key, g]))
    expect(byKey.chest.signal.step).toBe(2)
    expect(byKey.chest.before).toBe(9)
    expect(byKey.chest.after).toBe(12)     // one set more, trained three times
    expect(byKey.biceps.signal.step).toBe(-1)
    expect(byKey.biceps.after).toBe(6)
    expect(plan.changes).toEqual([
      { routineId: 'A', routineName: 'Full A', idx: 0, exId: 'x-bench', from: 3, to: 4 },
      { routineId: 'A', routineName: 'Full A', idx: 1, exId: 'x-curl', from: 3, to: 2 },
    ])
    const draft = structuredClone(S)
    expect(applyProposal(draft, { kind: 'volume', changes: plan.changes })).toBe(true)
    expect(draft.routines[0].ex.map(c => c.sets)).toEqual([4, 2])
  })

  it('leaves out the groups the user skipped', () => {
    const S = fullBody(ex, [session('2026-09-02', { chest: EASY, biceps: WRECKED })])
    const plan = feedbackPlan(S, { skip: ['biceps'] })
    expect(plan.changes.map(c => c.exId)).toEqual(['x-bench'])
    expect(plan.groups.find(g => g.key === 'biceps')).toMatchObject({ skipped: true, after: 9 })
  })

  it('reports a group whose step no exercise can take as capped, saying why', () => {
    const plan = feedbackPlan(fullBody([bench(7)], [session('2026-09-02', { chest: EASY })]))
    expect(plan.groups).toEqual([expect.objectContaining({ key: 'chest', capped: 'max', changes: [] })])
    expect(plan.changes).toEqual([])
    const down = feedbackPlan(fullBody([bench(1)], [session('2026-09-02', { chest: WRECKED })]))
    expect(down.groups[0].capped).toBe('min')
    const none = feedbackPlan(fullBody([curl(3)], [session('2026-09-02', { chest: EASY })]))
    expect(none.groups[0].capped).toBe('noexercise')
  })

  it('without calendar programming, still says what each group asks for', () => {
    const S = { ...fullBody(ex, [session('2026-09-02', { chest: EASY })]), program: null, microcycleSessions: 3 }
    const plan = feedbackPlan(S)
    expect(plan.blocked).toBe('noplan')
    expect(plan.groups).toEqual([expect.objectContaining({ key: 'chest', capped: 'noplan', changes: [] })])
    expect(plan.groups[0].signal.step).toBe(2)
    expect(plan.changes).toEqual([])
  })

  it('stays quiet when nobody answered, or around a deload', () => {
    expect(feedbackPlan(fullBody(ex, [session('2026-09-02')])).blocked).toBe('none')
    const S = fullBody(ex, [session('2026-09-02', { chest: EASY })], { meso: { deloads: [1] } })
    expect(feedbackPlan(S).blocked).toBe('deload')
  })

  it('keeps a group whose answers balance out off the list', () => {
    const S = fullBody(ex, [session('2026-09-02', { chest: FINE })])
    expect(feedbackPlan(S).groups).toEqual([])
  })
})

describe('the volume ramp', () => {
  const ramp = (ex, workouts = [], extra = {}) => fullBody(ex, workouts, { volumeRamp: true, ...extra })
  const steps = plan => Object.fromEntries(plan.groups.map(g => [g.key, [g.source, g.signal.step, g.before, g.after]]))

  it('is on unless switched off', () => {
    expect(rampOn({})).toBe(true)
    expect(rampOn({ volumeRamp: false })).toBe(false)
  })

  it('adds a set to every group the plan trains, with or without answers', () => {
    const plan = feedbackPlan(ramp([bench(3), curl(3)]))
    expect(plan.blocked).toBeNull()
    // Triceps only gets bench as a secondary: the ramp has nothing to move and says nothing.
    expect(steps(plan)).toEqual({ chest: ['ramp', 1, 9, 12], biceps: ['ramp', 1, 9, 12] })
    expect(plan.changes.map(c => [c.exId, c.from, c.to])).toEqual([['x-bench', 3, 4], ['x-curl', 3, 4]])
  })

  it('climbs only to the top of the band, while answers asking for more go on to the MRV', () => {
    // 6 sets × 3 = 18; one more is 21, past chest's band top of 20.
    expect(feedbackPlan(ramp([bench(6)])).groups).toEqual([])
    const asked = feedbackPlan(ramp([bench(6)], [session('2026-09-02', { chest: EASY })]))
    expect(steps(asked)).toEqual({ chest: ['feedback', 2, 18, 21] })   // MRV 22
  })

  it('reads neutral answers as "go on climbing", and holds or cuts when they say so', () => {
    expect(steps(feedbackPlan(ramp([bench(3)], [session('2026-09-02', { chest: FINE })])))).toEqual({ chest: ['ramp', 1, 9, 12] })
    // A great pump alone: the dose already works, hold.
    expect(feedbackPlan(ramp([bench(3)], [session('2026-09-02', { chest: { pump: 2, work: 1, sore: 1 } })])).groups).toEqual([])
    expect(steps(feedbackPlan(ramp([bench(4)], [session('2026-09-02', { chest: WRECKED })])))).toEqual({ chest: ['feedback', -2, 12, 9] })
  })

  it('starts the next mesocycle from the bottom of each band when the deload closes', () => {
    const S = ramp([bench(7), curl(3)], [], { meso: { deloads: [0] } })
    const plan = feedbackPlan(S)
    expect(plan.kind).toBe('start')
    // Chest 21 → no lower than 12, at most MAX_STEP sets off one exercise: 7 → 5 sets, 15.
    expect(steps(plan)).toEqual({ chest: ['start', -9, 21, 15] })
    expect(plan.changes).toEqual([{ routineId: 'A', routineName: 'Full A', idx: 0, exId: 'x-bench', from: 7, to: 5 }])
    expect(mesoStartPlan(S, { skip: ['chest'] }).changes).toEqual([])
  })

  it('without it, a deload proposes nothing', () => {
    expect(feedbackPlan(fullBody([bench(7)], [], { meso: { deloads: [0] } })).blocked).toBe('deload')
  })

  it('needs calendar programming, like the feedback does', () => {
    expect(feedbackPlan({ ...ramp([bench(3)]), program: null, microcycleSessions: 3 }).groups).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { workIndexOf, referenceSet, suggestionFor, targetFor, seedTargets, extraSetsWanted, overloadOf } from './set-reference.js'

const work = (w, r, done = false) => ({ w, r, done })
const warm = (w, r) => ({ w, r, phase: 'warmup', done: false })

describe('workIndexOf', () => {
  it('counts work rows only, so the first work set after two warm-ups is position 0', () => {
    const sets = [warm(30, 5), warm(45, 3), work(60, 10), work(60, 10)]
    expect(workIndexOf(sets, 2)).toBe(0)
    expect(workIndexOf(sets, 3)).toBe(1)
  })
  it('gives a warm-up no position of its own', () => {
    expect(workIndexOf([warm(30, 5), work(60, 10)], 0)).toBe(null)
  })
  it('returns null off the ends of the list', () => {
    expect(workIndexOf([work(60, 10)], -1)).toBe(null)
    expect(workIndexOf([work(60, 10)], 9)).toBe(null)
  })
})

describe('referenceSet', () => {
  const prev = [work(60, 10, true), work(60, 9, true), work(57.5, 8, true)]
  it('pairs each position with the set that sat there last session', () => {
    expect(referenceSet(prev, 0)).toEqual(prev[0])
    expect(referenceSet(prev, 2)).toEqual(prev[2])
  })
  // You added a fourth set today: the honest reference is still the last one you actually did.
  it('keeps the final set as the reference past the end of last session', () => {
    expect(referenceSet(prev, 3)).toEqual(prev[2])
  })
  it('ignores last session’s warm-ups when lining the positions up', () => {
    expect(referenceSet([warm(30, 5), work(60, 10, true)], 0)).toEqual(work(60, 10, true))
  })
  it('has nothing to say with no history', () => {
    expect(referenceSet([], 0)).toBe(null)
    expect(referenceSet(undefined, 0)).toBe(null)
  })
})

describe('suggestionFor', () => {
  it('follows the prescription over last time when the policy decided one', () => {
    const s = suggestionFor({ plan: { kind: 'up', weight: 62.5 }, row: work(60, 10), reference: work(60, 10, true) })
    expect(s).toEqual({ w: 62.5 })
  })
  it('falls back to last time’s numbers when progression is off', () => {
    const s = suggestionFor({ plan: { kind: 'off' }, row: work(0, 0), reference: work(60, 10, true) })
    expect(s).toEqual({ w: 60, r: 10 })
  })
  // The chip only earns its place when tapping it would change something.
  it('says nothing when the row already carries the target', () => {
    expect(suggestionFor({ plan: { weight: 60, reps: 10 }, row: work(60, 10), reference: work(60, 10, true) })).toBe(null)
  })
  it('never speaks to a logged set or a warm-up', () => {
    expect(suggestionFor({ plan: { weight: 62.5 }, row: work(60, 10, true), reference: work(60, 10, true) })).toBe(null)
    expect(suggestionFor({ plan: { weight: 62.5 }, row: warm(30, 5), reference: work(60, 10, true) })).toBe(null)
  })
  it('carries a bodyweight rep target with no weight to add', () => {
    const s = suggestionFor({ plan: { kind: 'up', weight: 0, reps: 13 }, row: work(0, 12), reference: work(0, 12, true) })
    expect(s).toEqual({ r: 13 })
  })
  it('works in seconds for a timed hold', () => {
    const s = suggestionFor({ mode: 'time', plan: { kind: 'up', sec: 50 }, row: { sec: 45, w: 0 }, reference: { sec: 45, w: 0, done: true } })
    expect(s).toEqual({ sec: 50 })
  })
  it('leaves cardio alone — the engine has no overload rule for it', () => {
    expect(suggestionFor({ mode: 'cardio', row: { min: 20, speed: 8 }, reference: { min: 25, speed: 9, done: true } })).toBe(null)
  })
  it('has nothing to suggest with neither a plan nor history', () => {
    expect(suggestionFor({ row: work(0, 0), reference: null })).toBe(null)
  })
})

describe('extraSetsWanted', () => {
  it('asks for the set a bodyweight progression decided to add', () => {
    expect(extraSetsWanted({ kind: 'up', sets: 4 }, [work(0, 10), work(0, 10), work(0, 10)], [])).toBe(1)
  })
  it('falls back to last session’s set count when the plan has no opinion', () => {
    expect(extraSetsWanted(null, [work(60, 10), work(60, 10)], [work(60, 10, true), work(60, 10, true), work(60, 9, true)])).toBe(1)
  })
  it('stays quiet when the list already has the sets', () => {
    expect(extraSetsWanted({ sets: 3 }, [work(60, 10), work(60, 10), work(60, 10)], [])).toBe(0)
    expect(extraSetsWanted(null, [work(60, 10), work(60, 10)], [work(60, 10, true)])).toBe(0)
  })
  it('does not count warm-ups on either side', () => {
    expect(extraSetsWanted(null, [warm(30, 5), work(60, 10)], [warm(30, 5), work(60, 10, true), work(60, 10, true)])).toBe(1)
  })
})

describe('targetFor — effort as the third lever', () => {
  const ref = (w, r, rir) => ({ w, r, rir, done: true })
  it('asks for one rep closer to failure when weight and reps hold', () => {
    const t = targetFor({ plan: { kind: 'hold', weight: 130, reps: 8 }, reference: ref(130, 8, 2), effort: 'rir' })
    expect(t).toEqual({ w: 130, r: 8, rir: 1 })
  })
  it('walks RPE up instead of down', () => {
    const t = targetFor({ plan: { kind: 'hold', weight: 130 }, reference: { w: 130, r: 8, rpe: 8, done: true }, effort: 'rpe' })
    expect(t).toEqual({ w: 130, r: 8, rpe: 9 })
  })
  it('keeps the effort when the weight goes up — the extra load is the overload', () => {
    const t = targetFor({ plan: { kind: 'up', weight: 132.5 }, reference: ref(130, 8, 2), effort: 'rir' })
    expect(t).toEqual({ w: 132.5, r: 8, rir: 2 })
  })
  it('keeps the effort when the reps go up', () => {
    const t = targetFor({ plan: { kind: 'hold', weight: 130, reps: 9 }, reference: ref(130, 8, 2), effort: 'rir' })
    expect(t).toEqual({ w: 130, r: 9, rir: 2 })
  })
  it('never pushes past failure', () => {
    expect(targetFor({ plan: { kind: 'hold', weight: 130 }, reference: ref(130, 8, 0), effort: 'rir' }).rir).toBe(0)
  })
  it('does not push a fatigued or deloaded session, nor with progression off', () => {
    expect(targetFor({ plan: { kind: 'hold', fatigue: true, weight: 130, reps: 8 }, reference: ref(130, 8, 2), effort: 'rir' }).rir).toBe(2)
    expect(targetFor({ plan: { kind: 'deload', weight: 117.5 }, reference: ref(130, 8, 2), effort: 'rir' }).rir).toBe(2)
    expect(targetFor({ plan: { kind: 'off' }, reference: ref(130, 8, 2), effort: 'rir' }).rir).toBe(2)
  })
  it('sets no effort when none was logged last time or the profile does not log it', () => {
    expect(targetFor({ plan: { kind: 'hold', weight: 130 }, reference: work(130, 8, true), effort: 'rir' })).toEqual({ w: 130, r: 8 })
    expect(targetFor({ plan: { kind: 'hold', weight: 130 }, reference: ref(130, 8, 2), effort: 'none' })).toEqual({ w: 130, r: 8 })
  })
  it('lets suggestionFor offer the effort when the row drifted from it', () => {
    const s = suggestionFor({ plan: { kind: 'hold', weight: 130 }, row: { w: 130, r: 8, rir: 2 }, reference: ref(130, 8, 2), effort: 'rir' })
    expect(s).toEqual({ rir: 1 })
  })
})

describe('seedTargets', () => {
  const prev = [{ w: 130, r: 8, rir: 2, done: true }, { w: 130, r: 7, rir: 1, done: true }]
  it('writes each work row’s target against its own position last time', () => {
    const rows = [warm(65, 5), work(130, 8), work(130, 7), work(130, 7)]
    const out = seedTargets(rows, prev, { plan: { kind: 'hold', weight: 130 }, effort: 'rir' })
    expect(out[0]).toEqual(rows[0])
    expect(out.slice(1).map(s => [s.w, s.r, s.rir])).toEqual([[130, 8, 1], [130, 7, 0], [130, 7, 0]])
  })
  it('never rewrites a logged set', () => {
    const rows = [{ w: 130, r: 8, rir: 3, done: true }, work(130, 7)]
    expect(seedTargets(rows, prev, { plan: { kind: 'hold', weight: 130 }, effort: 'rir' })[0]).toEqual(rows[0])
  })
  it('leaves the rows alone with progression off, on a first session or with no plan', () => {
    const rows = [work(110, 8)]
    expect(seedTargets(rows, prev, { plan: { kind: 'off' }, effort: 'rir' })).toBe(rows)
    expect(seedTargets(rows, prev, { plan: { kind: 'first' }, effort: 'rir' })).toBe(rows)
    expect(seedTargets(rows, prev, { plan: null, effort: 'rir' })).toBe(rows)
  })
  it('moves the weight to the prescription and keeps the effort', () => {
    const out = seedTargets([work(110, 8)], prev, { plan: { kind: 'up', weight: 132.5 }, effort: 'rir' })
    expect(out[0]).toMatchObject({ w: 132.5, r: 8, rir: 2 })
  })
})

describe('per-position weight — a ramp moves as a ramp', () => {
  // Last session: 110×10, 120×9, 130×8 — the prescription is decided from the 130 top set.
  const prev = [{ w: 110, r: 10, done: true }, { w: 120, r: 9, done: true }, { w: 130, r: 8, done: true }]
  const rows = () => [work(130, 8), work(130, 8), work(130, 8)]
  it('holds each set at its own weight instead of flattening it onto the top set', () => {
    const out = seedTargets(rows(), prev, { plan: { kind: 'hold', weight: 130 } })
    expect(out.map(s => s.w)).toEqual([110, 120, 130])
  })
  it('adds the increment to every set of the ramp', () => {
    const out = seedTargets(rows(), prev, { plan: { kind: 'up', weight: 132.5 } })
    expect(out.map(s => s.w)).toEqual([112.5, 122.5, 132.5])
  })
  it('never offers a set less than it lifted last time unless it is a deload', () => {
    const out = seedTargets([work(110, 10), work(110, 10), work(110, 10)], prev, { plan: { kind: 'hold', weight: 130, reps: 10 } })
    out.forEach((s, i) => expect(s.w).toBeGreaterThanOrEqual(prev[i].w))
  })
  it('scales a deload by the same fraction, on loadable steps', () => {
    const out = seedTargets(rows(), prev, { plan: { kind: 'deload', weight: 117.5 }, step: 2.5 })
    expect(out.map(s => s.w)).toEqual([100, 107.5, 117.5])
  })
  it('re-ramps warm-ups toward the first work set it now carries', () => {
    const out = seedTargets([warm(65, 5), ...rows()], prev, { plan: { kind: 'hold', weight: 130 }, step: 2.5 })
    expect(out[0].w).toBe(55)
  })
  it('lets the chip offer the same per-position weight', () => {
    const s = suggestionFor({ plan: { kind: 'hold', weight: 130 }, row: work(130, 9), reference: prev[1], base: 130 })
    expect(s).toEqual({ w: 120 })
  })
})

describe('targetFor — every held set still owes one lever', () => {
  const ref = (w, r, rir) => ({ w, r, rir, done: true })
  // The bug report: 77.5×10 RIR 1 at the top of an 8–10 range, the athlete has not picked
  // weight or a set yet — the row offered 77.5×10 RIR 1 again, which is no overload at all.
  it('takes an undecided set at the top of the range one rep closer to failure', () => {
    const plan = { kind: 'decide', weight: 77.5, reps: 10, top: 10, stride: 1 }
    expect(targetFor({ plan, reference: ref(77.5, 10, 1), effort: 'rir', base: 77.5 })).toEqual({ w: 77.5, r: 10, rir: 0 })
  })
  it('adds a rep to a set the session-wide aim left where it was, keeping the effort', () => {
    // Last time 12, 10, 10 at an 8–12 range: the aim is 11 (weakest + 1), but the first set
    // already did 12 and must not be offered fewer.
    const plan = { kind: 'hold', weight: 60, reps: 11, top: 12, stride: 1 }
    expect(targetFor({ plan, reference: ref(60, 12, 2), effort: 'rir', base: 60 })).toEqual({ w: 60, r: 12, rir: 1 })
    expect(targetFor({ plan, reference: ref(60, 10, 2), effort: 'rir', base: 60 })).toEqual({ w: 60, r: 11, rir: 2 })
  })
  it('walks a held linear set up toward its goal one rep at a time', () => {
    const plan = { kind: 'hold', weight: 100, top: 5, stride: 1 }
    expect(targetFor({ plan, reference: ref(100, 3, 1), effort: 'rir', base: 100 })).toEqual({ w: 100, r: 4, rir: 1 })
  })
  it('steps by two on a per-side lift', () => {
    const plan = { kind: 'hold', weight: 20, reps: 10, top: 14, stride: 2 }
    expect(targetFor({ plan, reference: ref(20, 10, 2), base: 20 })).toEqual({ w: 20, r: 12 })
  })
  it('leaves a fatigued session alone — the engine asked for no overload', () => {
    const plan = { kind: 'hold', fatigue: true, weight: 60, reps: 10, top: 12, stride: 1 }
    expect(targetFor({ plan, reference: ref(60, 10, 2), effort: 'rir', base: 60 })).toEqual({ w: 60, r: 10, rir: 2 })
  })
})

describe('overloadOf', () => {
  it('names each lever that moved, with its sign', () => {
    expect(overloadOf({ w: 80, r: 10, rir: 1 }, { w: 77.5, r: 10, rir: 1 })).toEqual([{ f: 'w', d: 2.5 }])
    expect(overloadOf({ w: 77.5, r: 10, rir: 0 }, { w: 77.5, r: 10, rir: 1 })).toEqual([{ f: 'rir', d: -1 }])
    expect(overloadOf({ w: 85, r: 8 }, { w: 77.5, r: 10 })).toEqual([{ f: 'w', d: 7.5 }, { f: 'r', d: -2 }])
  })
  it('is empty when nothing moved or there is nothing to compare', () => {
    expect(overloadOf({ w: 60, r: 10 }, { w: 60, r: 10 })).toEqual([])
    expect(overloadOf({ w: 60, r: 10 }, null)).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import {
  DELOAD_AFTER, DELOAD_MAX, DELOAD_PCT, emptyMeso, mesoOf, isDeloadCycle,
  mesoState, acceptDeload, postponeDeload, setDeloadPct, applyDeload,
  forceDeloadNow, forceDeloadNext, cancelDeload, exitDeload, deloadNotice, markDeloadNotified, isDeloadWorkout,
  restartMeso,
} from './mesocycle.js'
import { deloadActiveSession, undeloadActiveSession } from './session-start.js'

// A profile whose block is 3 sessions long, so `n` sessions is exactly n/3 microcycles.
const state = (sessions, meso) => ({
  program: { strategy: 'full-body', seq: ['a', 'b', 'c'], cycleStart: '2026-01-01' },
  meso,
  workouts: Array.from({ length: sessions }, (_, i) => ({
    id: 'w' + i, d: '2026-01-' + String(i + 1).padStart(2, '0'), routineId: 'a', entries: [],
  })),
})

describe('when a deload is due', () => {
  it('says nothing for the first three loading microcycles', () => {
    expect(mesoState(state(0)).suggest).toBe(false)
    expect(mesoState(state(8)).suggest).toBe(false)   // 2 closed, third under way
    expect(DELOAD_AFTER).toBe(3)
  })

  it('suggests once three are closed', () => {
    const st = mesoState(state(9))
    expect(st.streak).toBe(3)
    expect(st.suggest).toBe(true)
    expect(st.mandatory).toBe(false)
  })

  it('stops being optional past five in a row', () => {
    expect(mesoState(state(15)).mandatory).toBe(true)
    expect(DELOAD_MAX).toBe(5)
  })
})

describe('accepting and postponing', () => {
  it('marks the block that has not started yet', () => {
    // Nine sessions: block 3 is due to open, so accepting deloads block 3 itself.
    expect(acceptDeload(state(9)).deloads).toEqual([3])
    // Ten: block 3 is already under way at full load, so the deload is block 4.
    expect(acceptDeload(state(10)).deloads).toEqual([4])
  })

  it('goes quiet once a deload is on the books', () => {
    const S = state(10, { deloads: [4] })
    expect(mesoState(S).scheduled).toBe(true)
    expect(mesoState(S).suggest).toBe(false)
  })

  it('holds its tongue for the rest of a postponed microcycle, then asks again', () => {
    const S = state(9)
    const meso = postponeDeload(S)
    expect(meso.postponed).toEqual([3])
    expect(mesoState({ ...S, meso }).suggest).toBe(false)
    // Next microcycle opens — same question, one microcycle later.
    expect(mesoState({ ...state(12), meso }).suggest).toBe(true)
  })

  it('asks anyway once the ceiling is reached, postponed or not', () => {
    const meso = { deloads: [], postponed: [5], pct: 0.4 }
    const st = mesoState({ ...state(15), meso })
    expect(st.streak).toBe(5)
    expect(st.suggest).toBe(true)
  })

  it('resets the streak after the deload and counts from there', () => {
    const S = state(15, { deloads: [3] })       // block 3 was the deload, blocks 4 came after
    expect(mesoState(S).streak).toBe(1)
    expect(mesoState(S).suggest).toBe(false)
  })

  it('knows the microcycle being trained right now is the deload', () => {
    expect(isDeloadCycle(state(10, { deloads: [3] }), 3)).toBe(true)
    expect(mesoState(state(10, { deloads: [3] })).deload).toBe(true)
  })
})

describe('the remembered cut', () => {
  it('defaults to 40% and holds to the 25–50% band', () => {
    expect(emptyMeso().pct).toBe(DELOAD_PCT.def)
    expect(mesoOf({}).pct).toBe(0.4)
    expect(setDeloadPct({}, 0.3).pct).toBe(0.3)
    expect(setDeloadPct({}, 0.9).pct).toBe(DELOAD_PCT.max)
    expect(setDeloadPct({}, 0.1).pct).toBe(DELOAD_PCT.min)
    expect(mesoOf({ meso: { pct: 0.8 } }).pct).toBe(DELOAD_PCT.def)   // out of band, ignored
  })
})

describe('applyDeload', () => {
  const work = (w, r, extra = {}) => ({ w, r, done: false, ...extra })

  it('cuts weight, reps and set count together', () => {
    const rows = [work(100, 10), work(100, 10), work(100, 10), work(100, 10)]
    const out = applyDeload(rows, 0.5, 2.5)
    expect(out.length).toBe(2)                 // half the sets
    expect(out[0]).toMatchObject({ w: 50, r: 5 })
  })

  it('rounds the weight to something loadable and never to nothing', () => {
    expect(applyDeload([work(47.5, 8)], 0.25, 2.5)[0].w).toBe(35)   // 35.6 → 35
    expect(applyDeload([work(2, 8)], 0.5, 5)[0].w).toBe(5)          // one increment, not 0
    expect(applyDeload([work(0, 20)], 0.4, 2.5)[0].w).toBe(0)       // bodyweight stays bodyweight
  })

  it('walks warm-ups down with the weight but leaves their reps alone', () => {
    const rows = [work(60, 5, { phase: 'warmup' }), work(100, 10), work(100, 10)]
    const out = applyDeload(rows, 0.4, 2.5)
    expect(out[0]).toMatchObject({ w: 35, r: 5 })     // 36 → 35, reps untouched
    expect(out[1].r).toBe(6)
  })

  it('cuts a timed set by duration, and a cardio set by minutes', () => {
    expect(applyDeload([{ sec: 60, w: 0, done: false }], 0.5)[0].sec).toBe(30)
    expect(applyDeload([{ min: 20, speed: 8, done: false }], 0.5)[0]).toMatchObject({ min: 10, speed: 8 })
  })

  it('never rewrites or drops a set already logged', () => {
    const rows = [work(100, 10, { done: true }), work(100, 10), work(100, 10), work(100, 10)]
    const out = applyDeload(rows, 0.5, 2.5)
    expect(out[0]).toMatchObject({ w: 100, r: 10, done: true })
    expect(out.length).toBe(2)
    // Two work sets of four survive, and the one already logged is one of them.
  })

  it('always leaves one work set standing', () => {
    expect(applyDeload([work(100, 10)], 0.5, 2.5).length).toBe(1)
  })
})

describe('forcing a deload at any time', () => {
  it('deloads the microcycle being trained, at its start or half-way through', () => {
    expect(forceDeloadNow(state(9)).deloads).toEqual([3])     // block 3 not started
    expect(forceDeloadNow(state(10)).deloads).toEqual([3])    // block 3 one session in
    expect(mesoState({ ...state(10), meso: forceDeloadNow(state(10)) }).deload).toBe(true)
  })
  it('needs no suggestion or streak behind it', () => {
    expect(mesoState(state(1)).suggest).toBe(false)
    expect(forceDeloadNow(state(1)).deloads).toEqual([0])
  })
  it('can mark the next microcycle instead', () => {
    const meso = forceDeloadNext(state(4))
    expect(meso.deloads).toEqual([2])
    const st = mesoState({ ...state(4), meso })
    expect(st.deload).toBe(false)
    expect(st.next).toBe(true)
  })
  it('takes it back, and does not suggest it again in the same microcycle', () => {
    const forced = { ...state(10), meso: forceDeloadNow(state(10)) }
    const meso = cancelDeload(forced)
    expect(meso.deloads).toEqual([])
    expect(mesoState({ ...state(10), meso }).suggest).toBe(false)
  })
})

describe('announcing a deload', () => {
  it('announces a running deload once', () => {
    const st = { ...state(10), meso: forceDeloadNow(state(10)) }
    expect(deloadNotice(st)).toBe(3)
    expect(deloadNotice({ ...st, meso: markDeloadNotified(st) })).toBe(null)
  })
  it('says nothing for a deload that has not started yet', () => {
    expect(deloadNotice({ ...state(4), meso: forceDeloadNext(state(4)) })).toBe(null)
  })
})

describe('deload sessions', () => {
  it('knows a session trained as a deload — and only that', () => {
    expect(isDeloadWorkout({ deload: 0.4 })).toBe(true)
    // A routine kept out of progression is not by itself a deload.
    expect(isDeloadWorkout({ excludeFromProgression: true })).toBe(false)
    expect(isDeloadWorkout({})).toBe(false)
  })
  it('brings a session in progress down from the next set on, keeping what was logged', () => {
    const row = done => ({ w: 100, r: 10, done })
    const active = { id: 'x', entries: [{ id: 'nope', sets: [row(true), row(false), row(false), row(false), row(false)] }] }
    const out = deloadActiveSession(active, 0.4)
    expect(out.deload).toBe(0.4)
    expect(out.excludeFromProgression).toBe(true)
    const sets = out.entries[0].sets
    expect(sets[0]).toEqual(row(true))                 // logged: untouched
    expect(sets).toHaveLength(3)                       // 5 sets → 3, cut from the end
    expect(sets[1]).toMatchObject({ w: 60, r: 6 })
    expect(deloadActiveSession(out, 0.4)).toBe(out)
  })
})

describe('leaving a deload at any time', () => {
  it('puts the rest of the microcycle back to full load and does not suggest it again there', () => {
    const st = { ...state(10), meso: forceDeloadNow(state(10)) }
    const meso = exitDeload(st)
    expect(meso.deloads).toEqual([])
    const after = mesoState({ ...state(10), meso })
    expect(after.deload).toBe(false)
    expect(after.suggest).toBe(false)
  })
  it('leaves a deload already marked for the next microcycle alone', () => {
    const base = state(10)
    const marked = { ...base, meso: { deloads: [3, 4], pct: 0.4 } }
    expect(exitDeload(marked).deloads).toEqual([4])
  })
  it('rebuilds the unlogged rows of a session in progress at full load, keeping the logged ones', () => {
    const st = {
      unit: 'kg', routines: [], exWeights: {}, effort: 'none',
      workouts: [{ id: 'p', d: '2026-01-01', entries: [{ id: 'nope', target: { sets: 3, reps: 10 }, sets: [
        { w: 100, r: 10, done: true }, { w: 100, r: 10, done: true }, { w: 100, r: 10, done: true }] }] }],
    }
    const active = deloadActiveSession({ id: 'x', routineId: null, entries: [{ id: 'nope', target: { sets: 3, reps: 10 }, sets: [
      { w: 100, r: 10, done: true }, { w: 100, r: 10, done: false }, { w: 100, r: 10, done: false }] }] }, 0.4)
    const out = undeloadActiveSession(active, st)
    expect(out.deload).toBeUndefined()
    expect(out.excludeFromProgression).toBeUndefined()
    const sets = out.entries[0].sets
    expect(sets[0]).toEqual({ w: 100, r: 10, done: true })
    expect(sets).toHaveLength(3)
    expect(sets.slice(1).every(x => x.w >= 100 && !x.done)).toBe(true)
    expect(undeloadActiveSession(out, st)).toBe(out)
  })
})

describe('restarting the block count', () => {
  it('drops every microcycle index but keeps the chosen cut', () => {
    const meso = { deloads: [2, 5], postponed: [1], notified: [2], pct: 0.3 }
    expect(restartMeso({ meso })).toEqual({ deloads: [], postponed: [], notified: [], pct: 0.3 })
  })

  it('works on a profile that never had a mesocycle', () => {
    expect(restartMeso({})).toEqual({ deloads: [], postponed: [], notified: [], pct: DELOAD_PCT.def })
  })

  it('leaves a fresh block with no streak and no suggestion', () => {
    const st = mesoState({ ...state(0), meso: restartMeso({ meso: { deloads: [0], postponed: [], notified: [0] } }) })
    expect(st).toMatchObject({ cycle: 0, deload: false, streak: 0, suggest: false })
  })
})

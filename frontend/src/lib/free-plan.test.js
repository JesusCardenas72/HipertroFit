import { describe, it, expect } from 'vitest'
import { freePlanItem, stepFreeSets, freePlanVolume, freePlanProjection, freePlanEntries, FREE_MAX_SETS, toggleFreeLink, linkedToNext, removeFreeItem, freePlanDraft } from './free-plan.js'
import { isWarmupRow } from './workout-model.js'

// Single-muscle exercises with inline metadata (ids not in the catalogue), as in volume.test.js.
const curl = { id: 'curl', tg: 'biceps' }
const squat = { id: 'squat', tg: 'quads' }
const routines = [
  { id: 'push', ex: [{ id: 'curl', tg: 'biceps', sets: 3 }] },
  { id: 'legs', ex: [{ id: 'squat', tg: 'quads', sets: 4 }] },
]
const TODAY = '2026-09-02'
const S = (workouts = []) => ({
  unit: 'kg', exWeights: {}, routines, workouts, cycleLog: [],
  program: { on: false, seq: ['push', 'legs'], anchor: '2026-09-01', strategy: 'custom' },
})
const done = { done: true, w: 20, r: 10 }
const logged = (d, routineId, ex, n) => ({ d, routineId, entries: [{ ...ex, sets: Array.from({ length: n }, () => ({ ...done })) }] })
const row = (st, items, key) => freePlanProjection(st, items, TODAY).find(g => g.key === key)

describe('free plan lines', () => {
  it('starts an exercise without history at the default three sets', () => {
    expect(freePlanItem(S(), curl)).toMatchObject({ id: 'curl', sets: 3 })
  })
  it('starts an exercise at the sets it was last trained with', () => {
    expect(freePlanItem(S([logged('2026-09-01', null, curl, 5)]), curl).sets).toBe(5)
  })
  it('keeps the sets between 1 and the cap', () => {
    const items = [{ id: 'curl', ex: curl, sets: 1 }]
    expect(stepFreeSets(items, 0, -1)[0].sets).toBe(1)
    expect(stepFreeSets([{ ...items[0], sets: FREE_MAX_SETS }], 0, 1)[0].sets).toBe(FREE_MAX_SETS)
    expect(stepFreeSets(items, 0, 2)[0].sets).toBe(3)
  })
})

describe('supersets in the plan', () => {
  const line = (id, sg) => ({ id, sets: 3, ...(sg ? { sg } : {}) })
  it('joins a line with the next one', () => {
    const out = toggleFreeLink([line('a'), line('b'), line('c')], 0)
    expect(out[0].sg).toBeTruthy()
    expect(out[0].sg).toBe(out[1].sg)
    expect(out[2].sg).toBeUndefined()
    expect(linkedToNext(out, 0)).toBe(true)
    expect(linkedToNext(out, 1)).toBe(false)
  })
  it('extends a superset to a third line', () => {
    const out = toggleFreeLink([line('a', 'x'), line('b', 'x'), line('c')], 1)
    expect(out.map(it => it.sg)).toEqual(['x', 'x', 'x'])
  })
  it('splits a superset at the link, undoing a line left alone', () => {
    const out = toggleFreeLink([line('a', 'x'), line('b', 'x'), line('c', 'x')], 0)
    expect(out[0].sg).toBeUndefined()
    expect(out[1].sg).toBeTruthy()
    expect(out[1].sg).toBe(out[2].sg)
    expect(out[1].sg).not.toBe('x')
    const pair = toggleFreeLink([line('a', 'x'), line('b', 'x')], 0)
    expect(pair.every(it => !it.sg)).toBe(true)
  })
  it('removing a line undoes a superset left with one exercise', () => {
    const out = removeFreeItem([line('a', 'x'), line('b', 'x'), line('c')], 1)
    expect(out).toEqual([line('a'), line('c')])
  })
  it('carries the superset into the session entries', () => {
    const entries = freePlanEntries(S(), [line('curl', 'x'), line('squat', 'x')])
    expect(entries.map(e => e.sg)).toEqual(['x', 'x'])
  })
})

describe('freePlanDraft', () => {
  it('keeps id, sets and superset of each line, nothing else', () => {
    expect(freePlanDraft([{ id: 'curl', ex: curl, sets: 4, sg: 'x' }, { id: 'squat', ex: squat, sets: 2, sg: 'x' }]))
      .toEqual([{ id: 'curl', sets: 4, sg: 'x' }, { id: 'squat', sets: 2, sg: 'x' }])
  })
  it('reads a broken draft safely', () => {
    expect(freePlanDraft(null)).toEqual([])
    expect(freePlanDraft([null, { sets: 3 }, { id: 'curl', sets: 99, sg: 'x' }])).toEqual([{ id: 'curl', sets: FREE_MAX_SETS }])
  })
})

describe('freePlanVolume', () => {
  it('credits each group the planned work sets', () => {
    const g = freePlanVolume([{ id: 'curl', ex: curl, sets: 4 }, { id: 'squat', ex: squat, sets: 2 }])
    expect(g.biceps).toBe(4)
    expect(g.legs).toBe(2)
  })
})

describe('freePlanProjection', () => {
  it('adds the session on top of what is done and what the block still plans', () => {
    // push done with 3 curl sets; legs still ahead; the freestyle session adds 4 more curls.
    const st = S([logged('2026-09-01', 'push', curl, 3)])
    const b = row(st, [{ id: 'curl', ex: curl, sets: 4 }], 'biceps')
    expect(b).toMatchObject({ done: 3, ahead: 0, before: 3, added: 4, after: 7 })
    const l = row(st, [{ id: 'curl', ex: curl, sets: 4 }], 'legs')
    expect(l).toMatchObject({ done: 0, ahead: 4, before: 4, added: 0, after: 4 })
  })
  it('does not take a step of the sequence: what is still planned stays ahead', () => {
    const b = row(S(), [{ id: 'curl', ex: curl, sets: 2 }], 'biceps')
    expect(b).toMatchObject({ ahead: 3, before: 3, after: 5 })
  })
  it('reads the band before and after, and flags a session that passes the maximum', () => {
    const empty = row(S(), [], 'biceps')
    expect(empty.statusBefore).toBe('low')
    expect(empty.over).toBe(false)
    const toMin = row(S(), [{ id: 'curl', ex: curl, sets: empty.min - empty.before }], 'biceps')
    expect(toMin.status).toBe('ok')
    expect(toMin.over).toBe(false)
    const past = row(S(), [{ id: 'curl', ex: curl, sets: 10 }, { id: 'curl', ex: curl, sets: 10 }], 'biceps')
    expect(past.after).toBeGreaterThan(past.max)
    expect(past.status).toBe('high')
    expect(past.over).toBe(true)
  })
})

describe('freePlanEntries', () => {
  it('builds exactly the planned work sets, none of them done', () => {
    const [e] = freePlanEntries(S(), [{ id: 'curl', ex: curl, sets: 4 }])
    expect(e.id).toBe('curl')
    expect(e.target.sets).toBe(4)
    expect(e.sets.filter(s => !isWarmupRow(s))).toHaveLength(4)
    expect(e.sets.every(s => !s.done)).toBe(true)
  })
  it('overrides the set count history would give, carrying the last rows', () => {
    const st = S([logged('2026-09-01', null, curl, 5)])
    const [fewer] = freePlanEntries(st, [{ id: 'curl', ex: curl, sets: 2 }])
    expect(fewer.sets).toHaveLength(2)
    const [more] = freePlanEntries(st, [{ id: 'curl', ex: curl, sets: 7 }])
    expect(more.sets).toHaveLength(7)
    expect(more.sets[6]).toMatchObject({ w: 20, r: 10, done: false })
  })
})

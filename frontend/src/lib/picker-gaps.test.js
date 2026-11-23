import { describe, it, expect } from 'vitest'
import { pickerGaps, pickerGapList } from './picker-gaps.js'

// Biceps' classic band is 14–20; whole legs (unsplit) 10–20. A push/legs sequence plans one
// round per microcycle: 3 biceps sets and 4 leg sets.
const TODAY = '2026-09-02'
const curl = sets => ({ id: 'curl', tg: 'biceps', sets })
const squat = sets => ({ id: 'squat', tg: 'quads', sets })
const S = ({ push = 3, workouts = [], active = null, extra = 2 } = {}) => ({
  routines: [
    { id: 'push', ex: [curl(push)] },
    { id: 'legs', ex: [squat(4)] },
    { id: 'extra', ex: [curl(extra)] },
  ],
  workouts, active, paused: [], cycleLog: [],
  program: { on: false, seq: ['push', 'legs'], anchor: '2026-09-01', strategy: 'custom' },
})
const row = (r, key) => r.gaps.find(g => g.key === key)
const set = done => ({ done, w: 10, r: 10 })

describe('pickerGaps', () => {
  it('reads a routine of the sequence against the microcycle as programmed', () => {
    const r = pickerGaps(S(), { routineId: 'push' }, TODAY)
    expect(r.basis).toBe('plan')
    expect(row(r, 'biceps').remaining).toBe(11)
    expect(row(r, 'legs').remaining).toBe(6)
  })
  it('moves with every set added to that routine', () => {
    expect(row(pickerGaps(S({ push: 7 }), { routineId: 'push' }, TODAY), 'biceps').remaining).toBe(7)
    const over = row(pickerGaps(S({ push: 23 }), { routineId: 'push' }, TODAY), 'biceps')
    expect(over.remaining).toBe(0)
    expect(over.excess).toBe(3)
  })
  it('reads a routine outside the sequence as done on top of the running microcycle', () => {
    const r = pickerGaps(S({ extra: 5 }), { routineId: 'extra' }, TODAY)
    expect(r.basis).toBe('cycle')
    expect(row(r, 'biceps').remaining).toBe(6)   // 14 − 3 planned − 5 here
  })
  it('counts the running session of a step instead of that step’s plan', () => {
    // 2 curls done and 3 still to do replace the 3 the push step plans: 5 of 14.
    const active = { id: 'w1', d: TODAY, routineId: 'push', entries: [curl([set(true), set(true), set(false), set(false), set(false)])] }
    const r = pickerGaps(S({ active }), {}, TODAY)
    expect(r.basis).toBe('cycle')
    expect(row(r, 'biceps').remaining).toBe(9)
    expect(row(r, 'legs').remaining).toBe(6)
  })
  it('adds a freestyle session on top of everything the block plans', () => {
    const active = { id: 'w1', d: TODAY, routineId: null, entries: [curl([set(true), set(false)])] }
    expect(row(pickerGaps(S({ active }), {}, TODAY), 'biceps').remaining).toBe(9)   // 14 − 3 − 2
  })
  it('takes volume planned outside the store', () => {
    expect(row(pickerGaps(S(), { adds: { biceps: 4 } }, TODAY), 'biceps').remaining).toBe(7)
  })
  it('leaves a past workout being logged out of the running block', () => {
    const active = { id: 'w1', d: '2026-08-01', backfill: true, routineId: null, entries: [curl([set(true)])] }
    expect(row(pickerGaps(S({ active }), {}, TODAY), 'biceps').remaining).toBe(11)
  })
})

describe('pickerGapList', () => {
  const g = (key, remaining, excess = 0) => ({ key, remaining, excess })
  it('lists the groups short of their minimum, most missing first, then those over, most over first', () => {
    const { short, over } = pickerGapList([g('a', 2), g('b', 0, 1), g('c', 6), g('d', 0), g('e', 0, 4), g('f', 2)])
    expect(short.map(x => x.key)).toEqual(['c', 'a', 'f'])
    expect(over.map(x => x.key)).toEqual(['e', 'b'])
  })
  it('leaves the groups in range out', () => {
    expect(pickerGapList([g('a', 0)])).toEqual({ short: [], over: [] })
  })
})

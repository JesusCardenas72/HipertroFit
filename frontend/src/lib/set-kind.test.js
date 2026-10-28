import { describe, it, expect } from 'vitest'
import { setKindOf, withSetKind, dropCutPct, followDrop, wheelValues, DROP_PCT } from './set-kind.js'
import { isWarmupRow, isDropSet, dropsOf } from './workout-model.js'

describe('setKindOf', () => {
  it('reads every kind the row can carry', () => {
    expect(setKindOf({ w: 60, r: 10 })).toBe('normal')
    expect(setKindOf({ phase: 'warmup' })).toBe('warmup')
    expect(setKindOf({ warmup: true })).toBe('warmup')
    expect(setKindOf({ fail: true })).toBe('failure')
    expect(setKindOf({ type: 'dropset', drops: [] })).toBe('drop')
    expect(setKindOf({ type: 'restpause' })).toBe('restpause')
    expect(setKindOf(null)).toBe('normal')
  })
})

describe('withSetKind', () => {
  it('turns a work set into a warm-up without its effort, failure mark or drops', () => {
    const row = withSetKind({ w: 60, r: 10, rir: 1, fail: true, done: true }, 'warmup')
    expect(isWarmupRow(row)).toBe(true)
    expect(row).toEqual({ w: 60, r: 10, done: true, phase: 'warmup', warmup: true })
    const fromDrop = withSetKind({ w: 60, r: 10, type: 'dropset', drops: [{ w: 45, r: 8 }] }, 'warmup')
    expect(isDropSet(fromDrop)).toBe(false)
    expect(dropsOf(fromDrop)).toEqual([])
  })

  it('brings a warm-up back as a work set', () => {
    const row = withSetKind({ w: 40, r: 12, phase: 'warmup', warmup: true }, 'normal')
    expect(isWarmupRow(row)).toBe(false)
    expect(row).toEqual({ w: 40, r: 12 })
  })

  it('marks failure and logs the failure effort only where none was logged', () => {
    expect(withSetKind({ w: 60, r: 10 }, 'failure', { failure: { f: 'rir', v: 0 } })).toEqual({ w: 60, r: 10, fail: true, rir: 0 })
    expect(withSetKind({ w: 60, r: 10, rpe: 9 }, 'failure', { failure: { f: 'rpe', v: 10 } }).rpe).toBe(9)
    expect(withSetKind({ w: 60, r: 10, fail: true }, 'normal')).toEqual({ w: 60, r: 10 })
  })

  it('hangs a drop 25 % lighter off the set, with the same reps', () => {
    expect(DROP_PCT).toBe(25)
    const row = withSetKind({ w: 60, r: 10, done: true }, 'drop')
    expect(isDropSet(row)).toBe(true)
    expect(row.done).toBe(true)
    expect(dropsOf(row)).toEqual([{ w: 45, r: 10 }])
    // the caller's snapped weight wins (adjustable dumbbells land on a rung)
    expect(dropsOf(withSetKind({ w: 20, r: 10 }, 'drop', { dropWeight: 14.5 }))[0].w).toBe(14.5)
  })

  it('gives a rest-pause row its activation reps back when it changes kind', () => {
    const rp = { w: 60, r: 14, type: 'restpause', clusters: [{ r: 3, restSec: 15 }, { r: 1, restSec: 15 }] }
    expect(withSetKind(rp, 'normal')).toEqual({ w: 60, r: 10 })
  })

  it('leaves a row alone when it already is that kind', () => {
    const row = { w: 60, r: 10, type: 'dropset', drops: [{ w: 40, r: 6 }] }
    expect(withSetKind(row, 'drop')).toBe(row)
  })
})

describe('followDrop', () => {
  it('keeps the drop 25 % under a set whose weight changed', () => {
    const row = { w: 65, r: 10, type: 'dropset', drops: [{ w: 45, r: 10, done: false }, { w: 30, r: 8 }] }
    expect(followDrop(row, 60).drops).toEqual([{ w: 49, r: 10, done: false }, { w: 30, r: 8 }])
  })

  it('leaves a drop typed by hand, and anything that is not a drop-set', () => {
    const row = { w: 65, r: 10, type: 'dropset', drops: [{ w: 40, r: 10 }] }
    expect(followDrop(row, 60)).toBe(row)
    const plain = { w: 65, r: 10 }
    expect(followDrop(plain, 60)).toBe(plain)
  })
})

describe('dropCutPct', () => {
  it('is the whole-percent cut from the weight before', () => {
    expect(dropCutPct(60, 45)).toBe(25)
    expect(dropCutPct(57.5, 42.5)).toBe(26)
    expect(dropCutPct(0, 10)).toBe(0)
  })
})

describe('wheelValues', () => {
  it('walks from the floor to the top in steps', () => {
    expect(wheelValues(2, { step: 1, max: 4 })).toEqual([0, 1, 2, 3, 4])
    expect(wheelValues(60, { step: 1.25, max: 2.5 }).slice(0, 3)).toEqual([0, 1.25, 2.5])
  })

  it('reaches past the top for a heavier current value, and slots an off-grid one in', () => {
    expect(wheelValues(6, { step: 2, max: 4 })).toEqual([0, 2, 4, 6])
    expect(wheelValues(3, { step: 2, max: 4 })).toEqual([0, 2, 3, 4])
  })

  it('walks a ladder from its first rung, with 0 below it', () => {
    expect(wheelValues(7, { step: { from: 4, step: 1.5 }, max: 8.5 })).toEqual([0, 4, 5.5, 7, 8.5])
  })

  it('stops a ladder at its last rung instead of the top', () => {
    const v = wheelValues(7, { step: { from: 4, to: 32.5, step: 1.5 }, max: 300 })
    expect(v[1]).toBe(4)
    expect(v[v.length - 1]).toBe(32.5)
    expect(v).toHaveLength(21)
  })

  it('starts the effort wheel with nothing logged', () => {
    expect(wheelValues(null, { step: 0.5, min: 9, max: 10, empty: true })).toEqual([null, 9, 9.5, 10])
  })
})

import { describe, it, expect } from 'vitest'
import { overloadTargetFor, overloadOf } from './set-reference.js'

const last = { w: 87.5, r: 8, rir: 3.5 }

describe('overloadTargetFor', () => {
  it('adds a rep while the set is under the top of its rep range, keeping the load and effort', () => {
    expect(overloadTargetFor({ reference: last, top: 12, effort: 'rir' })).toEqual({ w: 87.5, r: 9, rir: 3.5 })
  })

  it('at the top of the range, one rep closer to failure on the effort scale', () => {
    expect(overloadTargetFor({ reference: last, top: 8, effort: 'rir' })).toEqual({ w: 87.5, r: 8, rir: 2.5 })
  })

  it('at the top of the range with no effort logged, the next load step, reps kept', () => {
    expect(overloadTargetFor({ reference: { w: 87.5, r: 8 }, top: 8, step: 2.5 })).toEqual({ w: 90, r: 8 })
  })

  it('RPE goes up toward failure, and never past the scale', () => {
    expect(overloadTargetFor({ reference: { w: 60, r: 10, rpe: 9 }, top: 10, effort: 'rpe' })).toEqual({ w: 60, r: 10, rpe: 10 })
    expect(overloadTargetFor({ reference: { w: 60, r: 10, rpe: 10 }, top: 10, effort: 'rpe' })).toEqual({ w: 62.5, r: 10, rpe: 10 })
  })

  it('moves every lever: reps, then effort, then load, each time it is the one left', () => {
    const at = (reference, top) => overloadTargetFor({ reference, top, effort: 'rir', step: 2.5 })
    const first = at({ w: 80, r: 6, rir: 2 }, 10)
    expect(overloadOf(first, { w: 80, r: 6, rir: 2 }).map(x => x.f)).toEqual(['r'])
    const second = at({ w: 80, r: 10, rir: 2 }, 10)
    expect(overloadOf(second, { w: 80, r: 10, rir: 2 }).map(x => x.f)).toEqual(['rir'])
    const third = at({ w: 80, r: 10, rir: 0 }, 10)
    expect(overloadOf(third, { w: 80, r: 10, rir: 0 }).map(x => x.f)).toEqual(['w'])
  })

  it('takes the load step from a ladder when one is given', () => {
    const ladder = { from: 0, step: 1.5 }
    expect(overloadTargetFor({ reference: { w: 7.5, r: 8 }, top: 8, step: ladder }).w).toBe(9)
  })

  it('has nothing to aim at without a reference, outside reps mode, or without a load', () => {
    expect(overloadTargetFor({ reference: null, top: 12 })).toBeNull()
    expect(overloadTargetFor({ mode: 'time', reference: { sec: 30 }, top: 12 })).toBeNull()
    expect(overloadTargetFor({ reference: { r: 8 }, top: 12 })).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { trainsMuscle, muscleGroupCounts } from './muscle-groups.js'
import { MUSCLES } from './muscles.js'

const bench = { id: 'b', tg: 'chest', mg: 'triceps', sm: ['deltoids'] }
const squat = { id: 's', tg: 'quadriceps', mg: 'gluteal', sm: ['hamstring'] }

describe('trainsMuscle', () => {
  it('is true for primary and secondary muscles', () => {
    expect(trainsMuscle(bench, 'chest')).toBe(true)
    expect(trainsMuscle(bench, 'triceps')).toBe(true)
  })

  it('is false for muscles the exercise does not touch, and for no slug', () => {
    expect(trainsMuscle(bench, 'quadriceps')).toBe(false)
    expect(trainsMuscle(bench, undefined)).toBe(false)
  })
})

describe('muscleGroupCounts', () => {
  it('returns every drawable muscle once, in body order', () => {
    const counts = muscleGroupCounts([])
    expect(counts.map(c => c.slug)).toEqual(MUSCLES)
    expect(counts.every(c => c.count === 0)).toBe(true)
  })

  it('counts each exercise once per muscle it trains', () => {
    const counts = Object.fromEntries(muscleGroupCounts([bench, squat, bench]).map(c => [c.slug, c.count]))
    expect(counts.chest).toBe(2)
    expect(counts.deltoids).toBe(2)
    expect(counts.quadriceps).toBe(1)
    expect(counts.hamstring).toBe(1)
    expect(counts.calves).toBe(0)
  })
})

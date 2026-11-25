import { describe, it, expect } from 'vitest'
import { normalizeMeasure, measuresOf, addMeasure, removeMeasure, seriesOf, measuredKeys, trendOf, lengthUnit } from './measures.js'

describe('measures', () => {
  it('keeps known positive measurements of a dated entry', () => {
    expect(normalizeMeasure({ d: '2026-11-01', arm: '38.25', waist: 0, wings: 3 })).toEqual({ d: '2026-11-01', arm: 38.3 })
    expect(normalizeMeasure({ d: '2026-11-01', waist: -2 })).toBeNull()
    expect(normalizeMeasure({ arm: 38 })).toBeNull()
  })

  it('files one entry per day, merging a second measurement of the same day', () => {
    let list = addMeasure([], { d: '2026-11-08', arm: 38, waist: 82 })
    list = addMeasure(list, { d: '2026-11-01', arm: 37.5 })
    list = addMeasure(list, { d: '2026-11-08', waist: 81.5 })
    expect(list).toEqual([
      { d: '2026-11-01', arm: 37.5 },
      { d: '2026-11-08', arm: 38, waist: 81.5 },
    ])
    expect(removeMeasure(list, '2026-11-01')).toEqual([{ d: '2026-11-08', arm: 38, waist: 81.5 }])
  })

  it('reads a profile’s list tidied and sorted, old states included', () => {
    expect(measuresOf({})).toEqual([])
    expect(measuresOf({ measures: [{ d: '2026-11-08', arm: 38 }, null, { d: '2026-11-01', arm: 37 }] }).map(e => e.d)).toEqual(['2026-11-01', '2026-11-08'])
  })

  it('charts one measurement and says how it moved', () => {
    const list = [{ d: '2026-11-01', arm: 37.5, waist: 83 }, { d: '2026-11-08', waist: 82 }, { d: '2026-11-15', arm: 38.2, waist: 81.6 }]
    expect(seriesOf(list, 'arm').map(p => [p.d, p.y])).toEqual([['2026-11-01', 37.5], ['2026-11-15', 38.2]])
    expect(measuredKeys(list)).toEqual(['arm', 'waist'])
    expect(trendOf(list, 'waist')).toEqual({ v: 81.6, d: '2026-11-15', delta: -1.4, since: '2026-11-01' })
    expect(trendOf(list, 'calf')).toBeNull()
  })

  it('measures in inches on a pound profile', () => {
    expect(lengthUnit({ unit: 'lb' })).toBe('in')
    expect(lengthUnit({ unit: 'kg' })).toBe('cm')
  })
})

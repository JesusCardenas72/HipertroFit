import { describe, it, expect } from 'vitest'
import { loadBar, platesFor, barFor, platesOf, isPlateLoaded, sideLabel, DEFAULT_PLATES } from './plates.js'

const BB = { eq: 'barbell' }
const EZ = { eq: 'ez barbell' }

describe('loadBar', () => {
  it('splits what is past the bar into pairs, heaviest plate first', () => {
    expect(loadBar(100, 20, DEFAULT_PLATES.kg)).toEqual({ side: [25, 15], rest: 0, short: false })
    expect(loadBar(102.5, 20, DEFAULT_PLATES.kg)).toEqual({ side: [25, 15, 1.25], rest: 0, short: false })
    expect(loadBar(140, 20, DEFAULT_PLATES.kg).side).toEqual([25, 25, 10])
  })

  it('reports what no plate can make instead of rounding it away', () => {
    expect(loadBar(101, 20, DEFAULT_PLATES.kg)).toEqual({ side: [25, 15], rest: 0.5, short: false })
  })

  it('handles the empty bar and a total below it', () => {
    expect(loadBar(20, 20, DEFAULT_PLATES.kg)).toEqual({ side: [], rest: 0, short: false })
    expect(loadBar(15, 20, DEFAULT_PLATES.kg)).toEqual({ side: [], rest: 0, short: true })
  })
})

describe('the profile’s bar and plates', () => {
  it('knows which exercises go on a bar', () => {
    expect(isPlateLoaded(BB)).toBe(true)
    expect(isPlateLoaded({ eq: 'trap bar' })).toBe(true)
    expect(isPlateLoaded({ eq: 'dumbbell' })).toBe(false)
    expect(isPlateLoaded(null)).toBe(false)
  })

  it('takes the straight bar from the settings, the others by type, in the profile’s unit', () => {
    expect(barFor({ unit: 'kg' }, BB)).toBe(20)
    expect(barFor({ unit: 'kg', barWeight: 15 }, BB)).toBe(15)
    expect(barFor({ unit: 'kg', barWeight: 15 }, EZ)).toBe(10)
    expect(barFor({ unit: 'lb' }, BB)).toBe(45)
    expect(barFor({ unit: 'kg' }, { eq: 'cable' })).toBeNull()
  })

  it('uses the plates the user picked, ignoring ones the unit does not offer', () => {
    expect(platesOf({ unit: 'kg', plateSet: [10, 20, 1.25, 7] })).toEqual([20, 10, 1.25])
    expect(platesOf({ unit: 'kg', plateSet: [] })).toEqual(DEFAULT_PLATES.kg)
    expect(platesOf({ unit: 'lb' })).toEqual(DEFAULT_PLATES.lb)
  })

  it('puts it together for one exercise', () => {
    expect(platesFor({ unit: 'kg', plateSet: [20, 10, 5] }, BB, 90)).toEqual({ bar: 20, side: [20, 10, 5], rest: 0, short: false })
    expect(platesFor({ unit: 'kg' }, { eq: 'dumbbell' }, 30)).toBeNull()
  })
})

describe('sideLabel', () => {
  it('groups a repeated plate', () => {
    expect(sideLabel([25, 25, 10, 2.5])).toBe('2 × 25 + 10 + 2.5')
    expect(sideLabel([1.25], v => String(v).replace('.', ','))).toBe('1,25')
    expect(sideLabel([])).toBe('')
  })
})

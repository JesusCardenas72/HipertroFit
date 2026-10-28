import { describe, expect, test } from 'vitest'
import { dateOrder, formatDay, parseDay } from './date-input.js'

const ES = { order: ['day', 'month', 'year'], sep: '/' }
const US = { order: ['month', 'day', 'year'], sep: '/' }

describe('dateOrder', () => {
  test('reads the order from the language', () => {
    expect(dateOrder('es-ES').order).toEqual(['day', 'month', 'year'])
    expect(dateOrder('en-US').order).toEqual(['month', 'day', 'year'])
    expect(dateOrder('zh-CN').order[0]).toBe('year')
  })
  test('falls back to day/month/year', () => {
    expect(dateOrder('xx-invalid-!!')).toEqual({ order: ['day', 'month', 'year'], sep: '/' })
  })
})

describe('formatDay', () => {
  test('writes the ISO day in the language’s order', () => {
    expect(formatDay('2026-10-21', ES)).toBe('21/10/2026')
    expect(formatDay('2026-10-21', US)).toBe('10/21/2026')
    expect(formatDay('', ES)).toBe('')
  })
})

describe('parseDay', () => {
  test('reads a typed date back to ISO, any separator', () => {
    expect(parseDay('21/10/2026', ES)).toBe('2026-10-21')
    expect(parseDay('1-2-2026', ES)).toBe('2026-02-01')
    expect(parseDay('10/21/2026', US)).toBe('2026-10-21')
    expect(parseDay('21.10.26', ES)).toBe('2026-10-21')
  })
  test('nothing until it is a whole, real day', () => {
    expect(parseDay('21/10', ES)).toBeNull()
    expect(parseDay('31/02/2026', ES)).toBeNull()
    expect(parseDay('21/13/2026', ES)).toBeNull()
    expect(parseDay('', ES)).toBeNull()
  })
})

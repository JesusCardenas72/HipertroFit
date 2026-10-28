import { describe, expect, test } from 'vitest'
import { UI_SCALE, TEXT_SCALE, clampScale, cleanDisplay, viewportContent } from './display.js'

describe('clampScale', () => {
  test('keeps a value on the steps and inside the range', () => {
    expect(clampScale(110, UI_SCALE)).toBe(110)
    expect(clampScale(112, UI_SCALE)).toBe(110)
    expect(clampScale(50, UI_SCALE)).toBe(85)
    expect(clampScale(200, UI_SCALE)).toBe(120)
    expect(clampScale(200, TEXT_SCALE)).toBe(130)
  })
  test('anything unreadable is the normal size', () => {
    expect(clampScale('x', UI_SCALE)).toBe(100)
    expect(clampScale(undefined, TEXT_SCALE)).toBe(100)
  })
})

describe('cleanDisplay', () => {
  test('fills what is missing and fixes what is out of range', () => {
    expect(cleanDisplay(null)).toEqual({ ui: 100, text: 100 })
    expect(cleanDisplay({ ui: 90 })).toEqual({ ui: 90, text: 100 })
    expect(cleanDisplay({ ui: 10, text: 999 })).toEqual({ ui: 85, text: 130 })
  })
})

describe('viewportContent', () => {
  test('at normal size it is the app’s own tag', () => {
    expect(viewportContent(1, 390)).toBe('width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no')
  })
  test('larger lays the page out narrower and shows it zoomed in, pinned there', () => {
    expect(viewportContent(1.2, 390)).toBe('width=325,initial-scale=1.2,minimum-scale=1.2,maximum-scale=1.2,viewport-fit=cover,user-scalable=no')
  })
  test('smaller lays it out wider and shows it zoomed out', () => {
    expect(viewportContent(0.85, 390)).toBe('width=459,initial-scale=0.85,minimum-scale=0.85,maximum-scale=0.85,viewport-fit=cover,user-scalable=no')
  })
  test('without a known width it stays at the plain tag', () => {
    expect(viewportContent(1.1, 0)).toBe('width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no')
  })
})

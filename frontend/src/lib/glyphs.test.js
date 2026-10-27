import { describe, expect, test } from 'vitest'
import { ICON_NAMES } from '../components/Icon.jsx'
import { DEFAULT_GLYPH, GLYPHS, glyphOf } from './glyphs.js'

describe('routine glyphs', () => {
  test('every glyph the picker offers is a drawn icon', () => {
    for (const g of GLYPHS) expect(ICON_NAMES, g).toContain(g)
  })

  test('keys the picker used to offer render as their muscle-map redraw', () => {
    expect(glyphOf('bench')).toBe('pushDay')
    expect(glyphOf('pullup')).toBe('pullDay')
    expect(glyphOf('squat')).toBe('legDay')
    expect(glyphOf('legs')).toBe('legDay')
    expect(glyphOf('arm')).toBe('biceps')
    expect(glyphOf('abs')).toBe('core')
  })

  test('legacy emoji follow the same redraw, other keys pass through', () => {
    expect(glyphOf('💪')).toBe('biceps')
    expect(glyphOf('🦵')).toBe('legDay')
    expect(glyphOf('dumbbell')).toBe('dumbbell')
    expect(glyphOf('plate')).toBe('plate')
    expect(glyphOf('')).toBe(DEFAULT_GLYPH)
    expect(glyphOf('🍕')).toBe(DEFAULT_GLYPH)
  })
})

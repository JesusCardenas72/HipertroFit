import { describe, expect, test } from 'vitest'
import { ICON_NAMES } from '../components/Icon.jsx'
import { DEFAULT_GLYPH, GLYPHS, glyphOf, muscleGlyphOf } from './glyphs.js'
import { MUSCLE_CHOICES } from './muscles.js'
import { SPLITS } from './split-templates.js'

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

describe('split and muscle artwork', () => {
  test('Push / Pull / Legs and Upper / Lower days get the split artwork', () => {
    const glyphs = split => Object.fromEntries(SPLITS[split].plan.map(d => [d.name, d.glyph]))
    expect(glyphs('ppl')).toEqual({
      'Push A': 'pushDay', 'Pull A': 'pullDay', 'Legs A': 'legDay',
      'Push B': 'pushDay', 'Pull B': 'pullDay', 'Legs B': 'legDay',
    })
    expect(glyphs('upper-lower')).toEqual({
      'Upper A': 'upperDay', 'Lower A': 'legDay', 'Upper B': 'upperDay', 'Lower B': 'legDay',
    })
  })

  test('an exercise shows the muscle it trains hardest', () => {
    expect(muscleGlyphOf({ primaries: ['chest'], secondaries: ['triceps', 'deltoids'] })).toBe('chest')
    expect(muscleGlyphOf({ tg: 'quads', sm: ['glutes', 'hamstrings'] })).toBe('quads')
    // first-listed primary on a tie
    expect(muscleGlyphOf({ primaries: ['triceps', 'chest'] })).toBe('triceps')
    expect(muscleGlyphOf({ tg: 'abs', sm: ['obliques'] })).toBe('core')
  })

  test('the lats keep their own picture, apart from the rest of the upper back', () => {
    expect(muscleGlyphOf({ tg: 'lats' })).toBe('lats')
    expect(muscleGlyphOf({ tg: 'latissimus dorsi' })).toBe('lats')
    expect(muscleGlyphOf({ tg: 'upper back' })).toBe('upperBack')
    expect(muscleGlyphOf({ tg: 'traps' })).toBe('upperBack')
    expect(muscleGlyphOf({ tg: 'spine' })).toBe('lowerBack')
  })

  test('every muscle a person can pick has a picture that exists', () => {
    for (const m of MUSCLE_CHOICES) {
      const g = muscleGlyphOf({ primaries: [m] })
      expect(g, m).toBeTruthy()
      expect(ICON_NAMES, m).toContain(g)
    }
  })

  test('cardio and exercises with no drawable muscle have none', () => {
    expect(muscleGlyphOf({ bp: 'cardio', tg: 'cardiovascular system' })).toBe(null)
    expect(muscleGlyphOf({ tg: 'hands' })).toBe(null)
    expect(muscleGlyphOf(null)).toBe(null)
  })
})

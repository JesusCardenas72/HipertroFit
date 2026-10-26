import { describe, it, expect } from 'vitest'
import { buildCustomExercise, parseSteps, stepsText, dataUrlBytes, copyName, MAX_IMAGE_BYTES, STEPS_MAX, NAME_MAX } from './custom-exercise.js'
import { classifyExercise, repRangeFor } from './exercise-class.js'
import { imgSrc, gifSrc } from './exercises.js'

const JPG = 'data:image/jpeg;base64,' + 'A'.repeat(400)
const GIF = 'data:image/gif;base64,' + 'R'.repeat(400)

describe('parseSteps', () => {
  it('splits one step per line, drops blanks and list markers', () => {
    expect(parseSteps('1. Túmbate\n\n- Sube\n  3) Baja  \n• Repite')).toEqual(['Túmbate', 'Sube', 'Baja', 'Repite'])
  })
  it('caps the number of steps and round-trips through stepsText', () => {
    const many = Array.from({ length: 40 }, (_, i) => 'paso ' + i).join('\n')
    expect(parseSteps(many)).toHaveLength(STEPS_MAX)
    expect(parseSteps(stepsText(['a', 'b']))).toEqual(['a', 'b'])
  })
})

describe('buildCustomExercise', () => {
  const base = { id: 'c1', n: '  Remo en máquina X ', bp: 'back', eq: 'leverage machine', primaries: ['lats'], secondaries: ['lats', 'biceps'] }

  it('fills every catalogue field from the form', () => {
    const ex = buildCustomExercise({ ...base, desc: ' agarre neutro ', steps: 'Siéntate\nTira', img: JPG, gif: GIF })
    expect(ex).toMatchObject({
      id: 'c1', n: 'Remo en máquina X', bp: 'back', eq: 'leverage machine', tg: 'lats', mg: 'lats',
      sm: ['biceps'], primaries: ['lats'], secondaries: ['biceps'], muscleGroups: ['lats', 'biceps'],
      desc: 'agarre neutro', st: ['Siéntate', 'Tira'], img: JPG, gif: GIF, custom: true,
    })
  })

  it('keeps a known movement pattern, and none for cardio or an unknown one', () => {
    expect(buildCustomExercise({ ...base, pattern: 'horizontal_pull' }).pattern).toBe('horizontal_pull')
    expect('pattern' in buildCustomExercise({ ...base, pattern: 'bogus' })).toBe(false)
    expect('pattern' in buildCustomExercise({ ...base, pattern: '' })).toBe(false)
    expect('pattern' in buildCustomExercise({ ...base, bp: 'cardio', pattern: 'horizontal_pull' })).toBe(false)
  })

  it('defaults equipment to custom and leaves out an unset class and image', () => {
    const ex = buildCustomExercise({ ...base, eq: '', cls: '' })
    expect(ex.eq).toBe('custom')
    expect('cls' in ex).toBe(false)
    expect('img' in ex).toBe(false)
    expect('gif' in ex).toBe(false)
  })

  it('a chosen class overrides what the name would decide, and sets the rep range', () => {
    const auto = buildCustomExercise({ ...base, n: 'mi curl raro', eq: 'dumbbell' })
    expect(classifyExercise(auto)).toBe('isolation')
    const picked = buildCustomExercise({ ...base, n: 'mi curl raro', eq: 'dumbbell', cls: 'compound' })
    expect(classifyExercise(picked)).toBe('compound')
    expect(repRangeFor(picked)).toEqual({ repsMin: 5, reps: 12 })
  })

  it('cardio carries no muscle groups', () => {
    const ex = buildCustomExercise({ ...base, bp: 'cardio' })
    expect(ex.primaries).toEqual([])
    expect(ex.sm).toEqual([])
  })

  it('remembers the gif frame used as the still, only for a gif', () => {
    expect(buildCustomExercise({ ...base, img: JPG, gif: GIF, frame: 7 }).frame).toBe(7)
    expect('frame' in buildCustomExercise({ ...base, img: JPG, gif: GIF, frame: 0 })).toBe(false)
    expect('frame' in buildCustomExercise({ ...base, img: JPG, frame: 7 })).toBe(false)
    expect('frame' in buildCustomExercise({ ...base, img: JPG, gif: GIF, frame: -2 })).toBe(false)
  })

  it('rejects non-image and oversized pictures, and a gif without a still', () => {
    expect('img' in buildCustomExercise({ ...base, img: 'https://example.com/x.jpg' })).toBe(false)
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8)
    expect(dataUrlBytes(huge)).toBeGreaterThan(MAX_IMAGE_BYTES)
    expect('img' in buildCustomExercise({ ...base, img: huge })).toBe(false)
    expect('gif' in buildCustomExercise({ ...base, gif: GIF })).toBe(false)
  })
})

describe('media sources', () => {
  it('inline pictures are used as is, catalogue files get the media path', () => {
    expect(imgSrc({ img: JPG })).toBe(JPG)
    expect(gifSrc({ gif: GIF })).toBe(GIF)
    expect(imgSrc({ img: '0001-x.jpg' })).toBe('img/0001-x.jpg')
    expect(gifSrc({ gif: '0001-x.gif' })).toBe('gif/0001-x.gif')
  })
})

describe('copyName', () => {
  it('appends the copy label, numbering it past names already taken (any case)', () => {
    expect(copyName('Press banca', ['Press banca'], 'copia')).toBe('Press banca (copia)')
    expect(copyName('Press banca', ['press banca (COPIA)'], 'copia')).toBe('Press banca (copia 2)')
    expect(copyName(' Press banca ', ['Press banca (copia)', 'Press banca (copia 2)'], 'copia')).toBe('Press banca (copia 3)')
  })
  it('shortens a long base so the name still fits NAME_MAX', () => {
    const n = copyName('x'.repeat(NAME_MAX), [], 'copy')
    expect(n).toHaveLength(NAME_MAX)
    expect(n.endsWith(' (copy)')).toBe(true)
  })
})

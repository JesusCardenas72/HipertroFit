import { afterEach, describe, expect, it } from 'vitest'
import { BODYPARTS, CATALOGUE, EXDB, EXIDX, allExercises, muscleTagsOf, registerCustom, registerMuscleEdits } from './exercises.js'
import { EXERCISE_MUSCLES } from './exercise-muscles.js'
import { MUSCLES, MUSCLE_CHOICES, musclesOf, volumeMusclesOf, muscleChoiceOf, muscleLabel } from './muscles.js'

const VOCABULARY = [...MUSCLES, 'lats', 'rear-delts']
const duplicateFree = values => values.length === new Set(values).size
const muscles = id => EXERCISE_MUSCLES[id]

afterEach(() => { registerMuscleEdits({}); registerCustom([]) })

describe('reviewed exercise muscles', () => {
  it('covers every built-in exercise except cardio', () => {
    for (const ex of EXDB) {
      if (ex.tg === 'cardiovascular system') expect(muscles(ex.id), ex.n).toBeUndefined()
      else expect(muscles(ex.id), ex.n).toBeDefined()
    }
    expect(Object.keys(EXERCISE_MUSCLES).every(id => EXDB.some(ex => ex.id === id))).toBe(true)
  })

  it('stores primaries and secondaries in the picker vocabulary, never a muscle twice', () => {
    expect([...MUSCLE_CHOICES].sort()).toEqual([...VOCABULARY].sort())
    for (const [id, m] of Object.entries(EXERCISE_MUSCLES)) {
      expect(m.primaries.length, id).toBeGreaterThan(0)
      expect(duplicateFree([...m.primaries, ...m.secondaries]), id).toBe(true)
      expect([...m.primaries, ...m.secondaries].every(x => VOCABULARY.includes(x)), id).toBe(true)
      expect(EXIDX[id]).toMatchObject(m)
    }
  })

  it('drops the dataset secondaries that do not train anything', () => {
    // calf raises "working" the hamstrings, wrist curls the biceps, extensions the shoulders
    expect(muscles('1371')).toEqual({ primaries: ['calves'], secondaries: [] })
    expect(muscles('0126')).toEqual({ primaries: ['forearm'], secondaries: [] })
    expect(muscles('0061')).toEqual({ primaries: ['triceps'], secondaries: [] })
    // bench press: no biceps; flies: no upper back
    expect(muscles('0025')).toEqual({ primaries: ['chest'], secondaries: ['triceps', 'deltoids'] })
    expect(muscles('0155')).toEqual({ primaries: ['chest'], secondaries: ['deltoids'] })
  })

  it('follows the movement families', () => {
    expect(muscles('0043')).toEqual({ primaries: ['quadriceps', 'gluteal'], secondaries: ['adductors', 'hamstring', 'lower-back'] })
    expect(muscles('0032')).toEqual({ primaries: ['gluteal', 'hamstring', 'lower-back'], secondaries: ['quadriceps', 'adductors', 'trapezius', 'forearm'] })
    expect(muscles('0085')).toEqual({ primaries: ['hamstring', 'gluteal'], secondaries: ['lower-back', 'adductors'] })
    expect(muscles('0091')).toEqual({ primaries: ['deltoids'], secondaries: ['triceps', 'trapezius'] })
    expect(muscles('0652')).toEqual({ primaries: ['lats'], secondaries: ['upper-back', 'biceps', 'forearm'] })
    expect(muscles('0027')).toEqual({ primaries: ['upper-back', 'lats'], secondaries: ['biceps', 'rear-delts'] })
    expect(muscles('0334')).toEqual({ primaries: ['deltoids'], secondaries: ['trapezius'] })
    expect(muscles('0380')).toEqual({ primaries: ['rear-delts'], secondaries: ['trapezius', 'upper-back'] })
    expect(muscles('0294')).toEqual({ primaries: ['biceps'], secondaries: ['forearm'] })
    // names that read as something else: "throw" is not a row, "high pulley" is not a high pull
    expect(muscles('1353').primaries).not.toContain('upper-back')
    expect(muscles('1722')).toEqual({ primaries: ['triceps'], secondaries: [] })
  })

  it('keeps the lats and rear delts apart for volume and folds them for the map', () => {
    expect(musclesOf(EXIDX['0652'])).toMatchObject({ 'upper-back': 1, biceps: 0.4 })
    expect(volumeMusclesOf(EXIDX['0652'])).toMatchObject({ lats: 1, 'upper-back': 0.4 })
    expect(volumeMusclesOf(EXIDX['0027'])).toMatchObject({ 'upper-back': 1, lats: 1, 'rear-delts': 0.4 })
    expect(musclesOf(EXIDX['0380'])).toEqual({ deltoids: 1, trapezius: 0.4, 'upper-back': 0.4 })
  })

  it('treats an empty secondary list as a decision, not a gap to fill from the dataset', () => {
    expect(EXDB.find(ex => ex.id === '1371').sm).toContain('hamstrings')
    expect(muscleTagsOf(EXIDX['1371'])).toEqual({ primary: ['calves'], secondary: [] })
  })

  it('moves the cross-region lifts to Full body', () => {
    expect(EXIDX['0032'].bp).toBe('full body')
    expect(EXIDX['1010'].bp).toBe('upper legs')
    expect(EXIDX['0025'].bp).toBe('chest')
    expect(BODYPARTS).toContain('full body')
  })
})

describe('muscle corrections for built-in exercises', () => {
  it('applies S.exMuscles to the index and the catalogue list, and undoes it', () => {
    registerMuscleEdits({ '0025': { primaries: ['chest', 'triceps'], secondaries: ['triceps', 'deltoids'] } })
    expect(EXIDX['0025']).toMatchObject({ primaries: ['chest', 'triceps'], secondaries: ['deltoids'], musclesEdited: true })
    expect(allExercises({}).find(ex => ex.id === '0025').primaries).toEqual(['chest', 'triceps'])
    expect(musclesOf(EXIDX['0025'])).toMatchObject({ chest: 1, triceps: 1, deltoids: 0.4 })
    registerMuscleEdits({})
    expect(EXIDX['0025']).toBe(CATALOGUE.find(ex => ex.id === '0025'))
  })

  it('ignores a correction without primaries', () => {
    registerMuscleEdits({ '0025': { primaries: [], secondaries: ['biceps'] } })
    expect(EXIDX['0025'].primaries).toEqual(['chest'])
  })

  it('keeps the correction when the custom catalogue is re-registered', () => {
    registerMuscleEdits({ '0025': { primaries: ['triceps'], secondaries: [] } })
    registerCustom([{ id: 'c1', n: 'Mine', bp: 'chest', primaries: ['chest'] }])
    expect(EXIDX['0025'].primaries).toEqual(['triceps'])
  })
})

describe('muscle picker helpers', () => {
  it('maps stored names onto picker choices', () => {
    expect(muscleChoiceOf('lats')).toBe('lats')
    expect(muscleChoiceOf('latissimus dorsi')).toBe('lats')
    expect(muscleChoiceOf('rear deltoids')).toBe('rear-delts')
    expect(muscleChoiceOf('glutes')).toBe('gluteal')
    expect(muscleChoiceOf('hamstring')).toBe('hamstring')
    expect(muscleChoiceOf('hands')).toBe(null)
  })

  it('labels slugs with their display names and leaves dataset names as they are', () => {
    expect(muscleLabel('gluteal')).toBe('Glutes')
    expect(muscleLabel('lats')).toBe('Lats')
    expect(muscleLabel('rear-delts')).toBe('Rear delts')
    expect(muscleLabel('rear deltoids')).toBe('rear deltoids')
  })
})

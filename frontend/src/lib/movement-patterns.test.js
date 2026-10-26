import { afterEach, describe, expect, it } from 'vitest'
import { CATALOGUE, EXDB, EXIDX, allExercises, catalogueRow, registerCustom, registerMuscleEdits, registerPatternEdits } from './exercises.js'
import { EXERCISE_MUSCLES } from './exercise-muscles.js'
import { PATTERNS, exercisesOfPattern, isPattern, patternName, patternOf } from './movement-patterns.js'

const pat = id => patternOf(EXIDX[id])

afterEach(() => { registerMuscleEdits({}); registerPatternEdits({}); registerCustom([]) })

describe('movement patterns of the catalogue', () => {
  it('stores only known patterns, and only on reviewed exercises', () => {
    for (const [id, m] of Object.entries(EXERCISE_MUSCLES)) {
      if (m.pattern !== undefined) expect(isPattern(m.pattern), id).toBe(true)
    }
    expect(CATALOGUE.filter(ex => patternOf(ex)).length).toBeGreaterThan(1000)
  })

  it('puts the staple lifts in their pattern', () => {
    const cases = {
      '0025': 'horizontal_push', // barbell bench press
      '0251': 'horizontal_push', // chest dip
      '0047': 'incline_push',    // barbell incline bench press
      '0405': 'vertical_push',   // dumbbell seated shoulder press
      '0308': 'chest_fly',       // dumbbell fly
      '0334': 'lateral_raise',   // dumbbell lateral raise
      '0203': 'rear_delt',       // cable rear delt row (rope)
      '0194': 'elbow_extension', // cable overhead triceps extension
      '0030': 'elbow_extension', // close-grip bench press
      '0198': 'vertical_pull',   // cable pulldown
      '0652': 'vertical_pull',   // pull-up
      '0027': 'horizontal_pull', // barbell bent over row
      '0238': 'straight_arm_pull', // cable straight arm pulldown
      '0031': 'elbow_flexion',   // barbell curl
      '0313': 'elbow_flexion',   // dumbbell hammer curl
      '0043': 'squat',           // barbell full squat
      '0739': 'squat',           // sled leg press
      '0410': 'lunge',           // dumbbell split squat
      '0085': 'hinge',           // barbell romanian deadlift
      '0032': 'hinge',           // barbell deadlift
      '1409': 'hip_extension',   // barbell glute bridge
      '0585': 'knee_extension',  // lever leg extension
      '0599': 'knee_flexion',    // lever seated leg curl
      '0605': 'calf_raise',      // lever standing calf raise
      '0175': 'core_flexion',    // cable kneeling crunch
    }
    for (const [id, p] of Object.entries(cases)) expect([id, pat(id)]).toEqual([id, p])
  })

  it('keeps an incline push-up a flat push and splits off the incline press', () => {
    const incline = EXDB.filter(ex => /incline/i.test(ex.n) && pat(ex.id) === 'horizontal_push')
    expect(incline.length).toBeGreaterThan(0)
    expect(incline.every(ex => /push-?up/i.test(ex.n))).toBe(true)
  })

  it('leaves cardio, stretches and wrist work out of every slot', () => {
    for (const ex of EXDB) {
      // 3642 "weighted stretch lunge" is a loaded lunge, whatever its name says.
      if (ex.tg === 'cardiovascular system' || (/\bstretch\b/i.test(ex.n) && ex.id !== '3642')) expect(pat(ex.id), ex.n).toBe(null)
    }
    expect(pat('3642')).toBe('lunge')
    expect(pat('0126')).toBe(null) // wrist curl
  })

  it('offers several exercises for every pattern', () => {
    for (const p of PATTERNS) expect([p.key, exercisesOfPattern(CATALOGUE, p.key).length >= 4]).toEqual([p.key, true])
  })

  it('survives a muscle correction of the exercise', () => {
    registerMuscleEdits({ '0025': { primaries: ['chest', 'triceps'], secondaries: [] } })
    expect(pat('0025')).toBe('horizontal_push')
  })
})

describe('pattern corrections of built-in exercises', () => {
  it('overrides the catalogue pattern in every lookup, and restores it when dropped', () => {
    registerPatternEdits({ '0025': 'incline_push' })
    expect(pat('0025')).toBe('incline_push')
    expect(patternOf(allExercises({}).find(ex => ex.id === '0025'))).toBe('incline_push')
    expect(patternOf(catalogueRow('0025'))).toBe('horizontal_push')
    registerPatternEdits({})
    expect(pat('0025')).toBe('horizontal_push')
  })

  it('reads an empty correction as "fills no slot" and ignores an unknown pattern', () => {
    registerPatternEdits({ '0025': '', '0126': 'bogus' })
    expect(pat('0025')).toBe(null)
    expect(pat('0126')).toBe(null)
  })

  it('keeps a muscle correction and a pattern correction of the same exercise together', () => {
    registerMuscleEdits({ '0025': { primaries: ['triceps'], secondaries: [] } })
    registerPatternEdits({ '0025': 'elbow_extension' })
    expect(EXIDX['0025'].primaries).toEqual(['triceps'])
    expect(pat('0025')).toBe('elbow_extension')
    registerMuscleEdits({})
    expect(pat('0025')).toBe('elbow_extension')
  })
})

describe('patterns of custom exercises', () => {
  it('reads the pattern its owner picked, and nothing from an unknown one', () => {
    registerCustom([{ id: 'c1', n: 'my press', bp: 'chest', pattern: 'horizontal_push' },
      { id: 'c2', n: 'mystery', bp: 'chest', pattern: 'bogus' }, { id: 'c3', n: 'plain', bp: 'chest' }])
    expect(pat('c1')).toBe('horizontal_push')
    expect(pat('c2')).toBe(null)
    expect(pat('c3')).toBe(null)
    expect(exercisesOfPattern(allExercises({ customEx: [EXIDX.c1] }), 'horizontal_push')[0].id).toBe('c1')
  })

  it('names every pattern', () => {
    for (const p of PATTERNS) expect(patternName(p.key)).not.toBe('')
    expect(patternName('bogus')).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { classifyExercise, repRangeFor, lastWorkWeight, routineExerciseConfig, CLASS_REP_RANGE } from './exercise-class.js'
import { seedConfig } from './exercise-defaults.js'

const cls = id => classifyExercise(EXIDX[id])

describe('classifyExercise', () => {
  it('reads heavy free-weight multi-joint lifts as compounds', () => {
    for (const id of ['0043', '0032', '0025', '0027', '0085', '0091', '0652', '0811', '0534']) {
      if (EXIDX[id]) expect([id, cls(id)]).toEqual([id, 'compound'])
    }
  })

  it('reads multi-joint work on a guided path as a stable machine', () => {
    // leg press, hack squat, chest press, smith bench, lat pulldown, seated cable row
    for (const id of ['0739', '0743', '0577', '0748', '0770', '1350', '0579']) {
      expect([id, cls(id)]).toEqual([id, 'machine'])
    }
  })

  it('reads single-joint work as isolation, whatever the equipment', () => {
    // barbell curl, leg extension machine, lying leg curl, lateral raise machine, seated calf
    // raise, barbell shrug, skull crusher, pec fly machine, smith calf raise
    for (const id of ['0031', '0585', '0586', '0584', '0088', '0095', '0060', '0596', '0773']) {
      expect([id, cls(id)]).toEqual([id, 'isolation'])
    }
  })

  it('keeps combined movements compound, and a calf raise a calf raise', () => {
    expect(cls('0028')).toBe('compound') // barbell clean and press
    expect(cls('1385')).toBe('isolation') // seated squat calf raise on leg press machine
  })

  it('does not take bodyweight "lever" holds for machines', () => {
    const backLever = Object.values(EXIDX).find(e => e.n === 'back lever')
    if (backLever) expect(classifyExercise(backLever)).not.toBe('machine')
  })

  it('classifies a custom exercise without equipment from its name', () => {
    expect(classifyExercise({ id: 'c1', n: 'Machine chest press', tg: 'pectorals' })).toBe('machine')
    expect(classifyExercise({ id: 'c2', n: 'Cable lateral raise', tg: 'delts', eq: 'cable' })).toBe('isolation')
  })
})

describe('repRangeFor', () => {
  it('maps each class to its optimal range', () => {
    expect(CLASS_REP_RANGE).toEqual({
      compound: { repsMin: 5, reps: 12 },
      machine: { repsMin: 8, reps: 10 },
      isolation: { repsMin: 10, reps: 20 },
    })
    expect(repRangeFor(EXIDX['0043'])).toEqual({ repsMin: 5, reps: 12 })
    expect(repRangeFor(EXIDX['0739'])).toEqual({ repsMin: 8, reps: 10 })
    expect(repRangeFor(EXIDX['0031'])).toEqual({ repsMin: 10, reps: 20 })
  })
})

const workout = (d, entries) => ({ d, entries })

describe('routineExerciseConfig', () => {
  it('defaults to double progression over the class range, at 0 kg with no history', () => {
    const cfg = routineExerciseConfig({ workouts: [] }, EXIDX['0043'])
    expect(cfg).toMatchObject({ mode: 'reps', sets: 3, prog: 'double', repsMin: 5, reps: 12, weight: 0 })
  })

  it('takes the weight from the last session that trained the exercise, work sets only', () => {
    const S = { workouts: [
      workout('2026-09-01', [{ id: '0031', sets: [{ w: 20, reps: 12, done: true }] }]),
      workout('2026-09-08', [{ id: '0031', sets: [
        { w: 10, reps: 10, done: true, warmup: true },
        { w: 25, reps: 10, done: true },
        { w: 22.5, reps: 12, done: true },
        { w: 40, reps: 1, done: false },
      ] }]),
    ] }
    const cfg = routineExerciseConfig(S, EXIDX['0031'])
    expect(cfg).toMatchObject({ prog: 'double', repsMin: 10, reps: 20, weight: 25 })
  })

  it('leaves timed and cardio exercises on their plain default', () => {
    const run = Object.values(EXIDX).find(e => e.bp === 'cardio')
    expect(routineExerciseConfig({ workouts: [] }, run).prog).toBeUndefined()
  })

  it('lastWorkWeight is 0 for an exercise never trained', () => {
    expect(lastWorkWeight({ workouts: [] }, '0043')).toBe(0)
  })
})

describe('seeding a routine default with what the exercise already remembers', () => {
  const base = { sets: 3, mode: 'reps', weight: 60, prog: 'double', repsMin: 5, reps: 12 }

  it('keeps the class range over a lone remembered rep target', () => {
    const seeded = seedConfig(base, { reps: 10, restSec: 120 }, 'reps')
    expect(seeded).toMatchObject({ repsMin: 5, reps: 12, restSec: 120, prog: 'double', weight: 60 })
  })

  it('lets a range the user already chose win', () => {
    const seeded = seedConfig(base, { prog: 'double', reps: 8, repsMin: 6 }, 'reps')
    expect(seeded).toMatchObject({ repsMin: 6, reps: 8 })
  })

  it('lets another remembered rule win, with its own rep target', () => {
    const seeded = seedConfig(base, { prog: 'linear', reps: 5 }, 'reps')
    expect(seeded).toMatchObject({ prog: 'linear', reps: 5 })
  })
})

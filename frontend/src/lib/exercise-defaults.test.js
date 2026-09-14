import { describe, it, expect } from 'vitest'
import {
  GLOBAL_FIELDS, isGlobalField, globalFieldsFor, pickGlobals, seedConfig, changedGlobals, applyGlobals, previousRoutineConfig,
} from './exercise-defaults.js'

const loaded = { sets: 3, reps: 10, weight: 60, mode: 'reps', bodyweight: false }
const bw = { sets: 3, reps: 8, weight: 10, mode: 'reps', bodyweight: true }

describe('the local/global split', () => {
  it('keeps sets local — two routines are allowed to disagree about how much they ask for', () => {
    expect(isGlobalField('sets', loaded)).toBe(false)
    expect(GLOBAL_FIELDS).not.toContain('sets')
  })

  it('keeps mode, note and warm-ups local', () => {
    for (const field of ['mode', 'sec', 'min', 'speed', 'note', 'warmupSets']) {
      expect(isGlobalField(field, loaded)).toBe(false)
    }
  })

  it('treats weight as global only on bodyweight work, where it means the belt load', () => {
    expect(isGlobalField('weight', loaded)).toBe(false)
    expect(isGlobalField('weight', bw)).toBe(true)
    expect(globalFieldsFor(loaded)).not.toContain('weight')
    expect(globalFieldsFor(bw)).toContain('weight')
  })
})

describe('pickGlobals', () => {
  it('takes only the global fields the config actually carries', () => {
    expect(pickGlobals({ ...loaded, restSec: 120, prog: 'linear', inc: 2.5, note: 'bar only' }))
      .toEqual({ bodyweight: false, reps: 10, restSec: 120, prog: 'linear', inc: 2.5 })
  })

  it('leaves out the working weight of a loaded lift', () => {
    expect(pickGlobals(loaded).weight).toBeUndefined()
  })

  it('keeps the belt load of a bodyweight lift', () => {
    expect(pickGlobals(bw).weight).toBe(10)
  })

  it('returns nothing for a missing config', () => {
    expect(pickGlobals(null)).toEqual({})
  })
})

describe('seedConfig', () => {
  it('fills the global fields from what the exercise was given the first time', () => {
    const seeded = seedConfig({ sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: false },
      { reps: 6, restSec: 180, prog: 'greyskull', inc: 5, bodyweight: false })
    expect(seeded).toEqual({ sets: 3, reps: 6, weight: 0, mode: 'reps', bodyweight: false, restSec: 180, prog: 'greyskull', inc: 5 })
  })

  it('does not touch the local fields', () => {
    const seeded = seedConfig({ sets: 5, reps: 10, weight: 100, mode: 'reps', bodyweight: false, note: 'top set' }, { reps: 6 })
    expect(seeded.sets).toBe(5)
    expect(seeded.weight).toBe(100)
    expect(seeded.note).toBe('top set')
  })

  it('carries the belt load once bodyweight comes across with it', () => {
    // The `bodyweight` flag has to land before `weight` is judged, or the belt load is dropped
    // as if it were a working weight.
    const seeded = seedConfig({ sets: 3, reps: 10, weight: 0, mode: 'reps' }, { bodyweight: true, weight: 20, reps: 8 })
    expect(seeded).toMatchObject({ bodyweight: true, weight: 20, reps: 8 })
  })

  it('is a plain copy when the exercise has never been configured', () => {
    const base = { sets: 3, reps: 10, weight: 0, mode: 'reps' }
    expect(seedConfig(base, undefined)).toEqual(base)
    expect(seedConfig(base, undefined)).not.toBe(base)
  })
})

describe('changedGlobals', () => {
  it('is empty the first time the exercise is configured', () => {
    expect(changedGlobals({ ...loaded, reps: 5 }, undefined)).toEqual([])
    expect(changedGlobals({ ...loaded, reps: 5 }, {})).toEqual([])
  })

  it('is empty when nothing global moved, however much local moved', () => {
    const globals = pickGlobals(loaded)
    expect(changedGlobals({ ...loaded, sets: 6, weight: 80, note: 'new' }, globals)).toEqual([])
  })

  it('reports each remembered value that would be overwritten', () => {
    const globals = { bodyweight: false, reps: 10, restSec: 90, prog: 'linear', inc: 2.5 }
    expect(changedGlobals({ ...loaded, reps: 8, restSec: 90, prog: 'linear', inc: 5 }, globals))
      .toEqual([{ field: 'reps', from: 10, to: 8 }, { field: 'inc', from: 2.5, to: 5 }])
  })

  it('reports a cleared field — removing an intensifier propagates like setting one', () => {
    const globals = { bodyweight: false, reps: 10, intensifier: { type: 'dropset', count: 1, pct: 20 } }
    expect(changedGlobals({ ...loaded }, globals))
      .toEqual([{ field: 'intensifier', from: globals.intensifier, to: undefined }])
  })

  it('compares intensifiers by value, not by identity', () => {
    const globals = { bodyweight: false, reps: 10, intensifier: { type: 'dropset', count: 1, pct: 20 } }
    const cfg = { ...loaded, intensifier: { type: 'dropset', count: 1, pct: 20 } }
    expect(changedGlobals(cfg, globals)).toEqual([])
    expect(changedGlobals({ ...cfg, intensifier: { type: 'dropset', count: 2, pct: 20 } }, globals)).toHaveLength(1)
  })

  it('ignores the working weight of a loaded lift', () => {
    expect(changedGlobals({ ...loaded, weight: 80 }, { ...pickGlobals(loaded), weight: 60 })).toEqual([])
  })

  it('catches the belt load of a bodyweight lift', () => {
    expect(changedGlobals({ ...bw, weight: 20 }, pickGlobals(bw)))
      .toEqual([{ field: 'weight', from: 10, to: 20 }])
  })
})

describe('applyGlobals', () => {
  it('writes the exercise entry without disturbing the others', () => {
    const store = { squat: { reps: 5 }, bench: { reps: 8 } }
    const next = applyGlobals(store, 'squat', { ...loaded, reps: 6 })
    expect(next.bench).toBe(store.bench)
    expect(next.squat).toEqual({ bodyweight: false, reps: 6 })
    expect(store.squat).toEqual({ reps: 5 })
  })

  it('starts a map when there is none', () => {
    expect(applyGlobals(undefined, 'squat', { reps: 5, bodyweight: false })).toEqual({ squat: { bodyweight: false, reps: 5 } })
  })

  it('round-trips: what one routine saves is what the next routine seeds', () => {
    const saved = { sets: 5, reps: 5, weight: 100, mode: 'reps', bodyweight: false, restSec: 180, prog: 'greyskull', inc: 2.5 }
    const store = applyGlobals({}, 'squat', saved)
    const seeded = seedConfig({ sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: false }, store.squat)
    expect(seeded).toMatchObject({ reps: 5, restSec: 180, prog: 'greyskull', inc: 2.5 })
    expect(seeded.sets).toBe(3)
    expect(seeded.weight).toBe(0)
    expect(changedGlobals(seeded, store.squat)).toEqual([])
  })
})

describe('mode-aware field sets', () => {
  const repsCfg = { sets: 3, reps: 10, weight: 0, mode: 'reps', bodyweight: false, restSec: 90, prog: 'linear', inc: 2.5 }

  it('offers nothing but rest on a cardio interval', () => {
    expect(globalFieldsFor({ sets: 1, min: 20, speed: 8, restSec: 60 }, 'cardio')).toEqual(['restSec'])
  })

  it('leaves the rep target and the kilo step out of a timed hold', () => {
    const fields = globalFieldsFor({ mode: 'time', sec: 45, bodyweight: false }, 'time')
    expect(fields).not.toContain('reps')
    // The Time form's step is in seconds — sharing the key with a kilo step would be a
    // silent unit swap.
    expect(fields).not.toContain('inc')
    expect(fields).not.toContain('side')
    expect(fields).not.toContain('intensifier')
  })

  it('does not erase the rep target when the same exercise is saved as a timed hold', () => {
    const store = applyGlobals({}, 'plank', repsCfg, 'reps')
    const next = applyGlobals(store, 'plank', { mode: 'time', sec: 45, bodyweight: false, restSec: 120 }, 'time')
    expect(next.plank.reps).toBe(10)
    expect(next.plank.inc).toBe(2.5)
    expect(next.plank.restSec).toBe(120)
  })

  it('still erases a cleared field inside the mode that owns it', () => {
    const store = applyGlobals({}, 'squat', { ...repsCfg, intensifier: { type: 'dropset', count: 1, pct: 20 } }, 'reps')
    const next = applyGlobals(store, 'squat', repsCfg, 'reps')
    expect('intensifier' in next.squat).toBe(false)
  })

  it('does not pull a kilo step into a seconds stepper when seeding a timed hold', () => {
    const seeded = seedConfig({ mode: 'time', sec: 45, sets: 3, weight: 0 }, { reps: 10, inc: 2.5, restSec: 180 }, 'time')
    expect(seeded.reps).toBeUndefined()
    expect(seeded.inc).toBeUndefined()
    expect(seeded.restSec).toBe(180)
  })

  it('asks about nothing outside the mode being edited', () => {
    const globals = pickGlobals(repsCfg, 'reps')
    // Reps, the rep ceiling and the kilo step all differ or are absent here, and none of them
    // is the Time form's business — only what it can actually show is up for a prompt.
    const timed = { mode: 'time', sec: 45, bodyweight: false, restSec: 90, prog: 'linear' }
    expect(changedGlobals(timed, globals, 'time')).toEqual([])
    expect(changedGlobals({ ...timed, restSec: 120 }, globals, 'time'))
      .toEqual([{ field: 'restSec', from: 90, to: 120 }])
  })
})

describe('previousRoutineConfig', () => {
  const push = { id: 'push', name: 'Push', ex: [{ id: 'bench', sets: 4, reps: 12, repsMin: 8, prog: 'double', weight: 80, sg: 'g1' }] }
  const upper = { id: 'upper', name: 'Upper', ex: [{ id: 'bench', sets: 3, reps: 10, weight: 70 }] }

  it('is null for an exercise no routine uses yet', () => {
    expect(previousRoutineConfig([push], 'squat', 'legs')).toBeNull()
    expect(previousRoutineConfig(undefined, 'squat')).toBeNull()
  })

  it('returns the whole config from another routine, local fields included, without its superset link', () => {
    const found = previousRoutineConfig([push], 'bench', 'legs')
    expect(found.routine).toBe(push)
    expect(found.cfg).toEqual({ sets: 4, reps: 12, repsMin: 8, prog: 'double', weight: 80 })
  })

  it('prefers another routine over a copy already in the one being edited', () => {
    expect(previousRoutineConfig([upper, push], 'bench', 'upper').routine).toBe(push)
    expect(previousRoutineConfig([upper], 'bench', 'upper').routine).toBe(upper)
  })
})

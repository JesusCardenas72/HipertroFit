import { describe, it, expect } from 'vitest'
import { exerciseProgress } from './exercise-progress.js'

const w = (d, entries) => ({ d, start: new Date(d).getTime(), entries })

describe('exerciseProgress', () => {
  it('plots the top work weight of each session, oldest first, warm-ups left out', () => {
    const p = exerciseProgress([
      w('2026-09-01', [{ id: 'bench', sets: [{ w: 40, r: 10, done: true, warmup: true }, { w: 60, r: 10, done: true }] }]),
      w('2026-09-05', [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }]),
      w('2026-09-08', [{ id: 'bench', sets: [{ w: 62.5, r: 8, done: true }, { w: 60, r: 10, done: true }] }]),
    ], 'bench')
    expect(p.mode).toBe('reps')
    expect(p.repsOnly).toBe(false)
    expect(p.points.map(x => [x.d, x.y])).toEqual([['2026-09-01', 60], ['2026-09-08', 62.5]])
    expect(p.best).toBe(62.5)
  })

  it('plots reps when the exercise was never loaded', () => {
    const p = exerciseProgress([
      w('2026-09-01', [{ id: 'pullup', target: { bodyweight: true }, sets: [{ w: 0, r: 8, done: true }, { w: 0, r: 6, done: true }] }]),
      w('2026-09-04', [{ id: 'pullup', target: { bodyweight: true }, sets: [{ w: 0, r: 10, done: true }] }]),
    ], 'pullup')
    expect(p.repsOnly).toBe(true)
    expect(p.points.map(x => x.y)).toEqual([8, 10])
  })

  it('has no points for an exercise with no history', () => {
    expect(exerciseProgress([], 'bench').points).toEqual([])
    expect(exerciseProgress(undefined, 'bench').best).toBe(0)
  })
})

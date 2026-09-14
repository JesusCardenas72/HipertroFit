import { describe, it, expect } from 'vitest'
import { doubleProgressExercises, doubleProgressStatus, applyProgressionChoice } from './double-progress.js'
import { nextPrescription } from './progression.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id
const OTHER = EXDB.find(e => e.bp === 'chest' && e.id !== LIFT).id
const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }

const state = rows => ({
  unit: 'kg',
  exWeights: {},
  routines: [{ id: 'r1', ex: [cfg] }],
  workouts: rows.map((row, i) => ({
    d: '2026-03-0' + (i + 1),
    entries: [{ id: LIFT, target: { sets: 3, reps: 12 }, sets: row.slice(1).map(r => ({ w: row[0], r, done: true })) }]
  }))
})

describe('doubleProgressExercises', () => {
  it('lists each double-progression exercise once, skipping other rules and deload routines', () => {
    const S = {
      routines: [
        { id: 'a', ex: [cfg, { id: OTHER, sets: 3, reps: 5, prog: 'linear' }] },
        { id: 'b', ex: [{ ...cfg, sets: 4 }] },
        { id: 'c', excludeFromProgression: true, ex: [{ id: OTHER, prog: 'double', reps: 12 }] },
      ]
    }
    const list = doubleProgressExercises(S)
    expect(list.map(x => x.cfg.id)).toEqual([LIFT])
    expect(list[0].routine.id).toBe('a')
  })
})

describe('doubleProgressStatus', () => {
  it('starts at first with no history', () => {
    const st = doubleProgressStatus(state([]), cfg)
    expect(st.state).toBe('first')
    expect(st.top).toBe(12)
    expect(st.bottom).toBe(8)
  })

  it('places the last session inside the range while climbing', () => {
    const st = doubleProgressStatus(state([[40, 8, 8, 8], [40, 10, 10, 10]]), cfg)
    expect(st.state).toBe('climbing')
    expect(st.weight).toBe(40)
    expect(st.reps).toEqual([10, 10, 10])
    expect(st.progress).toBe(0.5)
    expect(st.repsLeft).toBe(6)
    expect(st.sessionsLeft).toBe(2)
    expect(st.history.map(h => h.reps)).toEqual([[8, 8, 8], [10, 10, 10]])
  })

  it('only keeps the climb at the current weight', () => {
    const st = doubleProgressStatus(state([[37.5, 12, 12, 12], [40, 8, 8, 8]]), cfg)
    expect(st.history).toHaveLength(1)
  })

  it('is ready at the top of the range in every set', () => {
    const st = doubleProgressStatus(state([[40, 12, 12, 12]]), cfg)
    expect(st.state).toBe('ready')
    expect(st.progress).toBe(1)
    expect(st.sessionsLeft).toBe(0)
  })

  it('flags fatigue when reps fell set to set', () => {
    const st = doubleProgressStatus(state([[40, 12, 11, 10]]), cfg)
    expect(st.state).toBe('fatigue')
    expect(st.history[0].fatigued).toBe(true)
  })

  it('counts a set the last session planned but skipped as the bottom of the range', () => {
    const st = doubleProgressStatus(state([[40, 12, 12]]), cfg)
    expect(st.planned).toBe(3)                  // the stored target asked for 3 sets
    expect(st.reps).toEqual([12, 12, 0])
    expect(st.state).toBe('climbing')
  })
})

describe('applyProgressionChoice', () => {
  const S = state([[40, 12, 12, 12]])
  const entry = () => ({
    id: LIFT, target: { ...cfg }, plan: nextPrescription(S, cfg),
    sets: [
      { w: 20, r: 8, done: false, phase: 'warmup' },
      { w: 40, r: 12, done: true, rir: 1 },
      { w: 40, r: 12, done: false },
      { w: 40, r: 12, done: false },
    ]
  })

  it('adds the chosen weight to the rows still to do and drops reps to the bottom', () => {
    const out = applyProgressionChoice(entry(), { type: 'weight', amount: 5 })
    expect(out.decided).toBe('weight')
    expect(out.plan.kind).toBe('up')
    expect(out.plan.weight).toBe(45)
    expect(out.sets[1]).toEqual({ w: 40, r: 12, done: true, rir: 1 })
    expect(out.sets[2]).toMatchObject({ w: 45, r: 8 })
    expect(out.sets[3]).toMatchObject({ w: 45, r: 8 })
  })

  it('adds sets at the same weight, reps to the bottom, and records the new set count', () => {
    const out = applyProgressionChoice(entry(), { type: 'sets', amount: 1 })
    const work = out.sets.filter(s => s.phase !== 'warmup')
    expect(work).toHaveLength(4)
    expect(work[3]).toEqual({ w: 40, r: 8, done: false })
    expect(out.target.sets).toBe(4)
    expect(out.plan.sets).toBe(4)
  })

  it('keeps everything when asked to, and ignores a plan that was not asking', () => {
    const kept = applyProgressionChoice(entry(), { type: 'keep' })
    expect(kept.decided).toBe('keep')
    expect(kept.plan.kind).toBe('hold')
    expect(kept.sets).toEqual(entry().sets)
    const hold = { ...entry(), plan: { policy: 'double', kind: 'hold', reps: 10 } }
    expect(applyProgressionChoice(hold, { type: 'weight', amount: 2.5 })).toBe(hold)
  })
})

import { describe, it, expect } from 'vitest'
import { routineFromSession, sessionChangedRoutine } from './routine-from-session.js'

const routine = {
  id: 'r1',
  ex: [
    { id: 'bench', sets: 3, reps: 8, prog: 'double', repsMin: 6 },
    { id: 'row', sets: 3, reps: 10, sg: 'a' },
    { id: 'fly', sets: 3, reps: 12, sg: 'a' },
  ],
}
// A session as beginWorkout builds it: the target carries history's set count, not the routine's.
const entry = (cfg, extra = {}) => ({ id: cfg.id, ...(cfg.sg ? { sg: cfg.sg } : {}), target: { ...cfg, sets: 4 }, sets: [], ...extra })
const session = (entries = routine.ex.map(c => entry(c))) => ({ routineId: 'r1', entries })

describe('sessionChangedRoutine', () => {
  it('is false for a session that kept the plan, whatever set count history gave it', () => {
    expect(sessionChangedRoutine(session(), routine)).toBe(false)
  })

  it('is false when a superset was undone and redone under a fresh id', () => {
    const [b, r, f] = routine.ex
    expect(sessionChangedRoutine(session([entry(b), entry(r, { sg: 'zz' }), entry(f, { sg: 'zz' })]), routine)).toBe(false)
  })

  it('sees an added, removed, reordered or unpaired exercise', () => {
    const [b, r, f] = routine.ex
    expect(sessionChangedRoutine(session([entry(b), entry(r), entry(f), entry({ id: 'curl', sets: 2, reps: 12 })]), routine)).toBe(true)
    expect(sessionChangedRoutine(session([entry(b), entry(r)]), routine)).toBe(true)
    expect(sessionChangedRoutine(session([entry(r), entry(f), entry(b)]), routine)).toBe(true)
    expect(sessionChangedRoutine(session([entry(b), { ...entry(r), sg: undefined }, { ...entry(f), sg: undefined }]), routine)).toBe(true)
  })

  it('sees a swapped exercise', () => {
    const [b, r, f] = routine.ex
    expect(sessionChangedRoutine(session([entry({ ...b, id: 'dbpress' }), entry(r), entry(f)]), routine)).toBe(true)
  })

  it('sees an exercise re-set during the session, and ignores an unchanged re-set', () => {
    const [b, r, f] = routine.ex
    expect(sessionChangedRoutine(session([{ ...entry(b), retuned: true, target: { ...b, reps: 10 } }, entry(r), entry(f)]), routine)).toBe(true)
    expect(sessionChangedRoutine(session([{ ...entry(b), retuned: true, target: { ...b } }, entry(r), entry(f)]), routine)).toBe(false)
  })

  it('is false without a routine (freestyle)', () => {
    expect(sessionChangedRoutine(session(), null)).toBe(false)
  })
})

describe('routineFromSession', () => {
  it('keeps the routine config of untouched exercises and takes the new ones as trained', () => {
    const [b, r, f] = routine.ex
    const curl = { id: 'curl', sets: 2, reps: 12 }
    const ex = routineFromSession(session([entry(f), entry(b), entry(curl, { target: { sets: 2, reps: 12 } })]), routine)
    expect(ex).toEqual([
      { id: 'fly', sets: 3, reps: 12, sg: 'a' },
      { id: 'bench', sets: 3, reps: 8, prog: 'double', repsMin: 6 },
      { id: 'curl', sets: 2, reps: 12 },
    ])
    expect(r).toBeTruthy()
  })

  it('takes a re-set config over the routine one, keeping fields the sheet did not touch', () => {
    const [b, r, f] = routine.ex
    const ex = routineFromSession(session([{ ...entry(b), retuned: true, target: { sets: 5, reps: 5 } }, entry(r), entry(f)]), routine)
    expect(ex[0]).toEqual({ id: 'bench', sets: 5, reps: 5, prog: 'double', repsMin: 6 })
  })

  it('pairs repeated exercises by occurrence', () => {
    const twice = { id: 'r2', ex: [{ id: 'squat', sets: 5, reps: 5 }, { id: 'squat', sets: 2, reps: 12 }] }
    const ex = routineFromSession({ entries: twice.ex.map(c => entry(c)) }, twice)
    expect(ex).toEqual(twice.ex)
    expect(sessionChangedRoutine({ entries: twice.ex.map(c => entry(c)) }, twice)).toBe(false)
  })
})

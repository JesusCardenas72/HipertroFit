import { describe, it, expect } from 'vitest'
import { buildExtraEntry, fileExtraEntry } from './extra-log.js'
import { cyclePosition, cycleWorkouts, nextStepOf, nextCycleStart } from './microcycle.js'
import { cycleVolume } from './volume.js'
import { sessionsFor } from './progression.js'
import { sessionSetCount } from './history.js'
import { EXDB } from './exercises.js'
import { musclesOf } from './muscles.js'
import { REST } from './program.js'

// Any strength exercise from the catalogue that trains something the volume panel shows.
const ex = EXDB.find(e => e.bp === 'chest' && Object.keys(musclesOf(e)).includes('chest'))
const cfg = { mode: 'reps', sets: 3, reps: 10, weight: 40 }
const opts = { iso: '2026-01-03', today: '2026-01-03', now: Date.parse('2026-01-03T20:00:00'), id: 'x1', name: 'Extra work' }
const planned = (d, routineId) => ({
  id: d, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), routineId,
  entries: [{ id: ex.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 60 }, sets: [1, 2, 3].map(() => ({ w: 60, r: 10, done: true })) }],
})
const state = workouts => ({
  workouts, routines: [], exWeights: {},
  program: { on: true, seq: ['a', 'b', REST], anchor: '2026-01-01', cycleStart: '2026-01-01', strategy: 'custom' },
})

describe('buildExtraEntry', () => {
  it('writes the sets as done work sets of the weight and reps given', () => {
    const e = buildExtraEntry(ex.id, cfg, { sets: 2, reps: 12, weight: 22.5 })
    expect(e.sets).toEqual([{ w: 22.5, r: 12, done: true }, { w: 22.5, r: 12, done: true }])
    expect(e.target).toMatchObject({ mode: 'reps', sets: 2, reps: 12, weight: 22.5 })
  })

  it('never writes an empty or negative set', () => {
    const e = buildExtraEntry(ex.id, cfg, { sets: 0, reps: -3, weight: -5 })
    expect(e.sets).toEqual([{ w: 0, r: 1, done: true }])
  })

  it('writes each set with its own weight, reps and RIR', () => {
    const e = buildExtraEntry(ex.id, cfg, {
      sets: 3, reps: 10, weight: 20,
      rows: [{ w: 20, r: 12, rir: 2 }, { w: 22.5, r: 10, rir: 1 }, { w: 22.5, r: 8, rir: '' }],
    })
    expect(e.sets).toEqual([
      { w: 20, r: 12, rir: 2, done: true },
      { w: 22.5, r: 10, rir: 1, done: true },
      { w: 22.5, r: 8, done: true },               // empty effort: not rated, not 0
    ])
    expect(e.target).toMatchObject({ sets: 3, reps: 12, weight: 20 })
  })

  it('fills sets without a row of their own from the shared values, and caps the effort', () => {
    const e = buildExtraEntry(ex.id, cfg, { sets: 2, reps: 10, weight: 30, rows: [{ w: 30, r: 9, rir: 14 }] })
    expect(e.sets).toEqual([{ w: 30, r: 9, rir: 10, done: true }, { w: 30, r: 10, done: true }])
  })

  it('counts only the sets rated near failure as effective volume', () => {
    const hard = buildExtraEntry(ex.id, cfg, { sets: 2, rows: [{ w: 20, r: 10, rir: 1 }, { w: 20, r: 10, rir: 6 }] })
    const v = cycleVolume(state(fileExtraEntry([], hard, opts)))
    expect(v.groups.chest).toBeCloseTo(musclesOf(ex).chest)
  })

  it('logs a timed exercise as seconds', () => {
    const e = buildExtraEntry(ex.id, { mode: 'time', bodyweight: true }, { sets: 1, sec: 60, weight: 0, reps: 10 })
    expect(e.sets).toEqual([{ sec: 60, w: 0, done: true }])
    expect(e.target).toMatchObject({ mode: 'time', sec: 60, bodyweight: true })
  })
})

describe('fileExtraEntry', () => {
  const entry = buildExtraEntry(ex.id, cfg, { sets: 2, reps: 12, weight: 20 })

  it('files a workout flagged extra, with its volume, in date order', () => {
    const out = fileExtraEntry([planned('2026-01-02', 'a'), planned('2026-01-04', 'b')], entry, opts)
    expect(out.map(w => w.d)).toEqual(['2026-01-02', '2026-01-03', '2026-01-04'])
    expect(out[1]).toMatchObject({ extra: true, excludeFromProgression: true, routineId: null, vol: 480, prs: [] })
    expect(out[1].start).toBe(out[1].end)
  })

  it('adds to the same day’s extra workout instead of opening another', () => {
    const once = fileExtraEntry([], entry, opts)
    const twice = fileExtraEntry(once, buildExtraEntry(ex.id, cfg, { sets: 1, reps: 8, weight: 25 }), { ...opts, id: 'x2' })
    expect(twice.length).toBe(1)
    expect(twice[0].id).toBe('x1')
    expect(twice[0].entries.length).toBe(1)
    expect(twice[0].entries[0].sets.length).toBe(3)
    expect(twice[0].entries[0].target.sets).toBe(3)
    expect(twice[0].vol).toBe(480 + 200)
    expect(once[0].entries[0].sets.length).toBe(2)            // the input was not mutated
  })

  it('keeps a different exercise as its own entry', () => {
    const other = EXDB.find(e => e.id !== ex.id)
    const out = fileExtraEntry(fileExtraEntry([], entry, opts), buildExtraEntry(other.id, cfg, { sets: 1, reps: 10, weight: 5 }), opts)
    expect(out[0].entries.map(e => e.id)).toEqual([ex.id, other.id])
  })
})

describe('what extra work counts toward', () => {
  const entry = buildExtraEntry(ex.id, cfg, { sets: 2, reps: 12, weight: 20 })
  const base = [planned('2026-01-02', 'a')]
  const withExtra = fileExtraEntry(base, entry, opts)

  it('adds its sets to the current microcycle’s volume', () => {
    const before = cycleVolume(state(base))
    const after = cycleVolume(state(withExtra))
    expect(after.groups.chest - before.groups.chest).toBeCloseTo(2 * musclesOf(ex).chest)
    expect(after.sessions).toBe(before.sessions)              // sets, not a session
  })

  it('takes no slot of the block and does not move the sequence on', () => {
    expect(cyclePosition(state(withExtra)).step).toBe(1)
    expect(nextStepOf(state(withExtra))).toBe('b')
  })

  it('takes no slot even with no sequence to be outside of', () => {
    const S = { ...state(withExtra), program: { seq: [], strategy: 'ppl', cycleStart: '2026-01-01' } }
    expect(cyclePosition(S).step).toBe(1)
    expect(cycleWorkouts(S).length).toBe(2)
  })

  it('stays in the block it was logged in once that block’s first session is trained', () => {
    // Block of two closes on the 2nd and 4th; extra on the 5th, next block opens on the 6th.
    const closed = [planned('2026-01-02', 'a'), planned('2026-01-04', 'b')]
    const between = fileExtraEntry(closed, entry, { ...opts, iso: '2026-01-05', today: '2026-01-05' })
    expect(cycleWorkouts(state(between)).map(w => w.d)).toEqual(['2026-01-05'])
    const opened = [...between, planned('2026-01-06', 'a')]
    expect(cycleWorkouts(state(opened)).map(w => w.d)).toEqual(['2026-01-05', '2026-01-06'])
  })

  it('does not become "last time" for the next planned session', () => {
    const S = state(withExtra)
    expect(sessionsFor(S, ex.id).map(s => s.d)).toEqual(['2026-01-02'])
    expect(sessionSetCount(S, { id: ex.id, mode: 'reps', sets: 3 })).toBe(3)
  })

  it('logged today does not push a block closed today to tomorrow', () => {
    expect(nextCycleStart(state(withExtra), '2026-01-03')).toBe('2026-01-03')
  })
})

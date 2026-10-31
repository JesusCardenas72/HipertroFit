import { describe, it, expect } from 'vitest'
import { cycleHistory, closeCycle, keepCycle, closableToday, askCycleEnd, workoutsBetween } from './cycle-history.js'
import { cycleLayout, cycleEndOf, cycleDue, cyclePosition, cycleWorkouts, opensNextCycle } from './microcycle.js'
import { mesoState } from './mesocycle.js'
import { REST } from './program.js'

const w = (d, routineId = 'push', extra = {}) => ({ id: d + routineId, d, start: Date.parse(d + 'T10:00:00'), routineId, entries: [], ...extra })
const days = (from, n, routineId) => Array.from({ length: n }, (_, i) => {
  const d = new Date(from + 'T12:00:00'); d.setDate(d.getDate() + i)
  return w(d.toISOString().slice(0, 10), routineId)
})

// Push, Pull, Legs and a rest day, twice: one PPL microcycle is eight days.
const PPL_SEQ = ['push', 'pull', 'legs', REST, 'push', 'pull', 'legs', REST]
const state = (over = {}) => ({
  workouts: [],
  program: { on: true, seq: PPL_SEQ, anchor: '2026-03-02', cycleStart: '2026-03-02', strategy: 'ppl' },
  ...over,
})
// The six sessions of one block as the plan lays them out, Monday 2 March on.
const asPlanned = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-06', '2026-03-07', '2026-03-08'].map(d => w(d))

describe('the days of a microcycle', () => {
  it('lays one block over the sequence, the rest days after its last session included', () => {
    expect(cycleLayout(state())).toEqual({ days: 8, tail: 1 })
    // Three steps and a rest repeat twice under PPL: the same eight days.
    expect(cycleLayout(state({ program: { seq: ['push', 'pull', 'legs', REST], strategy: 'ppl' } }))).toEqual({ days: 8, tail: 1 })
    // Trailing rests run to the end of the sequence, where the next block starts over.
    expect(cycleLayout(state({ program: { seq: ['a', 'b', 'c', REST, REST], strategy: 'full-body' } }))).toEqual({ days: 5, tail: 2 })
    // A week laid out Monday first: six sessions and Sunday off.
    const week = ['push', 'pull', 'legs', 'push', 'pull', 'legs', REST]
    expect(cycleLayout(state({ program: { seq: week, mode: 'week', strategy: 'ppl' } }))).toEqual({ days: 7, tail: 1 })
  })

  it('has no rest days to wait for without a sequence', () => {
    expect(cycleLayout(state({ program: { seq: [], strategy: 'ppl' } }))).toEqual({ days: 0, tail: 0 })
  })

  it('has no end while sessions are still to do', () => {
    expect(cycleEndOf(state({ workouts: asPlanned.slice(0, 5) }))).toBe(null)
    expect(cycleDue(state({ workouts: asPlanned.slice(0, 5) }), '2026-04-01')).toBe(false)
  })

  it('ends on the last rest day of the plan when it was trained as planned', () => {
    const S = state({ workouts: asPlanned })
    expect(cycleEndOf(S)).toBe('2026-03-09')
    expect(cycleDue(S, '2026-03-09')).toBe(false)     // the rest day itself is still the block
    expect(cycleDue(S, '2026-03-10')).toBe(true)
  })

  it('keeps its whole span when the sessions were trained back to back', () => {
    const S = state({ workouts: days('2026-03-02', 6) })
    expect(cycleEndOf(S)).toBe('2026-03-09')          // eight days from the 2nd, not the 8th
  })

  it('waits for the rest day after the last session when the sessions slipped', () => {
    const S = state({ workouts: [...asPlanned.slice(0, 5), w('2026-03-12')] })
    expect(cycleEndOf(S)).toBe('2026-03-13')
  })

  it('ends on the day of the last session without a sequence', () => {
    const S = state({ program: { seq: [], strategy: 'full-body', cycleStart: '2026-03-02' }, workouts: [w('2026-03-02'), w('2026-03-04'), w('2026-03-06')] })
    expect(cycleEndOf(S)).toBe('2026-03-06')
  })
})

describe('asking before the next microcycle opens', () => {
  it('asks about a planned session once the block is complete', () => {
    expect(opensNextCycle(state({ workouts: asPlanned.slice(0, 5) }), 'push')).toBe(false)
    expect(opensNextCycle(state({ workouts: asPlanned }), 'push')).toBe(true)
    // A freestyle session takes no slot of any block, so it opens nothing.
    expect(opensNextCycle(state({ workouts: asPlanned }), null)).toBe(false)
  })

  it('asks at the end of the days, once a day', () => {
    const S = state({ workouts: asPlanned })
    expect(askCycleEnd(S, '2026-03-09')).toBe(false)
    expect(askCycleEnd(S, '2026-03-10')).toBe(true)
    expect(askCycleEnd({ ...S, program: { ...S.program, endAsked: '2026-03-10' } }, '2026-03-10')).toBe(false)
    expect(askCycleEnd({ ...S, program: { ...S.program, endAsked: '2026-03-10' } }, '2026-03-11')).toBe(true)
  })

  it('cannot close today a block with a session logged today', () => {
    const S = state({ workouts: asPlanned })
    expect(closableToday(S, '2026-03-08')).toBe(false)
    expect(closableToday(S, '2026-03-09')).toBe(true)
  })
})

describe('closing a microcycle', () => {
  it('writes it to the log with its dates and opens the next one today', () => {
    const S = state({ workouts: asPlanned })
    const after = { ...S, ...closeCycle(S, 'ppl', '2026-03-10') }
    expect(after.cycleLog).toEqual([{ start: '2026-03-02', end: '2026-03-09', n: 1, sessions: 6, len: 6, strategy: 'ppl', deload: false }])
    expect(after.program.cycleStart).toBe('2026-03-10')
    expect(cyclePosition(after)).toMatchObject({ cycle: 0, step: 0, complete: false })
    expect(mesoState(after).number).toBe(2)
    expect(cycleWorkouts(after)).toEqual([])
  })

  it('counts every later session in the new block, however many there are', () => {
    const S = state({ workouts: asPlanned })
    const after = { ...S, ...closeCycle(S, 'ppl', '2026-03-10') }
    after.workouts = [...after.workouts, ...days('2026-03-10', 8)]
    // No splitting by the count once the log exists: eight planned sessions, one block.
    expect(cyclePosition(after)).toMatchObject({ cycle: 0, sessions: 8, step: 6, complete: true })
  })

  it('keeps the history a profile without the log already had', () => {
    // Two full blocks and two sessions of a third, split by the count.
    const S = state({ workouts: [...asPlanned, ...days('2026-03-10', 6), ...days('2026-03-18', 2)] })
    const after = { ...S, ...closeCycle(S, 'ppl', '2026-03-21') }
    expect(after.cycleLog.map(c => [c.start, c.end, c.n, c.sessions])).toEqual([
      ['2026-03-02', '2026-03-09', 1, 6],
      ['2026-03-10', '2026-03-17', 2, 6],
      ['2026-03-18', '2026-03-20', 3, 2],
    ])
    expect(mesoState(after).number).toBe(4)
  })

  it('does not log a block with nothing in it, and keeps its number for the next', () => {
    const S = state({ workouts: asPlanned })
    const once = { ...S, ...closeCycle(S, 'ppl', '2026-03-10') }
    const twice = { ...once, ...closeCycle(once, 'full-body', '2026-03-11') }
    expect(twice.cycleLog).toHaveLength(1)
    expect(twice.program).toMatchObject({ cycleStart: '2026-03-11', strategy: 'full-body' })
    expect(mesoState(twice).number).toBe(2)
  })

  it('carries a deload marked for the next microcycle onto the one that opens', () => {
    const S = state({ workouts: asPlanned, meso: { deloads: [1] } })
    const after = { ...S, ...closeCycle(S, 'ppl', '2026-03-10') }
    expect(mesoState(after).deload).toBe(true)
  })

  it('records a block trained as a deload as one', () => {
    const S = state({ workouts: [w('2026-03-02', 'push', { deload: 0.4 })] })
    expect(closeCycle(S, 'ppl', '2026-03-05').cycleLog[0].deload).toBe(true)
  })
})

describe('keeping a complete microcycle open', () => {
  it('stops the count from splitting it, so the next session stays in it', () => {
    const S = state({ workouts: asPlanned })
    const kept = { ...S, ...keepCycle(S, '2026-03-09') }
    kept.workouts = [...kept.workouts, w('2026-03-09')]
    expect(cyclePosition(kept)).toMatchObject({ cycle: 0, sessions: 7, complete: true })
    expect(cycleWorkouts(kept)).toHaveLength(7)
  })

  it('writes the blocks the count already closed to the log', () => {
    const S = state({ workouts: [...asPlanned, ...days('2026-03-10', 6)] })
    const patch = keepCycle(S, '2026-03-16')
    expect(patch.cycleLog.map(c => [c.start, c.end])).toEqual([['2026-03-02', '2026-03-09']])
    expect(patch.program.cycleStart).toBe('2026-03-10')
    expect(mesoState({ ...S, ...patch })).toMatchObject({ cycle: 0, number: 2 })
  })

  it('has nothing to write once the log exists', () => {
    expect(keepCycle(state({ cycleLog: [] }))).toBe(null)
  })
})

describe('the microcycles on record', () => {
  it('lists the running one first, then the closed ones with their dates and sessions', () => {
    const S = state({ workouts: [...asPlanned, ...days('2026-03-10', 6), ...days('2026-03-18', 2)] })
    const list = cycleHistory(S)
    expect(list.map(c => [c.id, c.n, c.start, c.end, c.current])).toEqual([
      [2, 3, '2026-03-18', null, true],
      [1, 2, '2026-03-10', '2026-03-17', false],
      [0, 1, '2026-03-02', '2026-03-09', false],
    ])
    expect(list.map(c => c.workouts.length)).toEqual([2, 6, 6])
  })

  it('reads a closed one back from the workouts between its dates', () => {
    const S = state({ workouts: asPlanned })
    const after = { ...S, ...closeCycle(S, 'ppl', '2026-03-10') }
    after.workouts = [...after.workouts, w('2026-03-05', 'arms', { routineId: null })]   // backfilled later
    const [running, closed] = cycleHistory(after)
    expect(running).toMatchObject({ current: true, start: '2026-03-10', workouts: [] })
    expect(closed.workouts.map(x => x.d)).toContain('2026-03-05')
    expect(workoutsBetween(after, '2026-03-04', '2026-03-05').map(x => x.d)).toEqual(['2026-03-04', '2026-03-05'])
  })

  it('gives the running one the day it is due once complete', () => {
    expect(cycleHistory(state({ workouts: asPlanned }))[0].due).toBe('2026-03-09')
    expect(cycleHistory(state({ workouts: asPlanned.slice(0, 2) }))[0].due).toBe(null)
  })

  it('lists the sessions a moved programming start left behind as earlier microcycles', () => {
    // Two blocks trained in March, then the programming start moved to the 20th: the running
    // block counts from there, and both earlier blocks stay on the list, unnumbered.
    const S = state({
      workouts: [...asPlanned, ...days('2026-03-10', 6)],
      program: { ...state().program, anchor: '2026-03-20', cycleStart: '2026-03-20' },
    })
    const list = cycleHistory(S)
    expect(list.map(c => [c.start, c.end, c.sessions, c.current])).toEqual([
      ['2026-03-20', null, 0, true],
      ['2026-03-10', '2026-03-19', 6, false],
      ['2026-03-02', '2026-03-09', 6, false],
    ])
    expect(list[1].n).toBe(null)
    expect(list.reduce((n, c) => n + c.workouts.length, 0)).toBe(12)   // every session on record
  })

  it('reads the sessions the log covers from the log, not twice', () => {
    const S = state({
      workouts: [...asPlanned, ...days('2026-03-10', 6)],
      cycleLog: [{ start: '2026-03-02', end: '2026-03-09', n: 1, sessions: 6, len: 6, strategy: 'ppl', deload: false }],
      program: { ...state().program, anchor: '2026-03-10', cycleStart: '2026-03-10' },
    })
    expect(cycleHistory(S).map(c => [c.start, c.current, c.workouts.length])).toEqual([
      ['2026-03-10', true, 6],
      ['2026-03-02', false, 6],
    ])
  })
})

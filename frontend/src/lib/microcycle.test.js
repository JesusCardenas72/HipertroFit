import { describe, it, expect } from 'vitest'
import {
  STRATEGIES, DEFAULT_MICROCYCLE, strategyOf, microcycleLen, cycleStartOf, sessionsSince,
  cyclePosition, trainingSteps, nextStepOf, cycleWorkouts, cycleStrip,
  nextCycleStart, closeMicrocycle,
} from './microcycle.js'
import { REST } from './program.js'

const w = (d, routineId = 'push') => ({ id: d + routineId, d, start: Date.parse(d + 'T10:00:00'), routineId, entries: [] })

// Push A, Pull A, Legs, Push B, Pull B, Legs — the sequence that repeats a routine, which is
// exactly the case a routine-name pointer cannot resolve and a positional one can.
const PPL_SEQ = ['pushA', 'pullA', 'legs', REST, 'pushB', 'pullB', 'legs', REST]

const state = (over = {}) => ({
  microcycleSessions: 6,
  workouts: [],
  program: { on: true, seq: PPL_SEQ, anchor: '2026-01-01', cycleStart: '2026-01-01', strategy: 'ppl' },
  ...over,
})

describe('strategy', () => {
  it('sizes the block from the strategy, not from the calendar', () => {
    expect(microcycleLen(state({ program: { strategy: 'full-body', seq: [] } }))).toBe(3)
    expect(microcycleLen(state({ program: { strategy: 'upper-lower', seq: [] } }))).toBe(4)
    expect(microcycleLen(state({ program: { strategy: 'ppl', seq: [] } }))).toBe(6)
  })

  it('counts the sequence itself when the strategy is custom', () => {
    // Five training steps and three rest days is a five-session block.
    const seq = ['a', REST, 'b', 'c', REST, 'd', 'e', REST]
    expect(microcycleLen(state({ program: { strategy: 'custom', seq } }))).toBe(5)
  })

  it('infers the strategy of a profile saved before strategies existed', () => {
    expect(strategyOf({ microcycleSessions: 4 })).toBe('upper-lower')
    expect(strategyOf({ microcycleSessions: 6 })).toBe('ppl')
    expect(strategyOf({ microcycleSessions: 5 })).toBe('custom')
    // ...and keeps the block length that profile already had.
    expect(microcycleLen({ microcycleSessions: 5 })).toBe(5)
    expect(microcycleLen({})).toBe(DEFAULT_MICROCYCLE)
  })

  it('offers the three strategies plus custom', () => {
    expect(STRATEGIES.map(s => s.key)).toEqual(['full-body', 'upper-lower', 'ppl', 'custom'])
  })
})

describe('where the block starts', () => {
  it('prefers an explicit start, then the program anchor, then the first workout ever', () => {
    expect(cycleStartOf(state())).toBe('2026-01-01')
    expect(cycleStartOf(state({ program: { seq: [], anchor: '2026-02-01' } }))).toBe('2026-02-01')
    expect(cycleStartOf({ program: null, workouts: [w('2026-03-04'), w('2026-03-02')] })).toBe('2026-03-02')
  })

  it('ignores everything logged before the start', () => {
    const S = state({ workouts: [w('2025-12-20'), w('2026-01-02'), w('2026-01-05')] })
    expect(sessionsSince(S).map(x => x.d)).toEqual(['2026-01-02', '2026-01-05'])
  })
})

describe('counting sessions, not days', () => {
  it('closes a block on its last session whatever the rest days did', () => {
    // Six sessions spread over three weeks still closes exactly one PPL microcycle.
    const days = ['2026-01-02', '2026-01-05', '2026-01-09', '2026-01-12', '2026-01-18', '2026-01-21']
    const S = state({ workouts: days.map(d => w(d)) })
    const pos = cyclePosition(S)
    expect(pos.len).toBe(6)
    expect(pos.sessions).toBe(6)
    expect(pos.cycle).toBe(1)      // block 0 is closed, block 1 opens
    expect(pos.step).toBe(0)       // nothing of it logged yet
    expect(pos.remaining).toBe(6)
  })

  it('reports the position of the next session inside the block', () => {
    const S = state({ workouts: ['2026-01-02', '2026-01-03', '2026-01-05'].map(d => w(d)) })
    expect(cyclePosition(S)).toMatchObject({ cycle: 0, step: 3, remaining: 3 })
  })

  it('counts two sessions on one day as two sessions', () => {
    const S = state({ workouts: [w('2026-01-02', 'pushA'), w('2026-01-02', 'pullA')] })
    expect(cyclePosition(S).step).toBe(2)
  })
})

describe('the sequence pointer', () => {
  it('walks the training steps by position, telling the two Legs days apart', () => {
    const at = n => nextStepOf(state({
      workouts: Array.from({ length: n }, (_, i) => w(`2026-01-${String(i + 2).padStart(2, '0')}`)),
    }))
    expect(trainingSteps({ seq: PPL_SEQ })).toEqual(['pushA', 'pullA', 'legs', 'pushB', 'pullB', 'legs'])
    expect(at(0)).toBe('pushA')
    expect(at(2)).toBe('legs')     // third session of the block
    expect(at(5)).toBe('legs')     // sixth — the other Legs day, same routine id
    expect(at(6)).toBe('pushA')    // block closed, back to the top
  })

  it('does not skip a step when a training day is missed', () => {
    // Two sessions logged a fortnight apart: the next one is still the third step, because
    // the rest days in between never consumed one.
    const S = state({ workouts: [w('2026-01-02'), w('2026-01-16')] })
    expect(nextStepOf(S)).toBe('legs')
  })

  it('is null without a sequence to walk', () => {
    expect(nextStepOf(state({ program: { seq: [], strategy: 'ppl' } }))).toBe(null)
  })
})

describe('the block as trained', () => {
  const S = state({ workouts: [w('2026-01-02', 'pushA'), w('2026-01-04', 'freestyle')] })

  it('windows the volume on the current block only', () => {
    expect(cycleWorkouts(S).map(x => x.d)).toEqual(['2026-01-02', '2026-01-04'])
    // A closed block leaves the next one empty — volume restarts, it does not roll over.
    const closed = state({ workouts: Array.from({ length: 6 }, (_, i) => w(`2026-01-0${i + 2}`)) })
    expect(cycleWorkouts(closed)).toEqual([])
  })

  it('keeps an off-plan session out of the block count but inside its volume', () => {
    // A freestyle workout carries no routine: it is training done outside the planning.
    const free = { id: 'free', d: '2026-01-03', start: Date.parse('2026-01-03T10:00:00'), routineId: null, entries: [] }
    const T = state({ workouts: [w('2026-01-02', 'pushA'), free, w('2026-01-04', 'pullA')] })
    expect(cyclePosition(T)).toMatchObject({ step: 2, remaining: 4 })   // two planned steps
    expect(nextStepOf(T)).toBe('legs')                                  // pointer did not skip
    expect(cycleWorkouts(T).map(x => x.d)).toEqual(['2026-01-02', '2026-01-03', '2026-01-04'])
    expect(cycleStrip(T).map(s => s.state)).toEqual(['done', 'done', 'next', 'todo', 'todo', 'todo'])
  })

  it('does not let an off-plan session push a planned one out of the block', () => {
    const days = ['2026-01-02', '2026-01-05', '2026-01-09', '2026-01-12', '2026-01-18', '2026-01-21']
    const workouts = days.map(d => w(d))
    workouts.splice(3, 0, { id: 'free', d: '2026-01-10', start: 1, routineId: null, entries: [] })
    const T = state({ workouts })
    expect(cyclePosition(T)).toMatchObject({ cycle: 1, step: 0 })  // six planned: block closed
    expect(cycleWorkouts(T)).toEqual([])                           // the next one starts empty
  })

  it('counts every session when there is no plan to be outside of', () => {
    const free = d => ({ id: d, d, start: 1, routineId: null, entries: [] })
    const T = state({ program: { seq: [], strategy: 'ppl', cycleStart: '2026-01-01' },
      workouts: ['2026-01-02', '2026-01-03'].map(free) })
    expect(cyclePosition(T).step).toBe(2)
    expect(cycleWorkouts(T).length).toBe(2)
  })

  it('lays the block out as done / next / upcoming slots', () => {
    const strip = cycleStrip(S)
    expect(strip.length).toBe(6)
    expect(strip.map(s => s.state)).toEqual(['done', 'done', 'next', 'todo', 'todo', 'todo'])
    // A done slot reports what was actually trained, not what the sequence planned.
    expect(strip[1].routineId).toBe('freestyle')
    expect(strip[2].routineId).toBe('legs')
  })
})

describe('closing a microcycle by hand', () => {
  // Three of six sessions done: block 0, step 3.
  const half = () => state({ workouts: ['2026-01-02', '2026-01-03', '2026-01-05'].map(d => w(d)) })

  it('restarts the count: the new block is #1, nothing logged in it', () => {
    const S = half()
    const next = { ...S, program: closeMicrocycle(S, 'full-body', '2026-01-10') }
    expect(cyclePosition(S)).toMatchObject({ cycle: 0, step: 3 })
    expect(cyclePosition(next)).toMatchObject({ cycle: 0, step: 0, sessions: 0 })
    expect(cycleWorkouts(next)).toEqual([])
  })

  it('sizes the new block from the chosen strategy', () => {
    const S = half()
    expect(microcycleLen({ ...S, program: closeMicrocycle(S, 'full-body', '2026-01-10') })).toBe(3)
    expect(microcycleLen({ ...S, program: closeMicrocycle(S, 'upper-lower', '2026-01-10') })).toBe(4)
    expect(microcycleLen({ ...S, program: closeMicrocycle(S, 'ppl', '2026-01-10') })).toBe(6)
  })

  it('keeps the calendar layout: sequence, anchor and switch', () => {
    const S = half()
    const p = closeMicrocycle(S, 'ppl', '2026-01-10')
    expect(p).toMatchObject({ on: true, seq: PPL_SEQ, anchor: '2026-01-01', strategy: 'ppl' })
  })

  it('starts today when nothing is logged today, so the next session counts', () => {
    const S = half()
    expect(nextCycleStart(S, '2026-01-10')).toBe('2026-01-10')
    const next = { ...S, program: closeMicrocycle(S, 'ppl', '2026-01-10') }
    next.workouts = [...next.workouts, w('2026-01-10', 'legs')]
    expect(cyclePosition(next)).toMatchObject({ cycle: 0, step: 1 })
  })

  it('starts the day after a session already logged today, so it stays in the closed block', () => {
    const S = state({ workouts: ['2026-01-02', '2026-01-10'].map(d => w(d)) })
    expect(nextCycleStart(S, '2026-01-10')).toBe('2026-01-11')
    const next = { ...S, program: closeMicrocycle(S, 'ppl', '2026-01-10') }
    expect(cyclePosition(next).sessions).toBe(0)
  })

  it('rolls the day over month and year ends', () => {
    expect(nextCycleStart({ workouts: [w('2026-12-31')] }, '2026-12-31')).toBe('2027-01-01')
  })

  it('works on a profile with no program at all', () => {
    const S = { workouts: [w('2026-01-02')], program: null, microcycleSessions: 6 }
    const p = closeMicrocycle(S, 'full-body', '2026-01-10')
    expect(p).toMatchObject({ on: false, seq: [], strategy: 'full-body', cycleStart: '2026-01-10' })
    expect(microcycleLen({ ...S, program: p })).toBe(3)
  })

  it('falls back to custom for a strategy it does not know', () => {
    expect(closeMicrocycle(half(), 'bro-split', '2026-01-10').strategy).toBe('custom')
  })

  it('does not touch the state it was given', () => {
    const S = half()
    const before = JSON.stringify(S)
    closeMicrocycle(S, 'ppl', '2026-01-10')
    expect(JSON.stringify(S)).toBe(before)
  })
})

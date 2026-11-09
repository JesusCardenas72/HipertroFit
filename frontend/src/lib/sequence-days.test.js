import { describe, it, expect } from 'vitest'
import { sequenceDays, sequenceQueue } from './sequence-days.js'
import { REST } from './program.js'

const w = (d, routineId) => ({ id: d + routineId, d, start: Date.parse(d + 'T10:00:00'), routineId, entries: [] })

// Push, rest, Pull, rest, Legs, rest, rest — a weekday layout starting on Monday 2 November.
const SEQ = ['push', REST, 'pull', REST, 'legs', REST, REST]
const MON = '2026-11-02'
const state = (workouts = [], over = {}) => ({
  routines: [], week: {}, dayPlan: {}, cycleLog: [], workouts,
  program: { mode: 'week', seq: SEQ, anchor: MON, cycleStart: MON, strategy: 'custom' },
  ...over,
})
const strip = (S, today) => sequenceDays(S, 7, MON, today).map(d => d.state + (d.routineId ? ':' + d.routineId : ''))

describe('sequenceDays', () => {
  it('shows what was trained and lays the rest of the sequence out from the last session', () => {
    expect(strip(state([w(MON, 'push')]), '2026-11-04')).toEqual([
      'done:push', 'past', 'planned:pull', 'rest', 'planned:legs', 'rest', 'rest'])
  })

  it('moves a session that was due and not trained, and everything after it, on a day', () => {
    // Pull was due on Wednesday and nothing was trained: on Thursday it is still the next one.
    expect(strip(state([w(MON, 'push')]), '2026-11-05')).toEqual([
      'done:push', 'past', 'missed:pull', 'planned:pull', 'rest', 'planned:legs', 'rest'])
  })

  it('keeps moving the first session while nothing of the block is trained', () => {
    expect(strip(state(), '2026-11-04')).toEqual([
      'missed:push', 'missed:push', 'planned:push', 'rest', 'planned:pull', 'rest', 'planned:legs'])
  })

  it('reports the session actually trained, even out of turn', () => {
    const S = state([w(MON, 'push'), w('2026-11-03', 'legs')])
    const days = sequenceDays(S, 7, MON, '2026-11-04')
    expect(days[1]).toMatchObject({ state: 'done', routineId: 'legs' })
    expect(days.slice(2).some(d => d.routineId === 'pull')).toBe(true)
  })

  it('opens the next block from the top once its rest days have passed', () => {
    const S = state([w(MON, 'push'), w('2026-11-04', 'pull'), w('2026-11-06', 'legs')])
    expect(sequenceDays(S, 9, MON, '2026-11-07').map(d => d.state + (d.routineId ? ':' + d.routineId : ''))).toEqual([
      'done:push', 'past', 'done:pull', 'past', 'done:legs', 'rest', 'rest', 'planned:push', 'rest'])
  })

  it('shows a per-day change and carries the sequence on after it', () => {
    const S = state([w(MON, 'push')], { dayPlan: { '2026-11-04': 'rest' } })
    expect(strip(S, '2026-11-04')).toEqual([
      'done:push', 'past', 'rest', 'planned:pull', 'rest', 'planned:legs', 'rest'])
  })

  it('falls back to the calendar without a sequence', () => {
    const S = state([], { program: null, week: { 1: 'push', 3: 'pull' } })
    expect(strip(S, '2026-11-03')).toEqual([
      'past', 'rest', 'planned:pull', 'rest', 'rest', 'rest', 'rest'])
  })
})

describe('sequenceQueue', () => {
  it('is null without a sequence', () => {
    expect(sequenceQueue({ program: null, workouts: [] }, 5)).toBe(null)
  })
  it('starts at the top of the sequence before anything is trained', () => {
    expect(sequenceQueue(state(), 8)).toEqual([...SEQ, 'push'])
  })
})

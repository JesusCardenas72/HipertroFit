import { describe, it, expect } from 'vitest'
import {
  REST, daysBetween, programActive, programStep, projectProgram, sessionsPerRound, emptyProgram,
  SEQ_WEEK, programMode, mondayOf, weekSequence,
} from './program.js'

// Legs, rest, Push, Pull, rest — the user's own example, a 5-day loop.
const prog = { on: true, anchor: '2026-09-07', seq: ['legs', REST, 'push', 'pull', REST] }

describe('daysBetween', () => {
  it('counts whole calendar days across a month boundary', () => {
    expect(daysBetween('2026-09-07', '2026-09-07')).toBe(0)
    expect(daysBetween('2026-09-07', '2026-09-10')).toBe(3)
    expect(daysBetween('2026-08-31', '2026-09-02')).toBe(2)
    expect(daysBetween('2026-09-10', '2026-09-07')).toBe(-3)
  })
})

describe('programActive', () => {
  it('needs on, a non-empty sequence and an anchor', () => {
    expect(programActive(prog)).toBe(true)
    expect(programActive(null)).toBe(false)
    expect(programActive({ ...prog, on: false })).toBe(false)
    expect(programActive({ ...prog, seq: [] })).toBe(false)
    expect(programActive({ ...prog, anchor: '' })).toBe(false)
  })
})

describe('programStep', () => {
  it('walks the sequence day by day from the anchor', () => {
    expect(programStep(prog, '2026-09-07')).toBe('legs')
    expect(programStep(prog, '2026-09-08')).toBe(REST)
    expect(programStep(prog, '2026-09-09')).toBe('push')
    expect(programStep(prog, '2026-09-10')).toBe('pull')
    expect(programStep(prog, '2026-09-11')).toBe(REST)
  })

  it('repeats past the end of the sequence', () => {
    expect(programStep(prog, '2026-09-12')).toBe('legs')   // day 5 → index 0
    expect(programStep(prog, '2026-09-14')).toBe('push')   // day 7 → index 2
  })

  it('does not speak for dates before the anchor, or when inactive', () => {
    expect(programStep(prog, '2026-09-06')).toBe(null)
    expect(programStep({ ...prog, on: false }, '2026-09-07')).toBe(null)
    expect(programStep(null, '2026-09-07')).toBe(null)
  })
})

describe('projectProgram', () => {
  it('projects a run of dates inclusive of the start', () => {
    const days = projectProgram(prog, '2026-09-07', 6)
    expect(days.map(d => d.iso)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'])
    expect(days.map(d => d.step)).toEqual(['legs', REST, 'push', 'pull', REST, 'legs'])
  })

  it('reports null steps for a program that has not started', () => {
    const later = { ...prog, anchor: '2026-09-20' }
    expect(projectProgram(later, '2026-09-18', 2).map(d => d.step)).toEqual([null, null])
  })
})

describe('sessionsPerRound & emptyProgram', () => {
  it('counts the training days in one pass', () => {
    expect(sessionsPerRound(prog)).toBe(3)               // legs, push, pull
    expect(sessionsPerRound({ seq: [REST, REST] })).toBe(0)
    expect(sessionsPerRound(null)).toBe(0)
  })
  it('starts off, empty, anchored to the given day', () => {
    expect(emptyProgram('2026-09-07')).toEqual({ on: false, seq: [], anchor: '2026-09-07' })
  })
})

describe('weekday mode', () => {
  it('defaults to the numeric cycle', () => {
    expect(programMode(prog)).toBe('cycle')
    expect(programMode({ ...prog, mode: SEQ_WEEK })).toBe(SEQ_WEEK)
  })

  it('finds the Monday of any date in its week', () => {
    expect(mondayOf('2026-10-29')).toBe('2026-10-26')   // a Thursday
    expect(mondayOf('2026-10-26')).toBe('2026-10-26')   // already a Monday
    expect(mondayOf('2026-11-01')).toBe('2026-10-26')   // a Sunday closes the week
  })

  it('builds seven steps Monday first from the weekly plan', () => {
    const week = { 0: 'sun', 1: 'mon', 3: 'wed' }
    expect(weekSequence(week)).toEqual(['mon', REST, 'wed', REST, REST, REST, 'sun'])
  })

  it('lands each weekday on its own step when anchored on a Monday', () => {
    const wk = { on: true, mode: SEQ_WEEK, anchor: '2026-10-26', seq: ['mon', REST, 'wed', REST, REST, REST, 'sun'] }
    expect(programStep(wk, '2026-10-26')).toBe('mon')
    expect(programStep(wk, '2026-10-28')).toBe('wed')
    expect(programStep(wk, '2026-11-01')).toBe('sun')
    expect(programStep(wk, '2026-11-02')).toBe('mon')   // next week repeats
  })
})

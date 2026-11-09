import { describe, it, expect } from 'vitest'
import { pausedList, isResumable, resumableOf, pausedFor, pausedOn, pauseActive, resumePaused, discardPaused } from './paused-workout.js'
import { closeCycle } from './cycle-history.js'
import { cyclePosition } from './microcycle.js'
import { REST } from './program.js'

const PPL_SEQ = ['pushA', 'pullA', 'legs', REST, 'pushB', 'pullB', 'legs', REST]
const at = (d, hh = '10:00') => Date.parse(d + 'T' + hh + ':00')
const w = (d, routineId) => ({ id: d + routineId, d, start: at(d), end: at(d, '11:00'), routineId, entries: [] })
const session = (d, routineId = 'pushA', over = {}) => ({
  id: 'a-' + d + '-' + routineId, d, start: at(d), routineId, name: routineId, bw: 80, cur: 1,
  entries: [
    { id: 'bench', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] },
    { id: 'ohp', sets: [{ w: 40, r: 8, done: false }] },
  ],
  ...over,
})
const state = (over = {}) => ({
  workouts: [],
  cycleLog: [],
  active: null,
  paused: [],
  program: { on: true, seq: PPL_SEQ, anchor: '2026-03-02', cycleStart: '2026-03-02', strategy: 'ppl' },
  ...over,
})

describe('pausing the running session', () => {
  it('takes it off the screen with everything logged in it, and stops its clock', () => {
    const A = session('2026-03-02')
    const patch = pauseActive(state({ active: A }), at('2026-03-02', '10:25'), '2026-03-02')
    expect(patch.active).toBe(null)
    expect(patch.paused).toHaveLength(1)
    expect(patch.paused[0]).toEqual({ ...A, pausedAt: at('2026-03-02', '10:25') })
  })

  it('does not file it: the microcycle neither advances nor counts it', () => {
    const S = state({ active: session('2026-03-02') })
    const after = { ...S, ...pauseActive(S, at('2026-03-02', '10:25'), '2026-03-02') }
    expect(after.workouts).toEqual([])
    expect(cyclePosition(after).sessions).toBe(0)
  })

  it('has nothing to pause without a session, nor for a past workout being logged', () => {
    expect(pauseActive(state())).toBe(null)
    expect(pauseActive(state({ active: session('2026-02-20', 'pushA', { backfill: { durationMin: 60 } }) }))).toBe(null)
  })

  it('keeps one pause per routine: pausing it again supersedes the older one', () => {
    const old = { ...session('2026-03-02'), id: 'old', pausedAt: at('2026-03-02', '10:20') }
    const other = { ...session('2026-03-03', 'pullA'), pausedAt: at('2026-03-03', '10:20') }
    const S = state({ paused: [old, other], active: session('2026-03-04') })
    const patch = pauseActive(S, at('2026-03-04', '10:30'), '2026-03-04')
    expect(patch.paused.map(p => p.id).sort()).toEqual(['a-2026-03-03-pullA', 'a-2026-03-04-pushA'])
  })

  it('lets several sessions stay paused at once', () => {
    const S = state({ paused: [{ ...session('2026-03-02'), pausedAt: 1 }], active: session('2026-03-03', 'pullA') })
    expect(pauseActive(S, at('2026-03-03', '11:00'), '2026-03-03').paused).toHaveLength(2)
  })
})

describe('resuming it', () => {
  const paused = { ...session('2026-03-02'), pausedAt: at('2026-03-02', '10:25') }

  it('brings it back where it was, without the time it spent paused on the clock', () => {
    const S = state({ paused: [paused] })
    const now = at('2026-03-04', '18:00')
    const patch = resumePaused(S, paused.id, now, '2026-03-04')
    expect(patch.paused).toEqual([])
    expect(patch.active.entries).toEqual(paused.entries)
    expect(patch.active.cur).toBe(1)
    expect(patch.active.pausedAt).toBeUndefined()
    // 25 minutes had been trained when it was paused; the clock picks up from there.
    expect(now - patch.active.start).toBe(25 * 60000)
  })

  it('moves it to the day it is resumed, where it will be filed', () => {
    const patch = resumePaused(state({ paused: [paused] }), paused.id, at('2026-03-04', '18:00'), '2026-03-04')
    expect(patch.active.d).toBe('2026-03-04')
  })

  it('needs the running session out of the way first', () => {
    const S = state({ paused: [paused], active: session('2026-03-04', 'pullA') })
    expect(resumePaused(S, paused.id, at('2026-03-04', '18:00'), '2026-03-04')).toBe(null)
  })

  it('cannot resume what is not there', () => {
    expect(resumePaused(state({ paused: [paused] }), 'nope', at('2026-03-04'), '2026-03-04')).toBe(null)
  })
})

describe('only within its microcycle', () => {
  const paused = { ...session('2026-03-03', 'pullA'), pausedAt: at('2026-03-03', '10:30') }

  it('can be taken up at any moment while the microcycle runs', () => {
    const S = state({ paused: [paused], workouts: [w('2026-03-02', 'pushA'), w('2026-03-05', 'legs')] })
    expect(isResumable(S, paused, '2026-03-03')).toBe(true)
    expect(isResumable(S, paused, '2026-03-07')).toBe(true)
    expect(resumableOf(S, '2026-03-07').map(p => p.id)).toEqual([paused.id])
  })

  it('cannot once the microcycle is closed', () => {
    const S = state({ paused: [paused], workouts: [w('2026-03-02', 'pushA')] })
    const after = { ...S, ...closeCycle(S, 'ppl', '2026-03-06') }
    expect(after.paused).toEqual([])
    // Even with the entry still on record (a state from before closing cleared it), its day is
    // now in the block behind.
    expect(isResumable({ ...after, paused: [paused] }, paused, '2026-03-06')).toBe(false)
    expect(resumePaused({ ...after, paused: [paused] }, paused.id, at('2026-03-06'), '2026-03-06')).toBe(null)
  })

  it('cannot once all its days, rest days included, have passed', () => {
    const done = ['pushA', 'pullA', 'legs', 'pushB', 'pullB', 'legs']
    const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-06', '2026-03-07', '2026-03-08']
    const S = state({ paused: [paused], workouts: done.map((r, i) => w(days[i], r)) })
    // Complete on the 8th, its last rest day is the 9th: still resumable then, not after.
    expect(isResumable(S, paused, '2026-03-09')).toBe(true)
    expect(isResumable(S, paused, '2026-03-10')).toBe(false)
    expect(resumableOf(S, '2026-03-10')).toEqual([])
  })

  it('survives the gap day when a block is closed after the day’s session', () => {
    // Closed on the 6th with a session already logged that day: the new block opens on the 7th.
    const S0 = state({ workouts: [w('2026-03-02', 'pushA'), w('2026-03-06', 'pullA')] })
    const S = { ...S0, ...closeCycle(S0, 'ppl', '2026-03-06') }
    expect(cyclePosition(S).start).toBe('2026-03-07')
    const late = { ...session('2026-03-06', 'legs'), pausedAt: at('2026-03-06', '20:00') }
    expect(isResumable({ ...S, paused: [late] }, late, '2026-03-06')).toBe(true)
  })
})

describe('finding them', () => {
  const a = { ...session('2026-03-02', 'pushA'), pausedAt: at('2026-03-02', '10:30') }
  const b = { ...session('2026-03-03', 'pullA'), pausedAt: at('2026-03-03', '10:30') }
  const free = { ...session('2026-03-03', null, { id: 'free' }), pausedAt: at('2026-03-03', '19:00') }
  const S = state({ paused: [a, b, free] })

  it('lists the most recently paused first', () => {
    expect(resumableOf(S, '2026-03-04').map(p => p.id)).toEqual(['free', b.id, a.id])
  })

  it('by routine — never for a freestyle session', () => {
    expect(pausedFor(S, 'pullA', '2026-03-04')).toBe(b)
    expect(pausedFor(S, 'legs', '2026-03-04')).toBe(null)
    expect(pausedFor(S, null, '2026-03-04')).toBe(null)
  })

  it('by the day it was trained', () => {
    expect(pausedOn(S, '2026-03-02', '2026-03-04')).toBe(a)
    expect(pausedOn(S, '2026-03-03', '2026-03-04')).toBe(free)
    expect(pausedOn(S, '2026-03-04', '2026-03-04')).toBe(null)
  })

  it('drops malformed entries and reads a profile saved before pausing existed', () => {
    expect(pausedList({ paused: [null, { id: 'x' }, a] })).toEqual([a])
    expect(pausedList({})).toEqual([])
    expect(resumableOf(state({ paused: undefined }), '2026-03-04')).toEqual([])
  })

  it('discards one, keeping the rest', () => {
    expect(discardPaused(S, b.id, '2026-03-04').paused.map(p => p.id)).toEqual(['free', a.id])
  })
})

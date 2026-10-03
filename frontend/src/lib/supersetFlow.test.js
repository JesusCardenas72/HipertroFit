import { describe, expect, it } from 'vitest'
import { insertionIndexAfterCurrentUnit, markResumeAt, nextUnfinishedUnit, resumeEntryIdx, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, unitEntryIdx } from './supersetFlow.js'

const entry = done => ({ sets: done.map(value => ({ done: value })) })

describe('restAfterSet', () => {
  it('rests between the sets of an exercise', () => {
    expect(restAfterSet({ unitDone: false, lastUnit: false })).toBe(true)
    expect(restAfterSet({ unitDone: false, lastUnit: true })).toBe(true)
  })

  // Issue #3: a two-set exercise timed one rest instead of two, because the closing set
  // "finished quietly". The next exercise still follows it, so the rest belongs there.
  it('rests after the closing set when another exercise follows', () => {
    expect(restAfterSet({ unitDone: true, lastUnit: false })).toBe(true)
  })

  it('stays quiet only on the very last set of the session', () => {
    expect(restAfterSet({ unitDone: true, lastUnit: true })).toBe(false)
  })
})

describe('supersetFlowStep', () => {
  it('does not create navigation or rest flow for a normal singleton exercise', () => {
    const entries = [entry([true]), entry([false])]
    expect(supersetFlowStep(entries, [0], 0)).toBeNull()
  })

  it('does not count an uncheck/re-check of previously completed work as new progress', () => {
    const finished = entry([true, true, true])
    expect(setProgressHighWater(finished, 3)).toEqual({ isNew: false, highWater: 3 })
    expect(setProgressHighWater(finished, 2)).toEqual({ isNew: true, highWater: 3 })
  })

  it('skips a spent short member and uses the last member with work as the round boundary', () => {
    // A has just completed set two of three; B's only set was completed last round.
    const entries = [entry([true, true, false]), entry([true])]
    expect(supersetFlowStep(entries, [0, 1], 0)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })

  it('wraps to the next member with work at a normal round boundary', () => {
    const entries = [entry([true, false, false]), entry([true])]
    expect(supersetFlowStep(entries, [0, 1], 1)).toEqual({
      unitDone: false,
      roundDone: true,
      nextIdx: 0
    })
  })
})

// Rows as [done, phase]: 'w' is a warm-up, anything else a work set.
const phased = rows => ({ sets: rows.map(([done, phase]) => ({ done, phase: phase === 'w' ? 'warmup' : 'work' })) })

describe('supersetFlowStep with warm-ups', () => {
  it('stays on the only member with warm-ups instead of jumping to another member’s work set', () => {
    // A: 2 warm-ups + 2 work sets, first warm-up just done. B: 2 work sets, no warm-ups.
    const entries = [phased([[true, 'w'], [false, 'w'], [false], [false]]), phased([[false], [false]])]
    expect(supersetFlowStep(entries, [0, 1], 0, 0)).toEqual({ unitDone: false, roundDone: true, nextIdx: 0 })
  })

  it('starts the work phase at the first member once the last warm-up is done', () => {
    const entries = [phased([[false], [false]]), phased([[true, 'w'], [true, 'w'], [false], [false]])]
    expect(supersetFlowStep(entries, [0, 1], 1, 1)).toEqual({ unitDone: false, roundDone: true, nextIdx: 0 })
  })

  it('alternates between members that both have warm-ups', () => {
    // A: 2 warm-ups, B: 1 warm-up, C: none.
    const entries = [
      phased([[true, 'w'], [false, 'w'], [false]]),
      phased([[false, 'w'], [false]]),
      phased([[false]]),
    ]
    expect(supersetFlowStep(entries, [0, 1, 2], 0, 0)).toEqual({ unitDone: false, roundDone: false, nextIdx: 1 })
    entries[1].sets[0].done = true
    // B has no warm-up left and C never had one: back to A’s second warm-up, not C’s work set.
    expect(supersetFlowStep(entries, [0, 1, 2], 1, 0)).toEqual({ unitDone: false, roundDone: true, nextIdx: 0 })
    entries[0].sets[1].done = true
    expect(supersetFlowStep(entries, [0, 1, 2], 0, 1)).toEqual({ unitDone: false, roundDone: true, nextIdx: 0 })
  })

  it('sends a work set done out of turn back to the warm-ups still pending', () => {
    const entries = [phased([[true]]), phased([[false, 'w'], [false]])]
    expect(supersetFlowStep(entries, [0, 1], 0, 0)).toEqual({ unitDone: false, roundDone: false, nextIdx: 1 })
  })

  it('keeps the ordinary flow once every warm-up is done', () => {
    const entries = [phased([[true, 'w'], [true], [false]]), phased([[false], [false]])]
    expect(supersetFlowStep(entries, [0, 1], 0, 1)).toEqual({ unitDone: false, roundDone: false, nextIdx: 1 })
  })
})

describe('unitEntryIdx', () => {
  it('lands on the first member with a warm-up left, even if it is not the first member', () => {
    const entries = [phased([[false]]), phased([[false, 'w'], [false]])]
    expect(unitEntryIdx(entries, [0, 1])).toBe(1)
  })

  it('lands on the first member with work when no warm-up is pending', () => {
    expect(unitEntryIdx([phased([[true]]), phased([[false]])], [0, 1])).toBe(1)
    expect(unitEntryIdx([phased([[false]]), phased([[false]])], [0, 1])).toBe(0)
  })

  it('falls back to the first member of a spent or unknown unit', () => {
    expect(unitEntryIdx([phased([[true]])], [0])).toBe(0)
    expect(unitEntryIdx(undefined, [3])).toBe(3)
    expect(unitEntryIdx([], [])).toBeNull()
  })
})

describe('active workout unit ordering', () => {
  it('inserts after the whole current unit', () => {
    expect(insertionIndexAfterCurrentUnit([[0, 1], [2]], 0, 3)).toBe(2)
    expect(insertionIndexAfterCurrentUnit([[0], [1]], 1, 2)).toBe(2)
    expect(insertionIndexAfterCurrentUnit([], 0, 0)).toBe(0)
  })

  it('finds the next unfinished unit, skips completed units, and wraps once', () => {
    const entries = [entry([false]), entry([true]), entry([false]), entry([true])]
    const units = [[0], [1], [2, 3]]
    expect(nextUnfinishedUnit(entries, units, 0)).toEqual([2, 3])
    expect(nextUnfinishedUnit(entries, units, 2)).toEqual([0])
  })

  it('returns null only when every unit is complete', () => {
    const entries = [entry([true]), entry([true])]
    expect(nextUnfinishedUnit(entries, [[0], [1]], 1)).toBeNull()
  })
})

// Issue #3 has two halves. restAfterSet covers "no break after the LAST set of an exercise";
// this covers "after the first set, sometimes a break doesn't appear" — the uncheck/re-check
// that the high-water rule swallows.
describe('rest on a re-check', () => {
  it('starts the rest a swallowed re-check would otherwise cost you', () => {
    expect(restOnRecheck({ timerRunning: false, unitDone: false, lastUnit: false })).toBe(true)
  })

  it('leaves a rest that is already counting alone', () => {
    expect(restOnRecheck({ timerRunning: true, unitDone: false, lastUnit: false })).toBe(false)
  })

  it('still stays quiet on the last set of the last exercise', () => {
    expect(restOnRecheck({ timerRunning: false, unitDone: true, lastUnit: true })).toBe(false)
  })

  it('rests after closing an exercise that is not the last one', () => {
    expect(restOnRecheck({ timerRunning: false, unitDone: true, lastUnit: false })).toBe(true)
  })

  // A between-sets rest still counting when the closing set is re-checked must give way to a
  // separate between-exercises time — otherwise the two breaks stack.
  it('replaces a running between-sets rest when the exercise closes and has its own rest', () => {
    expect(restOnRecheck({ timerRunning: true, runningKind: 'sets', unitDone: true, lastUnit: false, exRestDiffers: true })).toBe(true)
  })

  it('keeps the running rest when there is no separate between-exercises time', () => {
    expect(restOnRecheck({ timerRunning: true, runningKind: 'sets', unitDone: true, lastUnit: false, exRestDiffers: false })).toBe(false)
  })

  it('does not restart a between-exercises rest that is already counting', () => {
    expect(restOnRecheck({ timerRunning: true, runningKind: 'exercise', unitDone: true, lastUnit: false, exRestDiffers: true })).toBe(false)
  })

  it('never replaces a running rest between sets of an exercise that is not finished', () => {
    expect(restOnRecheck({ timerRunning: true, runningKind: 'sets', unitDone: false, lastUnit: false, exRestDiffers: true })).toBe(false)
  })

  it('stays quiet at the end of the session even with a separate time', () => {
    expect(restOnRecheck({ timerRunning: true, runningKind: 'sets', unitDone: true, lastUnit: true, exRestDiffers: true })).toBe(false)
  })
})

// Issue #10: a routine can give an exercise its own rest, and the global timer stops being the
// only answer. The resolution is the whole feature — the UI just writes the number down.
describe('restSecFor', () => {
  // 0: no rest of its own, 1: 180 s, 2: 45 s — a heavy pull, a light accessory, a plain one.
  const entries = [
    { id: 'a', target: { mode: 'reps' } },
    { id: 'b', target: { mode: 'reps', restSec: 180 } },
    { id: 'c', target: { mode: 'reps', restSec: 45 } },
  ]

  it('prefers the exercise’s own rest over the global default', () => {
    expect(restSecFor(entries, [1], 90)).toBe(180)
    expect(restSecFor(entries, [2], 90)).toBe(45)
  })

  it('falls back to the global default when the exercise sets none', () => {
    expect(restSecFor(entries, [0], 90)).toBe(90)
  })

  it('gives a superset the longest rest its members asked for', () => {
    // Not the member that closed the round, and not the shortest: the group rests once, and
    // the 180 s exercise is the one still recovering when the 45 s one is ready to go again.
    expect(restSecFor(entries, [1, 2], 90)).toBe(180)
    // A member with no rest of its own pulls in the global, which can be the longest of all.
    expect(restSecFor(entries, [0, 2], 90)).toBe(90)
  })

  it('honours an explicit rest even with the global timer switched off', () => {
    expect(restSecFor(entries, [1], 0)).toBe(180)
    expect(restSecFor(entries, [0, 1], 0)).toBe(180)
  })

  it('stays off when the timer is off and nothing asked for a rest', () => {
    expect(restSecFor(entries, [0], 0)).toBe(0)
    expect(restSecFor(entries, [0, 0], 0)).toBe(0)
  })

  it('survives a missing unit or entry rather than timing NaN', () => {
    expect(restSecFor(entries, null, 90)).toBe(90)
    expect(restSecFor(entries, [], 90)).toBe(90)
    expect(restSecFor(entries, [7], 90)).toBe(90)
    expect(restSecFor(undefined, [0], undefined)).toBe(0)
  })
})

describe('resumeEntryIdx', () => {
  const marked = (entries, idx) => { markResumeAt(entries, idx); return entries }
  const warm = done => ({ done, warmup: true })

  it('starts at the first unfinished exercise when nothing has been logged yet', () => {
    const entries = [entry([true, true]), entry([false]), entry([false])]
    expect(resumeEntryIdx(entries, [[0], [1], [2]])).toBe(1)
  })

  it('returns to the marked exercise wherever you browsed, while it has a set left', () => {
    const entries = marked([entry([true, false]), entry([false]), entry([false])], 0)
    expect(resumeEntryIdx(entries, [[0], [1], [2]])).toBe(0)
  })

  it('moves on to the next unfinished exercise once the marked one is spent', () => {
    const entries = marked([entry([true]), entry([true]), entry([false])], 0)
    expect(resumeEntryIdx(entries, [[0], [1], [2]])).toBe(2)
  })

  it('follows the mark through a superset round, skipping a spent member', () => {
    const entries = marked([entry([true, false]), entry([true, true]), entry([false])], 1)
    expect(resumeEntryIdx(entries, [[0, 1], [2]])).toBe(0)
  })

  it('keeps a superset in its warm-up phase', () => {
    const entries = marked([{ sets: [warm(true), { done: false }] }, { sets: [warm(false), { done: false }] }], 0)
    expect(resumeEntryIdx(entries, [[0, 1]])).toBe(1)
  })

  it('has nowhere to go when every set is done', () => {
    const entries = marked([entry([true]), entry([true])], 1)
    expect(resumeEntryIdx(entries, [[0], [1]])).toBe(null)
  })

  it('keeps a single mark', () => {
    const entries = [entry([false]), entry([false])]
    markResumeAt(entries, 0)
    markResumeAt(entries, 1)
    expect(entries.map(e => !!e.resume)).toEqual([false, true])
  })
})

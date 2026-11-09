import { describe, expect, it } from 'vitest'
import { REST_SET_PRESETS, isRestSec, sessionRestFor, withoutUnitPicks, pickUnitRest, pickSessionRest, sessionHasRestPicks, sessionRestChanges, withSessionRests } from './session-rest.js'
import { restSecFor } from './supersetFlow.js'
import { supersetUnits } from './history.js'
import { estimateSessionSec } from './session-view.js'

// 0: no rest of its own, 1: 180 s, 2 and 3: a superset, 45 s and none.
const plan = () => [
  { id: 'a', target: { mode: 'reps' }, sets: [] },
  { id: 'b', target: { mode: 'reps', restSec: 180 }, sets: [] },
  { id: 'c', sg: 'x', target: { mode: 'reps', restSec: 45 }, sets: [] },
  { id: 'd', sg: 'x', target: { mode: 'reps' }, sets: [] },
]

describe('rest presets', () => {
  it('runs from 15 s to 10 min, finer at the short end', () => {
    expect(REST_SET_PRESETS[0]).toBe(15)
    expect(REST_SET_PRESETS).toContain(90)
    expect(REST_SET_PRESETS).toContain(180)
    expect(REST_SET_PRESETS).toContain(210)
    expect(REST_SET_PRESETS.at(-1)).toBe(600)
    expect(REST_SET_PRESETS.every(isRestSec)).toBe(true)
  })
})

describe('restSecFor with rests picked during the session', () => {
  it('follows the plan until something is picked', () => {
    const entries = plan()
    expect(restSecFor(entries, [0], 90)).toBe(90)
    expect(restSecFor(entries, [1], 90)).toBe(180)
    expect(restSecFor(entries, [2, 3], 90)).toBe(90)
  })

  it('gives an exercise its own pick, over its routine rest and Settings', () => {
    const entries = plan()
    entries[1].restSec = 60
    expect(restSecFor(entries, [1], 90)).toBe(60)
    expect(restSecFor(entries, [0], 90)).toBe(90)
  })

  it('gives every exercise the session’s pick, the ones with a routine rest included', () => {
    const entries = plan()
    expect(restSecFor(entries, [0], 90, 120)).toBe(120)
    expect(restSecFor(entries, [1], 90, 120)).toBe(120)
    expect(restSecFor(entries, [2, 3], 90, 120)).toBe(120)
  })

  it('lets an exercise’s own pick beat the session’s', () => {
    const entries = plan()
    entries[0].restSec = 30
    expect(restSecFor(entries, [0], 90, 120)).toBe(30)
    expect(restSecFor(entries, [1], 90, 120)).toBe(120)
  })

  it('rests a superset at its pick, even when only one member carries it', () => {
    // A pair formed after the pick: the pick is the group's rest, not one value among the plan's.
    const entries = plan()
    entries[3].restSec = 30
    expect(restSecFor(entries, [2, 3], 90)).toBe(30)
    entries[2].restSec = 50
    expect(restSecFor(entries, [2, 3], 90)).toBe(50)
  })

  it('reads anything but seconds above zero as no pick', () => {
    const entries = plan()
    entries[0].restSec = 0
    entries[1].restSec = 'sets'
    expect(restSecFor(entries, [0], 90, 0)).toBe(90)
    expect(restSecFor(entries, [1], 90, null)).toBe(180)
    expect(sessionRestFor(entries, [0, 1], undefined)).toBeNull()
  })

  it('is what the session estimate times between sets', () => {
    const entries = [{ id: 'a', target: {}, sets: [{ r: 8 }, { r: 8 }, { r: 8 }] }]
    const units = supersetUnits(entries)
    const base = estimateSessionSec(entries, units, { restSec: 90 })
    expect(estimateSessionSec(entries, units, { restSec: 90, sessionRestSec: 60 })).toBe(base - 2 * 30)
    entries[0].restSec = 150
    expect(estimateSessionSec(entries, units, { restSec: 90, sessionRestSec: 60 })).toBe(base + 2 * 60)
  })
})

describe('picking a rest', () => {
  it('writes an exercise’s pick, and a superset’s on every member', () => {
    const active = { entries: plan() }
    pickUnitRest(active, [1], 75)
    pickUnitRest(active, [2, 3], 40)
    expect(active.entries.map(e => e.restSec)).toEqual([undefined, 75, 40, 40])
    expect(sessionHasRestPicks(active)).toBe(true)
  })

  it('goes back to the plan for that unit only', () => {
    const active = { entries: plan() }
    pickUnitRest(active, [1], 75)
    pickUnitRest(active, [2, 3], 40)
    pickUnitRest(active, [2, 3], null)
    expect(active.entries.map(e => 'restSec' in e)).toEqual([false, true, false, false])
  })

  it('the session’s pick replaces every exercise’s, and undoing it clears them all', () => {
    const active = { entries: plan() }
    pickUnitRest(active, [1], 75)
    pickSessionRest(active, 120)
    expect(active.restSec).toBe(120)
    expect(active.entries.some(e => 'restSec' in e)).toBe(false)
    pickUnitRest(active, [0], 30)
    pickSessionRest(active, 'plan')
    expect('restSec' in active).toBe(false)
    expect(sessionHasRestPicks(active)).toBe(false)
  })

  it('sets the unit’s picks aside to say what it would rest without them', () => {
    const entries = plan()
    entries[1].restSec = 60
    entries[2].restSec = 30
    entries[3].restSec = 30
    const without = withoutUnitPicks(entries, [2, 3])
    expect(without[1].restSec).toBe(60)
    expect('restSec' in without[2] || 'restSec' in without[3]).toBe(false)
    expect(restSecFor(without, [2, 3], 90, 120)).toBe(120)
    expect(restSecFor(without, [2, 3], 90)).toBe(90)
    expect(entries[2].restSec).toBe(30)
  })
})

describe('keeping the session’s rests in the routine', () => {
  const routine = () => [
    { id: 'a', sets: 3, reps: 8 },
    { id: 'b', sets: 3, reps: 5, restSec: 180 },
    { id: 'c', sets: 3, reps: 12, restSec: 45, sg: 'x' },
    { id: 'd', sets: 3, reps: 12, sg: 'x' },
  ]
  const session = () => ({ routineId: 'r', entries: plan() })
  const changes = (active, ex = routine(), def = 90) => sessionRestChanges(active, ex, supersetUnits(active.entries), def)

  it('has nothing to keep when no rest was picked', () => {
    expect(changes(session())).toEqual([])
  })

  it('keeps an exercise’s pick for that exercise only', () => {
    const active = session()
    pickUnitRest(active, [1], 120)
    expect(changes(active)).toEqual([{ idx: 1, id: 'b', from: 180, to: 120 }])
    const ex = withSessionRests(routine(), changes(active))
    expect(ex.map(c => c.restSec)).toEqual([undefined, 120, 45, undefined])
    expect(ex[1]).toEqual({ id: 'b', sets: 3, reps: 5, restSec: 120 })
  })

  it('compares an exercise without a routine rest against Settings', () => {
    const active = session()
    pickUnitRest(active, [0], 60)
    expect(changes(active)).toEqual([{ idx: 0, id: 'a', from: 90, to: 60 }])
    // Picking what Settings already gives it is no change at all.
    pickUnitRest(active, [0], 90)
    expect(changes(active)).toEqual([])
  })

  it('keeps a superset’s pick on every member that would rest differently', () => {
    const active = session()
    pickUnitRest(active, [2, 3], 60)
    expect(changes(active)).toEqual([
      { idx: 2, id: 'c', from: 45, to: 60 },
      { idx: 3, id: 'd', from: 90, to: 60 },
    ])
  })

  it('sees no change in a superset picked at the rest it already took', () => {
    // c 45 s and d 90 s (Settings) rest the pair 90 s: picking 90 s changes nothing.
    const active = session()
    pickUnitRest(active, [2, 3], 90)
    expect(changes(active)).toEqual([])
  })

  it('keeps the session’s pick for every exercise it changes', () => {
    const active = session()
    pickSessionRest(active, 90)
    // a and d already rest 90 s (Settings); b and the pair do not.
    expect(changes(active)).toEqual([
      { idx: 1, id: 'b', from: 180, to: 90 },
    ])
    pickSessionRest(active, 120)
    expect(changes(active).map(c => [c.id, c.to])).toEqual([['a', 120], ['b', 120], ['c', 120], ['d', 120]])
    pickUnitRest(active, [1], 180)
    expect(changes(active).map(c => c.id)).toEqual(['a', 'c', 'd'])
  })

  it('pairs a repeated exercise with its own occurrence in the routine', () => {
    const ex = [{ id: 'a', restSec: 60 }, { id: 'b' }, { id: 'a', restSec: 120 }]
    const active = { entries: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }
    pickUnitRest(active, [2], 150)
    expect(changes(active, ex)).toEqual([{ idx: 2, id: 'a', from: 120, to: 150 }])
    expect(withSessionRests(ex, changes(active, ex)).map(c => c.restSec)).toEqual([60, undefined, 150])
  })

  it('leaves out exercises added during the session, and follows a reordered one', () => {
    const active = { entries: [{ id: 'b' }, { id: 'new' }, { id: 'a' }] }
    pickSessionRest(active, 100)
    expect(changes(active)).toEqual([
      { idx: 1, id: 'b', from: 180, to: 100 },
      { idx: 0, id: 'a', from: 90, to: 100 },
    ])
  })

  it('writes nothing into a config that is no longer the exercise it was computed for', () => {
    const ex = withSessionRests(routine(), [{ idx: 0, id: 'b', from: 90, to: 30 }])
    expect(ex).toEqual(routine())
  })

  it('does not touch the routine it is given', () => {
    const ex = routine()
    const active = session()
    pickSessionRest(active, 120)
    withSessionRests(ex, changes(active, ex))
    expect(ex).toEqual(routine())
  })
})

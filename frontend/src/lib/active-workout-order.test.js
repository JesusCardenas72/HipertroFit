import { describe, expect, it } from 'vitest'
import { canMoveActiveWorkoutUnit, moveActiveWorkoutUnit, moveActiveWorkoutUnitTo, dropActiveWorkoutEntry } from './active-workout-order.js'
import { LANGS } from './i18n-core.js'
import { PT_BR_OVERRIDES } from '../locales/pt-BR.js'

const entry = (id, extra = {}) => ({
  id,
  target: { sets: 1, reps: 5 },
  sets: [{ w: 0, r: 5, done: false }],
  ...extra,
})

describe('active workout whole-unit order', () => {
  it('moves one standalone occurrence without conflating duplicate exercise ids', () => {
    const duplicateA = entry('duplicate', { occurrenceId: 'duplicate#1' })
    const selected = entry('duplicate', {
      occurrenceId: 'duplicate#2',
      target: { sets: 2, reps: 7, weight: 82.5, notes: 'Keep this target' },
      sets: [{ w: 77.5, r: 6, done: true, rir: 2 }],
    })
    const active = { cur: 2, entries: [duplicateA, entry('middle'), selected] }

    expect(moveActiveWorkoutUnit(active, active.cur, -1)?.indices).toEqual([0, 2, 1])
    expect(active.entries.map(item => item.occurrenceId || item.id)).toEqual(['duplicate#1', 'duplicate#2', 'middle'])
    expect(active.entries[0]).toBe(duplicateA)
    expect(active.entries[1]).toBe(selected)
    expect(active.entries[1].target).toBe(selected.target)
    expect(active.entries[1].sets).toBe(selected.sets)
    expect(active.cur).toBe(1)
  })

  it('moves a complete contiguous group one unit and preserves the selected member identity', () => {
    const first = entry('group-a', { sg: 'pair', occurrenceId: 'group-a#1' })
    const selected = entry('group-b', { sg: 'pair', occurrenceId: 'group-b#1' })
    const groupMeta = { pair: { kind: 'complex', label: 'Carry pair', cues: 'Stay braced.' } }
    const active = { cur: 2, entries: [entry('before'), first, selected, entry('after')], groupMeta }

    expect(moveActiveWorkoutUnit(active, active.cur, -1)?.indices).toEqual([1, 2, 0, 3])
    expect(active.entries.map(item => item.id)).toEqual(['group-a', 'group-b', 'before', 'after'])
    expect(active.entries.slice(0, 2)).toEqual([first, selected])
    expect(active.entries.map(item => item.sg)).toEqual(['pair', 'pair', undefined, undefined])
    expect(active.groupMeta).toBe(groupMeta)
    expect(active.entries[active.cur]).toBe(selected)
  })

  it('moves a group down by exactly one neighbouring unit', () => {
    const first = entry('group-a', { sg: 'pair' })
    const selected = entry('group-b', { sg: 'pair' })
    const active = { cur: 1, entries: [first, selected, entry('middle'), entry('last')] }

    expect(moveActiveWorkoutUnit(active, active.cur, 1)?.indices).toEqual([2, 0, 1, 3])
    expect(active.entries.map(item => item.id)).toEqual(['middle', 'group-a', 'group-b', 'last'])
    expect(active.entries[active.cur]).toBe(selected)
  })

  it('rejects boundaries and invalid directions without mutating the active workout', () => {
    const active = { cur: 0, entries: [entry('first'), entry('last')] }
    const entries = [...active.entries]

    expect(canMoveActiveWorkoutUnit(active, 0, -1)).toBe(false)
    expect(canMoveActiveWorkoutUnit(active, 1, 1)).toBe(false)
    expect(moveActiveWorkoutUnit(active, 0, 0)).toBeNull()
    expect(moveActiveWorkoutUnit(active, 0, -1)).toBeNull()
    expect(active.entries).toEqual(entries)
    expect(active.cur).toBe(0)
  })
})

describe('active workout move locale coverage', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  const localeCodes = Object.keys(LANGS).filter(code => code !== 'en')

  it('defines both visible move labels in every current locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(localeCodes.length)
    for (const code of localeCodes) {
      const pack = packs[`../locales/${code}.js`]
      expect(pack, `${code} locale pack is missing`).toBeTruthy()
      for (const key of ['Move up', 'Move down']) {
        expect(Object.hasOwn(pack, key), `${code} is missing ${key}`).toBe(true)
        expect(pack[key], `${code} has a blank ${key}`).toEqual(expect.any(String))
        expect(pack[key].trim(), `${code} has a blank ${key}`).not.toBe('')
      }
    }
    expect(Object.hasOwn(PT_BR_OVERRIDES, 'Move up')).toBe(true)
    expect(Object.hasOwn(PT_BR_OVERRIDES, 'Move down')).toBe(true)
  })
})

describe('dropping a whole unit into an arbitrary slot', () => {
  const ids = active => active.entries.map(item => item.id)

  it('moves a standalone exercise to the far end of the session', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b'), entry('c'), entry('d')] }
    expect(moveActiveWorkoutUnitTo(active, 0, 3)?.indices).toEqual([1, 2, 3, 0])
    expect(ids(active)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('carries a superset whole rather than splitting it', () => {
    const active = {
      cur: 0,
      entries: [entry('a'), entry('b', { sg: 'sg-1-2' }), entry('c', { sg: 'sg-1-2' }), entry('d')],
    }
    // slots are numbered with the dragged unit lifted out: 0 = before 'a'
    expect(moveActiveWorkoutUnitTo(active, 2, 0)?.indices).toEqual([1, 2, 0, 3])
    expect(ids(active)).toEqual(['b', 'c', 'a', 'd'])
    expect(active.entries[0].sg).toBe('sg-1-2')
    expect(active.entries[1].sg).toBe('sg-1-2')
  })

  it('never drops a unit into the middle of a superset', () => {
    const active = {
      cur: 0,
      entries: [entry('a'), entry('b', { sg: 'sg' }), entry('c', { sg: 'sg' })],
    }
    moveActiveWorkoutUnitTo(active, 0, 1)
    expect(ids(active)).toEqual(['b', 'c', 'a'])
  })

  it('keeps you on the exercise you were looking at, wherever it ends up', () => {
    const selected = entry('c')
    const active = { cur: 2, entries: [entry('a'), entry('b'), selected] }
    moveActiveWorkoutUnitTo(active, 0, 2)
    expect(ids(active)).toEqual(['b', 'c', 'a'])
    expect(active.entries[active.cur]).toBe(selected)
  })

  it('reports nothing for a drop that changes no order', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b')] }
    expect(moveActiveWorkoutUnitTo(active, 0, 0)).toBe(null)
    expect(moveActiveWorkoutUnitTo(active, 0, undefined)).toBe(null)
    expect(moveActiveWorkoutUnitTo(active, 9, 1)).toBe(null)
    expect(moveActiveWorkoutUnitTo(null, 0, 1)).toBe(null)
    expect(moveActiveWorkoutUnitTo({ cur: 0, entries: [] }, 0, 1)).toBe(null)
  })

  it('clamps a slot past the end instead of losing the unit', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b'), entry('c')] }
    moveActiveWorkoutUnitTo(active, 0, 99)
    expect(ids(active)).toEqual(['b', 'c', 'a'])
  })
})

describe('dropping one exercise from the dock', () => {
  const ids = active => active.entries.map(item => item.id)
  const sgs = active => active.entries.map(item => item.sg ?? null)

  it('moves a standalone exercise to another place', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b'), entry('c')] }
    expect(dropActiveWorkoutEntry(active, 0, { slot: 2, join: null })?.indices).toEqual([1, 2, 0])
    expect(ids(active)).toEqual(['b', 'c', 'a'])
    expect(sgs(active)).toEqual([null, null, null])
  })

  it('dropped onto another exercise, the two become a superset', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b'), entry('c')] }
    dropActiveWorkoutEntry(active, 0, { slot: 1, join: 2 })
    expect(ids(active)).toEqual(['b', 'a', 'c'])
    expect(sgs(active)[0]).toBe(null)
    expect(sgs(active)[1]).toBeTruthy()
    expect(sgs(active)[1]).toBe(sgs(active)[2])
  })

  it('dropped onto a superset member, it joins that superset', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b', { sg: 'pair' }), entry('c', { sg: 'pair' })] }
    dropActiveWorkoutEntry(active, 0, { slot: 2, join: 2 })
    expect(ids(active)).toEqual(['b', 'c', 'a'])
    expect(sgs(active)).toEqual(['pair', 'pair', 'pair'])
  })

  it('reorders inside a superset without breaking it', () => {
    const active = { cur: 0, entries: [entry('a', { sg: 'pair' }), entry('b', { sg: 'pair' }), entry('c')] }
    dropActiveWorkoutEntry(active, 0, { slot: 1, join: 1 })
    expect(ids(active)).toEqual(['b', 'a', 'c'])
    expect(sgs(active)).toEqual(['pair', 'pair', null])
  })

  it('dragged clear of its superset, it leaves it — and a lone partner is no superset', () => {
    const active = { cur: 0, entries: [entry('a', { sg: 'pair' }), entry('b', { sg: 'pair' }), entry('c')] }
    dropActiveWorkoutEntry(active, 0, { slot: 2, join: null })
    expect(ids(active)).toEqual(['b', 'c', 'a'])
    expect(sgs(active)).toEqual([null, null, null])
  })

  it('leaving a three-exercise superset keeps the other two paired', () => {
    const active = { cur: 0, entries: [entry('a', { sg: 'tri' }), entry('b', { sg: 'tri' }), entry('c', { sg: 'tri' }), entry('d')] }
    dropActiveWorkoutEntry(active, 0, { slot: 3, join: null })
    expect(ids(active)).toEqual(['b', 'c', 'd', 'a'])
    expect(sgs(active)).toEqual(['tri', 'tri', null, null])
  })

  it('pairing away from its superset gives the new pair its own id', () => {
    const active = { cur: 0, entries: [entry('a', { sg: 'pair' }), entry('b', { sg: 'pair' }), entry('c'), entry('d')] }
    dropActiveWorkoutEntry(active, 0, { slot: 3, join: 3 })
    expect(ids(active)).toEqual(['b', 'c', 'd', 'a'])
    expect(sgs(active)[0]).toBe(null)
    expect(sgs(active)[2]).toBeTruthy()
    expect(sgs(active)[2]).not.toBe('pair')
    expect(sgs(active)[2]).toBe(sgs(active)[3])
  })

  it('standing alone in the middle of a superset joins it', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b', { sg: 'pair' }), entry('c', { sg: 'pair' })] }
    dropActiveWorkoutEntry(active, 0, { slot: 1, join: null })
    expect(ids(active)).toEqual(['b', 'a', 'c'])
    expect(sgs(active)).toEqual(['pair', 'pair', 'pair'])
  })

  it('keeps you on the exercise you were looking at', () => {
    const selected = entry('c')
    const active = { cur: 2, entries: [entry('a'), entry('b'), selected] }
    dropActiveWorkoutEntry(active, 0, { slot: 2, join: null })
    expect(active.entries[active.cur]).toBe(selected)
  })

  it('reports nothing for a drop that changes neither order nor pairing', () => {
    const pair = () => ({ cur: 0, entries: [entry('a', { sg: 'pair' }), entry('b', { sg: 'pair' })] })
    expect(dropActiveWorkoutEntry(pair(), 0, { slot: 0, join: 1 })).toBe(null)
    expect(dropActiveWorkoutEntry({ cur: 0, entries: [entry('a'), entry('b')] }, 0, { slot: 0, join: null })).toBe(null)
    expect(dropActiveWorkoutEntry(pair(), 9, { slot: 1 })).toBe(null)
    expect(dropActiveWorkoutEntry(null, 0, { slot: 1 })).toBe(null)
  })

  it('refuses to pair with an exercise it does not end up next to', () => {
    const active = { cur: 0, entries: [entry('a'), entry('b'), entry('c')] }
    expect(dropActiveWorkoutEntry(active, 0, { slot: 0, join: 2 })).toBe(null)
    expect(ids(active)).toEqual(['a', 'b', 'c'])
  })
})

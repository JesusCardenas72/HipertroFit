import { describe, it, expect } from 'vitest'
import { dockItems, unitDone, dockIntent, dropSlot, hashSg, dockKeys, joinHue, SUPERSET_HUES } from './workout-dock.js'

const set = done => ({ w: 20, r: 5, done })
const entry = (id, sg, done = [false]) => ({ id, ...(sg ? { sg } : {}), sets: done.map(set) })

describe('dockItems', () => {
  it('gives one item per exercise, in session order', () => {
    const items = dockItems([entry('a'), entry('b'), entry('c')])
    expect(items.map(i => i.indices)).toEqual([[0], [1], [2]])
    expect(items.map(i => i.position)).toEqual([0, 1, 2])
    expect(items.every(i => i.sg === null && i.hue === null)).toBe(true)
  })

  it('folds a superset into one item carrying both exercises', () => {
    const items = dockItems([entry('a'), entry('b', 'sg-1-2'), entry('c', 'sg-1-2'), entry('d')])
    expect(items.map(i => i.indices)).toEqual([[0], [1, 2], [3]])
    expect(items[1].sg).toBe('sg-1-2')
    expect(SUPERSET_HUES).toContain(items[1].hue)
  })

  it('never gives two supersets in one session the same colour', () => {
    const items = dockItems([
      entry('a', 'sg-0-1'), entry('b', 'sg-0-1'),
      entry('c', 'sg-2-3'), entry('d', 'sg-2-3'),
      entry('e', 'sg-4-5'), entry('f', 'sg-4-5'),
    ])
    const hues = items.map(i => i.hue)
    expect(hues).toHaveLength(3)
    expect(new Set(hues).size).toBe(3)
  })

  it('keeps a group on its colour and varies the palette between sessions', () => {
    const one = dockItems([entry('a', 'sg-0-1'), entry('b', 'sg-0-1')])
    expect(dockItems([entry('a', 'sg-0-1'), entry('b', 'sg-0-1')])[0].hue).toBe(one[0].hue)
    // a session whose first group has a different id opens on a different colour
    const other = dockItems([entry('a', 'sg-3-4'), entry('b', 'sg-3-4')])
    expect(other[0].hue).not.toBe(one[0].hue)
  })

  it('marks a unit done only when every set of every member is checked off', () => {
    const items = dockItems([
      entry('a', null, [true, true]),
      entry('b', null, [true, false]),
      entry('c', 'sg', [true]), entry('d', 'sg', [false]),
    ])
    expect(items.map(i => i.done)).toEqual([true, false, false])
  })

  it('survives an empty or missing session', () => {
    expect(dockItems([])).toEqual([])
    expect(dockItems(undefined)).toEqual([])
  })
})

describe('unitDone', () => {
  it('is false for a unit with no sets at all', () => {
    expect(unitDone([{ id: 'a', sets: [] }], [0])).toBe(false)
  })
})

describe('hashSg', () => {
  it('is stable and stays a usable palette index', () => {
    expect(hashSg('sg-0-1')).toBe(hashSg('sg-0-1'))
    expect(hashSg('sg-0-1') % SUPERSET_HUES.length).toBeGreaterThanOrEqual(0)
  })
})

describe('dockIntent', () => {
  // three other thumbnails, 60px wide with a 20px gap: 0–60, 80–140, 160–220
  const strip = (sgs = [null, null, null]) => sgs.map((sg, i) => ({ index: i + 1, sg, left: i * 80, right: i * 80 + 60 }))

  it('over the middle of a thumbnail it joins that exercise, on the side the finger is', () => {
    expect(dockIntent(strip(), 100)).toEqual({ slot: 1, join: 2 })
    expect(dockIntent(strip(), 120)).toEqual({ slot: 2, join: 2 })
  })

  it('in a gap between standalone exercises it stands alone', () => {
    expect(dockIntent(strip(), 70)).toEqual({ slot: 1, join: null })
    expect(dockIntent(strip(), 300)).toEqual({ slot: 3, join: null })
    expect(dockIntent(strip(), -40)).toEqual({ slot: 0, join: null })
  })

  it('in the gap inside a capsule it joins that superset', () => {
    expect(dockIntent(strip([null, 'g', 'g']), 150)).toEqual({ slot: 2, join: 2 })
  })

  it('a little way out of its own superset it is pulled back in', () => {
    const others = strip(['own', null, null])
    expect(dockIntent(others, 70, 'own')).toEqual({ slot: 1, join: 1 })
    // stretched well out past where it would sit beside its mate, and still held
    expect(dockIntent(strip(['own']), 130, 'own')).toEqual({ slot: 1, join: 1 })
    expect(dockIntent(strip(['own']), 155, 'own')).toEqual({ slot: 1, join: null })
    expect(dockIntent(others, 70, 'other')).toEqual({ slot: 1, join: null })
  })

  it('its own capsule holds on over a neighbour, until pulled clear of it', () => {
    // '1' is its mate; '2' sits right next to where it was dragged from
    const others = strip(['own', null, null])
    expect(dockIntent(others, 100, 'own')).toEqual({ slot: 1, join: 1 })
    expect(dockIntent(others, 185, 'own')).toEqual({ slot: 2, join: 3 })
  })

  it('far enough from its own superset it lets go', () => {
    expect(dockIntent(strip([null, null, 'own']), 320, 'own')).toEqual({ slot: 3, join: null })
    expect(dockIntent(strip(['own', null, null]), 300, 'own')).toEqual({ slot: 3, join: null })
  })

  it('has one slot when there is nothing else in the strip', () => {
    expect(dockIntent([], 123)).toEqual({ slot: 0, join: null })
  })
})

describe('dropSlot', () => {
  it('counts the units the pointer has passed', () => {
    const centers = [50, 150, 250]
    expect(dropSlot(centers, 10)).toBe(0)
    expect(dropSlot(centers, 100)).toBe(1)
    expect(dropSlot(centers, 200)).toBe(2)
    expect(dropSlot(centers, 900)).toBe(3)
  })

  it('has one slot when everything else was lifted out', () => {
    expect(dropSlot([], 123)).toBe(0)
  })
})

describe('dockKeys', () => {
  it('names each entry by id and occurrence, so a repeat keeps its own name', () => {
    expect(dockKeys([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toEqual(['a#1', 'b#1', 'a#2'])
    expect(dockKeys(null)).toEqual([])
  })
})

describe('joinHue', () => {
  it('is the colour the capsule a drop would make or join', () => {
    const list = [entry('1'), entry('2', 'g'), entry('3', 'g'), entry('4')]
    const capsule = dockItems(list).find(item => item.sg === 'g').hue
    expect(joinHue(list, 3, { slot: 2, join: 2 })).toBe(capsule)
    expect(SUPERSET_HUES).toContain(joinHue(list, 0, { slot: 0, join: 1 }))
  })

  it('a routine exercise is never done: its sets are a planned count', () => {
    expect(unitDone([{ id: 'a', sets: 3 }], [0])).toBe(false)
  })
})

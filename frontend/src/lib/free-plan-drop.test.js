// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { dropRoutineEntry } from '../views/RoutineEdit.jsx'
import { linkedToNext } from './free-plan.js'

// The free-plan sheet drops its lines through the routine editor's drop (dropRoutineEntry): the
// lines keep their sets, and a drop on another line makes the two a superset.
describe('free plan drops', () => {
  const lines = () => [
    { id: 'press', sets: 4 },
    { id: 'row', sets: 3 },
    { id: 'curl', sets: 2 },
  ]

  it('moves a line to another place and keeps its sets', () => {
    const items = lines()
    expect(dropRoutineEntry(items, 0, { slot: 2, join: null })).toBe(true)
    expect(items.map(it => [it.id, it.sets])).toEqual([['row', 3], ['curl', 2], ['press', 4]])
  })

  it('joins a line with the one it is dropped on as a superset', () => {
    const items = lines()
    expect(dropRoutineEntry(items, 2, { slot: 1, join: 0 })).toBe(true)
    expect(items.find(it => it.id === 'curl').sg).toBeTruthy()
    expect(items.find(it => it.id === 'curl').sets).toBe(2)
    expect(items.find(it => it.id === 'press').sg).toBe(items.find(it => it.id === 'curl').sg)
    expect(linkedToNext(items, 0) || linkedToNext(items, 1)).toBe(true)
  })

  it('refuses an intent it cannot read', () => {
    expect(dropRoutineEntry(lines(), 0, null)).toBe(false)
    expect(dropRoutineEntry(null, 0, { slot: 1, join: null })).toBe(false)
  })
})

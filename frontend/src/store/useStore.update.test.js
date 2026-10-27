// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))

import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const saved = () => localStorage.getItem('gym_state_v1')
const workout = d => ({ id: 'w' + d, d, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] })

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: { ...clone(DEF), workouts: [workout('2026-01-01')], routines: [{ id: 'r', name: 'A', ex: [] }] }, user: null })
})
afterEach(() => localStorage.clear())

describe('update', () => {
  it('saves exactly what JSON.stringify of the new state would', () => {
    const { update } = useStore.getState()
    update(s => { s.restSec = 120; s.active = { id: 'a', entries: [] } })
    update(s => { s.workouts.push(workout('2026-01-02')) })
    const S = useStore.getState().S
    expect(saved()).toBe(JSON.stringify(S))
    expect(JSON.parse(saved())).toEqual(S)
  })

  it('keeps the object of every key the producer did not change', () => {
    const before = useStore.getState().S
    useStore.getState().update(s => { s.active = { id: 'a', entries: [] } })
    const after = useStore.getState().S
    expect(after).not.toBe(before)
    expect(after.workouts).toBe(before.workouts)
    expect(after.routines).toBe(before.routines)
    expect(after.active).toEqual({ id: 'a', entries: [] })
  })

  it('keeps the object of a key that was read, or rewritten, to the same value', () => {
    const before = useStore.getState().S
    useStore.getState().update(s => { s.workouts.find(w => w.id === 'nope'); s.routines = clone(s.routines) })
    const after = useStore.getState().S
    expect(after.workouts).toBe(before.workouts)
    expect(after.routines).toBe(before.routines)
  })

  it('gives a changed key a new object and never touches the previous state', () => {
    const before = useStore.getState().S
    useStore.getState().update(s => { s.workouts[0].entries[0].sets[0].w = 62.5 })
    const after = useStore.getState().S
    expect(after.workouts).not.toBe(before.workouts)
    expect(after.workouts[0].entries[0].sets[0].w).toBe(62.5)
    expect(before.workouts[0].entries[0].sets[0].w).toBe(60)
  })

  it('drops deleted keys and undefined values, adds new keys at the end', () => {
    const { update } = useStore.getState()
    update(s => { delete s.planGen; s.meso = undefined; s.extraKey = 1 })
    expect('planGen' in useStore.getState().S).toBe(false)
    expect(JSON.parse(saved())).not.toHaveProperty('meso')
    expect(Object.keys(JSON.parse(saved())).slice(-2)).toEqual(['extraKey', '_ts'])
    update(s => { s.restSec = 60 })
    expect('meso' in useStore.getState().S).toBe(false)
    expect(saved()).toBe(JSON.stringify(useStore.getState().S))
  })

  it('lets the producer spread or copy the whole draft', () => {
    useStore.getState().update(s => { s.copy = { ...s }.restSec; Object.assign(s, { unit: 'lb' }) })
    const S = useStore.getState().S
    expect(S.copy).toBe(90)
    expect(S.unit).toBe('lb')
    expect(saved()).toBe(JSON.stringify(S))
  })
})

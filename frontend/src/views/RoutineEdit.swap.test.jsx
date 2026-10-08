// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), addExerciseToRoutine: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../lib/sound.js', () => ({ vibrate: vi.fn() }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit, { replaceRoutineEntry } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const configured = (id, extra = {}) => ({ id, mode: 'reps', sets: 3, reps: 5, weight: 0, ...extra })
let root
let host

function mount(entries) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Swap routine', emoji: 'dumbbell', prog: 'linear', ex: entries }]
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const exercises = () => useStore.getState().S.routines[0].ex
const swapButtons = () => [...host.querySelectorAll('button[aria-label="Swap exercise"]')]
const click = node => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))

// The picker hands back `pick` (a moment later, as a person would), and the add-to-routine flow
// answers with `cfg`.
function choose(pick, cfg) {
  const close = vi.fn()
  sheets.exercisePicker.mockImplementation(onPick => { setTimeout(() => onPick(pick)); return { close } })
  sheets.addExerciseToRoutine.mockImplementation((ex, routine, onAdd) => onAdd(cfg))
  return close
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  Object.values(sheets).forEach(fn => fn.mockReset())
  root = null
  host = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (host) host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('swapping an exercise in the plan editor', () => {
  it('offers a swap on every exercise, without opening its settings', () => {
    mount([configured('1001'), configured('1002')])
    expect(swapButtons()).toHaveLength(2)
    choose({ id: '1003' }, configured('1003'))
    click(swapButtons()[0])
    expect(sheets.exercisePicker).toHaveBeenCalledTimes(1)
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('puts the chosen exercise, with its own config, in the same place and superset, then closes the picker', () => {
    mount([configured('1001'), configured('1002', { sg: 'g', reps: 8, weight: 40 }), configured('1003', { sg: 'g' })])
    const close = choose({ id: '2000' }, { mode: 'reps', sets: 4, reps: 12, weight: 10, prog: 'double' })
    click(swapButtons()[1])
    act(() => vi.runAllTimers())
    expect(sheets.addExerciseToRoutine.mock.calls[0][0]).toEqual({ id: '2000' })
    expect(exercises()).toEqual([
      configured('1001'),
      { id: '2000', sg: 'g', mode: 'reps', sets: 4, reps: 12, weight: 10, prog: 'double' },
      configured('1003', { sg: 'g' }),
    ])
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('replaceRoutineEntry', () => {
  it('finds the occurrence it was opened for even after the list moved', () => {
    const items = [configured('a'), configured('dup', { note: 'first' }), configured('dup', { note: 'second' })]
    items.reverse() // the second 'dup' is now first: key 'dup#2' names the other row
    expect(replaceRoutineEntry(items, 'dup#2', 'z', { reps: 9 })).toBe(true)
    expect(items.map(e => e.id)).toEqual(['dup', 'z', 'a'])
    expect(items[0].note).toBe('second')
  })

  it('swaps nothing when that occurrence is gone, and never takes id or superset from the config', () => {
    const items = [configured('a', { sg: 'g' }), configured('b', { sg: 'g' })]
    expect(replaceRoutineEntry(items, 'missing#1', 'z', {})).toBe(false)
    expect(replaceRoutineEntry(items, 'a#1', '', {})).toBe(false)
    expect(replaceRoutineEntry(items, 'a#1', 'z', { id: 'x', sg: 'other', sets: 2 })).toBe(true)
    expect(items[0]).toEqual({ id: 'z', sg: 'g', sets: 2 })
  })
})

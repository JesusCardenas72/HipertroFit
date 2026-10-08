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

import RoutineEdit, { dropRoutineEntry } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const configured = (id, extra = {}) => ({ id, mode: 'reps', sets: 3, reps: 5, weight: 0, ...extra })
let root
let host

function mount(entries) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Dock routine', emoji: 'dumbbell', prog: 'linear', ex: entries }]
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}

const dock = () => host.querySelector('[data-testid="workout-dock"]')
const units = () => [...dock().querySelectorAll('[data-dock-unit]')]
const thumbs = () => [...dock().querySelectorAll('[data-dock-index]')]
const exercises = () => useStore.getState().S.routines[0].ex
const ids = () => exercises().map(e => e.id)
const sgs = () => exercises().map(e => e.sg ?? null)

// Same hand-made layout as the session dock's tests: 60px thumbnails, 20px apart.
function layOut() {
  dock().querySelector('.wdock-strip').getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 60, width: 400, height: 60 })
  thumbs().forEach((node, i) => {
    const left = i * 80
    node.getBoundingClientRect = () => ({ left, right: left + 60, top: 0, bottom: 60, width: 60, height: 60 })
  })
}
function pointer(type, target, x, y = 30) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  event.pointerId = 1
  event.pointerType = 'touch'
  event.isPrimary = true
  target.dispatchEvent(event)
}
function dragThumb(thumb, toX) {
  act(() => pointer('pointerdown', thumb, 30))
  act(() => { vi.advanceTimersByTime(400) })
  layOut()
  act(() => pointer('pointermove', document, toX))
  act(() => pointer('pointerup', document, toX))
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

describe('routine editor dock', () => {
  it('shows the routine as the session strip, superset capsules included, with nothing current or done', () => {
    mount([configured('1001'), configured('1002', { sg: 'a' }), configured('1003', { sg: 'a' })])
    expect(thumbs()).toHaveLength(3)
    expect(units()).toHaveLength(2)
    expect(units()[1].className).toContain('ss')
    expect(thumbs().some(node => /\b(on|done)\b/.test(node.className))).toBe(false)
  })

  it('is not shown for an empty routine', () => {
    mount([])
    expect(dock()).toBe(null)
  })

  it('a tap opens that exercise’s settings', () => {
    mount([configured('1001'), configured('1002')])
    act(() => thumbs()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
    expect(sheets.exConfigSheet.mock.calls[0][1].id).toBe('1002')
  })

  it('the plus adds an exercise', () => {
    mount([configured('1001')])
    act(() => dock().querySelector('.wdock-add').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(sheets.exercisePicker).toHaveBeenCalledTimes(1)
  })

  it('held and dragged, a thumbnail reorders the routine', () => {
    mount([configured('1001'), configured('1002'), configured('1003')])
    dragThumb(thumbs()[0], 300)
    expect(ids()).toEqual(['1002', '1003', '1001'])
    expect(sgs()).toEqual([null, null, null])
  })

  it('dropped onto another exercise, the two become a superset — and keep their settings', () => {
    mount([configured('1001', { reps: 8 }), configured('1002'), configured('1003')])
    dragThumb(thumbs()[0], 185)
    expect(ids()).toEqual(['1002', '1001', '1003'])
    expect(sgs()[0]).toBe(null)
    expect(sgs()[1]).toBeTruthy()
    expect(sgs()[1]).toBe(sgs()[2])
    expect(exercises()[1]).toMatchObject({ reps: 8, sets: 3, mode: 'reps' })
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('pulled well clear of its capsule, a member leaves and the superset is gone', () => {
    mount([configured('1001', { sg: 'a' }), configured('1002', { sg: 'a' }), configured('1003')])
    dragThumb(thumbs()[0], 300)
    expect(ids()).toEqual(['1002', '1003', '1001'])
    expect(sgs()).toEqual([null, null, null])
  })

  it('held on longer, a member carries its whole superset', () => {
    mount([configured('1001'), configured('1002', { sg: 'a' }), configured('1003', { sg: 'a' })])
    act(() => pointer('pointerdown', thumbs()[1], 30))
    act(() => { vi.advanceTimersByTime(400) })
    act(() => { vi.advanceTimersByTime(450) })
    layOut()
    act(() => pointer('pointermove', document, 5))
    act(() => pointer('pointerup', document, 5))
    expect(ids()).toEqual(['1002', '1003', '1001'])
    expect(sgs()).toEqual(['a', 'a', null])
  })
})

describe('dropRoutineEntry', () => {
  it('joins, reorders and moves whole units in place', () => {
    const items = [configured('1'), configured('2'), configured('3', { sg: 'b' }), configured('4', { sg: 'b' })]
    expect(dropRoutineEntry(items, 0, { slot: 1, join: 1 })).toBe(true)
    expect(items.map(e => e.id)).toEqual(['2', '1', '3', '4'])
    expect(items[0].sg).toBeTruthy()
    expect(items[0].sg).toBe(items[1].sg)
    expect(dropRoutineEntry(items, 2, { unit: 0 })).toBe(true)
    expect(items.map(e => e.id)).toEqual(['3', '4', '2', '1'])
    expect(items.map(e => e.sg)).toEqual(['b', 'b', items[2].sg, items[2].sg])
  })

  it('reports a drop that changes nothing', () => {
    const items = [configured('1'), configured('2')]
    expect(dropRoutineEntry(items, 0, { slot: 0, join: null })).toBe(false)
    expect(dropRoutineEntry(items, 0, null)).toBe(false)
    expect(items.map(e => e.id)).toEqual(['1', '2'])
  })
})

// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), vibrate: vi.fn(), playClips: vi.fn(), stopClips: vi.fn(),
  clipsDuration: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, extra = {}) => ({
  id,
  target: { sets: 1, reps: 5 },
  sets: [{ w: 20, r: 5, done: false }],
  ...extra,
})

let root
let container

function renderWorkout(entries, cur = 0) {
  const S = clone(DEF)
  // The list view keeps the dock on screen; the drum folds it under the title (see its own tests).
  S.setView = 'list'
  S.active = {
    id: 'dock-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Dock test', bw: null, cur, entries,
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const dock = () => container.querySelector('[data-testid="workout-dock"]')
const units = () => [...dock().querySelectorAll('[data-dock-unit]')]
const thumbs = () => [...dock().querySelectorAll('[data-dock-index]')]
const ids = () => useStore.getState().S.active.entries.map(e => e.id)
const curIdx = () => useStore.getState().S.active.cur

// Lay the strip out by hand: happy-dom measures everything as zero, and the drop slot is
// decided entirely from these rects. Each unit is 60px wide with a 20px gap.
function layOut() {
  dock().querySelector('.wdock-strip').getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 60, width: 400, height: 60 })
  units().forEach((node, i) => {
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

// Press, hold past the lift delay, move to `toX`, release.
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
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('workout dock', () => {
  it('shows one thumbnail per exercise and rings the one you are on', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')], 1)
    expect(thumbs()).toHaveLength(3)
    expect(thumbs().map(node => node.className.includes('on'))).toEqual([false, true, false])
    expect(thumbs()[1].getAttribute('aria-current')).toBe('true')
  })

  it('jumps to the tapped exercise', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')])
    act(() => thumbs()[2].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(curIdx()).toBe(2)
  })

  it('groups a superset into one capsule with its own colour', () => {
    renderWorkout([
      entry('1001'),
      entry('1002', { sg: 'sg-1-2' }), entry('1003', { sg: 'sg-1-2' }),
      entry('1004', { sg: 'sg-3-4' }), entry('1005', { sg: 'sg-3-4' }),
    ])
    const capsules = units().filter(node => node.className.includes('ss'))
    expect(units()).toHaveLength(3)
    expect(capsules).toHaveLength(2)
    expect(capsules[0].querySelectorAll('[data-dock-index]')).toHaveLength(2)
    const hue = node => node.style.getPropertyValue('--ss-hue')
    expect(hue(capsules[0])).toBeTruthy()
    expect(hue(capsules[0])).not.toBe(hue(capsules[1]))
  })

  it('badges a finished exercise', () => {
    renderWorkout([entry('1001', { sets: [{ w: 20, r: 5, done: true }] }), entry('1002')])
    expect(thumbs().map(node => node.className.includes('done'))).toEqual([true, false])
    expect(dock().querySelectorAll('.wdock-check')).toHaveLength(1)
  })

  it('reorders the session when a thumbnail is held and dragged', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')])
    dragThumb(thumbs()[0], 300)
    expect(ids()).toEqual(['1002', '1003', '1001'])
  })

  it('moves a superset as one capsule, keeping the pair together', () => {
    renderWorkout([entry('1001'), entry('1002', { sg: 'sg' }), entry('1003', { sg: 'sg' })])
    dragThumb(thumbs()[1], 5)
    expect(ids()).toEqual(['1002', '1003', '1001'])
    expect(useStore.getState().S.active.entries[0].sg).toBe('sg')
    expect(useStore.getState().S.active.entries[1].sg).toBe('sg')
  })

  it('keeps you on the exercise you were doing after a reorder', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')], 2)
    dragThumb(thumbs()[0], 300)
    expect(ids()).toEqual(['1002', '1003', '1001'])
    expect(curIdx()).toBe(1)
  })

  it('a drag is not also a tap on wherever the finger let go', () => {
    // '1002' is current and stays at the front, so any change to cur here came from a stray tap
    renderWorkout([entry('1001'), entry('1002'), entry('1003')], 1)
    dragThumb(thumbs()[0], 300)
    expect(curIdx()).toBe(0)
    act(() => thumbs()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(curIdx()).toBe(0)
  })

  it('shows a drop marker while a unit is lifted and clears it on release', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')])
    act(() => pointer('pointerdown', thumbs()[0], 30))
    act(() => { vi.advanceTimersByTime(400) })
    layOut()
    act(() => pointer('pointermove', document, 300))
    expect(container.querySelector('[data-testid="workout-dock-marker"]')).toBeTruthy()
    expect(units()[0].className).toContain('lifted')
    act(() => pointer('pointerup', document, 300))
    expect(container.querySelector('[data-testid="workout-dock-marker"]')).toBe(null)
  })

  it('a flick before the hold completes scrolls the strip instead of reordering', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')])
    act(() => pointer('pointerdown', thumbs()[0], 30))
    act(() => pointer('pointermove', document, 200))
    act(() => { vi.advanceTimersByTime(400) })
    act(() => pointer('pointerup', document, 200))
    expect(ids()).toEqual(['1001', '1002', '1003'])
  })

  it('Escape abandons a lifted unit without moving it', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')])
    act(() => pointer('pointerdown', thumbs()[0], 30))
    act(() => { vi.advanceTimersByTime(400) })
    layOut()
    act(() => pointer('pointermove', document, 300))
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    act(() => pointer('pointerup', document, 300))
    expect(ids()).toEqual(['1001', '1002', '1003'])
  })

  it('does not reorder while a timed hold can still write by index', () => {
    renderWorkout([entry('1001'), entry('1002'), entry('1003')])
    act(() => useUI.setState({ work: { idx: 0, i: 0 } }))
    dragThumb(thumbs()[0], 300)
    expect(ids()).toEqual(['1001', '1002', '1003'])
  })

  it('is absent from an empty freestyle session', () => {
    renderWorkout([])
    expect(dock()).toBe(null)
  })
})

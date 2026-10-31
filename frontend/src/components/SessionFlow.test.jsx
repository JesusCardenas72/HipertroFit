// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionFlow from './SessionFlow.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ vibrate: vi.fn(), beep: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container

const set = () => ({ w: 10, r: 10, done: false })
const entries = () => [
  { id: 'a', sg: 'g1', target: { sets: 1, reps: 10 }, sets: [set()] },
  { id: 'b', sg: 'g1', target: { sets: 1, reps: 10 }, sets: [set()] },
  { id: 'c', target: { sets: 1, reps: 10 }, sets: [set()] },
]

function renderFlow(props = {}) {
  const S = JSON.parse(JSON.stringify(DEF))
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const base = {
    entries: entries(), cur: 0, renderBlock: () => null, onSelect: vi.fn(), onReorder: vi.fn(),
    disabled: false, onToggleHead: vi.fn(), headOpen: () => false, bindExRef: () => {},
  }
  act(() => root.render(<SessionFlow {...base} {...props} />))
  return base
}

// A pointer event as the browser sends it; happy-dom has no layout, so positions are all zero.
const pointer = (type, target, extra = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, clientY: 100, isPrimary: true, pointerType: 'touch', button: 0 }, extra)
  act(() => { target.dispatchEvent(event) })
}
const tab = index => container.querySelector(`.sf-tab[data-exidx="${index}"]`)

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  vi.useRealTimers()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('reordering the session tabs', () => {
  it('lifts a tab after a press and hold, and drops it with the order the dock would give', () => {
    const props = renderFlow()
    pointer('pointerdown', tab(2))
    act(() => { vi.advanceTimersByTime(400) })
    expect(tab(2).classList.contains('lifted')).toBe(true)
    pointer('pointerup', tab(2))
    expect(props.onReorder).toHaveBeenCalledTimes(1)
    expect(props.onReorder.mock.calls[0][0]).toBe(2)
    expect(props.onReorder.mock.calls[0][1]).toHaveProperty('slot')
  })

  it('does not lift a tab that is only tapped, and a tap still selects it', () => {
    const props = renderFlow()
    pointer('pointerdown', tab(1))
    pointer('pointerup', tab(1))
    act(() => { vi.advanceTimersByTime(400) })
    expect(tab(1).classList.contains('lifted')).toBe(false)
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('treats a move before the hold completes as a scroll, not a drag', () => {
    const props = renderFlow()
    pointer('pointerdown', tab(0))
    pointer('pointermove', tab(0), { clientY: 130 })
    act(() => { vi.advanceTimersByTime(400) })
    expect(tab(0).classList.contains('lifted')).toBe(false)
    pointer('pointerup', tab(0), { clientY: 130 })
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('drops nothing when the press is cancelled or Escape is pressed mid-drag', () => {
    const props = renderFlow()
    pointer('pointerdown', tab(2))
    act(() => { vi.advanceTimersByTime(400) })
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    pointer('pointerup', tab(2))
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('does not start a drag while the session is busy (a rest or a timed set)', () => {
    const props = renderFlow({ disabled: true })
    pointer('pointerdown', tab(2))
    act(() => { vi.advanceTimersByTime(400) })
    expect(tab(2).classList.contains('lifted')).toBe(false)
    pointer('pointerup', tab(2))
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('lifts a whole superset when it is held longer', () => {
    renderFlow()
    pointer('pointerdown', tab(0))
    act(() => { vi.advanceTimersByTime(380) })
    act(() => { vi.advanceTimersByTime(450) })
    expect(tab(0).classList.contains('lifted')).toBe(true)
    expect(tab(1).classList.contains('lifted')).toBe(true)
    expect(tab(2).classList.contains('lifted')).toBe(false)
  })
})

// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), vibrate: vi.fn(), playClips: vi.fn(), stopClips: vi.fn(), holdFocus: vi.fn(() => () => {}),
  clipsDuration: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root
let container

const sets = n => Array.from({ length: n }, () => ({ w: 10, r: 10, done: false }))
// Two supersets of two, then an exercise on its own — the shape of the screenshot.
const entries = () => [
  { id: 'a', sg: 'g1', target: { sets: 2, reps: 10 }, sets: sets(2) },
  { id: 'b', sg: 'g1', target: { sets: 2, reps: 10 }, sets: sets(2) },
  { id: 'c', sg: 'g2', target: { sets: 2, reps: 10 }, sets: sets(2) },
  { id: 'd', sg: 'g2', target: { sets: 2, reps: 10 }, sets: sets(2) },
  { id: 'e', target: { sets: 2, reps: 10 }, sets: sets(2) },
]

function renderWorkout({ setView = 'session', cur = 0 } = {}) {
  const S = clone(DEF)
  S.setView = setView
  S.workouts = [{ id: 'w1', d: '2026-08-04', start: 1, entries: [{ id: 'a', sets: [{ w: 12, r: 8, done: true }, { w: 6, r: 20, done: true }] }] }]
  S.active = { id: 'session-test', d: '2026-08-11', start: Date.now(), routineId: null, name: 'Session test', bw: null, cur, entries: entries() }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const rows = () => [...container.querySelectorAll('.sf-row')]
const click = node => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const active = () => useStore.getState().S.active

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('the session view', () => {
  it('lists every exercise, with each superset joined on the rail', () => {
    renderWorkout()
    expect(rows().map(r => r.dataset.exidx)).toEqual(['0', '1', '2', '3', '4'])
    expect(rows().map(r => ['first', 'mid', 'last', 'solo'].find(c => r.classList.contains(c)))).toEqual(['first', 'last', 'first', 'last', 'solo'])
    const hue = r => r.style.getPropertyValue('--ss')
    expect(hue(rows()[0])).toBe(hue(rows()[1]))
    expect(hue(rows()[0])).not.toBe(hue(rows()[2]))
    expect(hue(rows()[4])).toBe('')
  })

  it('opens the superset being worked and folds the rest', () => {
    renderWorkout()
    expect(rows().map(r => r.classList.contains('open'))).toEqual([true, true, false, false, false])
    expect(container.querySelectorAll('.settable')).toHaveLength(2)
    expect(rows()[2].querySelector('.sf-meta').textContent).toContain('0/2')
  })

  it('takes the place of the dock and of prev / next', () => {
    renderWorkout()
    expect(container.querySelector('.wdock')).toBeNull()
    expect(container.querySelector('.wnav')).toBeNull()
  })

  it('moves the session to an exercise tapped on the rail', () => {
    renderWorkout()
    click(rows()[4].querySelector('.sf-rail'))
    expect(active().cur).toBe(4)
    expect(rows().map(r => r.classList.contains('open'))).toEqual([false, false, false, false, true])
  })

  it('logs a set through the same path as the table, then hands over to the partner', () => {
    renderWorkout()
    click(rows()[0].querySelector('.settable .st-ck'))
    expect(active().entries[0].sets.map(s => s.done)).toEqual([true, false])
    // the superset flow moves on to the linked exercise, as in every other view
    expect(active().cur).toBe(1)
  })

  it('shows the records of the exercise you are on, from history', () => {
    renderWorkout()
    const recs = rows()[0].querySelectorAll('.sf-rec')
    expect(recs).toHaveLength(2)
    expect(recs[0].textContent).toContain('12')
    expect(recs[1].textContent).toContain('20')
    expect(rows()[0].querySelector('.sf-rm')).not.toBeNull()
    // the partner keeps only its sets
    expect(rows()[1].querySelector('.sf-rec')).toBeNull()
  })

  it('leaves the other views as they were', () => {
    renderWorkout({ setView: 'table' })
    expect(container.querySelector('[data-testid="session-flow"]')).toBeNull()
    expect(container.querySelector('.wdock')).not.toBeNull()
  })
})

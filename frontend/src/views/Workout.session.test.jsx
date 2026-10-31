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

const tabs = () => [...container.querySelectorAll('.sf-tab')]
const cards = () => [...container.querySelectorAll('.sf-panel .sf-card')]
const click = node => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
const active = () => useStore.getState().S.active

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null, sessionRepMaxOpen: false })
  useStore.setState({ S: clone(DEF), user: null })
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('the session view', () => {
  it('has a tab for every exercise, with each superset joined on the rail', () => {
    renderWorkout()
    expect(tabs().map(r => r.dataset.exidx)).toEqual(['0', '1', '2', '3', '4'])
    expect(tabs().map(r => ['first', 'mid', 'last', 'solo'].find(c => r.classList.contains(c)))).toEqual(['first', 'last', 'first', 'last', 'solo'])
    const hue = r => r.style.getPropertyValue('--ss')
    expect(hue(tabs()[0])).toBe(hue(tabs()[1]))
    expect(hue(tabs()[0])).not.toBe(hue(tabs()[2]))
    expect(hue(tabs()[4])).toBe('')
  })

  it('opens the panel of the superset being worked, joined to its tabs', () => {
    renderWorkout()
    expect(tabs().map(r => r.classList.contains('on'))).toEqual([true, true, false, false, false])
    expect(cards().map(c => c.dataset.exidx)).toEqual(['0', '1'])
    expect(container.querySelectorAll('.sf-panel .settable')).toHaveLength(2)
  })

  it('takes the place of the dock and of prev / next', () => {
    renderWorkout()
    expect(container.querySelector('.wdock')).toBeNull()
    expect(container.querySelector('.wnav')).toBeNull()
  })

  it('moves the session to the exercise whose tab is tapped', () => {
    renderWorkout()
    click(tabs()[4])
    expect(active().cur).toBe(4)
    expect(tabs().map(r => r.classList.contains('on'))).toEqual([false, false, false, false, true])
    expect(cards().map(c => c.dataset.exidx)).toEqual(['4'])
    // the panel comes in from below, moving on through the session
    expect(container.querySelector('.sf-panel').dataset.dir).toBe('1')
    click(tabs()[2])
    expect(container.querySelector('.sf-panel').dataset.dir).toBe('-1')
  })

  it('logs a set through the same path as the table, then hands over to the partner', () => {
    renderWorkout()
    click(cards()[0].querySelector('.settable .st-ck'))
    expect(active().entries[0].sets.map(s => s.done)).toEqual([true, false])
    // the superset flow moves on to the linked exercise, as in every other view
    expect(active().cur).toBe(1)
    expect(tabs()[1].classList.contains('cur')).toBe(true)
  })

  it('keeps the records out of sight until the exercise\'s arrow opens them', () => {
    renderWorkout()
    expect(cards()[0].querySelector('.sf-recs')).toBeNull()
    expect(cards()[0].querySelector('.sf-rm')).toBeNull()
    click(cards()[0].querySelector('.sf-head .exhead-tg'))
    // the rep-max estimate folds the records with it: its title is what shows first
    expect(cards()[0].querySelector('.sf-rec')).toBeNull()
    expect(cards()[0].querySelector('.sf-rm')).not.toBeNull()
    click(cards()[0].querySelector('.sf-rm .k'))
    const recs = cards()[0].querySelectorAll('.sf-rec')
    expect(recs).toHaveLength(2)
    expect(recs[0].textContent).toContain('12')
    expect(recs[1].textContent).toContain('20')
    // the partner has no history, so there are no records to open
    click(cards()[1].querySelector('.sf-head .exhead-tg'))
    expect(cards()[1].querySelector('.sf-rec')).toBeNull()
  })

  it('keeps the rep-max table folded on its title until it is tapped, then open from one exercise to the next', () => {
    renderWorkout()
    click(cards()[0].querySelector('.sf-head .exhead-tg'))
    const title = () => cards()[0].querySelector('.sf-rm .k')
    expect(title().getAttribute('aria-expanded')).toBe('false')
    expect(cards()[0].querySelector('.sf-rm .g')).toBeNull()
    click(title())
    expect(cards()[0].querySelector('.sf-rm .g').textContent).toContain('1 @')
    click(tabs()[4])
    click(tabs()[0])
    expect(cards()[0].querySelector('.sf-rm .g')).not.toBeNull()
    click(title())
    expect(cards()[0].querySelector('.sf-rm .g')).toBeNull()
  })

  it('ticks off the tab of a finished exercise', () => {
    renderWorkout()
    act(() => useStore.getState().update(s => { s.active.entries[4].sets.forEach(x => { x.done = true }) }))
    expect(tabs()[4].querySelector('.sf-ok')).not.toBeNull()
    expect(tabs()[0].querySelector('.sf-ok')).toBeNull()
  })

  it('brings the exercise in front to the top, whole, and follows the check on to its partner', async () => {
    const scrolled = []
    const native = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function scrollIntoView(options) { scrolled.push({ el: this, options }) }
    const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    try {
      renderWorkout()
      await settle()
      expect(scrolled.at(-1).el).toBe(cards()[0])
      expect(scrolled.at(-1).options.block).toBe('start')
      // the superset's partner comes up when the check hands the session on to it
      click(cards()[0].querySelector('.settable .st-ck'))
      await settle()
      expect(scrolled.at(-1).el.dataset.exidx).toBe('1')
      click(tabs()[4])
      await settle()
      expect(scrolled.at(-1).el.dataset.exidx).toBe('4')
    } finally {
      Element.prototype.scrollIntoView = native
    }
  })

  it('leaves the other views as they were', () => {
    renderWorkout({ setView: 'table' })
    expect(container.querySelector('[data-testid="session-flow"]')).toBeNull()
    expect(container.querySelector('.wdock')).not.toBeNull()
  })
})

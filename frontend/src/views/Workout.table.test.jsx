// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { LANGS } from '../lib/i18n-core.js'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), vibrate: vi.fn(), playClips: vi.fn(), stopClips: vi.fn(), holdFocus: vi.fn(() => () => {}),
  clipsDuration: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root
let container

// Last session: three sets at 60, the last one a rep short.
const lastSession = {
  id: 'w1', d: '2026-08-04', entries: [{
    id: 'a', target: { sets: 3, reps: 10 },
    sets: [{ w: 60, r: 10, done: true, rir: 2 }, { w: 60, r: 10, done: true, rir: 2 }, { w: 60, r: 9, done: true, rir: 1 }],
  }],
}

function renderWorkout({ plan = null, rows = null, effort = 'none', setView = 'table' } = {}) {
  const S = clone(DEF)
  S.setView = setView
  S.effort = effort
  S.workouts = clone([lastSession])
  S.active = {
    id: 'table-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Table test', bw: null, cur: 0,
    entries: [{
      id: 'a', target: { sets: 3, reps: 10 }, plan: plan ? clone(plan) : undefined,
      sets: rows ? clone(rows) : Array.from({ length: 3 }, () => ({ w: 60, r: 10, done: false })),
    }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const rowsEl = () => [...container.querySelectorAll('.settable .setswipe > .st-row')]
const header = () => [...container.querySelector('.settable .st-hd').children].map(n => n.textContent)
const activeSets = () => useStore.getState().S.active.entries[0].sets
const click = node => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))

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

describe('the set table', () => {
  it('draws one bare line per set — no steppers, no last-session line', () => {
    renderWorkout()
    expect(rowsEl()).toHaveLength(3)
    expect(container.querySelector('.settable .stp')).toBeNull()
    expect(container.querySelector('.setprev')).toBeNull()
    expect(header()).toEqual(['Set', 'Weight (kg)', 'Reps', ''])
    expect(rowsEl()[0].querySelectorAll('.st-cell')).toHaveLength(2)
  })

  it('adds the effort column only when the profile logs RIR, and never on a warm-up', () => {
    renderWorkout({ effort: 'rir', rows: [{ w: 30, r: 8, warmup: true, done: false }, { w: 60, r: 10, done: false }] })
    expect(header()).toContain('RIR')
    expect(rowsEl()[0].querySelectorAll('.st-cell')).toHaveLength(2)
    expect(rowsEl()[1].querySelectorAll('.st-cell')).toHaveLength(3)
  })

  it('shows the progression’s target, not last session, and puts it back with one tap', () => {
    renderWorkout({ plan: { policy: 'linear', kind: 'up', weight: 62.5, why: ['x'] } })
    const aim = container.querySelector('.st-card.aim .st-v').textContent
    expect(aim).toContain('62.5')
    // The rows still hold 60, so the weight cell carries the target under it.
    const chip = rowsEl()[0].querySelector('.st-aim')
    expect(chip.textContent).toBe('62.5')
    click(chip)
    expect(activeSets()[0].w).toBe(62.5)
    expect(rowsEl()[0].querySelector('.st-aim')).toBeNull()
  })

  it('carries no target chip while the row already holds the plan', () => {
    // A hold with no rep target asks each set for what that set did last time (60×10, 60×10, 60×9).
    renderWorkout({ plan: { policy: 'linear', kind: 'hold', weight: 60, why: ['x'] }, rows: [{ w: 60, r: 10, done: false }, { w: 60, r: 10, done: false }, { w: 60, r: 9, done: false }] })
    expect(container.querySelector('.st-aim')).toBeNull()
  })

  it('ticks a set off from its check', () => {
    renderWorkout()
    click(rowsEl()[1].querySelector('.st-ck'))
    expect(activeSets().map(s => s.done)).toEqual([false, true, false])
    expect(rowsEl()[1].classList.contains('done')).toBe(true)
  })

  it('keeps a set’s tools behind its number', () => {
    renderWorkout()
    expect(container.querySelector('.st-tools')).toBeNull()
    click(rowsEl()[2].querySelector('.st-n'))
    const tools = [...container.querySelectorAll('.st-tools button')]
    expect(tools.map(b => b.textContent)).toEqual(['+ Drop', '+ Burst', 'Remove set'])
    click(tools[0])
    expect(activeSets()[2].drops).toHaveLength(1)
    click(container.querySelector('.st-tools .danger'))
    expect(activeSets()).toHaveLength(2)
  })

  it('prints last time’s numbers on top of each cell, only to read', () => {
    renderWorkout({ effort: 'rir' })
    const prev = [...rowsEl()[2].querySelectorAll('.st-prev')]
    expect(prev.map(p => p.textContent)).toEqual(['60', '9', '1'])
    expect(prev.every(p => p.tagName === 'SPAN')).toBe(true)
  })

  it('draws no last-time label on a warm-up', () => {
    renderWorkout({ rows: [{ w: 30, r: 8, warmup: true, done: false }, { w: 60, r: 10, done: false }] })
    expect(rowsEl()[0].querySelector('.st-prev')).toBeNull()
    expect(rowsEl()[1].querySelectorAll('.st-prev')).toHaveLength(2)
  })

  it('adds a set, a drop on the set just done, or a warm-up from the foot', () => {
    renderWorkout()
    const foot = () => [...container.querySelectorAll('.st-foot button')]
    expect(foot().map(b => b.textContent)).toEqual(['Set', 'Drop', 'Warmup'])
    expect(container.textContent).not.toContain('Add warm-up set')
    click(foot()[0])
    expect(activeSets()).toHaveLength(4)
    // Nothing done yet: the drop goes on the next set to do.
    click(foot()[1])
    expect(activeSets()[0].drops).toHaveLength(1)
    click(rowsEl()[1].querySelector('.st-ck'))
    click(foot()[1])
    expect(activeSets()[1].drops).toHaveLength(1)
    click(foot()[2])
    expect(activeSets()[0].warmup).toBe(true)
  })

  it('offers “Add exercise” under the exercise', () => {
    renderWorkout()
    const btn = container.querySelector('.settable .st-addex')
    expect(btn.textContent).toBe('Add exercise')
    click(btn)
    expect(useUI.getState().sheets.length).toBeGreaterThan(0)
  })

  it('is the third stop of the header toggle: list → table → drum', () => {
    renderWorkout({ setView: 'list' })
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('table')
    expect(container.querySelector('.settable')).not.toBeNull()
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('drum')
    expect(container.querySelector('.settable')).toBeNull()
  })
})

describe('set table locale coverage', () => {
  const required = ['Table', 'Show sets as a table', 'Record', 'Target', 'Set', 'Use the target', '{0} of {1} sets', 'Last', 'Drop', 'Warmup', 'Add exercise']
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })

  it('defines every table string in every non-English locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(Object.keys(LANGS).length - 1)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty([key]))
    })
  })
})

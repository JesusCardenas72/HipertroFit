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

let root
let container

function renderWorkout(entries) {
  const S = clone(DEF)
  S.active = {
    id: 'drum-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Drum test', bw: null, cur: 0, entries: clone(entries),
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const rows = n => Array.from({ length: n }, (_, i) => ({ w: 60 + i * 5, r: 10, done: false }))
const pips = () => [...container.querySelectorAll('.drum-pip')]
const heroKind = () => container.querySelector('.drum-ch.hero .dh .dh-kind')?.textContent
const heroWeight = () => container.querySelector('.drum-ch.hero .dh .dh-v .num')?.value
const sets = (e = 0) => useStore.getState().S.active.entries[e].sets
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

describe('the set drum', () => {
  it('is the default view, with one pip per set on the rail', () => {
    renderWorkout([{ id: 'a', target: { sets: 3, reps: 10 }, sets: rows(3) }])
    expect(container.querySelector('.drum')).not.toBeNull()
    expect(pips()).toHaveLength(3)
    expect(heroKind()).toContain('1')
    expect(heroWeight()).toBe('60')
  })

  it('turns to another set from the rail without ticking anything off', () => {
    renderWorkout([{ id: 'a', target: { sets: 3, reps: 10 }, sets: rows(3) }])
    click(pips()[2])
    expect(heroWeight()).toBe('70')
    expect(pips()[2].getAttribute('aria-selected')).toBe('true')
    expect(sets().every(s => !s.done)).toBe(true)
  })

  it('ticks the set off only from the hero’s own button', () => {
    renderWorkout([{ id: 'a', target: { sets: 3, reps: 10 }, sets: rows(3) }])
    click(container.querySelector('.drum-ch.hero .dh-go'))
    expect(sets().map(s => s.done)).toEqual([true, false, false])
    expect(container.querySelector('.drum-ch.hero .dh-go').getAttribute('aria-checked')).toBe('true')
  })

  it('lays a superset out round by round on the rail', () => {
    renderWorkout([
      { id: 'a', sg: 's1', target: { sets: 2, reps: 10 }, sets: rows(2) },
      { id: 'b', sg: 's1', target: { sets: 2, reps: 10 }, sets: rows(2) },
    ])
    expect(pips().map(p => p.className.match(/m(\d)/)[1])).toEqual(['0', '1', '0', '1'])
    expect(container.querySelectorAll('.drum-tab')).toHaveLength(2)
  })

  it('switches back to the list from the header', () => {
    renderWorkout([{ id: 'a', target: { sets: 2, reps: 10 }, sets: rows(2) }])
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('list')
    expect(container.querySelector('.drum')).toBeNull()
    expect(container.querySelectorAll('.setrow')).toHaveLength(2)
  })
})

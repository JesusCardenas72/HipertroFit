// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { LANGS } from '../lib/i18n-core.js'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), vibrate: vi.fn(), playClips: vi.fn(), stopClips: vi.fn(),
  clipsDuration: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root
let container

function renderWorkout(entries, extra = {}) {
  const S = { ...clone(DEF), ...clone(extra) }
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
const tool = label => [...container.querySelectorAll('.drum-ch.hero .dh-tool')].find(b => b.textContent === label)
const sheetItem = (sheet, title) => [...sheet.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === title)

// Sheets are drawn by the app shell, not by Workout: draw the top one by hand.
let sheetRoot
let sheetContainer
function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  sheetContainer = document.createElement('div')
  document.body.appendChild(sheetContainer)
  sheetRoot = createRoot(sheetContainer)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheetContainer
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  sheetRoot = null
  sheetContainer = null
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

  it('keeps the set’s tools in one bar inside the hero', () => {
    renderWorkout([{ id: 'a', target: { sets: 1, reps: 10 }, sets: rows(1) }])
    expect(container.querySelector('.drum-tools')).toBeNull()
    click(tool('One more'))
    expect(sets()).toHaveLength(2)
    click(tool('Drop'))
    expect(sets()[0].drops).toHaveLength(1)
    // A drop set takes no burst: the slot stays where it is, greyed.
    expect(tool('Burst').disabled).toBe(true)
    click(tool('Remove'))
    expect(sets()).toHaveLength(1)
    click(tool('Warm up'))
    expect(sets()).toHaveLength(2)
    expect(isWarmupRow(sets()[0])).toBe(true)
  })

  describe('paging between exercises', () => {
    const two = () => [
      { id: 'a', target: { sets: 3, reps: 10 }, sets: rows(3) },
      { id: 'b', target: { sets: 3, reps: 10 }, sets: rows(3) },
    ]
    let pid = 0
    const pointer = (type, target, x, y) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
      if (type === 'pointerdown') pid++
      event.pointerId = pid
      event.pointerType = 'touch'
      target.dispatchEvent(event)
    }
    // Press on `from`, move and lift. Moves and the lift go to `to` (the surface that holds the
    // capture), the way the browser delivers them once a gesture has captured the pointer.
    const swipe = (from, dx, dy = 0, to = from) => {
      act(() => pointer('pointerdown', from, 200, 300))
      act(() => pointer('pointermove', to, 200 + dx, 300 + dy))
      act(() => pointer('pointerup', to, 200 + dx, 300 + dy))
    }
    const cur = () => useStore.getState().S.active.cur

    it('pages from the exercise header, outside the stage', () => {
      renderWorkout(two())
      swipe(container.querySelector('.drum-head'), -120, 0, container.querySelector('[data-testid="workout-swipe-surface"]'))
      expect(cur()).toBe(1)
    })

    it('pages from the rail, and from a number field in the hero', () => {
      renderWorkout(two())
      swipe(container.querySelector('.drum-rail'), -120)
      expect(cur()).toBe(1)
      act(() => root.unmount()); container.remove()
      renderWorkout(two())
      swipe(container.querySelector('.drum-ch.hero .dh-v input'), -120)
      expect(cur()).toBe(1)
    })

    it('never deletes a set by dragging: only the Remove button does', () => {
      renderWorkout(two())
      const surface = container.querySelector('[data-testid="workout-swipe-surface"]')
      expect(container.querySelector('[data-swipe-removable]')).toBeNull()
      swipe(container.querySelector('.drum-head'), 160, 0, surface)
      swipe(container.querySelector('.drum-ch.hero .dh-kind'), 160)
      expect(sets()).toHaveLength(3)
      // A real drag is followed by a click the drum swallows; none is dispatched here, so start
      // from a fresh screen to press the button.
      act(() => root.unmount()); container.remove()
      renderWorkout(two())
      click(tool('Remove'))
      expect(sets()).toHaveLength(2)
    })
  })

  it('offers One more only on the exercise’s last set', () => {
    renderWorkout([{ id: 'a', target: { sets: 3, reps: 10 }, sets: rows(3) }])
    expect(heroKind()).toContain('Set 1')
    expect(tool('One more')).toBeUndefined()
    act(() => root.unmount()); container.remove()
    const done = rows(3).map((s, i) => ({ ...s, done: i < 2 }))
    renderWorkout([{ id: 'a', target: { sets: 3, reps: 10 }, sets: done }])
    expect(heroKind()).toContain('Set 3')
    click(tool('One more'))
    expect(sets()).toHaveLength(4)
    expect(sets()[3]).toEqual({ w: 70, r: 10, done: false })
  })

  it('asks, in a superset, whether One more is this exercise’s alone', () => {
    renderWorkout([
      { id: 'a', sg: 's1', target: { sets: 1, reps: 10 }, sets: rows(1) },
      { id: 'b', sg: 's1', target: { sets: 1, reps: 10 }, sets: rows(1) },
    ])
    click(tool('One more'))
    // Nothing is added until you pick.
    expect([sets(0).length, sets(1).length]).toEqual([1, 1])
    const sheet = renderTopSheet()
    click(sheetItem(sheet, 'Only this exercise'))
    expect([sets(0).length, sets(1).length]).toEqual([2, 1])
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('adds a whole round when One more goes to every exercise of the superset', () => {
    renderWorkout([
      { id: 'a', sg: 's1', target: { sets: 1, reps: 10 }, sets: rows(1) },
      { id: 'b', sg: 's1', target: { sets: 1, reps: 10 }, sets: rows(1) },
    ])
    click(tool('One more'))
    click(sheetItem(renderTopSheet(), 'Every exercise in the superset'))
    expect([sets(0).length, sets(1).length]).toEqual([2, 2])
    expect(pips()).toHaveLength(4)
  })

  it('reads last time against the steppers, as capsules that follow every +/-', () => {
    const workouts = [{ id: 'w0', d: '2026-08-04', name: 'Before', entries: [
      { id: 'a', target: { sets: 1, reps: 10 }, sets: [{ w: 60, r: 6, done: true }] },
    ] }]
    renderWorkout([{ id: 'a', target: { sets: 1, reps: 10 }, sets: [{ w: 60, r: 10, done: false }] }], { workouts })
    const capsules = () => [...container.querySelectorAll('.drum-ch.hero .dh-delta')].map(c => c.textContent)
    // Today's numbers are only in the steppers: no "Today" line repeating them.
    expect(container.querySelector('.drum-ch.hero .dh-line.goal')).toBeNull()
    expect(capsules()).toEqual(['+4 reps'])
    const [wUp, wDown, rUp, rDown] = [...container.querySelectorAll('.drum-ch.hero .dh-b')]
    click(rDown); click(rDown); click(rDown); click(rDown)
    expect(capsules()).toEqual(['No overload'])
    click(rDown); click(rDown)
    expect(capsules()).toEqual(['−2 reps'])
    click(wUp)
    expect(capsules()).toEqual(['+2.5 kg', '−2 reps'])
  })

  it('lays a superset out round by round on the rail', () => {
    renderWorkout([
      { id: 'a', sg: 's1', target: { sets: 2, reps: 10 }, sets: rows(2) },
      { id: 'b', sg: 's1', target: { sets: 2, reps: 10 }, sets: rows(2) },
    ])
    expect(pips().map(p => p.className.match(/m(\d)/)[1])).toEqual(['0', '1', '0', '1'])
    expect(container.querySelectorAll('.drum-tab')).toHaveLength(2)
  })

  it('names a superset’s exercise only in its box, which unfolds its header under it', () => {
    renderWorkout([
      { id: 'a', sg: 's1', target: { sets: 2, reps: 10 }, sets: rows(2) },
      { id: 'b', sg: 's1', target: { sets: 2, reps: 10 }, sets: rows(2) },
    ])
    const tabs = () => [...container.querySelectorAll('.drum-tab')]
    // No name above the boxes repeating the one in them.
    expect(container.querySelector('.exhead-tg')).toBeNull()
    expect(tabs()[0].getAttribute('aria-expanded')).toBe('false')
    expect(tabs()[1].hasAttribute('aria-expanded')).toBe(false)
    expect(container.querySelector('.drum-head [aria-label="Details"]')).toBeNull()
    click(tabs()[0])
    expect(tabs()[0].getAttribute('aria-expanded')).toBe('true')
    // The header hangs right under its own box, above the next member's.
    const head = container.querySelector('.drum-tabs .drum-head')
    expect(head.previousElementSibling).toBe(tabs()[0])
    expect(head.querySelector('[aria-label="Details"]')).not.toBeNull()
    click(tabs()[0])
    expect(container.querySelector('.drum-head [aria-label="Details"]')).toBeNull()
  })

  it('folds the header to its title bar, and the title unfolds the rest', () => {
    renderWorkout([
      { id: 'a', target: { sets: 2, reps: 10 }, sets: rows(2) },
      { id: 'b', target: { sets: 2, reps: 10 }, sets: rows(2) },
    ])
    const top = container.querySelector('[data-testid="workout-top"]')
    expect(top.getAttribute('aria-expanded')).toBe('false')
    // Where you are in the session stays in the title bar while the rest is folded away.
    expect(top.textContent).toContain('1 / 2')
    // The running order stays too: it is how you get around the session.
    expect(container.querySelector('[data-testid="workout-dock"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="set-view"]')).toBeNull()
    click(top)
    expect(top.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-testid="workout-dock"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="set-view"]')).not.toBeNull()
  })

  it('keeps the animation behind a thumbnail beside the name', () => {
    renderWorkout([{ id: '0025', target: { sets: 2, reps: 10 }, sets: rows(2) }])
    const thumb = container.querySelector('.exthumb')
    expect(thumb).not.toBeNull()
    expect(container.querySelector('.exmedia')).toBeNull()
    click(thumb)
    expect(container.querySelector('.exmedia')).not.toBeNull()
    click(thumb)
    expect(container.querySelector('.exmedia')).toBeNull()
  })

  it('folds a note to one line that opens the exercise header', () => {
    renderWorkout([{ id: 'a', target: { sets: 2, reps: 10 }, sets: rows(2), note: 'Slow on the way down' }])
    const note = container.querySelector('.exnote.fold')
    expect(note.textContent).toBe('Slow on the way down')
    click(note)
    expect(container.querySelector('.exnote.fold')).toBeNull()
    expect(container.querySelector('.exnote').textContent).toBe('Slow on the way down')
  })

  it('keeps the foot to paging and adding / removing, with the session note up top', () => {
    renderWorkout([
      { id: 'a', target: { sets: 2, reps: 10 }, sets: rows(2) },
      { id: 'b', target: { sets: 2, reps: 10 }, sets: rows(2) },
    ])
    const foot = container.querySelector('.wfoot')
    expect([...foot.querySelectorAll('.wtool')].map(b => b.textContent))
      .toEqual(['Add exercise', 'Remove exercise'])
    // Finishing is the header's ✓, swapping is the exercise header's, the note is the header's.
    expect(foot.textContent).not.toMatch(/Finish|Swap|session note/)
    expect(container.querySelector('[data-testid="session-note"]')).toBeNull()
    click(container.querySelector('[data-testid="workout-top"]'))
    expect(container.querySelector('[data-testid="session-note"]').getAttribute('aria-label')).toBe('Add session note')
  })

  it('switches back to the list from the header', () => {
    renderWorkout([{ id: 'a', target: { sets: 2, reps: 10 }, sets: rows(2) }])
    click(container.querySelector('[data-testid="workout-top"]'))
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('list')
    expect(container.querySelector('.drum')).toBeNull()
    expect(container.querySelectorAll('.setrow')).toHaveLength(2)
  })
})

describe('set drum locale coverage', () => {
  const required = [
    'Show workout details', 'Hide workout details', 'Set tools', 'Drop', 'Burst', 'Warm up', 'One more',
    'One more set', 'Add the set to this exercise only, or to every exercise in the superset?',
    'Only this exercise', 'Every exercise in the superset',
  ]
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })

  it('defines every drum string in every non-English locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(Object.keys(LANGS).length - 1)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty([key]))
    })
  })
})

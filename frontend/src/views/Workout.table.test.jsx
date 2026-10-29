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

const rowsEl = () => [...container.querySelectorAll('.settable .setswipe > .st-row:not(.st-drop)')]
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

  it('folds the session line away from the title and brings it back, in the table too', () => {
    renderWorkout()
    const top = () => container.querySelector('[data-testid="workout-top"]')
    expect(container.querySelector('[data-testid="workout-position"]')).not.toBeNull()
    expect(top().getAttribute('aria-expanded')).toBe('true')
    click(top())
    expect(container.querySelector('[data-testid="workout-position"]')).toBeNull()
    expect(top().getAttribute('aria-expanded')).toBe('false')
    click(top())
    expect(container.querySelector('[data-testid="workout-position"]')).not.toBeNull()
  })

  it('puts the exercise’s tools on one line under its name, unpair included, with no superset banner', () => {
    renderWorkout()
    act(() => useStore.getState().update(s => {
      s.active.entries[0].sg = 'g'
      s.active.entries.push({ id: 'b', sg: 'g', target: { sets: 1, reps: 10 }, sets: [{ w: 20, r: 10, done: false }] })
    }))
    const head = container.querySelector('.exhead-tg')
    click(head)
    const tools = container.querySelector('[data-testid="ex-tools"]')
    expect(head.parentElement.nextElementSibling).toBe(tools)
    expect([...tools.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Note', 'Details', 'Rest after this exercise', 'Exercise progress', 'Swap exercise', 'Unpair', 'Remove exercise'])
    expect(container.textContent).not.toContain('back-to-back')
    click(tools.querySelector('[aria-label="Unpair"]'))
    expect(useStore.getState().S.active.entries.some(e => e.sg)).toBe(false)
  })

  it('lists the exercise’s primary muscles and then its secondary ones, each in its own colour', () => {
    renderWorkout()
    act(() => useStore.getState().update(s => { s.active.entries[0].id = '0749' }))
    click(container.querySelector('.exhead-tg'))
    const tags = cls => [...container.querySelectorAll('.tag.' + cls)].map(n => n.textContent)
    expect(tags('mus-p')).toEqual(['Hamstrings', 'Glutes'])
    expect(tags('mus-s')).toEqual(['Lower back', 'Adductors'])
  })

  it('is the third stop of the header toggle: list → table → session → drum', () => {
    renderWorkout({ setView: 'list' })
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('table')
    expect(container.querySelector('.settable')).not.toBeNull()
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('session')
    expect(container.querySelector('[data-testid="session-flow"]')).not.toBeNull()
    click(container.querySelector('[data-testid="set-view"]'))
    expect(useStore.getState().S.setView).toBe('drum')
    expect(container.querySelector('.settable')).toBeNull()
  })
})

describe('the set sheet', () => {
  let sheetRoot, sheetEl
  // The sheet lives in the modal layer (Modals.jsx), which this test does not mount: draw the
  // one that opened on its own.
  const openSheet = () => {
    const sheet = useUI.getState().sheets.at(-1)
    sheetEl = document.createElement('div')
    document.body.appendChild(sheetEl)
    sheetRoot = createRoot(sheetEl)
    act(() => sheetRoot.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>))
  }
  const doubleTap = node => { click(node); click(node) }
  const tab = label => [...sheetEl.querySelectorAll('.ss-kind button')].find(b => b.textContent === label)
  afterEach(() => {
    if (sheetRoot) act(() => sheetRoot.unmount())
    if (sheetEl) sheetEl.remove()
    sheetRoot = null
    sheetEl = null
  })

  it('opens on a double tap of the set’s number, and a single tap still opens the tools', () => {
    renderWorkout()
    click(rowsEl()[1].querySelector('.st-n'))
    expect(container.querySelector('.st-tools')).not.toBeNull()
    expect(useUI.getState().sheets).toHaveLength(0)
    renderWorkout()
    doubleTap(rowsEl()[1].querySelector('.st-n'))
    expect(useUI.getState().sheets).toHaveLength(1)
    // the pair leaves the tools as they were
    expect(container.querySelector('.st-tools')).toBeNull()
    openSheet()
    expect(sheetEl.querySelector('h3').textContent).toBe('Set 2')
    expect([...sheetEl.querySelectorAll('.ss-kind button')].map(b => b.textContent)).toEqual(['Normal', 'Warmup', 'Failure', 'Drop'])
    expect([...sheetEl.querySelectorAll('.ss-hd')].map(n => n.textContent)).toEqual(['Weight (kg)', 'Reps'])
  })

  it('turns a set into a warm-up, which logs no effort', () => {
    renderWorkout({ effort: 'rir', rows: [{ w: 60, r: 10, rir: 2, done: false }, { w: 60, r: 10, done: false }] })
    doubleTap(rowsEl()[0].querySelector('.st-n'))
    openSheet()
    expect(sheetEl.querySelectorAll('.wheel')).toHaveLength(3)
    click(tab('Warmup'))
    expect(activeSets()[0]).toEqual({ w: 60, r: 10, done: false, phase: 'warmup', warmup: true })
    expect(sheetEl.querySelectorAll('.wheel')).toHaveLength(2)
  })

  it('marks a set to failure, logging RIR 0', () => {
    renderWorkout({ effort: 'rir' })
    doubleTap(rowsEl()[0].querySelector('.st-n'))
    openSheet()
    click(tab('Failure'))
    expect(activeSets()[0]).toMatchObject({ fail: true, rir: 0 })
    expect(rowsEl()[0].querySelector('.st-n').classList.contains('fail')).toBe(true)
  })

  it('hangs a drop 25 % lighter off the set, and rests only after the drop', () => {
    renderWorkout()
    doubleTap(rowsEl()[0].querySelector('.st-n'))
    openSheet()
    click(tab('Drop'))
    expect(activeSets()[0].drops).toEqual([{ w: 45, r: 10 }])
    const drop = container.querySelector('.st-drop')
    expect(drop.querySelector('.st-prev').textContent).toBe('−25 %')
    // the set itself: ticked, but no rest yet — the drop comes with none in between
    click(rowsEl()[0].querySelector('.st-ck'))
    expect(activeSets()[0].done).toBe(true)
    expect(useUI.getState().timer).toBeNull()
    click(container.querySelector('.st-drop .st-ck'))
    expect(activeSets()[0].drops[0].done).toBe(true)
    expect(useUI.getState().timer).not.toBeNull()
    // a double tap on the drop's badge opens its set
    doubleTap(container.querySelector('.st-drop .st-n'))
    expect(useUI.getState().sheets).toHaveLength(2)
  })

  it('ticking the drop first completes its set too', () => {
    renderWorkout({ rows: [{ w: 60, r: 10, done: false, type: 'dropset', drops: [{ w: 45, r: 8 }] }, { w: 60, r: 10, done: false }] })
    click(container.querySelector('.st-drop .st-ck'))
    expect(activeSets()[0].done).toBe(true)
    expect(useUI.getState().timer).not.toBeNull()
  })

  it('swipes a drop away on its own, leaving its set', () => {
    renderWorkout({ rows: [{ w: 60, r: 10, done: false, type: 'dropset', drops: [{ w: 45, r: 8 }] }, { w: 60, r: 10, done: false }] })
    const surface = container.querySelector('[data-testid="workout-swipe-surface"]')
    const pointer = (type, target, x) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 300 })
      event.pointerId = 7
      event.pointerType = 'touch'
      act(() => target.dispatchEvent(event))
    }
    pointer('pointerdown', container.querySelector('.st-drop .st-n'), 100)
    pointer('pointermove', surface, 300)
    pointer('pointerup', surface, 300)
    expect(activeSets()).toHaveLength(2)
    expect(activeSets()[0].drops).toEqual([])
    expect(container.querySelector('.st-drop')).toBeNull()
    // and the set below it still swipes away as before
    pointer('pointerdown', rowsEl()[1].querySelector('.st-n'), 100)
    pointer('pointermove', surface, 300)
    pointer('pointerup', surface, 300)
    expect(activeSets()).toHaveLength(1)
  })

  it('hangs a rest-pause burst off its set like a drop, and swipes it away with its reps', () => {
    renderWorkout({ rows: [{ w: 60, r: 12, done: false, type: 'restpause', clusters: [{ r: 4, restSec: 15 }] }, { w: 60, r: 10, done: false }] })
    const burst = container.querySelector('.st-burst')
    expect(burst.querySelector('.st-n').textContent).toBe('R-P')
    expect(burst.querySelector('.st-prev').textContent).toBe('15 s')
    expect(burst.querySelector('.cut input').value).toBe('4')
    const surface = container.querySelector('[data-testid="workout-swipe-surface"]')
    const pointer = (type, target, x) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 300 })
      event.pointerId = 9
      event.pointerType = 'touch'
      act(() => target.dispatchEvent(event))
    }
    pointer('pointerdown', burst.querySelector('.st-n'), 100)
    pointer('pointermove', surface, 300)
    pointer('pointerup', surface, 300)
    expect(activeSets()).toHaveLength(2)
    expect(activeSets()[0]).toMatchObject({ r: 8, clusters: [] })
  })

  it('removes a drop or a burst with the bin at the end of its line', () => {
    renderWorkout({ rows: [
      { w: 60, r: 12, done: false, type: 'restpause', clusters: [{ r: 4, restSec: 15 }] },
      { w: 60, r: 10, done: false, type: 'dropset', drops: [{ w: 45, r: 10 }] },
    ] })
    click(container.querySelector('.st-del.burst'))
    expect(activeSets()[0]).toMatchObject({ r: 8, clusters: [] })
    click(container.querySelector('.st-del.drop'))
    expect(activeSets()[1].drops).toEqual([])
    expect(activeSets()).toHaveLength(2)
  })

  it('deletes the set from the sheet', () => {
    renderWorkout()
    doubleTap(rowsEl()[2].querySelector('.st-n'))
    openSheet()
    click(sheetEl.querySelector('.ss-del'))
    expect(activeSets()).toHaveLength(2)
  })
})

describe('the table’s set tools in the list and the drum', () => {
  const rows = [
    { w: 60, r: 10, done: false, type: 'dropset', drops: [{ w: 45, r: 10 }] },
    { w: 60, r: 12, done: false, type: 'restpause', clusters: [{ r: 4, restSec: 15 }] },
  ]
  const twice = node => { click(node); click(node) }

  it('the list opens the set sheet on a double tap of the number, and hangs drops and bursts off their sets', () => {
    renderWorkout({ setView: 'list', rows })
    twice(container.querySelector('.setrow .n'))
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(container.querySelector('.st-drop .st-badge.drop').textContent).toBe('D')
    expect(container.querySelector('.st-burst .st-badge').textContent).toBe('R-P')
    // the drop's own tick, then its bin
    click(container.querySelector('.st-drop .st-ck'))
    expect(activeSets()[0].drops[0].done).toBe(true)
    click(container.querySelector('.st-del.drop'))
    expect(activeSets()[0].drops).toEqual([])
    click(container.querySelector('.st-del.burst'))
    expect(activeSets()[1]).toMatchObject({ r: 8, clusters: [] })
  })

  it('the drum opens the set sheet on a double tap of its label, and shows the drop the same way', () => {
    renderWorkout({ setView: 'drum', rows })
    twice(container.querySelector('.dh-kind'))
    expect(useUI.getState().sheets).toHaveLength(1)
    const drop = container.querySelector('.dh-int .st-drop')
    expect(drop.querySelector('.st-prev').textContent).toBe('−25 %')
    click(drop.querySelector('.st-del.drop'))
    expect(activeSets()[0].drops).toEqual([])
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

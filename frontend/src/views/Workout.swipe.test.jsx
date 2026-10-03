// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { SWIPE_MIN_DISTANCE, ROW_DELETE_DISTANCE } from '../lib/swipe.js'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), vibrate: vi.fn(), playClips: vi.fn(), stopClips: vi.fn(),
  clipsDuration: vi.fn(() => Promise.resolve(0)),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, sets) => ({
  id,
  target: { sets: sets, reps: 5 },
  sets: Array.from({ length: sets }, (_, i) => ({ w: 20 + i, r: 5, done: false })),
})

let root
let container

function renderWorkout(entries, cur = 0) {
  const S = clone(DEF)
  // These pin the list view: every set of the exercise down one card (the drum has its own tests).
  S.setView = 'list'
  S.active = {
    id: 'swipe-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Swipe test', bw: null, cur, entries,
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const surface = () => container.querySelector('[data-testid="workout-swipe-surface"]')
// Scoped to the screen you are on: while a swipe settles, the screen being left is still in
// the DOM alongside it, and its rows are not the ones under your thumb.
const rows = () => [...container.querySelectorAll('.deck-layer:not(.deck-over) .setrow')]
const activeSets = () => useStore.getState().S.active.entries[useStore.getState().S.active.cur].sets
const curIdx = () => useStore.getState().S.active.cur
// The workout shows one set at a time, so where you are is an exercise *and* a set. The
// counter line above the card is the only place both are stated, which makes it the honest
// thing to assert against — it is what the screen actually claims.
const where = () => container.querySelector('[data-testid="workout-position"]').textContent.replace(/\s+/g, ' ').trim()

// happy-dom has no PointerEvent constructor with the fields we need, and React only needs the
// plain properties — so a MouseEvent carrying a pointerId/pointerType is enough to drive the
// handlers exactly as a finger would.
//
// Every press gets a fresh id, the way a real touch does. Reusing one id across gestures hid
// the very bug these tests exist for: a surface left armed for a finished gesture went on
// answering to that id, so a stale gesture looked like a working one.
let pointerId = 0
function pointer(type, target, x, y) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  if (type === 'pointerdown') pointerId++
  event.pointerId = pointerId
  event.pointerType = 'touch'
  target.dispatchEvent(event)
}

function drag(from, dx, dy = 0, { release = true } = {}) {
  act(() => pointer('pointerdown', from, 200, 300))
  act(() => pointer('pointermove', surface(), 200 + dx, 300 + dy))
  if (release) act(() => pointer('pointerup', surface(), 200 + dx, 300 + dy))
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
})


describe('swipe a set row away', () => {
  it('deletes the swiped row once it has been pulled past the threshold', () => {
    renderWorkout([entry('1001', 3)])
    drag(rows()[0].querySelector('.n'), ROW_DELETE_DISTANCE)
    expect(activeSets().map(s => s.w)).toEqual([21, 22])
  })

  it('springs back without deleting when the drag stops short', () => {
    renderWorkout([entry('1001', 3)])
    drag(rows()[0].querySelector('.n'), ROW_DELETE_DISTANCE - 10)
    expect(activeSets().map(s => s.w)).toEqual([20, 21, 22])
  })

  it('shows a red delete track under the row while it is being dragged, and clears it after', () => {
    renderWorkout([entry('1001', 3)])
    drag(rows()[0].querySelector('.n'), 40, 0, { release: false })
    const track = container.querySelector('.setswipe-track')
    expect(track).toBeTruthy()
    expect(track.className).not.toContain('armed')
    expect(rows()[0].style.transform).toBe('translateX(40px)')
    act(() => pointer('pointermove', surface(), 200 + ROW_DELETE_DISTANCE, 300))
    expect(container.querySelector('.setswipe-track').className).toContain('armed')
    act(() => pointer('pointerup', surface(), 200 + ROW_DELETE_DISTANCE, 300))
    expect(container.querySelector('.setswipe-track')).toBe(null)
  })

  it('cancelling the gesture leaves the set alone', () => {
    renderWorkout([entry('1001', 3)])
    act(() => pointer('pointerdown', rows()[0].querySelector('.n'), 200, 300))
    act(() => pointer('pointermove', surface(), 200 + ROW_DELETE_DISTANCE, 300))
    act(() => pointer('pointercancel', surface(), 200 + ROW_DELETE_DISTANCE, 300))
    expect(activeSets()).toHaveLength(3)
    expect(container.querySelector('.setswipe-track')).toBe(null)
  })

  it('leaves the last remaining set alone — that swipe pages instead', () => {
    renderWorkout([entry('1001', 1), entry('1002', 2)])
    // The lone set is not removable, so this swipe never peels a delete track; it pages.
    drag(rows()[0].querySelector('.n'), -ROW_DELETE_DISTANCE)
    expect(useStore.getState().S.active.entries[0].sets).toHaveLength(1)
    expect(curIdx()).toBe(1) // the row could not be deleted, so the drag paged instead
  })
})

describe('swipe between exercises', () => {
  it('drags left to the next exercise and right back to the previous one', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    expect(where()).toBe('Exercise 1 / 2')
    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 2 / 2')
    expect(curIdx()).toBe(1)
    drag(surface(), SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 1 / 2')
    expect(curIdx()).toBe(0)
  })

  /* The screen is the exercise, so every set of it is on the card at once, one under the next.
     Paging by set instead put them on screens of their own, and a routine's three sets read as
     one — you could not see the other two, and adding a set looked like a button doing nothing. */
  it('lists every set of the exercise on the one screen', () => {
    renderWorkout([entry('1001', 3), entry('1002', 2)])
    expect(rows()).toHaveLength(3)
    expect(rows().map(r => r.dataset.swipeSet)).toEqual(['0', '1', '2'])
    // And the numbers down the card are the sets themselves, in order.
    expect(rows().map(r => r.querySelector('.n').textContent)).toEqual(['1', '2', '3'])
    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(rows()).toHaveLength(2)
    expect(rows().map(r => r.dataset.swipeSet)).toEqual(['0', '1'])
  })

  it('keeps a warm-up on the same card as the work sets it ramps to', () => {
    const warmed = entry('1001', 3)
    warmed.sets.unshift({ w: 10, r: 5, done: false, phase: 'warmup' })
    renderWorkout([warmed])
    expect(rows()).toHaveLength(4)
    // Numbering restarts per phase: the warm-up is 1, and the work sets count 1..3 after it.
    expect(rows().map(r => r.querySelector('.n').textContent)).toEqual(['1', '1', '2', '3'])
  })

  it('ignores a mostly vertical drag so the page can still scroll', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    drag(surface(), 20, 120)
    expect(where()).toBe('Exercise 1 / 2')
  })

  it('does not page past either end of the session', () => {
    renderWorkout([entry('1001', 2), entry('1002', 2)], 1)
    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 2 / 2')
    drag(surface(), SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 1 / 2')
    drag(surface(), SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 1 / 2')
  })

  // Rightwards on a removable row belongs to the delete track, so a row can only be paged
  // forwards — the space around it pages either way.
  it('pages forward even when the drag starts on a set row', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)], 0)
    drag(rows()[0].querySelector('.n'), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 2 / 2')
    expect(useStore.getState().S.active.entries[0].sets).toHaveLength(3)
  })
})

describe('the exercises while a finger is down', () => {
  const layers = () => [...container.querySelectorAll('.deck-layer')]
  // The exercises turn like faces of a cylinder (lib/slide.js), so the shift is one function of
  // a longer transform.
  const shift = el => Number(el.style.transform.match(/translateX\((-?[\d.]+)px\)/)?.[1])

  it('draws the next exercise alongside, both following the finger', () => {
    renderWorkout([entry('1001', 3), entry('1002', 2)])
    drag(surface(), -120, 0, { release: false })
    expect(layers()).toHaveLength(2)
    expect(shift(layers()[0])).toBe(-120)
    expect(shift(layers()[1])).toBe(window.innerWidth - 120)
    // Each turns round the curve the way it is travelling, and the one further out more so.
    const tilt = el => Number(el.style.transform.match(/rotateY\((-?[\d.]+)deg\)/)[1])
    expect(tilt(layers()[0])).toBeLessThan(0)
    expect(tilt(layers()[1])).toBeGreaterThan(Math.abs(tilt(layers()[0])))
    // The exercise being worked is the only one that answers to a tap; the one sliding past
    // is scenery — and it arrives with all of its own sets already drawn.
    expect(layers()[1].className).toContain('deck-over')
    expect(layers()[1].getAttribute('aria-hidden')).toBe('true')
    expect(layers()[1].querySelectorAll('.setrow')).toHaveLength(2)
  })

  it('draws one exercise only until the drag has committed to the horizontal', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    expect(layers()).toHaveLength(1)
    drag(surface(), -4, 0, { release: false })
    expect(layers()).toHaveLength(1)
  })

  it('pushes the exercise being left out from where the finger let go', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    drag(surface(), -120, 0, { release: false })
    act(() => pointer('pointerup', surface(), 200 - 120, 300))
    expect(where()).toBe('Exercise 2 / 2')
    const [leaving, arriving] = layers()
    expect(leaving.className).toContain('deck-sliding')
    expect(leaving.style.getPropertyValue('--slide-from')).toBe('-120px')
    expect(leaving.style.getPropertyValue('--slide-to')).toBe(-window.innerWidth + 'px')
    expect(arriving.style.getPropertyValue('--slide-to')).toBe('0px')
  })

  // The end of the session has nothing to bring in, but the gesture still has to answer.
  it('gives a little and stops at the last exercise', () => {
    renderWorkout([entry('1001', 1), entry('1002', 1)], 1)
    drag(surface(), -200, 0, { release: false })
    expect(layers()).toHaveLength(1)
    const offset = shift(layers()[0])
    expect(offset).toBeLessThan(0)
    expect(offset).toBeGreaterThan(-200)
  })
})

describe('a superset travels as one', () => {
  const linked = (id, sets, sg) => ({ ...entry(id, sets), sg })

  it('keeps its linked exercises, and all their sets, on the same screen', () => {
    renderWorkout([linked('1001', 2, 'g1'), linked('1002', 3, 'g1')])
    expect(where()).toBe('Superset 1 / 1')
    // Both exercises of the group, every set of each — they are done back to back.
    expect(rows()).toHaveLength(5)
    expect(rows().map(r => r.dataset.swipeSet)).toEqual(['0', '1', '0', '1', '2'])
  })

  it('pages past the whole group rather than into its partner', () => {
    renderWorkout([linked('1001', 2, 'g1'), linked('1002', 2, 'g1'), entry('1003', 2)])
    expect(where()).toBe('Superset 1 / 2')
    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 2 / 2')
    expect(curIdx()).toBe(2)
    drag(surface(), SWIPE_MIN_DISTANCE)
    // Back onto the group lands on its first exercise, where its work starts.
    expect(where()).toBe('Superset 1 / 2')
    expect(curIdx()).toBe(0)
  })
})

// A finger does not always lift where it was put down: the browser can take the pointer back,
// a capture can fail to take, the system can cancel the touch. The gesture has to end anyway,
// because a surface still armed for a finished gesture turns every later drag away as though a
// second finger were down — which is what it looks like when the workout simply stops
// responding to swipes until the page is reloaded.
describe('a gesture that never gets its pointerup', () => {
  const three = () => [entry('1001', 2), entry('1002', 2), entry('1003', 2)]
  const abandon = () => {
    act(() => pointer('pointerdown', surface(), 200, 300))
    act(() => pointer('pointermove', surface(), 200 - SWIPE_MIN_DISTANCE, 300))
  }

  it('is ended by the lift landing anywhere at all, and the next swipe still works', () => {
    renderWorkout(three())
    abandon()
    // The lift reaches the window rather than the card — off the element, or past a capture
    // that was never granted.
    act(() => pointer('pointerup', window, 200 - SWIPE_MIN_DISTANCE, 300))
    expect(where()).toBe('Exercise 2 / 3')

    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 3 / 3')
  })

  // The worst case, and the one that was actually reaching people: the pointer is never heard
  // from again at all. Nothing can end that gesture but the next press.
  it('is superseded by the next press when its pointer never reports again', () => {
    renderWorkout(three())
    abandon()
    expect(where()).toBe('Exercise 1 / 3')

    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 2 / 3')
    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 3 / 3')
  })

  it('is ended by a cancelled touch, without paging', () => {
    renderWorkout(three())
    abandon()
    act(() => pointer('pointercancel', window, 200 - SWIPE_MIN_DISTANCE, 300))
    expect(where()).toBe('Exercise 1 / 3')

    drag(surface(), -SWIPE_MIN_DISTANCE)
    expect(where()).toBe('Exercise 2 / 3')
  })
})

// Excluding the card's buttons and the exercise's picture from the gesture left little to grab
// on a phone, and a swipe that began on them did nothing at all — the tap they carry is
// protected by the travel threshold, not by refusing the drag outright.
describe('where a swipe may start', () => {
  const startOn = el => {
    act(() => pointer('pointerdown', el, 200, 300))
    act(() => pointer('pointermove', surface(), 200 - SWIPE_MIN_DISTANCE, 300))
    act(() => pointer('pointerup', surface(), 200 - SWIPE_MIN_DISTANCE, 300))
  }

  it('pages from a drag that begins on a button', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    const button = [...container.querySelectorAll('.deck-layer:not(.deck-over) button')]
      .find(b => !b.closest('[data-swipe-row]'))
    expect(button).toBeTruthy()
    startOn(button)
    expect(where()).toBe('Exercise 2 / 2')
  })

  it('pages from a drag that begins on the exercise picture', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    const media = container.querySelector('.deck-layer:not(.deck-over) .exmedia')
    expect(media).toBeTruthy()
    startOn(media)
    expect(where()).toBe('Exercise 2 / 2')
  })

  // A tap is still a tap: nothing has travelled, so the button underneath gets its click.
  it('leaves a press with no travel alone', () => {
    renderWorkout([entry('1001', 3)])
    const box = container.querySelector('.deck-layer:not(.deck-over) [role="checkbox"]')
    act(() => pointer('pointerdown', box, 200, 300))
    act(() => pointer('pointerup', box, 200, 300))
    act(() => box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(activeSets()[0].done).toBe(true)
  })

  // Typing into a set's weight or reps means dragging across the number to select it.
  it('leaves a drag that begins in a typed field alone', () => {
    renderWorkout([entry('1001', 3), entry('1002', 3)])
    const field = container.querySelector('.deck-layer:not(.deck-over) input')
    expect(field).toBeTruthy()
    startOn(field)
    expect(where()).toBe('Exercise 1 / 2')
  })
})

describe('adding a set from inside the session', () => {
  const tap = label => {
    const button = [...container.querySelectorAll('.deck-layer:not(.deck-over) button')]
      .find(el => el.textContent.trim() === label)
    expect(button).toBeTruthy()
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  }

  // The set appears on the card you are already looking at — no screen to go and find it on.
  it('draws the new set under the ones already there', () => {
    renderWorkout([entry('1001', 3)])
    expect(rows()).toHaveLength(3)
    tap('Add set')
    expect(activeSets()).toHaveLength(4)
    expect(rows()).toHaveLength(4)
    expect(rows()[3].querySelector('.n').textContent).toBe('4')
  })

  it('carries the weight and reps of the set before it', () => {
    renderWorkout([entry('1001', 3)])
    tap('Add set')
    expect(activeSets()[3]).toMatchObject({ w: 22, r: 5, done: false })
  })

  it('takes the last set back off again, still on the same card', () => {
    renderWorkout([entry('1001', 3)])
    tap('Remove set')
    expect(activeSets()).toHaveLength(2)
    expect(rows()).toHaveLength(2)
  })
})

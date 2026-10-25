// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ScreenSlider from './ScreenSlider.jsx'
import { SWIPE_MIN_DISTANCE } from '../lib/swipe.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container

// The slider hands each layer the route it is drawing, which need not be the current one —
// so the stand-in screen reports the pathname it was *given*, and the layers can be told apart.
const Screen = ({ path }) => <div data-screen={path}>{path}</div>

function Here() {
  const loc = useLocation()
  return <span data-testid="here">{loc.pathname}</span>
}

function render(start = '/home', screen = path => <Screen path={path} />) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(
    <MemoryRouter initialEntries={[start]}>
      <Here />
      <ScreenSlider render={screen} />
    </MemoryRouter>
  ))
}

// A screen that runs a horizontal gesture of its own, the way the workout's set-by-set deck does.
const OwnSwipe = ({ path }) => (
  <div data-screen={path}>
    <div data-owns-swipe data-testid="inner">
      <button type="button" data-testid="inner-button">tap</button>
    </div>
  </div>
)

const here = () => container.querySelector('[data-testid="here"]').textContent
const layers = () => [...container.querySelectorAll('.deck-layer')]
const screens = () => [...container.querySelectorAll('[data-screen]')].map(el => el.dataset.screen)
const surface = () => container.querySelector('.screens')

// happy-dom has no PointerEvent carrying the fields React reads, and React only needs the
// plain properties — a MouseEvent with a pointerId/pointerType drives the handlers as a finger does.
function pointer(type, target, x, y, pointerType = 'touch', button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button })
  event.pointerId = 1
  event.pointerType = pointerType
  target.dispatchEvent(event)
}

function drag(dx, dy = 0, { release = true, pointerType = 'touch' } = {}) {
  act(() => pointer('pointerdown', surface(), 200, 300, pointerType))
  act(() => pointer('pointermove', surface(), 200 + dx, 300 + dy, pointerType))
  if (release) act(() => pointer('pointerup', surface(), 200 + dx, 300 + dy, pointerType))
}

beforeEach(() => { root = null; container = null })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
})

describe('swiping between screens', () => {
  it('drags left to the next tab and right back to the previous one', () => {
    render('/home')
    drag(-SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/plan')
    drag(SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/home')
  })

  it('walks the whole bar in the order the tabs are drawn', () => {
    render('/home')
    drag(-SWIPE_MIN_DISTANCE)
    drag(-SWIPE_MIN_DISTANCE)
    drag(-SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/library')
  })

  it('stays put when the drag stops short of the threshold', () => {
    render('/home')
    drag(-(SWIPE_MIN_DISTANCE - 1))
    expect(here()).toBe('/home')
  })

  it('leaves a mostly vertical drag to the page, so it can still scroll', () => {
    render('/home')
    drag(-30, 120)
    expect(here()).toBe('/home')
  })

  it('pages for a mouse held down and dragged, the same as for a finger', () => {
    render('/home')
    drag(-SWIPE_MIN_DISTANCE, 0, { pointerType: 'mouse' })
    expect(here()).toBe('/plan')
  })

  // Only the primary button: a right-click opens a context menu, and the drag a middle button
  // makes is the browser's autoscroll, neither of which is a request to change screen.
  it('leaves a drag with any other mouse button alone', () => {
    render('/home')
    act(() => pointer('pointerdown', surface(), 200, 300, 'mouse', 2))
    act(() => pointer('pointermove', surface(), 200 - SWIPE_MIN_DISTANCE, 300, 'mouse', 2))
    act(() => pointer('pointerup', surface(), 200 - SWIPE_MIN_DISTANCE, 300, 'mouse', 2))
    expect(here()).toBe('/home')
  })

  it('does not page past either end of the bar', () => {
    render('/home')
    drag(SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/home')
    render('/library')
    drag(-SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/library')
  })

  it('will not page sideways out of a sub-page', () => {
    render('/plan/r/abc')
    drag(-SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/plan/r/abc')
  })
})

describe('the screens while a finger is down', () => {
  it('draws the neighbour alongside, both following the finger', () => {
    render('/home')
    drag(-120, 0, { release: false })
    expect(screens()).toEqual(['/home', '/plan'])
    const [current, peek] = layers()
    expect(current.style.transform).toBe('translateX(-120px)')
    // The neighbour sits a screen to the right of it, and travels the same distance.
    expect(peek.style.transform).toBe('translateX(' + (window.innerWidth - 120) + 'px)')
    expect(peek.className).toContain('deck-over')
    expect(peek.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws one screen only, until a drag has committed to the horizontal', () => {
    render('/home')
    expect(screens()).toEqual(['/home'])
    drag(-4, 0, { release: false })
    expect(screens()).toEqual(['/home'])
  })

  // At the end of the row there is nothing to bring in, but the gesture still has to answer.
  it('gives a little and stops at the end of the bar, with nothing to pull in', () => {
    render('/home')
    drag(200, 0, { release: false })
    expect(screens()).toEqual(['/home'])
    const offset = Number(layers()[0].style.transform.match(/-?[\d.]+/)[0])
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(200)
  })

  it('animates the screen being left out the other side once the swipe commits', () => {
    render('/home')
    drag(-120, 0, { release: false })
    act(() => pointer('pointerup', surface(), 200 - 120, 300))
    expect(here()).toBe('/plan')
    // Both are still drawn: the one being left is pushed out while the new one arrives.
    expect(screens()).toEqual(['/home', '/plan'])
    const [leaving, arriving] = layers()
    expect(leaving.className).toContain('deck-sliding')
    // It carries on from where the finger let go rather than restarting at the border.
    expect(leaving.style.getPropertyValue('--slide-from')).toBe('-120px')
    expect(leaving.style.getPropertyValue('--slide-to')).toBe(-window.innerWidth + 'px')
    expect(arriving.style.getPropertyValue('--slide-to')).toBe('0px')
  })
})

/* The app-level slider is an ancestor of every screen, so a screen with a swipe of its own is a
   pointer gesture inside a pointer gesture. Both used to start on the same pointerdown, and this
   one — running last, as the outer element — took the capture away from the inner surface, which
   was then told it had lost the pointer before a single move reached it. That is what stopped the
   workout paging between sets with a finger, on a phone where nothing else could be blamed. */
describe('a screen that owns its own horizontal gesture', () => {
  const inner = () => container.querySelector('[data-testid="inner"]')

  it('does not start a screen swipe from inside it', () => {
    render('/home', path => <OwnSwipe path={path} />)
    act(() => pointer('pointerdown', inner(), 200, 300))
    act(() => pointer('pointermove', inner(), 200 - SWIPE_MIN_DISTANCE, 300))
    // No neighbour drawn alongside: the gesture never began, so there is nothing to page to.
    expect(layers()).toHaveLength(1)
    act(() => pointer('pointerup', inner(), 200 - SWIPE_MIN_DISTANCE, 300))
    expect(here()).toBe('/home')
  })

  it('does not take the pointer, so the screen inside keeps its own capture', () => {
    render('/home', path => <OwnSwipe path={path} />)
    const captured = []
    surface().setPointerCapture = id => captured.push(id)
    act(() => pointer('pointerdown', inner(), 200, 300))
    expect(captured).toEqual([])
  })

  /* Taken on every press, the capture made Chrome (131+) deliver the click after a mouse press to
     the surface instead of the button under it: no button inside a screen answered a mouse. */
  it('takes the pointer only once a press turns into a swipe, so a plain click reaches its button', () => {
    render('/home')
    const captured = []
    surface().setPointerCapture = id => captured.push(id)
    act(() => pointer('pointerdown', surface(), 200, 300))
    act(() => pointer('pointerup', surface(), 200, 300))
    expect(captured).toEqual([])
    drag(-SWIPE_MIN_DISTANCE)
    expect(captured.length).toBe(1)
  })

  /* A touch swipe is followed by no click of its own, so the flag a committed one leaves behind
     stayed set — and the next tap to land somewhere this slider bails out of was swallowed by a
     gesture that had already ended. On the workout screen that read as buttons doing nothing. */
  it('does not swallow a later tap inside it because an earlier swipe committed', () => {
    render('/home', path => <OwnSwipe path={path} />)
    drag(-SWIPE_MIN_DISTANCE)
    expect(here()).toBe('/plan')
    const button = container.querySelector('[data-testid="inner-button"]')
    let clicked = false
    button.addEventListener('click', () => { clicked = true })
    act(() => pointer('pointerdown', button, 200, 300))
    act(() => pointer('pointerup', button, 200, 300))
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(clicked).toBe(true)
  })
})

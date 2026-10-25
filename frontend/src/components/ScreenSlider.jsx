import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { navDirection, swipeLock } from '../lib/swipe.js'
import { neighbourTab, screenDirection } from '../lib/screen-nav.js'
import { edgeOffset } from '../lib/slide.js'
import SlideDeck from './SlideDeck.jsx'

/**
 * Swipe sideways to walk along the tab bar — Home, Plan, Stats, Exercises — with the screen
 * you are going to arriving from the border and pushing the one you are leaving out.
 *
 * Any pointer drives it — a finger, a pen, or a mouse held down and dragged. Only the primary
 * button, and only past the distance in lib/swipe.js that tells a drag from a click, so an
 * ordinary press still lands on whatever it was aimed at. Everything else about *what* a drag
 * means is in lib/swipe.js and lib/screen-nav.js; this component is the wiring between the two
 * and the deck that draws the result.
 */

// Places a horizontal drag already means something else. Anything that actually scrolls
// sideways is found at run time instead of listed here, so a new strip needs no edit.
//
// `[data-owns-swipe]` marks a subtree that runs a horizontal gesture of its own — the workout's
// set-by-set deck. Those have to be left alone outright, not merely lose the race: the capture
// taken below replaces the one the inner surface just took for the same pointer, so every later
// move for that gesture is delivered to *this* element instead. The inner surface would see a
// `lostpointercapture` and no move at all, which is exactly what stopped the workout paging
// between sets with a finger.
const IGNORED_TARGETS = '.sld,input[type="range"],[data-swipe-ignore],[data-owns-swipe]'

function inSideScroller(target, root) {
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth - el.clientWidth > 1) {
      const overflow = getComputedStyle(el).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
  }
  return false
}

export default function ScreenSlider({ render }) {
  const loc = useLocation()
  const navigate = useNavigate()
  const navType = useNavigationType()
  const gesture = useRef(null)
  const surface = useRef(null)
  // Only if it is still held: releasing a capture the browser already took back throws, and
  // that would swallow the navigation this gesture just earned.
  const releaseCapture = id => {
    const el = surface.current
    if (el?.hasPointerCapture?.(id)) { try { el.releasePointerCapture(id) } catch { /* already gone */ } }
  }
  const swallowClick = useRef(false)
  // { dir, dx, target } once a drag has committed to the horizontal axis; null the rest of
  // the time, which is nearly always — an idle deck renders exactly one screen.
  const [drag, setDrag] = useState(null)

  const onPointerDown = event => {
    if ((event.button ?? 0) !== 0) return
    // A new press supersedes whatever was in flight rather than being turned away as a second
    // finger. A gesture whose pointer never reports again — the browser took it back, the
    // touch was cancelled without telling us — would otherwise leave this surface refusing
    // every later drag for as long as the page stayed open.
    if (gesture.current) { releaseCapture(gesture.current.id); gesture.current = null; setDrag(null) }
    // A fresh press makes any pending swallow stale, so it is dropped before this press can be
    // turned away below. A touch swipe is followed by no click at all, so the flag a committed
    // one leaves behind would otherwise sit there and eat the first tap that lands somewhere
    // this handler bails out of — a button inside the workout's own swipe surface, say.
    swallowClick.current = false
    if (event.target.closest?.(IGNORED_TARGETS) || inSideScroller(event.target, event.currentTarget)) return
    // No capture yet: taken here, every press belonged to the surface, and Chrome (131+) then
    // hands the click that follows a mouse press to the capturing element instead of the button
    // under it — so no button inside a screen answered a mouse. It is taken on the axis lock.
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: null }
  }

  const onPointerMove = event => {
    const start = gesture.current
    if (!start || start.id !== event.pointerId || start.mode === 'none') return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.mode) {
      const mode = swipeLock({ dx, dy, row: false })
      if (!mode) return
      start.mode = mode
      if (mode === 'none') return
      // The gesture has taken the drag over, so whatever it started on must not also be tapped.
      swallowClick.current = true
      // Capture keeps the moves coming when the finger wanders off the card. It throws for a
      // pointer the browser no longer holds, which must not leave a gesture half-started.
      try { surface.current?.setPointerCapture?.(event.pointerId) } catch { /* the window listener still ends it */ }
      // A mouse would otherwise paint a text selection across the screen as it drags. Cleared
      // on every move rather than once, so nothing is left highlighted behind the gesture.
      if (event.pointerType === 'mouse') window.getSelection?.()?.removeAllRanges()
      // Which screen is being pulled in is decided once, on the axis lock, and does not change
      // if the finger wanders back: a half-dragged neighbour that swapped sides mid-gesture
      // would mean mounting the other one too.
      const dir = dx < 0 ? 1 : -1
      start.dir = dir
      start.target = neighbourTab(loc.pathname, dir)
    }
    // Nothing on that side: follow the finger a little and no further, so the edge is felt
    // rather than the gesture just going dead.
    setDrag({ dir: start.dir, target: start.target, dx: start.target ? dx : edgeOffset(dx) })
  }

  // A committed swipe leaves the drag in place and lets the route change end it. The router
  // runs its navigation as a transition, so clearing the drag here as well would land in an
  // earlier render than the new route — the deck would read that as a cancelled gesture and
  // spring the screen back a frame before pushing it out again.
  useEffect(() => { setDrag(null) }, [loc.pathname])

  const finish = (event, commit) => {
    const start = gesture.current
    if (!start || start.id !== event.pointerId) return
    gesture.current = null
    releaseCapture(start.id)
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // Let go short of the threshold and it springs back — the deck animates the return.
    if (commit && start.target && start.mode === 'nav' && navDirection(dx, dy) === start.dir) {
      navigate(start.target)
      return
    }
    setDrag(null)
  }

  /* A gesture has to end even when its pointerup never reaches this surface — a finger lifted
     after the browser took the pointer back, a capture that never took, a touch the system
     cancelled. Without this the surface stayed armed for a gesture that was already over, and
     every later drag was turned away as if a second finger were down: one interrupted swipe
     and it stopped answering until the page was reloaded. The listener reads the handler
     through a ref because it outlives the render that made it. */
  const finishRef = useRef(null)
  useEffect(() => { finishRef.current = finish })
  useEffect(() => {
    const end = event => finishRef.current?.(event, event.type === 'pointerup')
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  return (
    <div className="screens" ref={surface}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={event => finish(event, true)}
      onPointerCancel={event => finish(event, false)}
      onLostPointerCapture={event => {
        if (gesture.current?.id === event.pointerId) { gesture.current = null; setDrag(null) }
      }}
      onClickCapture={event => {
        if (!swallowClick.current) return
        swallowClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}>
      <SlideDeck
        current={loc.pathname}
        peek={drag?.target ?? null}
        dir={drag?.dir ?? 0}
        dx={drag?.dx ?? 0}
        directionOf={(from, to) => screenDirection(from, to, navType === 'POP')}
        render={render}
        layerClass="app"
        freezeScroll
      />
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SLIDE_MS, TURN_MS, dragOffsets, settlePlan, turnStyle, turnVars } from '../lib/slide.js'

/**
 * Two screens that slide past each other: the one arriving comes in from a border and pushes
 * the one it replaces out the opposite side.
 *
 * The deck is only the *presentation* — it never decides what the gesture meant. Callers own
 * the pointer handling (they each have their own rules about what a horizontal drag competes
 * with) and drive the deck with four numbers: what is showing, what is being dragged into
 * view, which side that neighbour sits on, and how far the finger has travelled. Change
 * `current` and the deck animates the rest of the way from wherever the finger left off, so a
 * committed swipe is one continuous movement rather than a drag followed by a separate
 * animation. Tapping a tab, with no drag at all, lands in the same path with `from` at the
 * screen edge — one code path, one look.
 *
 * The neighbour is rendered for real, not faked, which is what makes it a push instead of a
 * reveal; callers only hand one over once the drag has committed to the horizontal axis, so
 * the cost of mounting it is paid on genuine intent and at most once per gesture.
 *
 * With `turn` the screens are faces of an upright cylinder instead of flat sheets: each tilts,
 * shrinks and dims as it leaves the front (turnFace in lib/slide.js), and the settle eases in
 * with the small overshoot of the set drum clicking into place.
 */

const viewportWidth = () => (typeof window === 'undefined' ? 0 : window.innerWidth || 0)

export default function SlideDeck({
  current,
  peek = null,          // the neighbour being dragged in, or null when no drag is in flight
  dir = 0,              // +1 when that neighbour lies to the right, -1 when it lies to the left
  dx = 0,               // how far the finger has travelled, in px
  directionOf,          // (from, to) => ±1, for navigations that no gesture drove
  render,               // (id, isPeek) => JSX
  layerClass = '',
  freezeScroll = false, // hold the outgoing layer where it was scrolled to (see below)
  turn = false,         // faces of a cylinder rather than flat sheets (see above)
  className = '',
}) {
  const [anim, setAnim] = useState(null)   // [{ id, from, to }] while the deck settles
  const last = useRef(null)                // what was on screen, and where, at the last settle
  const timer = useRef(null)
  const frozenTop = useRef(0)
  const scrolled = useRef(0)

  useLayoutEffect(() => () => clearTimeout(timer.current), [])

  /* Where the page was scrolled to, recorded as it happens rather than read when a screen is
     left. By then it is too late twice over: the shell scrolls a new route back to the top,
     and before even that the browser has clamped the old position to whatever the incoming
     screen is tall enough to allow — leaving a screen that was 600px down looking 100px down
     on its way out. */
  useEffect(() => {
    if (!freezeScroll) return
    const onScroll = () => { scrolled.current = window.scrollY || 0 }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [freezeScroll])

  // No dependency list: the deck reacts to *any* change of what it is showing, and the pieces
  // it compares against live in refs rather than in state.
  useLayoutEffect(() => {
    const before = last.current
    const width = viewportWidth()
    const settled = before && (before.current !== current || (before.peek !== peek && !anim))
    if (settled) {
      const plan = settlePlan(before, current, directionOf ? directionOf(before.current, current) : 0, width)
      if (plan) {
        // Hold the outgoing screen at the offset it was last seen scrolled to, so it leaves
        // looking the way it did rather than jumping to its top on the way out.
        frozenTop.current = freezeScroll ? scrolled.current : 0
        setAnim(plan)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setAnim(null), turn ? TURN_MS : SLIDE_MS)
        last.current = { current, peek: null, dir, offsets: Object.fromEntries(plan.map(l => [l.id, l.to])) }
        return
      }
    }
    if (anim) return   // mid-flight: the plan owns where each layer is, not the live drag
    last.current = { current, peek, dir, offsets: dragOffsets({ current, peek, dir, dx }, width) }
  })

  const width = viewportWidth()
  const offsets = anim ? null : dragOffsets({ current, peek, dir, dx }, width)
  const layers = anim
    ? anim.map(l => ({ id: l.id, style: turn ? turnVars(l.from, l.to, width) : { '--slide-from': l.from + 'px', '--slide-to': l.to + 'px' } }))
    : (peek != null && peek !== current ? [current, peek] : [current])
        .map(id => ({ id, style: turn ? turnStyle(offsets[id], width)
          : offsets[id] ? { transform: 'translateX(' + offsets[id] + 'px)' } : undefined }))

  return (
    <div className={'deck' + (turn ? ' deck-turn' : '') + (className ? ' ' + className : '')} data-testid="slide-deck">
      {layers.map(l => {
        const over = l.id !== current
        return (
          <div
            key={l.id}
            className={'deck-layer' + (layerClass ? ' ' + layerClass : '') + (over ? ' deck-over' : '') + (anim ? ' deck-sliding' : '')}
            style={over && anim && frozenTop.current ? { ...l.style, marginTop: -frozenTop.current } : l.style}
            aria-hidden={over || undefined}
            inert={over}
          >
            {render(l.id, over)}
          </div>
        )
      })}
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SLIDE_MS, TURN_MS, dragOffsets, settlePlan, turnBands, turnBend, turnStyle, turnVars } from '../lib/slide.js'
import { copyFace, followFace } from './faceCopy.js'

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
 * with the small overshoot of the set drum clicking into place. While one is away from the front it
 * is also *wrapped* round the cylinder rather than leaning as one flat card: drawn as upright
 * bands, each a picture of the screen placed on the curve on its own (turnBands), with the real
 * screen kept underneath, unseen, until it lands flat.
 */

const viewportWidth = () => (typeof window === 'undefined' ? 0 : window.innerWidth || 0)

// What of a screen shows in its picture: its style too, since a drum inside it moves by style.
const WATCH = ['class', 'style', 'value', 'aria-checked', 'aria-label', 'disabled', 'src']
const GHOST = /deck-layer|deck-over|deck-sliding|deck-ghost/g

/* The bands of one wrapped screen: each shows its own part of a picture of the real screen. */
function BentLayer({ id, bands, layerWidth }) {
  const hosts = useRef([])
  useLayoutEffect(() => {
    // The screen is found from the picture's own place, not through the deck's ref: on the deck's
    // first render a child's effect runs before its parent's ref is set.
    const src = hosts.current[0]?.closest('.deck')?.querySelector(`.deck-layer[data-deck-layer="${id}"]`)
    if (!src) return
    const fill = () => hosts.current.forEach(h => {
      if (!h) return
      copyFace(h, src, { keepStyle: true })
      h.className = 'deck-band-in ' + src.className.replace(GHOST, '').trim()
    })
    return followFace(src, fill, WATCH)
  }, [])
  return bands.map((b, j) => <div key={j} className={'deck-band' + (b.anim ? ' anim' : '')} style={b.style} aria-hidden="true">
    <div className="deck-band-in" ref={el => { hosts.current[j] = el }} inert style={{ left: -b.left, width: layerWidth }} />
  </div>)
}

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
  const deckEl = useRef(null)
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
    ? anim.map(l => ({ id: l.id, from: l.from, to: l.to, style: turn ? turnVars(l.from, l.to, width) : { '--slide-from': l.from + 'px', '--slide-to': l.to + 'px' } }))
    : (peek != null && peek !== current ? [current, peek] : [current])
        .map(id => ({ id, from: offsets[id] || 0, to: offsets[id] || 0, style: turn ? turnStyle(offsets[id], width)
          : offsets[id] ? { transform: 'translateX(' + offsets[id] + 'px)' } : undefined }))

  // The screens that are away from the front are drawn as bands round the cylinder (see above).
  const layerWidth = deckEl.current?.offsetWidth || width
  const bent = !turn ? [] : layers.flatMap(l => {
    if (!turnBend(l.from, width) && !turnBend(l.to, width)) return []
    const a = turnBands({ offset: l.from, width, layerWidth }), b = turnBands({ offset: l.to, width, layerWidth })
    const px = n => n + 'px'
    return [{
      id: l.id,
      bands: a.map((f, j) => {
        const t = b[j]
        return anim
          ? { anim: true, left: f.left, style: { left: f.left, width: f.width,
            '--fx': px(f.x), '--fz': px(f.z), '--fr': f.deg + 'deg', '--fs': f.scale, '--sf': f.shade,
            '--tx': px(t.x), '--tz': px(t.z), '--tr': t.deg + 'deg', '--ts': t.scale, '--st': t.shade } }
          : { left: f.left, style: { left: f.left, width: f.width, '--shade': f.shade, visibility: f.back ? 'hidden' : undefined,
            transform: `translate3d(${f.x}px,0,${f.z}px) rotateY(${f.deg}deg) scaleX(${f.scale})` } }
      }),
    }]
  })
  const ghosted = new Set(bent.map(b => b.id))

  return (
    <div className={'deck' + (turn ? ' deck-turn' : '') + (className ? ' ' + className : '')} data-testid="slide-deck" ref={deckEl}>
      {layers.map(l => {
        const over = l.id !== current
        return (
          <div
            key={l.id}
            className={'deck-layer' + (layerClass ? ' ' + layerClass : '') + (over ? ' deck-over' : '') + (anim ? ' deck-sliding' : '') + (ghosted.has(l.id) ? ' deck-ghost' : '')}
            data-deck-layer={l.id}
            style={over && anim && frozenTop.current ? { ...l.style, marginTop: -frozenTop.current } : l.style}
            aria-hidden={over || undefined}
            inert={over}
          >
            {render(l.id, over)}
          </div>
        )
      })}
      {bent.length > 0 && <div className="deck-bands">
        {bent.map(b => <BentLayer key={b.id} id={b.id} bands={b.bands} layerWidth={layerWidth} />)}
      </div>}
    </div>
  )
}

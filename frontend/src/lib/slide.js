/**
 * The arithmetic behind a sliding screen transition: two layers that move past each other,
 * one entering from a border while the one it replaces is pushed out the opposite side.
 *
 * Kept here, away from the DOM, because every awkward case is a matter of *which offset each
 * layer starts and ends at* — a drag let go halfway, a drag cancelled short of the threshold,
 * a plain tap with no drag at all — and those are far easier to pin with numbers than by
 * dragging a finger across a phone.
 *
 * One convention throughout: a **direction of +1 means the other screen lies to the right**,
 * so reaching it drags the content leftwards. That matches `navDirection` in swipe.js and the
 * platform habit — swipe left for the next thing, right for the previous one.
 */

/** How long a settle animation runs. Mirrored by `--slide` in index.css. */
export const SLIDE_MS = 280

/**
 * Where each layer sits, in px, while a finger is down. `peek` is the neighbour rendered
 * alongside the current screen so the two really travel together; it is null when the drag has
 * not committed to an axis yet, or when there is nothing on that side to go to.
 */
export function dragOffsets({ current, peek, dir, dx }, width) {
  const offsets = { [current]: dx }
  if (peek != null && peek !== current) offsets[peek] = dir * width + dx
  return offsets
}

/**
 * The animation that finishes the gesture, as one `{ id, from, to }` per layer — `from` is
 * wherever the finger left it, so the slide continues the drag instead of restarting it.
 *
 * `prev` is the state the deck was in (current/peek/dir plus the offsets last rendered) and
 * `nextCurrent` is what it settles on: the peek when the swipe committed, the same screen
 * again when it was cancelled or let go short. `tapDir` covers the gestureless case — a tab
 * pressed in the tab bar — where there is no peek to take the direction from.
 *
 * Returns null when there is nothing to animate, so a same-place navigation stays still.
 */
export function settlePlan(prev, nextCurrent, tapDir, width) {
  const at = id => prev.offsets?.[id]
  let layers
  if (nextCurrent === prev.current) {
    // Cancelled: the neighbour goes back where it came from, the current screen springs home.
    if (prev.peek == null || prev.peek === prev.current) return null
    layers = [
      { id: prev.current, from: at(prev.current) ?? 0, to: 0 },
      { id: prev.peek, from: at(prev.peek) ?? prev.dir * width, to: prev.dir * width },
    ]
  } else {
    // Committed. The screen being left is pushed out the side opposite the one arriving.
    const dir = prev.peek === nextCurrent ? prev.dir : tapDir
    if (!dir) return null
    layers = [
      { id: prev.current, from: at(prev.current) ?? 0, to: -dir * width },
      { id: nextCurrent, from: at(nextCurrent) ?? dir * width, to: 0 },
    ]
  }
  return layers.every(l => l.from === l.to) ? null : layers
}

/**
 * The workout's exercises turn rather than slide: each screen is a face of an upright cylinder,
 * the horizontal twin of the set drum (lib/drum.js). The face in front is square on; as it
 * travels sideways it turns round the curve, shrinks a little and catches less light, while the
 * one arriving does the reverse — the same "one leaves as the other grows" the drum does between
 * sets, laid on its side.
 *
 * Every quantity is linear in how far a face is from the front, so the CSS animation that
 * settles the deck (`deck-turn` in index.css, which interpolates each function between its two
 * ends) traces exactly the faces a finger would have drawn on the way.
 */
export const TURN_MS = 380            // mirrored by `--turn` in index.css
export const TURN_DEG = 38            // tilt of a face a full screen away from the front
export const TURN_SHRINK = 0.1        // and how much smaller it is drawn
export const TURN_DIM = 0.35          // and how much light it has lost
export const TURN_PERSPECTIVE = 1100  // px

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d

/** The face drawn `offset` px from the front of a deck `width` px wide. */
export function turnFace(offset, width) {
  const f = width > 0 ? Math.max(-1.2, Math.min(1.2, offset / width)) : 0
  return {
    x: offset,
    // Moving left the face turns round the cylinder's left side: its left edge recedes.
    deg: round(f * TURN_DEG),
    scale: round(1 - TURN_SHRINK * Math.abs(f)),
    opacity: round(Math.max(0, 1 - TURN_DIM * Math.abs(f))),
  }
}

/** The face as an inline style while a finger holds it, or undefined at rest. */
export function turnStyle(offset, width) {
  if (!offset) return undefined
  const { x, deg, scale, opacity } = turnFace(offset, width)
  return {
    transform: `perspective(${TURN_PERSPECTIVE}px) translateX(${x}px) rotateY(${deg}deg) scale(${scale})`,
    opacity,
  }
}

/** Both ends of a settle as the custom properties `deck-turn` animates between. */
export function turnVars(from, to, width) {
  const a = turnFace(from, width), b = turnFace(to, width)
  return {
    '--slide-from': from + 'px', '--slide-to': to + 'px',
    '--turn-from': a.deg + 'deg', '--turn-to': b.deg + 'deg',
    '--scale-from': a.scale, '--scale-to': b.scale,
    '--fade-from': a.opacity, '--fade-to': b.opacity,
  }
}

/**
 * While the deck turns, a screen is not a flat sheet that leans: it is wrapped round the cylinder,
 * like the set drum's chambers (drumFace in lib/drum.js) on their side. The screen is cut into
 * `TURN_BANDS` upright bands and each is placed on the circle on its own, so the middle of it faces
 * you and the sides fall away and shrink — the curve of the drum, not a card tipped on its edge.
 * A screen at rest is the flat page you read and press, so the wrap only builds as it moves off
 * the front (`TURN_BEND` of a screen's width), and is flat again, seamlessly, when it lands.
 */
export const TURN_BANDS = 12
export const TURN_RADIUS = 1.15   // of the cylinder, in screen widths
export const TURN_BEND = 0.15     // of a screen's width, to wrap fully

/** How wrapped a screen `offset` px from the front is, 0..1. */
export function turnBend(offset, width) {
  return width > 0 ? Math.max(0, Math.min(1, Math.abs(offset) / (width * TURN_BEND))) : 0
}

/**
 * The bands of a screen `layerWidth` px wide whose middle is `offset` px from the front of a deck
 * `width` px wide. Per band: where it sits in its layer (`left`, `width`, a little over its share
 * so none shows a seam) and how it is moved from there — `x`, `z` px, `deg`, `scale` (across) —
 * plus `shade`, how far it has fallen into the page's colour, and `back` when it has turned past
 * the side of the cylinder. Wrapped, the bands' edges sit on the circle and tile it end to end;
 * unwrapped they are the flat screen, `x` being the offset itself.
 */
export function turnBands({ offset, width, layerWidth = width, bands = TURN_BANDS, overlap = 1, bend }) {
  if (!(width > 0) || !(layerWidth > 0)) return []
  const R = TURN_RADIUS * width
  const k = bend ?? turnBend(offset, width)
  const share = layerWidth / bands
  const step = share / R
  const chord = 2 * R * Math.sin(step / 2)
  const dist = R * Math.cos(step / 2)
  const mix = (flat, bent) => flat + (bent - flat) * k
  return Array.from({ length: bands }, (_, j) => {
    const u = (j + 0.5) * share - layerWidth / 2       // the band's middle, from its layer's
    const at = (offset + u) / R
    return {
      left: j * share - overlap, width: share + 2 * overlap,
      x: mix(offset, dist * Math.sin(at) - u),
      z: mix(0, dist * Math.cos(at) - R),
      deg: mix(0, at * 180 / Math.PI),
      scale: mix(1, chord / share),
      shade: k * (1 - Math.max(0, Math.cos(at)) ** 0.7),
      back: Math.abs(at) + step / 2 > Math.PI / 2 - 0.02,
    }
  })
}

/**
 * A drag with nowhere to go — the first screen swiped further back, the last one further on —
 * still has to answer the finger, or the gesture reads as broken. It follows at a fraction of
 * the distance and stops well short of uncovering the page, the way a list rubber-bands at its
 * end rather than refusing to move.
 */
export const EDGE_RESIST = 0.3
export const EDGE_MAX = 56

export function edgeOffset(dx) {
  const pulled = dx * EDGE_RESIST
  return Math.max(-EDGE_MAX, Math.min(EDGE_MAX, pulled))
}

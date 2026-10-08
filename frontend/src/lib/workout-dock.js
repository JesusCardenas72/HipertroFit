import { supersetUnits } from './history.js'
import { dropActiveWorkoutEntry } from './active-workout-order.js'

/**
 * The workout dock: the strip of exercise thumbnails under the session, one entry per
 * thumbnail, grouped into a coloured capsule wherever consecutive entries are supersetted.
 *
 * Everything here is pure — the geometry the strip measures comes in as plain numbers — so the
 * grouping, the colour assignment and the drop-slot arithmetic can be pinned by tests instead
 * of by dragging a thumbnail across a phone.
 */

// Hues far enough apart that two capsules on screen never read as the same group. Kept as
// hues rather than finished colours so the capsule can mix its own tint/border/ring from one
// number and stay legible in both themes.
export const SUPERSET_HUES = [212, 145, 32, 280, 0, 190, 96, 328]

/** Stable small hash of a superset id — the same group keeps its colour across a reload. */
export function hashSg(sg) {
  const text = String(sg ?? '')
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

/**
 * One item per display unit, in session order:
 * `{ position, indices, sg, hue, done }`. `sg`/`hue` are null unless the unit is a superset.
 *
 * Colours are handed out by order of appearance rather than straight from the hash, so two
 * supersets in the same session are always different colours; the starting point of the walk
 * comes from the first group's id, which is what makes the palette look arbitrary from one
 * session to the next instead of always opening on the same blue.
 */
export function dockItems(entries) {
  const list = Array.isArray(entries) ? entries : []
  const units = supersetUnits(list)
  const groups = []
  units.forEach(unit => {
    const sg = unit.length > 1 ? list[unit[0]]?.sg : null
    if (sg && !groups.includes(sg)) groups.push(sg)
  })
  const offset = groups.length ? hashSg(groups[0]) : 0
  return units.map((indices, position) => {
    const sg = indices.length > 1 ? (list[indices[0]]?.sg ?? null) : null
    return {
      position,
      indices,
      sg,
      hue: sg ? SUPERSET_HUES[(offset + groups.indexOf(sg)) % SUPERSET_HUES.length] : null,
      done: unitDone(list, indices),
    }
  })
}

/**
 * A stable name for each entry that survives a reorder, so whatever draws it can glide from
 * where it was to where it landed: the exercise id plus which occurrence of it this is.
 */
export function dockKeys(entries) {
  const seen = {}
  return (Array.isArray(entries) ? entries : []).map(e => {
    seen[e.id] = (seen[e.id] || 0) + 1
    return e.id + '#' + seen[e.id]
  })
}

/**
 * The hue of the capsule dropping entry `index` with `intent` (`{ slot, join }`) would make, so
 * the drop can wear it while it is still being dragged. Falls back to the first hue.
 */
export function joinHue(entries, index, intent) {
  const copy = { cur: 0, entries: (Array.isArray(entries) ? entries : []).map(e => ({ ...e })) }
  const moving = copy.entries[index]
  if (!moving || !dropActiveWorkoutEntry(copy, index, intent)) return SUPERSET_HUES[0]
  const at = copy.entries.indexOf(moving)
  return dockItems(copy.entries).find(item => item.indices.includes(at))?.hue ?? SUPERSET_HUES[0]
}

/** A unit is done when every set of every exercise in it is checked off. A routine's
 * exercises carry a planned set count rather than logged sets, so they are never done. */
export function unitDone(entries, indices) {
  const list = Array.isArray(entries) ? entries : []
  const sets = indices.flatMap(index => Array.isArray(list[index]?.sets) ? list[index].sets : [])
  return sets.length > 0 && sets.every(set => set.done)
}

// The middle of a thumbnail, as a share of its width either side of the centre: let go there
// and the dragged exercise supersets with it.
export const DOCK_CORE = 0.35
// How far past its resting place beside its own superset a member can be pulled and still be
// held — the stretch the capsule takes before it snaps (lib/dock-physics.js necks down over the
// same distance).
export const DOCK_STICK = 56

/**
 * What letting go of a dragged thumbnail at `x` means. `thumbs` are the other thumbnails in
 * strip order as `{ index, sg, left, right }`; `ownSg` is the dragged entry's superset id.
 *
 * Returns `{ slot, join }`: `slot` is where the entry lands among `thumbs`, `join` the entry
 * index it ends up supersetted with, or null to stand alone. Over a thumbnail's middle it joins
 * that exercise (or its superset); in the gap inside a capsule it joins that capsule; near its
 * own capsule it sticks to it; anywhere else it stands alone.
 */
export function dockIntent(thumbs, x, ownSg = null, stick = DOCK_STICK) {
  const centre = thumb => (thumb.left + thumb.right) / 2
  let core = null
  for (let i = 0; i < thumbs.length && !core; i++) {
    const thumb = thumbs[i]
    if (Math.abs(x - centre(thumb)) <= (thumb.right - thumb.left) * DOCK_CORE) {
      core = { thumb, intent: { slot: x < centre(thumb) ? i : i + 1, join: thumb.index } }
    }
  }
  if (core && (!ownSg || core.thumb.sg === ownSg)) return core.intent
  const slot = thumbs.reduce((count, thumb) => count + (x > centre(thumb) ? 1 : 0), 0)
  const left = thumbs[slot - 1]
  const right = thumbs[slot]
  // Its own capsule holds on first, even over a neighbour: leaving takes a real pull. Measured
  // from beside the mate, where the dragged thumbnail would sit: half a thumbnail out.
  if (ownSg && left?.sg === ownSg && x - left.right <= (left.right - left.left) / 2 + stick) return { slot, join: left.index }
  if (ownSg && right?.sg === ownSg && right.left - x <= (right.right - right.left) / 2 + stick) return { slot, join: right.index }
  if (core) return core.intent
  if (left?.sg && left.sg === right?.sg) return { slot, join: left.index }
  return { slot, join: null }
}

/**
 * Which gap a thumbnail dropped at `x` belongs in. `centers` are the horizontal midpoints of
 * the units still in the strip (the dragged one removed), so the answer is already a slot in
 * the same "after the source is lifted out" numbering `reorderRoutineUnit` expects.
 */
export function dropSlot(centers, x) {
  return centers.reduce((count, center) => count + (x > center ? 1 : 0), 0)
}

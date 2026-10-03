/**
 * Horizontal swipe gestures inside a workout (issue: swipe to delete a set / change exercise).
 *
 * Two gestures share one surface, so the decision of which one a drag *is* lives here as pure
 * functions rather than inside the pointer handlers: a rightward drag that started on a
 * removable set row peels that row open to a red delete track, anything else horizontal pages
 * between exercises. Everything below is plain arithmetic on a delta — no DOM, no React — so
 * the thresholds can be pinned by a test instead of by dragging a finger across a phone.
 */

/** How far a drag has to travel before it commits to being horizontal at all. */
export const SWIPE_LOCK_DISTANCE = 12
/** How far a *navigation* swipe has to travel to page to the next/previous exercise. */
export const SWIPE_MIN_DISTANCE = 48
/** Horizontal has to beat vertical by this much — a diagonal scroll stays a scroll. */
export const SWIPE_AXIS_RATIO = 1.25
/** How far a set row has to be pulled right before letting go deletes it. */
export const ROW_DELETE_DISTANCE = 96
/** The row stops following the finger here, so the track can't be pulled off-screen. */
export const ROW_MAX_OFFSET = 132

/**
 * What a drag has turned into, given how far it has moved so far.
 * `row` is truthy when the drag started on a set row that can actually be removed.
 *
 * Returns `'row'` (peel the row open), `'nav'` (page between exercises), `'none'` (a vertical
 * scroll — leave it to the browser) or `null` while the drag is still too small to call.
 */
export function swipeLock({ dx, dy, row }) {
  if (Math.abs(dy) >= SWIPE_LOCK_DISTANCE && Math.abs(dy) > Math.abs(dx)) return 'none'
  if (Math.abs(dx) < SWIPE_LOCK_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return null
  return row && dx > 0 ? 'row' : 'nav'
}

/** How far the row is drawn from its resting place: rightwards only, and never past the track. */
export function rowOffset(dx) {
  return Math.min(ROW_MAX_OFFSET, Math.max(0, dx))
}

/** Whether letting go at this offset deletes the set (the track turns solid red when it does). */
export function rowArmed(dx) {
  return rowOffset(dx) >= ROW_DELETE_DISTANCE
}

/**
 * Which way a navigation swipe goes: +1 for the next thing, -1 for the previous one, 0 when
 * the drag was too short or too diagonal to count.
 *
 * Dragging *left* moves forward, which is the platform habit on both phones and the only
 * direction that survives an animation: the next screen has to arrive from the right border,
 * so the finger has to be travelling that way. (An earlier version of this had it the other
 * way round, matching the Prev/Next buttons' positions rather than the motion.)
 */
export function navDirection(dx, dy = 0) {
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return 0
  return dx < 0 ? 1 : -1
}

/** A quick flick pages even short of SWIPE_MIN_DISTANCE, as the set drum does (px/ms). */
export const SWIPE_FLICK = 0.5

/**
 * Whether letting go of a navigation drag towards `dir` (+1 next, -1 previous) pages there.
 * `v` is the finger's horizontal speed as it left, in px/ms (0 when it had stopped). Far enough
 * pages, unless the finger was flicking back the other way; short of it, a flick the right way
 * still pages — the drag only has to have gone the right way at all.
 */
export function navCommit({ dx, dy = 0, v = 0, dir }) {
  if (!dir) return false
  const flick = Math.abs(v) >= SWIPE_FLICK ? (v < 0 ? 1 : -1) : 0
  if (flick === -dir) return false
  if (navDirection(dx, dy) === dir) return true
  return flick === dir && Math.sign(-dx) === dir && Math.abs(dx) >= SWIPE_LOCK_DISTANCE
}

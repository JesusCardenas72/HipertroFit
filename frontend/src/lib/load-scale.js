// The weights an exercise can actually be loaded with.
//
// A barbell or a plate-loaded machine moves in multiples of its increment — 2.5, 5, 7.5… —
// so a plain number has always been enough to describe it. A set of adjustable dumbbells does
// not start at nothing: the handle is already 4 kg and every click adds 1.5 kg, so the loads
// that exist are 4, 5.5, 7, 8.5… and rounding to multiples of 1.5 lands between them (7.5 kg is
// not a weight those dumbbells have). That is a ladder: a first rung and the gap between rungs.
//
// Everything that rounds a load (the set steppers, the progression engine, warm-up ramps,
// deloads, set-by-set targets) takes a `scale`, which is either the plain number it always was
// or a ladder `{ from, step }`. A number keeps behaving exactly as before.

export const ADJUSTABLE_DUMBBELLS = { from: 4, step: 1.5 }

const round2 = v => Math.round(v * 100) / 100

/** The exercise's ladder, `{ from, step }`, when it is set up for adjustable dumbbells; else null. */
export function ladderOf(cfg) {
  const a = cfg && cfg.adj
  if (!a) return null
  const from = Number(a.from), step = Number(a.step)
  return from > 0 && step > 0 ? { from, step } : null
}

/** The gap between two loadable weights: the ladder's step, or the plain number. */
export const stepOf = scale => (scale && typeof scale === 'object' ? scale.step : scale)

/** The lightest weight the scale can load: the ladder's first rung, or one step. */
export const minLoadOf = scale => (scale && typeof scale === 'object' ? scale.from : scale)

/**
 * `v` rounded onto the scale — 'round' to the nearest loadable weight, 'floor' to the one at or
 * below it. On a ladder nothing lands under the first rung: there is no lighter dumbbell to pick.
 * 0 (and anything not a positive number) stays 0 on a ladder, since 0 means "no load logged".
 */
export function snapLoad(v, scale, how = 'round') {
  const fn = how === 'floor' ? Math.floor : Math.round
  if (scale && typeof scale === 'object') {
    const { from, step } = scale
    if (!(v > 0)) return 0
    if (v <= from) return from
    // The tiny epsilon keeps a floor of 8.5 on a 1.5 ladder from 4 at 8.5, not 7 (binary noise).
    return round2(from + fn((v - from) / step + (how === 'floor' ? 1e-9 : 0)) * step)
  }
  if (!(scale > 0)) return Math.round(v * 10) / 10
  return Math.round(fn(v / scale + (how === 'floor' ? 1e-9 : 0)) * scale * 10) / 10
}

/**
 * One stepper tap from `v`. A plain number adds or takes away the step, never below 0, as the
 * steppers always did. On a ladder the tap moves to the next rung in that direction: up from
 * nothing is the first rung, a weight between rungs (typed by hand, or logged before) goes to
 * the rung on that side of it, and down from the first rung stays there.
 */
export function stepLoad(v, dir, scale) {
  const cur = Number(v) || 0
  if (!(scale && typeof scale === 'object')) return Math.max(0, round2(cur + dir * (Number(scale) || 0)))
  const { from, step } = scale
  if (dir > 0) {
    if (cur < from) return from
    return round2(from + (Math.floor((cur - from) / step + 1e-9) + 1) * step)
  }
  if (cur <= from) return cur > 0 ? from : 0
  return round2(from + (Math.ceil((cur - from) / step - 1e-9) - 1) * step)
}

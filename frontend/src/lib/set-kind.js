// What one row of a session is, as the set sheet's top bar names it: a normal work set, a
// warm-up, a set taken to failure or a drop-set (a rest-pause row keeps its own kind — the bar
// has no tab for it, so it stays as it is until another tab is picked).
//
// A warm-up is prep: it counts for no volume, record or progression (isWarmupRow everywhere
// else), so turning a row into one strips what only a work set carries — its drops, bursts,
// effort and failure mark.
import { isWarmupRow, isDropSet, isRestPauseSet, clustersOf, nextDropWeight } from './workout-model.js'

export const SET_KINDS = ['normal', 'warmup', 'failure', 'drop']
// The live drop cuts this much off the weight before it, with no rest in between.
export const DROP_PCT = 25

const objectOf = s => (s && typeof s === 'object' ? s : {})

export function setKindOf(set) {
  if (isWarmupRow(set)) return 'warmup'
  if (isDropSet(set)) return 'drop'
  if (isRestPauseSet(set)) return 'restpause'
  return objectOf(set).fail === true ? 'failure' : 'normal'
}

/**
 * The row re-made as `kind`, keeping its numbers and whether it was ticked off.
 * `dropWeight` is the first drop's weight when the row becomes a drop-set without one (the
 * caller snaps it to what the exercise can load; DROP_PCT lighter by default). `failure` is the
 * effort a set to failure logs — { f: 'rir', v: 0 } or { f: 'rpe', v: 10 } — written only when
 * the row has none of its own.
 */
export function withSetKind(set, kind, { dropWeight, failure } = {}) {
  const src = objectOf(set)
  if (setKindOf(src) === kind) return src
  const { phase, warmup, type, drops, clusters, fail, ...rest } = src
  // A rest-pause row's reps are the total across its bursts; leaving it gives back the
  // activation set's own reps.
  if (isRestPauseSet(src)) rest.r = Math.max(0, (Number(src.r) || 0) - clustersOf(src).reduce((n, c) => n + (Number(c?.r) || 0), 0))
  if (kind === 'warmup') {
    delete rest.rir; delete rest.rpe
    return { ...rest, phase: 'warmup', warmup: true }
  }
  if (kind === 'failure') {
    const out = { ...rest, fail: true }
    if (failure && failure.f && out[failure.f] == null) out[failure.f] = failure.v
    return out
  }
  if (kind === 'drop') {
    const w = dropWeight ?? nextDropWeight(rest.w, DROP_PCT)
    return { ...rest, type: 'dropset', drops: [{ w, r: Number(rest.r) || 0 }] }
  }
  return rest
}

/** How much lighter a drop is than the weight before it, as a whole percentage (25 for 60 → 45). */
export function dropCutPct(before, w) {
  const b = Number(before) || 0
  return b > 0 ? Math.round((1 - (Number(w) || 0) / b) * 100) : 0
}

/**
 * A drop-set's first drop after its set's weight changed from `was`: still the same cut off the
 * new weight while it is the one the cut gave the old weight — a drop typed by hand stays put.
 */
export function followDrop(set, was, pct = DROP_PCT) {
  const src = objectOf(set)
  const first = isDropSet(src) && Array.isArray(src.drops) ? src.drops[0] : null
  if (!first || first.w !== nextDropWeight(was, pct)) return src
  return { ...src, drops: [{ ...first, w: nextDropWeight(src.w, pct) }, ...src.drops.slice(1)] }
}

const round2 = v => Math.round(v * 100) / 100

/**
 * The values one wheel of the set sheet turns through: 0 up to `max` (or further, when the
 * current value is past it) in `step`s — or the rungs of a ladder { from, step } — with the
 * current value slotted in even when it is off the grid, so opening the sheet never moves it.
 * `empty` puts a "nothing logged" (null) first, for the optional effort wheel.
 */
export function wheelValues(cur, { step = 1, min = 0, max = 100, empty = false } = {}) {
  const ladder = step && typeof step === 'object' ? step : null
  const by = ladder ? ladder.step : Number(step) || 1
  const c = Number(cur)
  const top = Number.isFinite(c) && c > max ? c : max
  const out = []
  if (ladder) out.push(0)
  for (let v = ladder ? ladder.from : min; v <= top + 1e-9 && out.length < 2000; v = round2(v + by)) out.push(round2(v))
  if (cur != null && cur !== '' && Number.isFinite(c) && !out.includes(c)) {
    out.push(c)
    out.sort((a, b) => a - b)
  }
  return empty ? [null, ...out] : out
}

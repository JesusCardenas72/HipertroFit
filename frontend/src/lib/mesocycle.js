// The mesocycle: a run of loading microcycles closed by a deload one.
//
// Progressive overload cannot run forever. After three microcycles of pushing, the app
// suggests making the next one a deload; the suggestion can be taken now or put off to the
// following microcycle, where it is raised again. Five effective microcycles in a row is the
// ceiling — past that the deload stops being a suggestion. See the periodizacion-mesociclo
// note.
//
// A deload microcycle is not a rest: it is the same sessions with 25–50% less work. The app
// proposes the cut and the user sets it per session (`pct` here is only the remembered
// default), which is why applyDeload takes the percentage rather than owning it.
//
// Microcycles are identified by their index from the block start (lib/microcycle.js), so
// nothing here needs to be recomputed when a session is logged — the count moves on its own.

import { cyclePosition } from './microcycle.js'
import { isWarmupRow } from './workout-model.js'

/** Loading microcycles after which a deload is suggested. */
export const DELOAD_AFTER = 3
/** Loading microcycles after which it stops being a suggestion. */
export const DELOAD_MAX = 5
/** The cut a deload microcycle applies: a quarter to a half, proposed at 40%. */
export const DELOAD_PCT = { min: 0.25, max: 0.5, def: 0.4 }

/** A fresh mesocycle record: nothing deloaded, nothing postponed. */
export const emptyMeso = () => ({ deloads: [], postponed: [], notified: [], pct: DELOAD_PCT.def })

/** S.meso, defaulted and sanity-checked — old states have no such key at all. */
export function mesoOf(S) {
  const m = (S && S.meso) || {}
  const pct = Number(m.pct)
  return {
    deloads: Array.isArray(m.deloads) ? m.deloads.filter(Number.isInteger) : [],
    postponed: Array.isArray(m.postponed) ? m.postponed.filter(Number.isInteger) : [],
    // Deload microcycles whose start the user has already been told about (deloadNotice).
    notified: Array.isArray(m.notified) ? m.notified.filter(Number.isInteger) : [],
    pct: pct >= DELOAD_PCT.min && pct <= DELOAD_PCT.max ? pct : DELOAD_PCT.def,
  }
}

/** Whether a given microcycle index is (or is planned as) a deload. */
export const isDeloadCycle = (S, cycle) => mesoOf(S).deloads.includes(cycle)

/**
 * Where the mesocycle stands.
 *
 * `streak` counts the loading microcycles closed since the last deload — the deload itself
 * resets it. `target` is the microcycle an "accept" would mark: the current one when it has
 * not started yet, otherwise the next, since a block already half-trained at full load is
 * not a deload any more.
 */
export function mesoState(S) {
  const { cycle, step, len, remaining } = cyclePosition(S)
  const meso = mesoOf(S)
  const before = meso.deloads.filter(d => d < cycle)
  const streak = cycle - (before.length ? Math.max(...before) : -1) - 1
  const current = meso.deloads.includes(cycle)
  const target = step === 0 ? cycle : cycle + 1
  const scheduled = current || meso.deloads.includes(cycle + 1)
  const mandatory = !scheduled && streak >= DELOAD_MAX
  const postponedHere = meso.postponed.includes(cycle)
  return {
    cycle, step, len, remaining, streak, target,
    deload: current,                 // the microcycle being trained right now is the deload
    next: meso.deloads.includes(cycle + 1), // the one after this is already marked as a deload
    scheduled,                       // this one or the next is already marked
    mandatory,
    suggest: !scheduled && streak >= DELOAD_AFTER && (mandatory || !postponedHere),
    pct: meso.pct,
  }
}

/** Take the suggestion: mark the next microcycle to start as the deload. */
export function acceptDeload(S) {
  const meso = mesoOf(S)
  const { target } = mesoState(S)
  if (meso.deloads.includes(target)) return meso
  return { ...meso, deloads: [...meso.deloads, target].sort((a, b) => a - b) }
}

/** Put it off: the same suggestion is raised again when the next microcycle opens. */
export function postponeDeload(S) {
  const meso = mesoOf(S)
  const { cycle } = mesoState(S)
  if (meso.postponed.includes(cycle)) return meso
  return { ...meso, postponed: [...meso.postponed, cycle] }
}

const addCycle = (meso, c) => (meso.deloads.includes(c) ? meso : { ...meso, deloads: [...meso.deloads, c].sort((a, b) => a - b) })

/**
 * Force the deload on the microcycle being trained right now — at its start or half-way
 * through. Sessions already logged in it keep the load they were trained at; every session
 * started from here on comes down. No suggestion or streak is needed: it is the user's call.
 */
export function forceDeloadNow(S) {
  return addCycle(mesoOf(S), cyclePosition(S).cycle)
}

/** Force the deload on the microcycle after this one, whatever the streak says. */
export function forceDeloadNext(S) {
  return addCycle(mesoOf(S), cyclePosition(S).cycle + 1)
}

/**
 * Take a deload back: the current microcycle and the next one, whichever are marked. A
 * cancelled deload is never asked about again for the same microcycle — it is postponed.
 */
export function cancelDeload(S) {
  const meso = mesoOf(S)
  const { cycle } = cyclePosition(S)
  return {
    ...meso,
    deloads: meso.deloads.filter(d => d !== cycle && d !== cycle + 1),
    postponed: meso.postponed.includes(cycle) ? meso.postponed : [...meso.postponed, cycle],
  }
}

/**
 * Leave the deload being trained, at any point of it: the rest of this microcycle goes back
 * to full load. Sessions already trained as a deload stay deloads in the log. It is not
 * suggested again for the same microcycle (postponed); one already marked for the next
 * microcycle is left alone — that is a separate decision, taken back with cancelDeload.
 */
export function exitDeload(S) {
  const meso = mesoOf(S)
  const { cycle } = cyclePosition(S)
  return {
    ...meso,
    deloads: meso.deloads.filter(d => d !== cycle),
    postponed: meso.postponed.includes(cycle) ? meso.postponed : [...meso.postponed, cycle],
  }
}

/**
 * The deload microcycle to announce, or null. A deload is announced once, the first time the
 * app sees it running — whether it arrived on schedule or was forced half-way through.
 */
export function deloadNotice(S) {
  const { cycle } = cyclePosition(S)
  const meso = mesoOf(S)
  return meso.deloads.includes(cycle) && !meso.notified.includes(cycle) ? cycle : null
}

/** Record that the running deload has been announced. */
export function markDeloadNotified(S) {
  const meso = mesoOf(S)
  const { cycle } = cyclePosition(S)
  return meso.notified.includes(cycle) ? meso : { ...meso, notified: [...meso.notified, cycle] }
}

/**
 * Whether a logged (or running) session was a deload: one started with a deload cut. A routine
 * merely kept out of progression is not shown as one — that switch says nothing about the load
 * actually trained, and reading it as a deload painted full-load sessions as deloads.
 */
export const isDeloadWorkout = w => !!w && Number(w.deload) > 0

/** Remember the cut the user actually chose, as the proposal for the next session. */
export function setDeloadPct(S, pct) {
  const v = Math.min(DELOAD_PCT.max, Math.max(DELOAD_PCT.min, Number(pct) || DELOAD_PCT.def))
  return { ...mesoOf(S), pct: v }
}

// Weight rounded to something loadable: the exercise's own increment, never down to nothing.
const roundLoad = (w, step) => {
  if (!(w > 0)) return w || 0
  const s = step > 0 ? step : 2.5
  return Math.max(s, Math.round(w / s) * s)
}

/**
 * Apply a deload cut to the rows of one exercise: less weight, fewer reps, fewer sets.
 *
 * Warm-ups keep their reps but follow the weight down, so the ramp still lands on the work
 * weight instead of overshooting it. Logged rows are never touched — a session being
 * deloaded mid-way keeps what it already did.
 */
export function applyDeload(sets, pct, step = 2.5) {
  const f = 1 - Math.min(DELOAD_PCT.max, Math.max(DELOAD_PCT.min, Number(pct) || 0))
  const cut = (v, min) => (v > 0 ? Math.max(min, Math.round(v * f)) : v || 0)
  const scaled = (sets || []).map(s => {
    if (s.done) return s
    const warm = isWarmupRow(s)
    const o = { ...s }
    if (o.w != null) o.w = roundLoad(o.w * f, step)
    if (warm) return o
    if (o.r != null) o.r = cut(o.r, 1)
    if (o.sec != null) o.sec = cut(o.sec, 5)
    if (o.min != null) o.min = cut(o.min, 1)
    return o
  })
  // Then the set count itself, dropping from the end so the first work sets survive.
  const work = scaled.filter(s => !isWarmupRow(s))
  const keep = Math.max(1, Math.round(work.length * f))
  if (keep >= work.length) return scaled
  const drop = new Set(work.slice(keep).filter(s => !s.done))
  return scaled.filter(s => !drop.has(s))
}

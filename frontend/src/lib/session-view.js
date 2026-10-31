import { dockItems, dockIntent, dropSlot } from './workout-dock.js'
import { isWarmupRow } from './workout-model.js'
import { FORMULAS, DEFAULT_FORMULA, REP_CAP, best1RM } from './onerm.js'
import { restSecFor, restSecAfterSet } from './supersetFlow.js'
import { restBetweenExercisesSec, exerciseRestChoice } from './rest-between.js'

/**
 * The "Session" view of a running workout: every exercise in one column, with a rail of
 * thumbnails down the side and a coloured bar joining the members of each superset.
 *
 * Everything here only reads — the view logs sets through the same handlers as the drum, the
 * list and the table, so choosing it changes how the session looks, never what it does.
 */

/**
 * One rail cell per entry, in session order: `{ idx, unit, hue, pos, done, current }`.
 * `pos` places the entry inside its superset's bar ('first' | 'mid' | 'last'), or 'solo' when
 * it is not linked; `hue` is the dock's colour for that superset (null when solo), so the rail
 * and the dock always agree on which group is which.
 */
export function railItems(entries, cur) {
  const list = Array.isArray(entries) ? entries : []
  const out = []
  dockItems(list).forEach(item => {
    const n = item.indices.length
    item.indices.forEach((idx, k) => {
      const sets = list[idx]?.sets || []
      out.push({
        idx,
        unit: item.position,
        hue: item.hue,
        pos: n < 2 ? 'solo' : k === 0 ? 'first' : k === n - 1 ? 'last' : 'mid',
        done: sets.length > 0 && sets.every(s => s.done),
        current: item.indices.includes(cur),
      })
    })
  })
  return out
}

/**
 * The two records the session card shows for an exercise, each with the set and the day it
 * came from: the heaviest work set (ties go to the one with more reps) and the most reps in
 * one work set (ties go to the heavier one). Only finished work sets with a rep count count —
 * warm-ups, cardio and timed holds drop out. Null for a record there is nothing to show for.
 */
export function exerciseRecords(S, exId) {
  let maxWeight = null, maxReps = null
  ;(S?.workouts || []).forEach(w => {
    ;(w.entries || []).forEach(e => {
      if (e.id !== exId) return
      ;(e.sets || []).forEach(s => {
        if (!s.done || isWarmupRow(s)) return
        const weight = Number(s.w) || 0
        const reps = Math.round(Number(s.r) || 0)
        if (reps < 1) return
        if (weight > 0 && (!maxWeight || weight > maxWeight.w || (weight === maxWeight.w && reps > maxWeight.r))) {
          maxWeight = { w: weight, r: reps, d: w.d }
        }
        if (!maxReps || reps > maxReps.r || (reps === maxReps.r && weight > maxReps.w)) {
          maxReps = { r: reps, w: weight, d: w.d }
        }
      })
    })
  })
  return { maxWeight, maxReps }
}

export const REP_MAX_REPS = [1, 3, 5, 6, 8, 10, 12, 15, 20]

/**
 * The weight an estimated 1RM points to for each rep count — the formula of onerm.js run
 * backwards. Every formula there is the load times a factor of the reps, so the weight for
 * `r` reps is the 1RM over that factor. Rows past REP_CAP come back marked `rough`: onerm.js
 * will not estimate from them, and the view shows them dimmed rather than as a firm number.
 */
export function repMaxTable(e1rm, reps = REP_MAX_REPS, formula = DEFAULT_FORMULA) {
  const max = Number(e1rm)
  if (!isFinite(max) || max <= 0) return []
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  return reps.map(r => {
    const factor = r === 1 ? 1 : fn(1, r)
    const w = factor > 0 && isFinite(factor) ? Math.round(max / factor * 10) / 10 : null
    return { r, w, rough: r > REP_CAP }
  }).filter(row => row.w != null && row.w > 0)
}

/** repMaxTable from the exercise's all-time best estimate; empty without one. */
export function repMaxFor(S, exId, formula = DEFAULT_FORMULA) {
  const best = best1RM(S, exId, formula)
  return best ? repMaxTable(best.est, REP_MAX_REPS, formula) : []
}

// How long a set takes to do when nothing says otherwise.
export const WORK_SEC = 40

/**
 * A rough length for the whole session, in seconds, for the header's "elapsed / estimated".
 * Each set costs its own time (a timed set's `sec`, a cardio set's `min`, else WORK_SEC), and
 * the rests are the ones the session itself would start: the group's rest between rounds of a
 * superset or sets of an exercise (warm-ups on their own clock), then the break between
 * exercises — the same helpers the session's timer reads, with `opts` the app's settings
 * (`restSec`, `warmupRestSec`, `restExSec`) and the running workout's override (`workoutRestEx`).
 */
export function estimateSessionSec(entries, units, opts = {}) {
  const list = Array.isArray(entries) ? entries : []
  const groups = Array.isArray(units) ? units : []
  let total = 0
  groups.forEach((unit, u) => {
    const restSec = restSecFor(list, unit, opts.restSec)
    const rounds = Math.max(0, ...unit.map(i => list[i]?.sets?.length || 0))
    for (let k = 0; k < rounds; k++) {
      let last = null
      unit.forEach(i => {
        const s = list[i]?.sets?.[k]
        if (!s) return
        total += s.sec > 0 ? s.sec : s.min > 0 ? s.min * 60 : WORK_SEC
        last = s
      })
      if (last && k < rounds - 1) total += restSecAfterSet(last, restSec, opts.warmupRestSec)
    }
    if (u < groups.length - 1) {
      total += restBetweenExercisesSec(restSec, opts.workoutRestEx, opts.restExSec, exerciseRestChoice(list, unit))
    }
  })
  return total
}

/**
 * The room the session needs under its own cards, in px, so the page can scroll its last card
 * up under the pinned header with `gap` of air above it. A page is only as long as its content,
 * so a short last card cannot be scrolled that far on its own; this is the difference, and zero
 * when the page is long enough already. All the figures are page coordinates: `cardTop` the last
 * card's top, `panelBottom` the bottom of the cards, `belowSession` what the page has under the
 * session's box (the foot and what follows it), `viewport` the window's height, `header` the
 * pinned header's height.
 */
export function sessionRoom({ cardTop, panelBottom, belowSession, viewport, header, gap = 12 }) {
  return Math.max(0, cardTop - header - gap + viewport - panelBottom - belowSession)
}

// How far a dragged tab's neighbours lean toward the gap it is about to open.
export const DROP_LEAN = 8

/**
 * Where a tab dragged to `y` (the list's own coordinates) would land: `spans` are the tabs as
 * `{ index, top, bottom }`. The rules are the workout dock's (dockIntent): over another tab's
 * middle it joins that exercise or its superset, in a gap it lands there, near its own superset
 * it stays with it. Returns the `intent` the reorder takes, the `markerY` of the gap, the `join`
 * index (or null) and the `leans` the neighbours take on the way.
 */
export function tabDropIntent(entries, index, y, spans) {
  const sg = entries[index]?.sg ?? null
  const others = spans
    .filter(span => span.index !== index)
    .sort((a, b) => a.top - b.top)
    .map(span => ({ index: span.index, sg: entries[span.index]?.sg ?? null, left: span.top, right: span.bottom }))
  const intent = dockIntent(others, y, sg)
  const { slot, join } = intent
  const markerY = slot <= 0 ? others[0]?.left
    : slot >= others.length ? others.at(-1)?.right
      : (others[slot - 1].right + others[slot].left) / 2
  const leans = {}
  if (join == null && others[slot - 1]) leans[others[slot - 1].index] = -DROP_LEAN
  if (join == null && others[slot]) leans[others[slot].index] = DROP_LEAN
  return { intent, markerY, join, leans }
}

/**
 * Where a whole superset (`unitIndices`) dragged to `y` would land among the other units, in the
 * same numbering `moveActiveWorkoutUnitTo` takes. A superset only changes place; it never joins.
 */
export function unitDropIntent(entries, unitIndices, y, spans) {
  const bands = dockItems(entries)
    .filter(item => !item.indices.includes(unitIndices[0]))
    .map(item => {
      const tabs = spans.filter(span => item.indices.includes(span.index))
      return { top: Math.min(...tabs.map(span => span.top)), bottom: Math.max(...tabs.map(span => span.bottom)) }
    })
  const slot = dropSlot(bands.map(band => (band.top + band.bottom) / 2), y)
  const markerY = slot <= 0 ? bands[0]?.top
    : slot >= bands.length ? bands.at(-1)?.bottom
      : (bands[slot - 1].bottom + bands[slot].top) / 2
  return { intent: { unit: slot }, markerY, join: null, leans: {} }
}

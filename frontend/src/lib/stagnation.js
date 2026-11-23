// Exercises that stopped improving: the same best, microcycle after microcycle.
//
// A single flat session says nothing — sleep, a crowded gym, a bad day. Three loading microcycles
// in a row without beating what came before is a pattern, and the fix is rarely "try harder": it
// is a different variation, a different rep range, or less fatigue around it. So the app watches
// each exercise's best set per microcycle and names the ones that have stopped moving.
//
// The best set is read as an estimated 1RM (onerm.js) when every microcycle has one, which needs
// sets of 12 reps or fewer; otherwise as weight × reps of the best set — or reps alone on
// bodyweight work. One measure per exercise, never mixed. Deload microcycles and deload sessions
// are left out: they are lighter on purpose.

import { cycleHistory } from './cycle-history.js'
import { bestSetOf } from './onerm.js'
import { isDeloadWorkout } from './mesocycle.js'
import { isWarmupRow } from './workout-model.js'

/** Loading microcycles without beating the earlier best before an exercise counts as stalled. */
export const STALL_MICROS = 3
/** Gain below this share of the earlier best is noise, not progress. */
export const STALL_MIN_GAIN = 0.01
// The stall must reach the present: an exercise last trained this microcycle or the one before.
const RECENT_MICROS = 2

// The best done work set of one entry as weight × reps (reps alone without load).
function bestWork(entry) {
  let best = null
  for (const s of (entry && entry.sets) || []) {
    if (!s.done || isWarmupRow(s)) continue
    const w = Number(s.w) || 0, r = Number(s.r) || 0
    if (!(r > 0)) continue
    const v = w > 0 ? w * r : r
    if (best == null || v > best) best = v
  }
  return best
}

/**
 * Each exercise's best per loading microcycle, oldest → newest:
 * { [exId]: [{ micro, e1rm, work }] } — `micro` is the microcycle's place in the list (0 oldest).
 */
export function bestsByMicro(S) {
  const micros = cycleHistory(S).slice().reverse().filter(c => !c.deload)
  const out = {}
  micros.forEach((c, micro) => {
    const per = {}
    for (const w of c.workouts || []) {
      if (isDeloadWorkout(w) || w.extra) continue
      for (const e of w.entries || []) {
        const est = bestSetOf(e)
        const work = bestWork(e)
        if (work == null) continue
        const p = per[e.id] || (per[e.id] = { micro, e1rm: null, work: null })
        if (est && (p.e1rm == null || est.est > p.e1rm)) p.e1rm = est.est
        if (p.work == null || work > p.work) p.work = work
      }
    }
    for (const id in per) (out[id] = out[id] || []).push(per[id])
  })
  return { byEx: out, count: micros.length }
}

/**
 * The exercises that have not beaten their earlier best for `STALL_MICROS` loading microcycles in
 * which they were trained, most stalled first: { id, metric: 'e1rm' | 'work', best, recent,
 * micros }. `best` is the best before the stall, `recent` the best of the stalled stretch.
 */
export function stalledExercises(S, { micros: window = STALL_MICROS, minGain = STALL_MIN_GAIN } = {}) {
  const { byEx, count } = bestsByMicro(S)
  const out = []
  for (const id in byEx) {
    const pts = byEx[id]
    if (pts.length < window + 1) continue
    if (pts[pts.length - 1].micro < count - RECENT_MICROS) continue
    const metric = pts.every(p => p.e1rm != null) ? 'e1rm' : 'work'
    const val = p => p[metric]
    const before = Math.max(...pts.slice(0, -window).map(val))
    const recent = Math.max(...pts.slice(-window).map(val))
    if (recent > before * (1 + minGain)) continue
    // How long it has really been flat: walk back while the best before still is not beaten.
    let flat = window
    while (flat < pts.length - 1 && Math.max(...pts.slice(-(flat + 1)).map(val)) <= Math.max(...pts.slice(0, -(flat + 1)).map(val)) * (1 + minGain)) flat++
    out.push({ id, metric, best: Math.round(before * 10) / 10, recent: Math.round(recent * 10) / 10, micros: flat })
  }
  return out.sort((a, b) => b.micros - a.micros || a.id.localeCompare(b.id))
}

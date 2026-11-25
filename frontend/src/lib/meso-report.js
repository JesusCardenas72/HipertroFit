// The report of a mesocycle: what a block of loading microcycles and its deload added up to.
//
// Per microcycle it lines up the numbers the block was meant to move — effective sets per group
// against their band, sessions done against planned, effort against the target RIR — and across
// the block, what it moved: estimated 1RM per exercise, body weight and measurements. Pure; the
// microcycles come from cycle-history.js (oldest first here), split into mesocycles at each
// deload microcycle, which closes the one it follows.

import { cycleHistory } from './cycle-history.js'
import { groupVolume, VOLUME_GROUPS, targetOf } from './volume.js'
import { bestSetOf } from './onerm.js'
import { isWarmupRow } from './workout-model.js'
import { rirOf } from './effort.js'
import { isDeloadWorkout } from './mesocycle.js'
import { measuresOf, MEASURES } from './measures.js'
import { todayISO } from './format.js'

const round1 = v => (v == null ? null : Math.round(v * 10) / 10)

/**
 * Mesocycles oldest first: { micros: [loading microcycles], deload: the closing one or null,
 * running } — `running` while no deload has closed it yet. A deload with no loading microcycle
 * before it closes nothing and is left out.
 */
export function mesocycles(S) {
  const out = []
  let cur = []
  for (const c of cycleHistory(S).slice().reverse()) {
    if (c.deload) {
      if (cur.length) out.push({ micros: cur, deload: c, running: false })
      cur = []
    } else cur.push(c)
  }
  if (cur.length) out.push({ micros: cur, deload: null, running: true })
  return out
}

// The work sets of a list of workouts, deload sessions left out.
const workSets = ws => ws.filter(w => !isDeloadWorkout(w))
  .flatMap(w => (w.entries || []).flatMap(e => (e.sets || []).filter(s => s.done && !isWarmupRow(s))))

// Most frequent target RIR the sessions carried, or null.
function goalOf(ws) {
  const n = {}
  for (const w of ws) if (w.rirGoal != null) n[w.rirGoal] = (n[w.rirGoal] || 0) + 1
  const best = Object.keys(n).sort((a, b) => n[b] - n[a])[0]
  return best == null ? null : Number(best)
}

// Best estimated 1RM of an exercise across workouts.
function bestE1(ws, id) {
  let best = null
  for (const w of ws) {
    if (isDeloadWorkout(w)) continue
    for (const e of w.entries || []) {
      if (e.id !== id) continue
      const b = bestSetOf(e)
      if (b && (best == null || b.est > best)) best = b.est
    }
  }
  return best
}

// First and last value inside [start, end] of a dated list.
function span(list, start, end, val) {
  const inside = (list || []).filter(x => x && x.d >= start && x.d <= end && val(x) != null).sort((a, b) => a.d.localeCompare(b.d))
  if (!inside.length) return null
  const from = val(inside[0]), to = val(inside[inside.length - 1])
  return { from, to, delta: round1(to - from) }
}

/** The report of one mesocycle (an item of `mesocycles`). */
export function mesoReport(S, meso, today = todayISO()) {
  const micros = meso.micros
  const start = micros[0].start
  const end = (meso.deload && (meso.deload.end || today)) || micros[micros.length - 1].end || today
  const loading = micros.flatMap(c => c.workouts || [])

  const sessions = micros.reduce((n, c) => n + (c.sessions || 0), 0)
  const planned = micros.reduce((n, c) => n + (c.len || 0), 0)

  const perMicro = micros.map(c => groupVolume((c.workouts || []).filter(w => !isDeloadWorkout(w))).groups)
  const groups = VOLUME_GROUPS.map(g => {
    const sets = perMicro.map(v => round1(v[g.key] || 0))
    return { key: g.key, name: g.name, band: targetOf(g), sets, avg: round1(sets.reduce((a, b) => a + b, 0) / sets.length) }
  }).filter(g => g.sets.some(v => v > 0))

  const effort = micros.map(c => {
    const sets = workSets(c.workouts || [])
    const rated = sets.map(rirOf).filter(v => v != null)
    return { avg: rated.length ? round1(rated.reduce((a, b) => a + b, 0) / rated.length) : null, goal: goalOf(c.workouts || []) }
  })

  // Strength: every exercise trained in the first and the last microcycle that has an estimate.
  const first = micros[0].workouts || [], last = micros[micros.length - 1].workouts || []
  const ids = [...new Set(first.flatMap(w => (w.entries || []).map(e => e.id)))]
  const strength = micros.length < 2 ? [] : ids.map(id => {
    const from = bestE1(first, id), to = bestE1(last, id)
    return from && to ? { id, from: round1(from), to: round1(to), pct: round1((to / from - 1) * 100) } : null
  }).filter(Boolean).sort((a, b) => b.pct - a.pct)

  const ms = measuresOf(S)
  const measures = MEASURES.map(k => ({ key: k, ...span(ms, start, end, x => x[k] || null) })).filter(m => m.from != null && m.to !== undefined && m.from !== m.to)

  return {
    start, end, running: meso.running, micros: micros.length, deload: !!meso.deload,
    sessions, planned, adherence: planned ? Math.round(sessions / planned * 100) : null,
    groups, effort, strength,
    bodyweight: span(S.bodyweight, start, end, x => (x.w > 0 ? x.w : null)),
    measures,
    workouts: loading.length,
  }
}

/** The report of the latest mesocycle with a session trained in it, or null. */
export function latestMesoReport(S, today = todayISO()) {
  const all = mesocycles(S).filter(m => m.micros.some(c => (c.workouts || []).length))
  return all.length ? mesoReport(S, all[all.length - 1], today) : null
}

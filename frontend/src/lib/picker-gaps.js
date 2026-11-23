// What the exercise picker shows above the list while exercises are being chosen: the muscle
// groups still under their optimal range (short of the band's minimum), the ones most short
// first, then those past it (over the optimal maximum), the most over first. Groups in range
// are left out. Each count is per group and must not be added up: one compound set feeds every
// group it trains.
//
// The reading depends on where the picker was opened from, so that every set added there
// moves the figures as it is added:
//   - a routine that is a step of the sequence: the programming itself — one whole microcycle
//     as the sequence plans it (plannedVolume), the figure the Programming sheet shows. Its
//     edits land in the store, so each exercise added to it updates the reading at once.
//   - a routine outside the sequence: the running microcycle with that routine done on top of
//     the plan (anytimeRoutineGaps, the panel under it on its editing screen).
//   - anything else (the running session, a freestyle plan, a loose extra exercise): the running
//     microcycle — sets done plus what it still plans (minimumGaps over cycleVolume and
//     plannedAhead, the figure Home shows). The running session counts the way a paused one
//     does: its done sets as volume, the sets still to do instead of its step's plan. `adds`
//     carries volume being planned outside the store (a freestyle plan not started yet).

import { VOLUME_GROUPS, cycleVolume, plannedAhead, plannedVolume, minimumGaps, anytimeRoutineGaps, isAnytimeRoutine, setCredit } from './volume.js'
import { isWarmupRow } from './workout-model.js'
import { todayISO } from './format.js'

// The running session as if it were paused right now: plannedAhead then swaps its step's plan
// for the sets still to do in it, and cycleVolume adds the ones done. A past workout being
// logged (backfill) is not in the running block, so it is left as it is.
const runningSession = S => {
  const A = S && S.active
  return A && !A.backfill && Array.isArray(A.entries) ? A : null
}
function withActive(S) {
  const A = runningSession(S)
  if (!A) return S
  return { ...S, paused: [...(Array.isArray(S.paused) ? S.paused : []), { id: 'active', ...A, pausedAt: Number.MAX_SAFE_INTEGER }] }
}

/**
 * The per-group gaps (minimumGaps rows: `remaining` to the minimum, `excess` past the maximum)
 * for a picker opened from `ctx` — `{ routineId }` for a routine being programmed, `{ adds }`
 * for volume planned outside the store, `{}` otherwise. `basis` says which reading it is:
 * 'plan' (one microcycle as programmed) or 'cycle' (the running microcycle).
 */
export function pickerGaps(S, ctx = {}, today = todayISO()) {
  const { routineId, adds } = ctx || {}
  const routine = routineId && ((S && S.routines) || []).find(r => r.id === routineId)
  if (routine && !isAnytimeRoutine(S, routineId)) return { basis: 'plan', gaps: minimumGaps(plannedVolume(S)) }
  if (routine) return { basis: 'cycle', gaps: anytimeRoutineGaps(S, routine, today) }
  const st = withActive(S)
  const ahead = plannedAhead(st, today)
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = (ahead.groups[g.key] || 0) + ((adds && adds[g.key]) || 0)
  // A freestyle session fills no step, so plannedAhead has no plan to swap: the sets still to
  // do in it are added on top.
  const A = runningSession(S)
  if (A && !A.routineId) for (const e of A.entries) {
    const n = (e.sets || []).filter(x => !x.done && !isWarmupRow(x)).length
    if (!n) continue
    const per = setCredit(e)
    for (const k in per) groups[k] += per[k] * n
  }
  return { basis: 'cycle', gaps: minimumGaps(cycleVolume(st, today), { groups }) }
}

/**
 * The picker's two lists from minimumGaps rows: `short` (under the minimum, most sets missing
 * first) and `over` (past the maximum, most sets over first). Ties keep the panel's group order.
 */
export function pickerGapList(gaps) {
  const short = (gaps || []).filter(g => g.remaining > 0).sort((a, b) => b.remaining - a.remaining)
  const over = (gaps || []).filter(g => g.excess > 0).sort((a, b) => b.excess - a.excess)
  return { short, over }
}

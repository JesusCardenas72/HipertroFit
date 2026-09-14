// Training volume as effective sets, accumulated over a microcycle.
//
// "Effective set" here is this project's volume unit: a completed work set taken close
// enough to failure to drive hypertrophy — RIR <= 4 (see the volumen-series-efectivas
// note). Effort logging is optional and usually off, so a set with no RIR logged is
// counted as effective too — you do not leave a working set in the tank on purpose — and
// the coverage figures let the UI say how much of the volume is actually rated. Warm-ups
// never count.
//
// The window is the microcycle, NOT the calendar week: for a Push/Pull/Legs split one
// microcycle is two full rounds = 6 sessions, and six training days routinely spill past
// seven calendar days, so counting by week would cut one microcycle in two. Where the block
// starts and ends is lib/microcycle.js's business; this file only adds its sets up. Volume
// accumulates inside the block and restarts with the next one — it is not a rolling window.
// Everything trained inside the block counts, planned or not: an extra session squeezed in
// mid-microcycle adds all of its sets here (it just does not consume one of the block's
// planned slots — see microcycle.js isPlannedSession).
//
// Grouping is deliberately per-set, taking the strongest involvement of any muscle in a
// group rather than summing the group's muscles: a squat counts as one leg set, not as
// quads + glutes + hamstrings stacked. Secondary muscles still earn partial credit (the
// 0.4 weight from musclesOf), which is the usual way fractional volume is counted.

import { cycleWorkouts, microcycleLen } from './microcycle.js'
import { REST } from './program.js'
import { musclesOf } from './muscles.js'
import { EXIDX } from './exercises.js'
import { rirOf } from './effort.js'
import { isWarmupRow } from './workout-model.js'

// This project's volume threshold. Distinct from effort.js HARD_RIR (3), which labels a
// set "hard" for the muscle map; this is the product decision for what counts as volume.
export const EFFECTIVE_RIR = 4

// Effective-set target per muscle group per microcycle (the adaptive band from the note).
export const VOLUME_TARGET = { min: 10, max: 20 }

// The muscle groups shown on the home volume panel, in display order, each folding one or
// more canonical muscles (see lib/muscles.js MUSCLES). Names are i18n keys; `short`, when
// present, is the compact label the bar rows use so the bars get the width.
//   - "Side delts" uses the whole deltoids group as a proxy: the dataset does not separate
//     the three heads, so this over-counts pressing. Labelled as the user asked for.
//   - Legs folds every lower-body muscle; Back is upper + lower back only, as specified.
export const VOLUME_GROUPS = [
  { key: 'legs', name: 'Legs', muscles: ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'hip-flexors', 'calves', 'tibialis'] },
  { key: 'chest', name: 'Chest', muscles: ['chest'] },
  { key: 'back', name: 'Back muscles', muscles: ['upper-back', 'lower-back'] },
  { key: 'delts', name: 'Side delts', short: 'Lat. delts', muscles: ['deltoids'] },
  { key: 'biceps', name: 'Biceps', muscles: ['biceps'] },
  { key: 'triceps', name: 'Triceps', muscles: ['triceps'] },
  { key: 'abs', name: 'Abs', short: 'ABS', muscles: ['abs', 'obliques'] },
]

// muscle slug -> group key, built once from VOLUME_GROUPS.
const GROUP_OF = (() => {
  const map = {}
  for (const g of VOLUME_GROUPS) for (const slug of g.muscles) map[slug] = g.key
  return map
})()

/** A completed work set that counts as volume: RIR <= 4, or unrated (counted, per product). */
export const isEffectiveSet = s => { const r = rirOf(s); return r == null || r <= EFFECTIVE_RIR }

// The muscle map a workout entry trains, resolving the same way loadOf does: a completed
// entry may carry its own weighted snapshot (custom exercise since deleted); otherwise the
// catalogue entry by id wins, then whatever metadata the entry itself holds.
function entryMuscles(entry) {
  const historical = entry.exercise || entry
  const source = historical && historical.muscleWeights ? historical : (EXIDX[entry.id] || historical)
  return musclesOf(source)
}

// Credit `n` sets of an exercise to each group it trains, at the strongest involvement of
// any of the group's muscles — never their sum.
function creditSet(groups, mus, n) {
  const best = {}
  for (const slug in mus) {
    const g = GROUP_OF[slug]
    if (g) best[g] = Math.max(best[g] || 0, mus[slug])
  }
  for (const g in best) groups[g] += best[g] * n
}

/**
 * Effective-set volume per muscle group across a set of workouts.
 *
 * `pick` decides which done work sets count toward the volume (defaults to the RIR<=4
 * rule); the rated/unrated coverage counts every done work set regardless, so the UI can
 * report how much of the window was actually rated. Per set, each group is credited with
 * the strongest involvement of any of its muscles — never their sum.
 */
export function groupVolume(workouts, pick = isEffectiveSet) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  let rated = 0, unrated = 0
  for (const w of workouts || []) {
    for (const e of w.entries || []) {
      const mus = entryMuscles(e)
      for (const s of e.sets || []) {
        if (!s.done || isWarmupRow(s)) continue
        if (rirOf(s) == null) unrated++; else rated++
        if (pick && !pick(s)) continue
        creditSet(groups, mus, 1)
      }
    }
  }
  return { groups, rated, unrated, total: rated + unrated }
}

/**
 * Effective-set volume per muscle group over the current microcycle — everything logged
 * since the block opened (lib/microcycle.js), off-plan sessions included. `sessions` says
 * how many that is, so the UI can show the block filling up rather than implying the count
 * is final.
 */
export function cycleVolume(S) {
  const win = cycleWorkouts(S)
  return { ...groupVolume(win), sessions: win.length }
}

/**
 * The volume the programming plans for one microcycle, before anything is trained — what the
 * Programming sheet shows while the sequence is being built.
 *
 * One microcycle is microcycleLen(S) sessions, taken from the sequence's training steps in
 * order and wrapping around: a Push/Pull/Legs sequence under the PPL strategy (6 sessions) is
 * counted twice, which is what the block will actually train. Rest days and deleted routines
 * plan nothing. Each exercise contributes the work sets its routine configures (`sets`, warm-ups
 * never count), credited per group the same way groupVolume credits a logged set, so the plan
 * reads on the same scale as the live panel. Every planned set is assumed effective.
 */
export function plannedVolume(S) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  const routines = (S && S.routines) || []
  const byId = id => routines.find(r => r.id === id)
  // A deleted routine still holds its slot in the block (microcycleLen counts it); it just
  // plans no sets.
  const steps = ((S && S.program && S.program.seq) || []).filter(x => x && x !== REST)
  const len = steps.length ? microcycleLen(S) : 0
  let total = 0
  for (let i = 0; i < len; i++) {
    const r = byId(steps[i % steps.length])
    for (const cfg of (r && r.ex) || []) {
      const n = Math.max(1, Math.round(cfg.sets) || 1)
      creditSet(groups, entryMuscles(cfg), n)
      total += n
    }
  }
  return { groups, rated: total, unrated: 0, total, sessions: len }
}

/** Traffic-light status of a group's effective-set count against the target band. */
export function volumeStatus(v) {
  if (v < VOLUME_TARGET.min) return 'low'
  if (v > VOLUME_TARGET.max) return 'high'
  return 'ok'
}

/** CSS colour token for a volume status — under-target, in-band, over-target. */
export const volumeColor = status =>
  status === 'ok' ? 'var(--green)' : status === 'high' ? 'var(--red)' : 'var(--orange)'

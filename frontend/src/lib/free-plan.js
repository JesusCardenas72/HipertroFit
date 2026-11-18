// A freestyle session planned before it starts: the exercises and their work sets, read against
// the running microcycle's volume so the user sees, group by group, how far the session takes it
// towards (or past) its optimal range before walking up to the bar.
//
// A freestyle session never fills a step of a sequence (lib/microcycle.js, isPlannedSession), so
// its sets add on top of everything else the block holds: what was already done (cycleVolume)
// and what its own steps still plan (plannedAhead). Every planned set is taken as effective, the
// same assumption plannedVolume makes, so the three figures sit on one scale.
import { VOLUME_GROUPS, setCredit, cycleVolume, plannedAhead, targetOf, volumeStatus } from './volume.js'
import { buildSets, freestyleConfig, defaultConfig, applyIntensifierPlan } from './history.js'
import { loadScaleFor } from './progression.js'
import { applyDeload } from './mesocycle.js'
import { isWarmupRow } from './workout-model.js'
import { todayISO } from './format.js'

export const FREE_MAX_SETS = 10
const round1 = n => Math.round((n || 0) * 10) / 10
const clampSets = n => Math.max(1, Math.min(FREE_MAX_SETS, Math.round(n) || 1))

// What the exercise would start a freestyle session with: its last target, else the defaults.
const configOf = (S, id) => freestyleConfig(S, { id, ...defaultConfig(id) })

/** A new line of the plan: the exercise (`ex`, its catalogue or custom entry) and its work sets. */
export function freePlanItem(S, ex) {
  return { id: ex.id, ex, sets: clampSets(configOf(S, ex.id).sets) }
}

/** Change one line's work sets by `delta`, kept within 1…FREE_MAX_SETS. */
export const stepFreeSets = (items, i, delta) =>
  items.map((it, k) => (k === i ? { ...it, sets: clampSets(it.sets + delta) } : it))

/** The effective sets the plan credits each group: { groupKey: sets }. */
export function freePlanVolume(items) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  for (const it of items || []) {
    const per = setCredit({ ...(it.ex || {}), id: it.id })
    for (const k in per) groups[k] += per[k] * (it.sets || 0)
  }
  return groups
}

/**
 * Each group of the running microcycle with and without the plan:
 * `done` (trained so far), `ahead` (what its own steps still plan), `before` (the two together,
 * where the block lands without this session), `added` (this session) and `after` (where it lands
 * with it), against the band's `min` and `max`. `status` / `statusBefore` are the traffic light of
 * `after` / `before`; `over` flags a session that takes a group past its optimal maximum.
 */
export function freePlanProjection(S, items, today = todayISO()) {
  const vol = cycleVolume(S, today)
  const ahead = plannedAhead(S, today)
  const add = freePlanVolume(items)
  return VOLUME_GROUPS.map(g => {
    const band = targetOf(g)
    const done = round1(vol.groups[g.key])
    const left = round1(ahead.groups[g.key])
    const before = round1(done + left)
    const added = round1(add[g.key])
    const after = round1(before + added)
    return {
      ...g, done, ahead: left, before, added, after, min: band.min, max: band.max,
      statusBefore: volumeStatus(before, band), status: volumeStatus(after, band),
      over: added > 0 && after > band.max,
    }
  })
}

// Bring the work rows to exactly `n`, keeping warm-ups in front: a longer plan repeats the last
// work row (not done), a shorter one drops from the end.
function fitWorkRows(rows, n) {
  const warm = rows.filter(isWarmupRow)
  const work = rows.filter(r => !isWarmupRow(r)).slice(0, n)
  const last = work[work.length - 1]
  while (work.length < n && last) work.push({ ...last, done: false })
  return [...warm, ...work]
}

/**
 * The plan as the entries of a freestyle session — the same rows the in-session "Add exercise"
 * builds for a freestyle workout (last target, rows carried from the last session), with the
 * number of work sets the user planned. On a deload the rows take the cut like any other session.
 */
export function freePlanEntries(S, items, { deload = 0 } = {}) {
  return (items || []).map(it => {
    const cfg = { ...configOf(S, it.id), sets: clampSets(it.sets) }
    const full = { ...cfg, id: it.id }
    const step = loadScaleFor(full, S.unit)
    let sets = fitWorkRows(buildSets(S, full, { step, preferLast: true }), cfg.sets)
    sets = applyIntensifierPlan(sets, full)
    if (deload > 0) sets = applyDeload(sets, deload, step)
    return { id: it.id, target: cfg, plan: null, sets }
  })
}

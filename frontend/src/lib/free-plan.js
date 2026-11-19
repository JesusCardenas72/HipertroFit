// A freestyle session planned before it starts: the exercises and their work sets, read against
// the running microcycle's volume so the user sees, group by group, how far the session takes it
// towards (or past) its optimal range before walking up to the bar.
//
// A freestyle session never fills a step of a sequence (lib/microcycle.js, isPlannedSession), so
// its sets add on top of everything else the block holds: what was already done (cycleVolume)
// and what its own steps still plan (plannedAhead). Every planned set is taken as effective, the
// same assumption plannedVolume makes, so the three figures sit on one scale.
import { VOLUME_GROUPS, setCredit, cycleVolume, plannedAhead, targetOf, volumeStatus } from './volume.js'
import { buildSets, freestyleConfig, defaultConfig, applyIntensifierPlan, pairAdjacent } from './history.js'
import { loadScaleFor } from './progression.js'
import { applyDeload } from './mesocycle.js'
import { isWarmupRow } from './workout-model.js'
import { todayISO } from './format.js'

export const FREE_MAX_SETS = 10
const round1 = n => Math.round((n || 0) * 10) / 10
const clampSets = n => Math.max(1, Math.min(FREE_MAX_SETS, Math.round(n) || 1))

// What the exercise would start a freestyle session with: its last target, else the defaults.
const configOf = (S, id) => freestyleConfig(S, { id, ...defaultConfig(id) })

/**
 * A new line of the plan: the exercise id and its work sets. The line keeps no copy of the
 * exercise, so it can be stored as the draft (S.freePlan) as it is; `ex` (the catalogue or custom
 * entry) may be attached to read its muscles, and is dropped by freePlanDraft.
 */
export function freePlanItem(S, ex) {
  return { id: ex.id, sets: clampSets(configOf(S, ex.id).sets) }
}

/** Change one line's work sets by `delta`, kept within 1…FREE_MAX_SETS. */
export const stepFreeSets = (items, i, delta) =>
  items.map((it, k) => (k === i ? { ...it, sets: clampSets(it.sets + delta) } : it))

// A superset id left on a line with no neighbour sharing it is not a superset any more.
function cleanSg(items) {
  return items.map((it, i) => {
    if (!it.sg || items[i - 1]?.sg === it.sg || items[i + 1]?.sg === it.sg) return it
    const { sg, ...rest } = it
    return rest
  })
}

/** Whether line `i` and the next one are done back to back, as a superset. */
export const linkedToNext = (items, i) => !!items[i]?.sg && items[i].sg === items[i + 1]?.sg

/**
 * Join line `i` and the next one in a superset (merging any superset either already belongs to),
 * or, if they are joined, split the superset there: the lines after the cut take a new id, and a
 * line left on its own stops being a superset.
 */
export function toggleFreeLink(items, i) {
  if (!items[i] || !items[i + 1]) return items
  if (!linkedToNext(items, i)) return pairAdjacent(items, i, i + 1)
  const sg = items[i].sg
  let fresh = sg + '-b'
  while (items.some(it => it.sg === fresh)) fresh += 'b'
  const next = items.map(it => ({ ...it }))
  for (let k = i + 1; k < next.length && next[k].sg === sg; k++) next[k].sg = fresh
  return cleanSg(next)
}

/** Take line `i` out of the plan; a superset left with one line is undone. */
export const removeFreeItem = (items, i) => cleanSg(items.filter((_, k) => k !== i))

/**
 * The plan as it is stored between visits (S.freePlan): id, sets and superset of each line, and
 * nothing for a line without an exercise. Read back the same way, so a draft saved by an older
 * build or edited by hand cannot break the sheet.
 */
export function freePlanDraft(items) {
  const out = (Array.isArray(items) ? items : [])
    .filter(it => it && it.id)
    .map(it => ({ id: it.id, sets: clampSets(it.sets), ...(it.sg ? { sg: String(it.sg) } : {}) }))
  return cleanSg(out)
}

/**
 * The last freestyle session that was finished, as a plan to start the next one from: each
 * exercise with the work sets it actually did (warm-ups and undone rows left out) and its
 * superset, in the session's order. `{ d, items }`, or null when no freestyle session has any.
 */
export function lastFreePlan(S) {
  let last = null
  for (const w of S?.workouts || []) {
    if (!w || w.routineId || !(w.entries || []).length) continue
    if (!last || (w.d || '') > (last.d || '') || ((w.d || '') === (last.d || '') && (w.start || 0) > (last.start || 0))) last = w
  }
  if (!last) return null
  const items = freePlanDraft(last.entries.map(e => {
    const work = (e.sets || []).filter(s => s && s.done && !isWarmupRow(s)).length
    return work ? { id: e.id, sets: work, sg: e.sg } : null
  }))
  return items.length ? { d: last.d, items } : null
}

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
  return freePlanDraft(items).map(it => {
    const cfg = { ...configOf(S, it.id), sets: clampSets(it.sets) }
    const full = { ...cfg, id: it.id }
    const step = loadScaleFor(full, S.unit)
    let sets = fitWorkRows(buildSets(S, full, { step, preferLast: true }), cfg.sets)
    sets = applyIntensifierPlan(sets, full)
    if (deload > 0) sets = applyDeload(sets, deload, step)
    return { id: it.id, target: cfg, plan: null, sets, ...(it.sg ? { sg: it.sg } : {}) }
  })
}

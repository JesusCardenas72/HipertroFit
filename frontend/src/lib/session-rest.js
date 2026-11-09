/* ---- rest between sets, changed during a session ----
   The plan gives each exercise its rest between sets: the routine's own restSec, else Settings ▸
   Rest timer (restSecFor in supersetFlow.js). A running workout can change it for itself only:

     entry.restSec     — the timer icon on an exercise: the rest between its sets, and in a
                         superset the rest between its rounds (written on every member, since the
                         group rests once per round).
     S.active.restSec  — the timer in the workout's header: every exercise of the session at once.
                         Picking it clears the per-exercise ones, so the last choice is the one that
                         holds; picking one exercise after it overrides it for that exercise only.

   Both are seconds > 0 and absent means "as planned". Neither touches the routine or Settings
   while the session runs. Once it is filed, the rests that differ from the routine's plan can be
   kept for that routine's next sessions (sessionRestChanges / withSessionRests): each changed
   exercise's config takes the new restSec — that routine only, those exercises only. */

// 0:15 to 3:00 in 15-second steps, then to 10:00 in 30-second steps.
export const REST_SET_PRESETS = [
  ...Array.from({ length: 12 }, (_, i) => (i + 1) * 15),
  ...Array.from({ length: 14 }, (_, i) => 180 + (i + 1) * 30),
]

/** A rest picked during the session: a whole number of seconds above zero. */
export const isRestSec = v => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * The rest the session picked for a unit (one exercise, or a superset's members), or null when
 * it follows the plan. A pick on the exercise wins over the session's own; across a superset the
 * longest pick wins, as the planned rest does.
 */
export function sessionRestFor(entries, unit, sessionRestSec) {
  const picked = (unit || []).map(i => entries?.[i]?.restSec).filter(isRestSec)
  if (picked.length) return Math.max(...picked)
  return isRestSec(sessionRestSec) ? sessionRestSec : null
}

/** `entries` with the unit's own picks set aside — what the unit would rest without them. */
export function withoutUnitPicks(entries, unit) {
  const drop = new Set(unit || [])
  return (entries || []).map((e, i) => {
    if (!drop.has(i) || !e || !('restSec' in e)) return e
    const { restSec: _picked, ...rest } = e
    return rest
  })
}

/** Pick the rest between sets of one unit for this session; anything but seconds > 0 undoes it. */
export function pickUnitRest(active, unit, sec) {
  ;(unit || []).forEach(i => {
    const e = active?.entries?.[i]
    if (!e) return
    if (isRestSec(sec)) e.restSec = Math.round(sec)
    else delete e.restSec
  })
}

/** Pick the rest between sets of every exercise of the session; anything but seconds > 0 undoes it. */
export function pickSessionRest(active, sec) {
  if (!active) return
  ;(active.entries || []).forEach(e => { delete e.restSec })
  if (isRestSec(sec)) active.restSec = Math.round(sec)
  else delete active.restSec
}

/** Whether the session has changed any rest between sets. */
export const sessionHasRestPicks = active =>
  isRestSec(active?.restSec) || !!active?.entries?.some(e => isRestSec(e?.restSec))

// The k-th occurrence of an exercise in the session is the k-th one in the routine (the rule
// routine-from-session.js uses), as an index into routine.ex, or null for one not in it.
function routineIndices(entries, ex) {
  const pools = new Map()
  ;(ex || []).forEach((cfg, i) => {
    if (!pools.has(cfg.id)) pools.set(cfg.id, [])
    pools.get(cfg.id).push(i)
  })
  return entries.map(e => pools.get(e?.id)?.shift() ?? null)
}

const plannedOf = (cfg, defaultRestSec) =>
  isRestSec(cfg?.restSec) ? cfg.restSec : (defaultRestSec > 0 ? defaultRestSec : 0)

/**
 * The rests this session changed against the routine `ex`, one row per routine exercise whose
 * rest between sets would change: { idx (in ex), id, from, to }. `units` is
 * supersetUnits(active.entries), `defaultRestSec` Settings ▸ Rest timer.
 *
 * A unit counts as changed when its pick differs from the rest its routine configs give it
 * together (the longest of a superset's); then every member it can be matched to takes the pick.
 * Exercises added during the session have no config in the routine to keep it in, and are
 * left out.
 */
export function sessionRestChanges(active, ex, units, defaultRestSec) {
  const entries = active?.entries || []
  if (!entries.length || !Array.isArray(ex) || !ex.length) return []
  const at = routineIndices(entries, ex)
  const groups = Array.isArray(units) && units.length ? units : entries.map((_, i) => [i])
  const out = []
  groups.forEach(unit => {
    const to = sessionRestFor(entries, unit, active.restSec)
    if (to == null) return
    const members = unit.filter(i => at[i] != null)
    if (!members.length) return
    const planned = Math.max(...members.map(i => plannedOf(ex[at[i]], defaultRestSec)))
    if (planned === to) return
    members.forEach(i => {
      const cfg = ex[at[i]]
      const from = plannedOf(cfg, defaultRestSec)
      if (from !== to) out.push({ idx: at[i], id: cfg.id, from, to })
    })
  })
  return out
}

/** The routine's exercise list with each change written into its config's restSec. */
export function withSessionRests(ex, changes) {
  const byIdx = new Map((changes || []).map(c => [c.idx, c]))
  return (ex || []).map((cfg, i) => {
    const c = byIdx.get(i)
    return c && c.id === cfg.id && isRestSec(c.to) ? { ...cfg, restSec: c.to } : cfg
  })
}

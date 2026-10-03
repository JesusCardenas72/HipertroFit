// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { buildSets, applyIntensifierPlan, sessionSetCount, lastEntryFor, modeOf, effortOf } from './history.js'
import { nextPrescription, applyPrescription, defaultIncrement } from './progression.js'
import { applyDeload } from './mesocycle.js'
import { seedTargets } from './set-reference.js'
import { isWarmupRow } from './workout-model.js'

// One exercise's rows with its prescription applied. Each row then carries its own target
// against the same set last time — including the effort, when the policy holds weight and reps
// and the overload is a rep closer to failure.
function prescribedSets(st, cfg, plan, { useTarget = false } = {}) {
  const step = defaultIncrement(cfg.id, st.unit)
  const progressed = seedTargets(applyPrescription(buildSets(st, cfg, { step, useTarget }), plan, step),
    lastEntryFor(st, cfg.id)?.sets, { mode: modeOf(cfg), plan, effort: effortOf(st), step })
  return applyIntensifierPlan(progressed, cfg)
}

export function buildSessionEntries(st, r, { deload = 0 } = {}) {
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards. `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  // A deload session is prescription-free for the same reason a deload routine is: its
  // reduced numbers must not be read back as a stall, nor become the base to progress from.
  const excluded = r?.excludeFromProgression === true || deload > 0
  const entries = (r ? r.ex : []).map(cfg => {
    const plan = excluded ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, r)
    const step = defaultIncrement(cfg.id, st.unit)
    const built = prescribedSets(st, cfg, plan, { useTarget: excluded })
    const sets = deload > 0 ? applyDeload(built, deload, step) : built
    // The set count comes from the exercise's own history, not the routine (sessionSetCount),
    // so the target records the count this session actually prescribed — that is what
    // readSession later judges "every planned set done" against.
    return { id: cfg.id, sg: cfg.sg, target: { ...cfg, sets: sessionSetCount(st, cfg, { useTarget: excluded }) }, plan, sets }
  })
  return { entries, excluded }
}

/**
 * Bring a session already under way down to a deload, from the next set on: every row not yet
 * logged takes the cut (applyDeload never touches a logged one), and the session is marked so
 * it is shown as a deload and kept out of progression like any other deload session.
 * Returns a new active session; one that is already a deload is returned unchanged.
 */
export function deloadActiveSession(active, pct, unit = 'kg') {
  if (!active || Number(active.deload) > 0) return active
  return {
    ...active,
    deload: pct,
    excludeFromProgression: true,
    entries: (active.entries || []).map(e => ({ ...e, sets: applyDeload(e.sets || [], pct, defaultIncrement(e.id, unit)) })),
  }
}

/**
 * Take a session in progress back out of its deload: every row not yet logged is rebuilt at the
 * full prescription, exactly as a regular session would have started it; logged rows stay as
 * they were (done warm-ups first, then done work sets, then the fresh remainder). The deload
 * mark goes, and with it the exclusion from progression — unless the routine itself is kept
 * out of it. A session that is not a deload is returned unchanged.
 */
export function undeloadActiveSession(active, st) {
  if (!active || !(Number(active.deload) > 0)) return active
  const r = active.routineId ? (st.routines || []).find(x => x.id === active.routineId) || null : null
  const keepOut = r?.excludeFromProgression === true
  const entries = (active.entries || []).map(e => {
    const cfg = { ...(e.target || {}), id: e.id }
    const plan = keepOut ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, r)
    const fresh = prescribedSets(st, cfg, plan, { useTarget: keepOut })
    const sets = e.sets || []
    const doneWarm = sets.filter(x => x.done && isWarmupRow(x))
    const doneWork = sets.filter(x => x.done && !isWarmupRow(x))
    const freshWarm = fresh.filter(isWarmupRow)
    const freshWork = fresh.filter(x => !isWarmupRow(x))
    const target = { ...(e.target || {}), sets: Math.max(sessionSetCount(st, cfg), doneWork.length) }
    return { ...e, plan, target, sets: [...doneWarm, ...freshWarm.slice(doneWarm.length), ...doneWork, ...freshWork.slice(doneWork.length)] }
  })
  const { deload, excludeFromProgression, ...rest } = active
  return { ...rest, entries, ...(keepOut ? { excludeFromProgression: true } : {}) }
}

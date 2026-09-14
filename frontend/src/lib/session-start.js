// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { buildSets, applyIntensifierPlan, sessionSetCount } from './history.js'
import { nextPrescription, applyPrescription, defaultIncrement } from './progression.js'
import { applyDeload } from './mesocycle.js'

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
    const built = applyIntensifierPlan(applyPrescription(buildSets(st, cfg, { step, useTarget: excluded }), plan, step), cfg)
    const sets = deload > 0 ? applyDeload(built, deload, step) : built
    // The set count comes from the exercise's own history, not the routine (sessionSetCount),
    // so the target records the count this session actually prescribed — that is what
    // readSession later judges "every planned set done" against.
    return { id: cfg.id, sg: cfg.sg, target: { ...cfg, sets: sessionSetCount(st, cfg, { useTarget: excluded }) }, plan, sets }
  })
  return { entries, excluded }
}

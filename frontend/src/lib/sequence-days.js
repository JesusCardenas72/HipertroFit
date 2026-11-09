// The days of Home's microcycle strip: what was trained, and what the sequence still has ahead.
//
// The calendar projection (lib/program.js) pins each step of the sequence to a date, so a
// session that was due and not trained just disappears and the next ones stay where they were.
// The strip reads it the other way round. Days gone by are history — the session logged that day,
// or nothing. The days ahead are the sequence carried on from the last session trained: its rest
// days pass with the calendar, but a training day that goes by untrained is not used up — that
// session is still the next one, so it and everything after it move on a day, in the same order
// and with the same rest days between them. The sessions still to do are the open steps of the
// block (blockFill), in order; once those are laid out the block's trailing rest days follow and
// the next block starts again from the top of the sequence.
//
// A per-day change (S.dayPlan) on today or later still shows on its day, and leaves the sequence
// where it was for the days after it.

import { REST } from './program.js'
import { blockFill, cycleStartOf, isExtra, addDays } from './microcycle.js'
import { effectiveRoutineId } from './history.js'
import { todayISO } from './format.js'

const isRest = step => !step || step === REST

/**
 * The sessions and rest days the sequence still has ahead, from the day after the last session
 * of the block: [routineId | REST], `count` long. null without a sequence to walk.
 */
export function sequenceQueue(S, count) {
  const seq = Array.isArray(S && S.program && S.program.seq) ? S.program.seq : []
  const { steps, open, filled } = blockFill(S)
  if (!steps.length) return null
  // Where each training step sits in the sequence, and a block position as a walk index.
  const at = seq.map((step, i) => isRest(step) ? -1 : i).filter(i => i >= 0)
  const walkOf = pos => Math.floor(pos / steps.length) * seq.length + at[pos % steps.length]
  const restAt = i => isRest(seq[i % seq.length])
  const out = []
  let i = filled.length ? walkOf(filled[filled.length - 1]) + 1 : 0
  // The rest of this block: its rest days as laid out, its training days taking the open steps in order.
  for (let k = 0; k < open.length && out.length < count; i++) {
    out.push(restAt(i) ? REST : steps[open[k++] % steps.length])
  }
  // Its trailing rest days, up to where the sequence starts over …
  while (out.length < count && i % seq.length && restAt(i)) { out.push(REST); i++ }
  // … and the blocks after it, each from the top.
  for (let j = 0; out.length < count; j++) out.push(isRest(seq[j % seq.length]) ? REST : seq[j % seq.length])
  return out
}

/**
 * `n` days from `from`: { iso, wd, dn, done, state, routineId }.
 *
 * state is 'done' (a session was logged: `done` is it, `routineId` what it trained), 'planned'
 * (a session ahead, `routineId`), 'rest' (a rest day ahead), 'missed' (a day gone by that had a
 * session due and none was trained: `routineId` is the one that moved on) or 'past' (a day gone
 * by with nothing due and nothing logged).
 */
export function sequenceDays(S, n, from, today = todayISO()) {
  const workouts = (S && S.workouts) || []
  const dayPlan = (S && S.dayPlan) || {}
  const loggedOn = iso => workouts.filter(w => w.d === iso && !isExtra(w)).at(-1) || null
  const dates = Array.from({ length: n }, (_, i) => addDays(from, i))
  const last = from && dates[dates.length - 1]

  // Where the walk starts: the day after the last session of the block, or the block's start.
  const { done } = blockFill(S)
  const start = done.length ? addDays(done[done.length - 1].d, 1) : cycleStartOf(S)
  const span = start <= last ? Math.round((new Date(last + 'T12:00:00') - new Date(start + 'T12:00:00')) / 86400000) + 1 : 0
  const queue = sequenceQueue(S, span + 1)

  // Walk from `start` to the end of the strip, deciding what each day holds.
  const planOf = new Map()
  if (queue) {
    let q = 0
    for (let d = 0; d < span; d++) {
      const iso = addDays(start, d)
      const own = iso >= today ? dayPlan[iso] : undefined
      if (own !== undefined) { planOf.set(iso, own === 'rest' ? REST : own); continue }
      const step = queue[q]
      if (iso >= today) { planOf.set(iso, step); q++ }
      else if (isRest(step)) { planOf.set(iso, REST); q++ }   // a rest day passes with the calendar
      else planOf.set(iso, { missed: step })                 // an untrained session waits for the next day
    }
  }

  return dates.map(iso => {
    const date = new Date(iso + 'T12:00:00')
    const base = { iso, wd: date.getDay(), dn: date.getDate(), done: loggedOn(iso) }
    if (base.done) return { ...base, state: 'done', routineId: base.done.routineId || null }
    let step = planOf.get(iso)
    // Before the walk (or with no sequence at all) the days ahead are the calendar's.
    if (step === undefined) step = iso >= today ? (effectiveRoutineId(S, iso) || REST) : REST
    if (step && typeof step === 'object') return { ...base, state: 'missed', routineId: step.missed }
    if (iso < today) return { ...base, state: 'past', routineId: null }
    return isRest(step) ? { ...base, state: 'rest', routineId: null } : { ...base, state: 'planned', routineId: step }
  })
}

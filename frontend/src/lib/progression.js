// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf, repStep, rerampWarmups } from './history.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { normalizeRepRange } from './rep-range.js'
import { ladderOf, snapLoad, stepOf, minLoadOf } from './load-scale.js'

export const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time']

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR = {
  reps: ['off', 'linear', 'greyskull', 'double'],
  time: ['off', 'time'],
  cardio: ['off']
}

export const POLICY_NAME = {
  off: 'No automatic progression',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  time: 'Add time'
}
export const POLICY_DESC = {
  off: 'Targets stay where you set them.',
  linear: 'Hit every rep in every set and the weight goes up. Repeated misses trigger a deload.',
  greyskull: 'Two straight sets plus a final set taken to failure. Beat the target on that set and the weight goes up — double if you double the reps. One failure resets 10 %.',
  double: 'Work up through a rep range at the same weight. Reach the top of the range in every set and the weight goes up, reps back to the bottom.',
  time: 'Hold every set for the full duration and the target goes up.'
}

// Sessions of repeated misses before a deload. Greyskull resets on the first failure by
// design; the general linear policy gives you two more cracks at it first.
export const DELOAD_AFTER = { linear: 3, greyskull: 1, double: 3, time: 3 }
const DELOAD_FACTOR = 0.9

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}
// The weights this exercise can be loaded with (see lib/load-scale.js): the ladder of a set of
// adjustable dumbbells when it is set up for them, else multiples of the default increment.
export function loadScaleFor(cfg, unit) {
  return ladderOf(cfg) || defaultIncrement(cfg && cfg.id, unit)
}
export const DEFAULT_SEC_INCREMENT = 5
// Where adding another set of push-ups stops being progress and starts being a way to spend
// an evening. Past this the honest advice is load or a harder variation (issue #33).
export const MAX_BW_SETS = 6

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(cfg, routine, mode) {
  const m = mode || modeOf(cfg || {})
  const allowed = POLICIES_FOR[m] || ['off']
  const pick = (cfg && cfg.prog) || (routine && routine.prog) || (m === 'reps' ? 'linear' : 'off')
  return allowed.includes(pick) ? pick : 'off'
}

// Snap to a loadable weight: a multiple of the step, or a rung of the ladder.
const snap = (v, scale) => snapLoad(v, scale)
// Back off by DELOAD_FACTOR, landing on something you can actually load. Rounding to the
// nearest step keeps the cut close to the intended 10 %, but on small weights the nearest
// step can be the weight you started from — so a deload that did not actually reduce
// anything takes one step down instead. Never goes below a single step (or the first rung).
function deloadTo(cur, scale) {
  let next = snap(cur * DELOAD_FACTOR, scale)
  if (next >= cur) next = snap(cur - stepOf(scale), scale)
  return Math.max(minLoadOf(scale), next)
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Workouts only started recording their prescription in v1.2.2, so most existing history has
 * no `target` at all. Judging those against nothing would score every past session as a miss
 * — and then greet a long-standing user with "missed reps 11 sessions running, deload". So an
 * entry without its own target is judged against `fallback`, the exercise's current plan,
 * which is exactly what the app's old weight hint compared against.
 */
export function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {}
  const mode = modeOf({ ...target, id: entry && entry.id })
  // Warm-up rows are prep, not the session: one filtered read beats guarding every consumer
  // below (an undone warm-up otherwise poisons `ok` forever and its reps drag `low`/`count`).
  const sets = ((entry && entry.sets) || []).filter(s => !isWarmupRow(s))
  const planned = target.sets || sets.length
  const enough = sets.length >= planned

  if (mode === 'time') {
    const goal = target.sec || 0
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0))
    return {
      mode, goal, held,
      weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
      best: Math.max(0, ...held),
      ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal)
    }
  }
  const goal = target.reps || 0
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0))
  return {
    mode, goal, reps,
    weight: Math.max(0, ...sets.filter(s => s.done).map(s => s.w || 0)),
    count: reps.length,                                   // the dimension bodyweight work grows (#33)
    // Sets that session was worth: what it prescribed, or more when sets were added on the day.
    // It is what the next session starts from, whichever routine it is in (sessionSetCount).
    setCount: Math.max(planned, reps.length),
    low: reps.length ? Math.min(...reps) : 0,
    amrap: reps.length ? reps[reps.length - 1] : 0,       // Greyskull's final set
    fatigued: repsFell(sets),
    // The rep aim double progression asked for that session, when it recorded one.
    aim: entry && entry.aim > 0 ? entry.aim : 0,
    ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal)
  }
}

/**
 * Reps that fall from one performed set to the next — at the same or a lighter load — mean the
 * session arrived at those sets tired. Double progression reads that as "not ready": no more
 * reps, no more weight, however high the numbers were. A heavier set doing fewer reps is not
 * fatigue, it is the load, so a rise in weight between two sets never counts.
 */
export function repsFell(sets) {
  const done = (sets || []).filter(s => s && s.done && !isWarmupRow(s))
  for (let i = 1; i < done.length; i++) {
    if ((done[i].r || 0) < (done[i - 1].r || 0) && (done[i].w || 0) <= (done[i - 1].w || 0)) return true
  }
  return false
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(S, exId, fallback) {
  const out = []
  ;(S.workouts || []).forEach(w => {
    // A planned deload remains a real workout for history and statistics, but it cannot become
    // the baseline for the next regular prescription. The routine flag is copied onto the
    // active session, then onto this completed workout, so later routine edits do not rewrite it.
    if (w.excludeFromProgression === true) return
    const entry = w.entries.find(e => e.id === exId)
    if (entry && entry.sets.some(s => s.done && !isWarmupRow(s))) out.push({ d: w.d, ...readSession(entry, fallback) })
  })
  return out
}

/**
 * Double progression reads a session differently from a load-every-time policy. Climbing from
 * 9 to 10 reps at the same weight is the plan working, not a miss — so a session only counts
 * against the deload when it was fatigued (reps fell set to set) or did no more total reps than
 * the one before it at that weight. The first session at a weight is a fresh start.
 *
 * `topHit` — every planned set at the top of today's range, with no drop between sets — is
 * judged against the exercise's current range, not the one stored with the old session, so
 * widening a range never leaves an exercise stuck on "ready".
 */
export function judgeDouble(sessions, top) {
  return sessions.map((s, i) => {
    const prev = sessions[i - 1]
    const total = (s.reps || []).reduce((a, r) => a + r, 0)
    const prevTotal = prev ? (prev.reps || []).reduce((a, r) => a + r, 0) : 0
    const full = (s.reps || []).length > 0 && s.reps.length >= (s.setCount || 0)
    const topHit = !s.fatigued && full && s.reps.every(r => r >= top)
    const climbed = !prev || prev.weight !== s.weight || total > prevTotal
    return { ...s, topHit, ok: topHit || (!s.fatigued && climbed) }
  })
}

// How many sessions in a row ended in a miss, counting back from the most recent.
export function stallCount(sessions) {
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].ok) break
    n++
  }
  return n
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said. A `hold`/`decide` on a loaded lift
 * also carries `top` (the most reps the plan asks for) and `stride` (the rep step), so each set
 * row can still overload with a rep when the session as a whole holds (see targetFor).
 */
export function nextPrescription(S, cfg, routine) {
  const mode = modeOf(cfg)
  const policy = policyFor(cfg, routine, mode)
  const unit = S.unit || 'kg'
  const ladder = mode === 'time' ? null : ladderOf(cfg)
  const inc = cfg.inc > 0 ? cfg.inc
    : (mode === 'time' ? DEFAULT_SEC_INCREMENT : ladder ? ladder.step : defaultIncrement(cfg.id, unit))
  // Where a new weight has to land: on adjustable dumbbells 5.5 + 1.5 is 7, not 7.5.
  const scale = ladder || inc
  if (policy === 'off') return { policy, kind: 'off' }

  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode)
  const last = sessions[sessions.length - 1]
  if (!last) return { policy, kind: 'first', why: ['Nothing logged yet — this session sets the baseline.'] }

  const stalls = stallCount(sessions)
  const deloadAt = DELOAD_AFTER[policy] || 3

  if (mode === 'time') {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + inc
      return { policy, kind: 'up', sec, why: ['Held every set for the full time — target up by {0}s.', inc] }
    }
    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5)
      return { policy, kind: 'deload', sec, why: ['Short {0} sessions in a row — back off to {1}s and build up again.', stalls, sec] }
    }
    return { policy, kind: 'hold', sec: last.goal || cfg.sec, why: ['Last time came up short — same target again.'] }
  }

  const w = last.weight
  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs ahead
  // of the individual policies because it is true for all of them. Note the trigger is the
  // *logged* weight, not the `bw` flag: a dip done with a belt has a load to progress and
  // belongs on the normal policies, and a barbell lift logged at 0 has nothing to add to.
  if (w <= 0) {
    const goal = last.goal || cfg.reps || 0
    if (!last.ok || goal <= 0) return { policy, kind: 'hold', weight: 0, reps: goal || undefined, why: ['Bodyweight — same target again until every set is clean.'] }
    // A ceiling turns "+1 rep forever" into a plan (issue #33). Past the top of the range the
    // reps go back to the bottom and a set is added instead, which is how bodyweight work
    // actually progresses once a set of 30 push-ups stops being a strength stimulus.
    const top = cfg.repsMax > 0 ? cfg.repsMax : 0
    if (top > 0 && goal >= top) {
      const sets = Math.max(1, last.setCount || cfg.sets || 1) + 1
      const bottom = Math.max(1, Math.min(cfg.reps || top, top))
      if (sets <= MAX_BW_SETS) return { policy, kind: 'up', weight: 0, reps: bottom, sets, why: ['{0} reps in every set — add a set and go back to {1}.', goal, bottom] }
      // Out of sets worth adding: more volume is no longer the answer, load or a harder
      // variation is — and that is a decision for a person, not a policy.
      return { policy, kind: 'hold', weight: 0, reps: goal, why: ['{0} sets of {1} — time to add weight or move to a harder variation.', sets - 1, goal] }
    }
    // Unilateral work steps by two, so the total stays even and both sides get the rep.
    const next = goal + repStep(cfg)
    return { policy, kind: 'up', weight: 0, reps: next, why: ['Bodyweight — every rep last time, so go for {0} this time.', next] }
  }
  if (policy === 'double') {
    const range = normalizeRepRange(cfg.reps || last.goal || 10, cfg.repsMin, repStep(cfg))
    const top = range.reps
    const bottom = range.repsMin
    const judged = judgeDouble(sessions, top)
    const dstalls = stallCount(judged)
    const clamp = r => Math.min(top, Math.max(bottom, r))
    if (judged[judged.length - 1].topHit) {
      // Semi-automatic: the top of the range earns the next step, but whether that step is a
      // plate or another set — and how big — is the athlete's call, asked in the session.
      const sets = Math.max(1, last.setCount || cfg.sets || 1)
      return {
        policy, kind: 'decide', weight: w, reps: top, top, stride: repStep(cfg),
        choice: { inc, weight: snap(w + inc, scale), sets, reps: bottom },
        why: ['Top of the rep range in every set — time to progress: more weight or another set.']
      }
    }
    if (dstalls >= deloadAt) {
      const dw = deloadTo(w, scale)
      return { policy, kind: 'deload', weight: dw, reps: bottom, why: ['Stalled {0} sessions — deload to {1} {2}.', dstalls, dw, unit] }
    }
    if (last.fatigued) {
      // Reps fell set to set: repeat the aim, never raise it.
      const aim = clamp(last.aim > 0 ? last.aim : last.low)
      return { policy, kind: 'hold', fatigue: true, weight: w, reps: aim, why: ['Reps dropped from set to set — you arrived fatigued. Same weight and {0} reps, no overload this time.', aim] }
    }
    const aim = clamp(last.low + repStep(cfg))
    return { policy, kind: 'hold', weight: w, reps: aim, top, stride: repStep(cfg), why: ['Same weight — aim for {0} reps this time.', aim] }
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const dbl = policy === 'greyskull' && last.goal > 0 && last.amrap >= last.goal * 2
    const step = dbl ? inc * 2 : inc
    return {
      policy, kind: 'up', weight: snap(w + step, scale),
      why: dbl
        ? ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', last.amrap, step, unit]
        : ['Every rep last time — {0} {1} more.', step, unit]
    }
  }
  if (stalls >= deloadAt) {
    const dw = deloadTo(w, scale)
    return {
      policy, kind: 'deload', weight: dw,
      why: stalls > 1
        ? ['Missed reps {0} sessions running — reset to {1} {2} and work back up.', stalls, dw, unit]
        : ['Missed reps — reset to {0} {1} and work back up.', dw, unit]
    }
  }
  return { policy, kind: 'hold', weight: w, top: last.goal || cfg.reps || undefined, stride: repStep(cfg), why: ['Missed reps last time — same weight again ({0} of {1} to go).', deloadAt - stalls, deloadAt] }
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription(sets, p, step = 2.5) {
  if (!p || p.kind === 'off' || p.kind === 'first') return sets
  const out = sets.map(s => {
    // Never rewrite a logged set, and never rewrite a warm-up: the prescription speaks to
    // the work rows only (a ticked warm-up falling through here would be the data-loss the
    // cascade fix removed, two files over).
    if (s.done || isWarmupRow(s)) return s
    const o = { ...s }
    if (p.weight != null) o.w = p.weight
    if (p.reps != null) o.r = p.reps
    if (p.sec != null) o.sec = p.sec
    return o
  })
  // A policy that decided on a set count gets to grow the list — bodyweight progression adds
  // a set where a barbell would have added a plate. Only ever upwards, and only by copying a
  // row that is already there: a session in progress must not lose a set it has logged.
  const workRows = out.filter(s => !isWarmupRow(s))
  if (p.sets > workRows.length) {
    // An all-warm-up entry has no work row to seed growth from - growing warm-up copies
    // would both invent work and never terminate the loop. Leave the entry untouched.
    if (!workRows.length) return rerampWarmups(out, step)
    const seed = workRows[workRows.length - 1]
    // A freshly appended row hasn't been performed, so it never inherits a seed's already-
    // logged drops/clusters — that would invent extra work the row never actually did. Its
    // `type` is kept: that's the exercise's plan (every set is a drop-set/rest-pause), not
    // something this particular row logged.
    const { drops, clusters, ...plainSeed } = seed
    while (out.filter(s => !isWarmupRow(s)).length < p.sets) out.push({ ...plainSeed, done: false })
  }
  // Last, because the work rows now carry their final weight: the warm-up block ramps toward
  // what you are actually about to lift, not toward what you lifted last time.
  return rerampWarmups(out, step)
}

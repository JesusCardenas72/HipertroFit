// Double progression, seen from where the athlete stands (the tracking view) and decided in the
// session it becomes due (the semi-automatic step).
//
// The engine (progression.js) stays the source of truth: it says whether the top of the range
// was earned (`kind: 'decide'`), whether reps fell set to set (`fatigue`) and what to aim for.
// This file only reads that back as a picture — where each set sits inside the rep range, how
// many reps are left before the next step — and applies the choice the athlete makes.

import { modeOf, repStep, rerampWarmups } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { normalizeRepRange } from './rep-range.js'
import { nextPrescription, policyFor, sessionsFor, stallCount, judgeDouble, DELOAD_AFTER } from './progression.js'

const round1 = v => Math.round(v * 10) / 10

/**
 * Every exercise that progresses by double progression in some routine, once each — the
 * progression is the exercise's own (a global field), so the first routine that uses it speaks
 * for all of them.
 */
export function doubleProgressExercises(S) {
  const seen = new Set()
  const out = []
  ;(S.routines || []).forEach(routine => {
    if (routine.excludeFromProgression === true) return
    ;(routine.ex || []).forEach(cfg => {
      if (!cfg || seen.has(cfg.id)) return
      const mode = modeOf(cfg)
      if (mode !== 'reps' || policyFor(cfg, routine, mode) !== 'double') return
      seen.add(cfg.id)
      out.push({ cfg, routine })
    })
  })
  return out
}

/**
 * Where one exercise stands in its double progression.
 *
 * `state` is one of
 *   first   — nothing logged yet
 *   climbing— same weight, reps still going up through the range
 *   ready   — top of the range in every set, the next session asks what to add
 *   fatigue — reps fell from set to set last time: no overload next session
 *   deload  — stalled long enough that the weight comes down
 *   bodyweight — no load to add; the engine grows reps and sets instead
 *
 * `progress` (0–1) is how far through the range the planned sets are, every set weighing the
 * same and a missing set counting as the bottom. `sessionsLeft` is the engine's own pace — one
 * rep more on the weakest set per clean session — so it is an estimate, not a promise.
 */
export function doubleProgressStatus(S, cfg, routine) {
  const step = repStep(cfg)
  const range = normalizeRepRange(cfg.reps || 10, cfg.repsMin, step)
  const top = range.reps
  const bottom = range.repsMin
  const plan = nextPrescription(S, cfg, routine)
  const sessions = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === 'reps')
  const last = sessions[sessions.length - 1] || null
  // Sets follow the exercise, not the routine: last session's count, from whichever routine.
  const planned = Math.max(1, (last && last.setCount) || cfg.sets || 1)
  const base = { id: cfg.id, top, bottom, planned, plan, last }
  if (!last) return { ...base, state: 'first', weight: cfg.weight || 0, reps: [], progress: 0, repsLeft: null, sessionsLeft: null, history: [] }

  const weight = last.weight
  // The sessions at today's working weight, newest last — the climb this weight has made.
  const history = []
  for (let i = sessions.length - 1; i >= 0 && history.length < 6; i--) {
    if (sessions[i].weight !== weight) break
    history.unshift({ d: sessions[i].d, reps: sessions[i].reps, fatigued: sessions[i].fatigued })
  }
  const reps = Array.from({ length: Math.max(planned, last.reps.length) }, (_, i) => last.reps[i] ?? 0)
  const span = Math.max(1, top - bottom)
  const counted = reps.slice(0, planned)
  while (counted.length < planned) counted.push(0)
  const progress = counted.reduce((a, r) => a + Math.min(1, Math.max(0, (r - bottom) / span)), 0) / planned
  const repsLeft = counted.reduce((a, r) => a + Math.max(0, top - r), 0)
  const low = counted.length ? Math.min(...counted) : 0

  let state
  if (weight <= 0) state = 'bodyweight'
  else if (plan.kind === 'decide') state = 'ready'
  else if (plan.kind === 'deload') state = 'deload'
  else if (plan.fatigue) state = 'fatigue'
  else state = 'climbing'

  const judged = judgeDouble(sessions, top)
  const stalls = state === 'ready' ? 0 : stallCount(judged)
  const sessionsLeft = state === 'ready' ? 0 : Math.max(1, Math.ceil(Math.max(0, top - low) / step))
  return {
    ...base, state, weight, reps, progress: round1(progress * 100) / 100, repsLeft, sessionsLeft,
    stalls, deloadAt: DELOAD_AFTER.double, history
  }
}

/**
 * Apply the athlete's answer to a `decide` prescription on the session entry.
 *
 *   { type: 'weight', amount } — heavier by `amount`, reps back to the bottom of the range
 *   { type: 'sets', amount }   — `amount` more sets at the same weight, reps back to the bottom
 *   { type: 'keep' }           — nothing changes; the question comes back next session
 *
 * Only rows not yet logged are rewritten; warm-ups re-ramp toward the new working weight.
 * Returns a new entry (target, plan and sets), never mutates the one given.
 */
export function applyProgressionChoice(entry, choice, { step = 2.5, unit = 'kg' } = {}) {
  const plan = entry && entry.plan
  if (!plan || plan.kind !== 'decide' || !choice) return entry
  const c = plan.choice || {}
  const type = choice.type
  if (type === 'keep') {
    return { ...entry, decided: 'keep', plan: { ...plan, kind: 'hold', why: ['Top of the range again — keeping weight and sets this session.'] } }
  }
  const amount = Number(choice.amount)
  if (!(amount > 0)) return entry
  const bottom = c.reps || plan.reps
  let sets = (entry.sets || []).map(s => (s.done || isWarmupRow(s) ? s : { ...s, r: bottom }))
  if (type === 'weight') {
    const to = round1((plan.weight || 0) + amount)
    sets = sets.map(s => (s.done || isWarmupRow(s) ? s : { ...s, w: to }))
    return {
      ...entry, decided: 'weight',
      sets: rerampWarmups(sets, step),
      plan: { ...plan, kind: 'up', weight: to, reps: bottom, why: ['Top of the rep range in every set — {0} {1} more, back to {2} reps.', amount, unit, bottom] }
    }
  }
  if (type === 'sets') {
    const add = Math.max(1, Math.round(amount))
    const work = sets.filter(s => !isWarmupRow(s))
    const total = (c.sets || work.length) + add
    if (work.length) {
      const { drops, clusters, rir, rpe, ...seed } = work[work.length - 1]
      while (sets.filter(s => !isWarmupRow(s)).length < total) sets.push({ ...seed, r: bottom, done: false })
    }
    return {
      ...entry, decided: 'sets',
      sets,
      target: { ...(entry.target || {}), sets: total },
      plan: { ...plan, kind: 'up', reps: bottom, sets: total, why: ['Top of the rep range in every set — {0} more set(s), back to {1} reps.', add, bottom] }
    }
  }
  return entry
}

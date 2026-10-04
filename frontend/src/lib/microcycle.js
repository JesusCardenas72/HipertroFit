// The microcycle as a counted block of sessions, not a stretch of calendar.
//
// A training strategy defines how many sessions close one microcycle — full body 3,
// upper/lower 4 (and any similar four-day split, whatever it mixes), push/pull/legs 6.
// None of those map onto a week: six sessions with rest days interleaved routinely span
// nine or ten days, so anything counted per week cuts a microcycle in half.
//
// So a microcycle is counted in sessions from an explicit start (`program.cycleStart`).
// The end needs no marking: session `len` closes the block and session `len + 1` opens the
// next one. Rest days are free — train Tuesday or train Thursday, either way the session
// that happens is the next step of the sequence. That is why the routine to propose comes
// from a *positional* pointer (`nextStepOf`) and not from projecting the sequence onto
// dates: a sequence like Push A, Pull A, Legs, Push B, Pull B, Legs repeats a routine, and
// only the position tells the two Legs days apart.
//
// See lib/program.js for the calendar projection (which days you intend to train) and
// lib/volume.js for what the block's volume adds up to.

import { REST, sessionsPerRound, emptyProgram } from './program.js'
import { todayISO, isoOf } from './format.js'

/** Sessions per microcycle by training strategy. `custom` counts the user's own sequence. */
export const STRATEGIES = [
  { key: 'full-body', name: 'Full body', sessions: 3 },
  { key: 'upper-lower', name: 'Upper / Lower', sessions: 4 },
  { key: 'ppl', name: 'Push / Pull / Legs', sessions: 6 },
  { key: 'custom', name: 'Custom', sessions: 0 },
]

const BY_KEY = Object.fromEntries(STRATEGIES.map(s => [s.key, s]))

/** Fallback block length when nothing says otherwise — two PPL rounds. */
export const DEFAULT_MICROCYCLE = 6

/**
 * This profile's strategy key.
 *
 * An explicit `program.strategy` wins. Without one — every state saved before strategies
 * existed — it is inferred from the manual session count that used to be the only setting,
 * so a profile that had 6 there keeps a 6-session microcycle and simply gains the label.
 */
export function strategyOf(S) {
  const key = S && S.program && S.program.strategy
  if (key && BY_KEY[key]) return key
  const legacy = Math.round(Number(S && S.microcycleSessions))
  const match = STRATEGIES.find(s => s.sessions && s.sessions === legacy)
  return match ? match.key : 'custom'
}

/** Sessions that close one microcycle for this profile. */
export function microcycleLen(S) {
  const preset = BY_KEY[strategyOf(S)]
  if (preset && preset.sessions) return preset.sessions
  // Custom: the sequence itself is the block — its training (non-rest) steps.
  const seq = sessionsPerRound(S && S.program)
  if (seq >= 1) return seq
  const legacy = Math.round(Number(S && S.microcycleSessions))
  return legacy >= 1 ? legacy : DEFAULT_MICROCYCLE
}

// Completed workouts oldest→newest. Stored in append order, but sorted defensively: a
// backfilled session is written at the end and belongs at its own date.
const sorted = workouts => (workouts || []).slice()
  .sort((a, b) => String(a.d).localeCompare(String(b.d)) || (a.start || 0) - (b.start || 0))

/**
 * The day the current run of microcycles started counting from.
 *
 * `program.cycleStart` when the user set one, the program anchor next (a program built
 * before this existed started its first block at its anchor), then the first workout ever
 * — so the count works for someone with history and no programming at all.
 */
export function cycleStartOf(S) {
  const prog = (S && S.program) || null
  if (prog && prog.cycleStart) return prog.cycleStart
  if (prog && prog.anchor) return prog.anchor
  const first = sorted(S && S.workouts)[0]
  return first ? first.d : todayISO()
}

/** Completed sessions on or after the microcycle start, oldest→newest. */
export function sessionsSince(S) {
  const start = cycleStartOf(S)
  return sorted(S && S.workouts).filter(w => String(w.d) >= start)
}

/**
 * Where the profile stands in its block: which microcycle, and which session of it comes
 * next. `step` is the zero-based position of the *next* session, so `step === 0` means the
 * previous block just closed and nothing of this one is logged yet.
 */
export function cyclePosition(S) {
  const len = microcycleLen(S)
  const sessions = sessionsSince(S).filter(w => isPlannedSession(S, w)).length
  return {
    len,
    start: cycleStartOf(S),
    sessions,
    cycle: Math.floor(sessions / len),
    step: sessions % len,
    remaining: len - (sessions % len),
  }
}

/**
 * The day a block closed by hand today starts counting from.
 *
 * Today, unless a session is already logged for today (or later): sessions are counted from
 * `cycleStart` inclusive, so starting the new block today would pull the session that just
 * closed the old one into it. Then it starts the day after the last logged session.
 */
export function nextCycleStart(S, today = todayISO()) {
  const last = sorted(S && S.workouts).at(-1)
  if (!last || String(last.d) < today) return today
  const d = new Date(String(last.d) + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return isoOf(d)
}

/**
 * The program after closing the running microcycle by hand and opening a new one under
 * `strategy`: the strategy is set and the count restarts, so the new block is #1 with its
 * volume at zero. The sequence, anchor and on/off switch are left as they are — they are the
 * calendar layout, not the block. An unknown strategy falls back to `custom`.
 */
export function closeMicrocycle(S, strategy, today = todayISO()) {
  const prev = (S && S.program) || emptyProgram(today)
  return {
    ...prev,
    strategy: BY_KEY[strategy] ? strategy : 'custom',
    cycleStart: nextCycleStart(S, today),
  }
}

/** The training (non-rest) steps of the sequence, in order — the routines of one block. */
export const trainingSteps = program =>
  (Array.isArray(program?.seq) ? program.seq : []).filter(s => s && s !== REST)

/**
 * Whether a logged session is one of the block's counted steps.
 *
 * A freestyle session — started with "pick as you go", so it carries no routine — is
 * training done outside the planning. It must not consume a slot of the microcycle nor
 * move the sequence pointer on: if it did, the planned session it displaced would fall out
 * of the block and its volume with it. The block still counts `len` planned sessions; the
 * off-plan one rides along, and everything it trained is added to the block's volume all
 * the same (see cycleWorkouts).
 *
 * Training a routine out of turn is a different thing — that *is* one of the planned
 * sessions, just not the one the pointer proposed — so it keeps consuming its slot. And
 * with no sequence to be outside of (no program, or an all-freestyle log) every session is
 * the plan, or the block would never advance at all.
 */
export const isPlannedSession = (S, w) =>
  !trainingSteps(S && S.program).length || !!(w && w.routineId)

/**
 * The routine id the next session should be, by position in the sequence.
 *
 * Positional on purpose: with Push A, Pull A, Legs, Push B, Pull B, Legs the routine alone
 * cannot say which Legs day is due. null when there is no sequence to walk.
 */
export function nextStepOf(S) {
  const steps = trainingSteps(S && S.program)
  if (!steps.length) return null
  return steps[cyclePosition(S).step % steps.length]
}

/**
 * Everything logged so far in the current microcycle, oldest→newest — the block's volume
 * window. Off-plan (freestyle) sessions are in it even though they are not steps of the
 * block: train something extra mid-microcycle and every set of it counts toward this
 * microcycle's volume.
 */
export function cycleWorkouts(S) {
  const len = microcycleLen(S)
  const done = sessionsSince(S)
  const planned = []
  for (let i = 0; i < done.length; i++) if (isPlannedSession(S, done[i])) planned.push(i)
  const step = planned.length % len
  // Where the block opened: at its first planned session, or — when the previous block
  // just closed and this one has not started — right after that closing session, so an
  // off-plan workout trained in between belongs to the block that is opening.
  const from = step === 0
    ? (planned.length ? planned[planned.length - 1] + 1 : 0)
    : planned[planned.length - step]
  return done.slice(from)
}

/**
 * The current block as a strip of `len` slots for the UI: what was trained in each slot so
 * far, what the sequence says is coming, and where "next" sits. A done slot reports the
 * workout that actually happened, which may not be what the sequence planned — the strip
 * shows the block as trained, not as intended.
 */
export function cycleStrip(S) {
  const { len, step } = cyclePosition(S)
  const done = cycleWorkouts(S).filter(w => isPlannedSession(S, w))
  const steps = trainingSteps(S && S.program)
  const out = []
  for (let i = 0; i < len; i++) {
    const workout = i < step ? done[i] : null
    out.push({
      i,
      state: workout ? 'done' : i === step ? 'next' : 'todo',
      routineId: workout ? workout.routineId || null : (steps.length ? steps[i % steps.length] : null),
      workout,
    })
  }
  return out
}

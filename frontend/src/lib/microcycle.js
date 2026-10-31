// The microcycle as a counted block of sessions, not a stretch of calendar.
//
// A training strategy defines how many sessions close one microcycle — full body 3,
// upper/lower 4 (and any similar four-day split, whatever it mixes), push/pull/legs 6.
// None of those map onto a week: six sessions with rest days interleaved routinely span
// nine or ten days, so anything counted per week cuts a microcycle in half.
//
// So a microcycle is counted in sessions from an explicit start (`program.cycleStart`).
// Rest days are free — train Tuesday or train Thursday, either way the session that happens
// is the next step of the sequence. That is why the routine to propose comes from a
// *positional* pointer (`nextStepOf`) and not from projecting the sequence onto dates: a
// sequence like Push A, Pull A, Legs, Push B, Pull B, Legs repeats a routine, and only the
// position tells the two Legs days apart. A step trained out of turn fills its own position,
// so Legs done where Pull A was due leaves Pull A as the next session.
//
// Session `len` completes the block but does not close it: a microcycle is also its days,
// rest days included, so it runs on until those have passed (cycleEndOf) and the next one is
// opened only once the user says so — when the app asks at the end of its days, when a
// session that would open the next one is started, or by hand. Closing writes the block to
// `S.cycleLog` with its dates (lib/cycle-history.js), which is what lets Home and Stats show
// the microcycles already behind. A profile saved before that log existed has no closings on
// record: its count is still split every `len` planned sessions (countedBlocks), the next
// planned session after a full block being the one that opened the next block.
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

/** `iso` moved by `n` calendar days (negative goes back). */
export function addDays(iso, n) {
  const d = new Date(String(iso) + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

/**
 * The microcycles closed on record (S.cycleLog), oldest→newest: { start, end, n, sessions,
 * len, strategy, deload } each, written when the block was closed (lib/cycle-history.js).
 * Entries without both dates are dropped rather than trusted.
 */
export function cycleLogOf(S) {
  const log = S && S.cycleLog
  return Array.isArray(log) ? log.filter(c => c && typeof c.start === 'string' && typeof c.end === 'string') : []
}

/**
 * The microcycles still counted from the start, oldest→newest — { start, workouts, planned }
 * each, the last one being the running microcycle.
 *
 * With closings on record (S.cycleLog is an array) that is always one block: everything logged
 * since `cycleStart`, however many planned sessions it holds — the count no longer closes a
 * block, the user does. Without them, the profile is one saved before closings were recorded
 * and the count splits it as it always did, every `len` planned sessions; only where the split
 * falls moved: not at the session that fills a block but at the next planned one, so the rest
 * days and the off-plan work after a full block stay in it. A block's start is the day that
 * session was trained (the first block's, the microcycle start).
 */
export function countedBlocks(S) {
  const len = microcycleLen(S)
  const split = !Array.isArray(S && S.cycleLog)
  const blocks = [{ start: cycleStartOf(S), workouts: [], planned: 0 }]
  for (const w of sessionsSince(S)) {
    const planned = isPlannedSession(S, w)
    let cur = blocks[blocks.length - 1]
    if (split && planned && cur.planned >= len) blocks.push(cur = { start: String(w.d), workouts: [], planned: 0 })
    cur.workouts.push(w)
    if (planned) cur.planned++
  }
  return blocks
}

/**
 * Where the profile stands in its block: which microcycle, and which session of it comes
 * next. `step` is the zero-based position of the *next* session, so `step === 0` means
 * nothing of this block is logged yet; it stops at `len` once the block is `complete` — all
 * its sessions done, its rest days possibly still running. `sessions` is the planned sessions
 * of this block, which can pass `len` when the user chose to keep training in it.
 */
export function cyclePosition(S) {
  const len = microcycleLen(S)
  const blocks = countedBlocks(S)
  const cur = blocks[blocks.length - 1]
  return {
    len,
    start: cur.start,
    sessions: cur.planned,
    cycle: blocks.length - 1,
    step: Math.min(cur.planned, len),
    remaining: Math.max(0, len - cur.planned),
    complete: cur.planned >= len,
  }
}

/**
 * How one microcycle lies on the days of the sequence: `days`, from its first step through
 * the rest days after its last session, and `tail`, those trailing rest days alone. Walked from
 * the top of the sequence, where every block starts (blockFill); the trailing rests stop at the
 * next training step or where the sequence starts over, since that is the next block's first
 * day. Without a sequence there are no rest days to wait for: { days: 0, tail: 0 }.
 */
export function cycleLayout(S) {
  const seq = Array.isArray(S && S.program && S.program.seq) ? S.program.seq : []
  const len = microcycleLen(S)
  if (!trainingSteps(S && S.program).length) return { days: 0, tail: 0 }
  const isRest = i => { const s = seq[i % seq.length]; return !s || s === REST }
  let i = 0, n = 0
  while (n < len) { if (!isRest(i)) n++; i++ }
  let tail = 0
  while (i % seq.length && isRest(i)) { tail++; i++ }
  return { days: i, tail }
}

/**
 * The last day of the running microcycle, or null while sessions of it are still to do.
 *
 * Its days are all of them, rest days included: no earlier than its whole span counted from
 * its start, and — when sessions slipped past that span — no earlier than the rest days that
 * follow its last session. Without a sequence it is the day of the last session.
 */
export function cycleEndOf(S) {
  const pos = cyclePosition(S)
  if (!pos.complete) return null
  const { days, tail } = cycleLayout(S)
  const last = cycleWorkouts(S).filter(w => !isExtra(w)).at(-1)
  const byLast = last ? addDays(last.d, tail) : pos.start
  const bySpan = addDays(pos.start, Math.max(0, days - 1))
  return byLast > bySpan ? byLast : bySpan
}

/** Whether the running microcycle is over: complete, and its last day gone by. */
export function cycleDue(S, today = todayISO()) {
  const end = cycleEndOf(S)
  return !!end && end < today
}

/**
 * Whether a session started now would open the next microcycle — and so has to be asked
 * about first: one the block counts (isPlannedSession), with the running block complete.
 * A routine id of null is a freestyle session.
 */
export function opensNextCycle(S, routineId) {
  return isPlannedSession(S, { routineId: routineId || null }) && cyclePosition(S).complete
}

/**
 * The day a block closed by hand today starts counting from.
 *
 * Today, unless a session is already logged for today (or later): sessions are counted from
 * `cycleStart` inclusive, so starting the new block today would pull the session that just
 * closed the old one into it. Then it starts the day after the last logged session.
 */
export function nextCycleStart(S, today = todayISO()) {
  // Loose extra work is not a session: logged today, it goes with the block that opens today.
  const last = sorted(S && S.workouts).filter(w => !isExtra(w)).at(-1)
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
 * sessions, just not the one the pointer proposed — so it keeps consuming a slot (its own
 * step, see blockFill). And
 * with no sequence to be outside of (no program, or an all-freestyle log) every session is
 * the plan, or the block would never advance at all.
 */
export const isPlannedSession = (S, w) =>
  !isExtra(w) && (!trainingSteps(S && S.program).length || !!(w && w.routineId))

/**
 * Loose work logged outside any session (lib/extra-log.js). Never a step of the block, with
 * or without a sequence: it is not a session, so it cannot be "the plan" the way a freestyle
 * session is on a profile that has none. Its sets still count toward the block's volume.
 */
export const isExtra = w => !!w && w.extra === true

/**
 * The current block replayed session by session: its planned sessions oldest→newest, and the
 * positions of the block (0…len−1) still open after them, in sequence order.
 *
 * Each session fills the first open position whose step is the routine it trained, so one
 * trained out of turn takes its own step and leaves the one it jumped over open. A session
 * with no open step of its own — a routine outside the sequence, or one trained more often
 * than the block plans it — stands in for the step that was due, the first open one. Either
 * way it fills exactly one position, so the block still closes on its count.
 */
function blockFill(S) {
  const len = microcycleLen(S)
  const steps = trainingSteps(S && S.program)
  const done = cycleWorkouts(S).filter(w => isPlannedSession(S, w))
  const open = Array.from({ length: len }, (_, i) => i)
  for (const w of done) {
    const own = steps.length ? open.findIndex(i => steps[i % steps.length] === w.routineId) : -1
    open.splice(own >= 0 ? own : 0, 1)
  }
  return { steps, done, open }
}

/**
 * The routine id the next session should be: the step at the first open position of the
 * block.
 *
 * Positional on purpose: with Push A, Pull A, Legs, Push B, Pull B, Legs the routine alone
 * cannot say which Legs day is due. Open rather than counted, so a step trained out of turn
 * is not proposed again while the one it skipped falls out of the block. null when there is
 * no sequence to walk.
 */
export function nextStepOf(S) {
  const steps = trainingSteps(S && S.program)
  if (!steps.length) return null
  const { open } = blockFill(S)
  return steps[(open.length ? open[0] : 0) % steps.length]
}

/**
 * Everything logged so far in the current microcycle, oldest→newest — the block's volume
 * window. Off-plan (freestyle) sessions are in it even though they are not steps of the
 * block: train something extra mid-microcycle and every set of it counts toward this
 * microcycle's volume.
 */
export function cycleWorkouts(S) {
  // The running block of countedBlocks: off-plan work after a full block stays in it until
  // the next one is opened, and once it is, the next one starts with nothing in it.
  return countedBlocks(S).at(-1).workouts
}

/**
 * The current block as a strip of `len` slots for the UI: what was trained in each slot so
 * far, what the sequence says is coming, and where "next" sits. A done slot reports the
 * workout that actually happened, which may not be what the sequence planned — the strip
 * shows the block as trained, not as intended. The done slots come first in the order they
 * were trained, then the steps still open in sequence order (blockFill), so "next" always sits
 * at the session count and a step skipped out of turn is still ahead.
 */
export function cycleStrip(S) {
  const { steps, done, open } = blockFill(S)
  const out = done.map((workout, i) => ({ i, state: 'done', routineId: workout.routineId || null, workout }))
  open.forEach((pos, k) => out.push({
    i: out.length,
    state: k === 0 ? 'next' : 'todo',
    routineId: steps.length ? steps[pos % steps.length] : null,
    workout: null,
  }))
  return out
}

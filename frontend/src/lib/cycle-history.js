// The microcycles as a list with dates — the running one and those already behind — and the
// writes that close one and open the next.
//
// A microcycle is closed only when the user says so (lib/microcycle.js): when the app asks at
// the end of its days, when a session that would open the next one is started, or with the
// "Close microcycle" button. Closing writes the block to `S.cycleLog` — its dates, its number
// in the mesocycle, how many sessions it held and whether it was a deload — and moves
// `program.cycleStart` to the day the next one opens. The log is what lets Home and Stats show
// a microcycle that is over: its sessions are read back from the workouts between its dates,
// so its volume is recounted from what is logged now, not frozen at the closing.
//
// A profile saved before the log existed has its blocks split by the session count instead
// (countedBlocks). Its first closing writes those blocks to the log too, so the history it
// already had is kept and every later one is counted the same way.

import {
  countedBlocks, cycleLogOf, cycleEndOf, cycleDue, microcycleLen, strategyOf,
  closeMicrocycle, nextCycleStart, addDays, isPlannedSession, cycleStartOf,
} from './microcycle.js'
import { emptyProgram } from './program.js'
import { microNumber, isDeloadCycle, isDeloadWorkout, shiftMeso } from './mesocycle.js'
import { todayISO } from './format.js'

const byDate = (a, b) => String(a.d).localeCompare(String(b.d)) || (a.start || 0) - (b.start || 0)

/** The workouts logged between two dates, both included, oldest→newest. */
export const workoutsBetween = (S, start, end) =>
  ((S && S.workouts) || []).filter(w => String(w.d) >= start && String(w.d) <= end).sort(byDate)

// One block of countedBlocks as the log stores it.
const entryOf = (S, block, k, end) => ({
  start: block.start,
  end,
  n: microNumber(S, k),
  sessions: block.planned,
  len: microcycleLen(S),
  strategy: strategyOf(S),
  deload: isDeloadCycle(S, k) || block.workouts.some(isDeloadWorkout),
})

// The blocks the count still splits before the running one (none once the log exists), as
// log entries: each ends the day before the next one started.
function splitEntries(S, blocks) {
  return blocks.slice(0, -1).map((b, k) => entryOf(S, b, k, addDays(blocks[k + 1].start, -1)))
}

// The sessions before the programming start (cycleStart) that no log entry covers. Moving the
// start (the Programming sheet's anchor is also cycleStart) restarts the count there, so what
// was trained before it leaves the running block and, with no closing on record for it, the
// list too. They are grouped the way an unlogged profile splits its count (countedBlocks): a
// block opens at a planned session once the one before holds `len`, extras riding along. They
// were never numbered, so `n` is null; each runs to the day before the next one opened, as the
// rest do.
function earlierEntries(S, start, log) {
  const len = microcycleLen(S)
  const logged = w => log.some(c => String(w.d) >= c.start && String(w.d) <= c.end)
  const earlier = ((S && S.workouts) || []).filter(w => String(w.d) < start && !logged(w)).sort(byDate)
  const blocks = []
  let cur = null
  for (const w of earlier) {
    const planned = isPlannedSession(S, w)
    if (!cur || (planned && cur.planned >= len)) blocks.push(cur = { start: String(w.d), workouts: [], planned: 0 })
    cur.workouts.push(w)
    if (planned) cur.planned++
  }
  return blocks.map((b, k) => ({
    start: b.start,
    end: addDays(k + 1 < blocks.length ? blocks[k + 1].start : start, -1),
    n: null,
    sessions: b.planned,
    len,
    strategy: strategyOf(S),
    deload: b.workouts.some(isDeloadWorkout),
    workouts: b.workouts,
  }))
}

/**
 * Every microcycle on record, newest first: the running one, then the closed ones.
 *
 * Each is { id, n, start, end, current, deload, sessions, len, strategy, workouts }. `id` is
 * its place oldest→newest, stable as new ones are added, so a picker can hold on to it. The
 * running one has no `end` yet — `due` is the day its days run out once its sessions are all
 * done (cycleEndOf), null while they are not. Sessions before the running block that no log
 * entry covers are listed too, as earlier microcycles without a number (earlierEntries): nothing
 * trained on record drops out of the list.
 */
export function cycleHistory(S) {
  const blocks = countedBlocks(S)
  const log = cycleLogOf(S)
  const closed = [...log.map(c => ({ ...c, workouts: workoutsBetween(S, c.start, c.end) })),
    ...splitEntries(S, blocks).map((c, k) => ({ ...c, workouts: blocks[k].workouts })),
    ...earlierEntries(S, cycleStartOf(S), log)]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
  const k = blocks.length - 1
  const cur = blocks[k]
  const running = {
    start: cur.start, end: null, due: cycleEndOf(S), n: microNumber(S, k),
    sessions: cur.planned, len: microcycleLen(S), strategy: strategyOf(S),
    deload: isDeloadCycle(S, k) || cur.workouts.some(isDeloadWorkout), workouts: cur.workouts,
  }
  return [...closed, running].map((c, i, all) => ({ ...c, id: i, current: i === all.length - 1 })).reverse()
}

/**
 * What closing the running microcycle writes, as a patch for S: { program, cycleLog, meso }.
 *
 * The new block follows `strategy` and opens today — or the day after a session already
 * logged today, which stays in the block it closed (nextCycleStart). The closed block ends the
 * day before. One with nothing logged in it is not written to the log: it is replaced, and the
 * new one keeps its number. The mesocycle moves down with the count (shiftMeso), so a deload
 * marked for the next microcycle lands on the one that opens.
 */
export function closeCycle(S, strategy = strategyOf(S), today = todayISO()) {
  const blocks = countedBlocks(S)
  const k = blocks.length - 1
  const cur = blocks[k]
  const program = closeMicrocycle(S, strategy, today)
  const log = [...cycleLogOf(S), ...splitEntries(S, blocks)]
  const empty = !cur.workouts.length
  if (!empty) log.push(entryOf(S, cur, k, addDays(program.cycleStart, -1)))
  return { program, cycleLog: log, meso: shiftMeso(S, empty ? k : k + 1) }
}

/**
 * What keeping the running microcycle open writes, as a patch for S — or null when there is
 * nothing to write. A profile without the log would split its count at the next planned
 * session; writing the blocks before the running one to the log stops that, so a session the
 * user chose to train in a complete block stays in it.
 */
export function keepCycle(S, today = todayISO()) {
  if (Array.isArray(S && S.cycleLog)) return null
  const blocks = countedBlocks(S)
  const k = blocks.length - 1
  return {
    program: { ...((S && S.program) || emptyProgram(today)), cycleStart: blocks[k].start },
    cycleLog: splitEntries(S, blocks),
    meso: shiftMeso(S, k),
  }
}

/** Whether the running microcycle can be closed today: no session logged today keeps it open. */
export const closableToday = (S, today = todayISO()) => nextCycleStart(S, today) === today

/** Whether a microcycle that is over should be asked about today (not asked yet today). */
export const askCycleEnd = (S, today = todayISO()) =>
  cycleDue(S, today) && ((S && S.program) || {}).endAsked !== today

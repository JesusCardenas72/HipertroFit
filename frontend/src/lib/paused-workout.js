// A workout left paused instead of finished.
//
// Pausing takes the running session (S.active) off the screen without filing it: its logged
// sets, the order it was in and the set it was on are kept as they are in `S.paused`, and the
// clock stops. Nothing of it counts yet — it is not in `S.workouts`, so the microcycle neither
// advances nor adds its volume — until it is resumed and finished like any other session.
//
// A paused workout belongs to the microcycle it was trained in, and can be taken up again at
// any moment while that microcycle runs. Once it ends — closed into the log, or all its days
// (rest days included) gone by (lib/microcycle.js cycleDue) — it can no longer be resumed. The
// microcycle a paused session belongs to is read from its day: it is resumable while that day
// is inside the running block. Closing a block also clears the list outright (closeCycle), since
// a block closed the same day it opened would otherwise start on the paused session's own day.
//
// Several can be paused at once, one per session; resuming needs the running one out of the
// way first, so there is still only one session on screen at a time.

import { cyclePosition, cycleDue } from './microcycle.js'
import { todayISO } from './format.js'

/** Every paused session on record, well-formed or dropped. Includes those no longer resumable. */
export const pausedList = S =>
  (Array.isArray(S && S.paused) ? S.paused : [])
    .filter(p => p && p.id && typeof p.d === 'string' && Array.isArray(p.entries))

/** Whether a paused session can still be taken up: its day is in the running, unfinished block. */
export function isResumable(S, p, today = todayISO()) {
  if (!p || typeof p.d !== 'string') return false
  // A block closed after today's session opens tomorrow (nextCycleStart): a session paused in
  // between is not lost the moment it is paused, only once the new block is under way.
  const start = cyclePosition(S).start
  return p.d >= (start > today ? today : start) && !cycleDue(S, today)
}

/** The paused sessions that can still be resumed, the most recently paused first. */
export const resumableOf = (S, today = todayISO()) =>
  pausedList(S).filter(p => isResumable(S, p, today))
    .sort((a, b) => (b.pausedAt || 0) - (a.pausedAt || 0))

/** The resumable paused session of a routine, or null. A freestyle session (no routine) has none. */
export const pausedFor = (S, routineId, today = todayISO()) =>
  (routineId && resumableOf(S, today).find(p => p.routineId === routineId)) || null

/** The resumable paused session trained on `iso`, the most recently paused when there are several. */
export const pausedOn = (S, iso, today = todayISO()) =>
  resumableOf(S, today).find(p => p.d === iso) || null

/**
 * What pausing the running session writes, as a patch for S — or null when there is nothing
 * to pause. A past workout being logged has no clock to stop and is not paused.
 *
 * The session keeps its own fields; `pausedAt` records when the clock stopped. Paused sessions
 * that can no longer be resumed are dropped on the way, and so is an older pause of the same
 * routine, which this one supersedes.
 */
export function pauseActive(S, now = Date.now(), today = todayISO()) {
  const A = S && S.active
  if (!A || A.backfill || !Array.isArray(A.entries)) return null
  const keep = resumableOf(S, today).filter(p => p.id !== A.id && !(A.routineId && p.routineId === A.routineId))
  return { active: null, paused: [...keep, { ...A, pausedAt: now }] }
}

/**
 * What resuming a paused session writes, as a patch for S — or null when it cannot be: no such
 * session, no longer resumable, or another one already on screen.
 *
 * It comes back as the running session with the time it had been trained for: its clock is set
 * so the time it spent paused does not count, and it is moved to today — it is finished, and
 * filed, on the day its last sets are done.
 */
export function resumePaused(S, id, now = Date.now(), today = todayISO()) {
  if (!S || S.active) return null
  const p = resumableOf(S, today).find(x => x.id === id)
  if (!p) return null
  const { pausedAt, ...session } = p
  const trained = Math.max(0, (Number(pausedAt) || now) - (Number(p.start) || now))
  return {
    active: { ...session, d: today, start: now - trained },
    paused: resumableOf(S, today).filter(x => x.id !== id),
  }
}

/** What dropping a paused session writes, as a patch for S. Expired ones go with it. */
export const discardPaused = (S, id, today = todayISO()) =>
  ({ paused: resumableOf(S, today).filter(p => p.id !== id) })

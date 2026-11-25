// Taking a set or a whole exercise back out of a logged workout — a planned session, a freestyle
// one or the day's extra work alike — from the day's detail sheet (sheets.jsx DayDetail).
//
// What a removal keeps true about the saved workout:
//   - an exercise left without a done set goes with it, and a workout left without an exercise
//     goes from history entirely (a workout with nothing in it is not a workout);
//   - `vol` is written into the record, so it is worked out again (workoutVolume);
//   - a PR the touched exercise claimed stays only while what is left of it still beats every
//     earlier workout. Taking sets out never makes a new record, and the exercises not touched
//     keep their PR as it was decided when the workout was finished;
//   - on the extra workout, where `target.sets` is just how many sets were logged, it follows
//     the count; a session's target is what was planned and stays as it was;
//   - a legacy `topW` cannot outlive the set it came from: it is reset to the heaviest set left.
//
// Pure: takes the history array and returns a new one plus what went (`removed`: 'set',
// 'entry' or 'workout'), or null when the target is not there any more.

import { workoutVolume, bestWeightForEntry } from './history.js'
import { isWarmupRow } from './workout-model.js'

const doneSets = e => (e.sets || []).filter(s => s && s.done)

// What removing that set (setIdx given) or that exercise would take with it, without doing it.
export function removalScope(w, entryIdx, setIdx) {
  const e = w && w.entries && w.entries[entryIdx]
  if (!e) return null
  if (setIdx != null) {
    const s = e.sets && e.sets[setIdx]
    if (!s) return null
    if (doneSets(e).length > 1 || !s.done) return 'set'
  }
  return w.entries.length > 1 ? 'entry' : 'workout'
}

export function removeSetFromHistory(workouts, wid, entryIdx, setIdx) {
  return edit(workouts, wid, entryIdx, e => {
    if (!e.sets || !e.sets[setIdx]) return undefined
    return { ...e, sets: e.sets.filter((_, i) => i !== setIdx) }
  })
}

export function removeEntryFromHistory(workouts, wid, entryIdx) {
  return edit(workouts, wid, entryIdx, () => null)
}

function edit(workouts, wid, entryIdx, change) {
  const list = workouts || []
  const at = list.findIndex(w => w && w.id === wid)
  if (at < 0) return null
  const w = list[at]
  const old = w.entries && w.entries[entryIdx]
  if (!old) return null
  let e = change(old)
  if (e === undefined) return null
  if (e && !doneSets(e).length) e = null
  const entries = w.entries.flatMap((x, i) => (i !== entryIdx ? [x] : e ? [tidy(e, w)] : []))
  if (!entries.length) return { workouts: list.filter((_, i) => i !== at), removed: 'workout' }
  const next = { ...w, entries }
  next.vol = workoutVolume(next)
  if (Array.isArray(w.prs)) next.prs = w.prs.filter(id => id !== old.id || stillPr(list.slice(0, at), next, id))
  return { workouts: list.map((x, i) => (i === at ? next : x)), removed: e ? 'set' : 'entry' }
}

function tidy(e, w) {
  const out = { ...e }
  if (w.extra === true && out.target) out.target = { ...out.target, sets: out.sets.length }
  if (out.topW != null) {
    const top = Math.max(0, ...out.sets.filter(s => s.done && !isWarmupRow(s)).map(s => Number(s.w) || 0))
    out.topW = top || null
  }
  return out
}

function stillPr(earlier, w, id) {
  const best = list => Math.max(0, ...list.flatMap(x => (x.entries || []).filter(e => e.id === id).map(bestWeightForEntry)))
  const now = best([w])
  return now > 0 && now > best(earlier)
}

// Work done outside a session: a few sets of something at home, at the park, between meetings.
// It is logged straight into history — exercise, sets, reps, weight — without ever opening the
// workout screen, and filed as a workout flagged `extra`.
//
// What the flag means everywhere else:
//   - volume:      counted. It carries no routine, so the microcycle's volume window takes every
//                  set of it (lib/microcycle.js cycleWorkouts, lib/volume.js).
//   - block count: never a step. Unlike a freestyle session it is not a session at all, so it
//                  consumes no slot even on a profile with no sequence (isPlannedSession).
//   - progression: left alone. `excludeFromProgression` rides along, so two loose sets do not
//                  become "last time" for the next planned session nor shrink its set count.
//
// Everything logged loose on one day lands in that day's single extra workout, so history
// shows one row per day instead of one per exercise.

import { modeOf, workoutVolume } from './history.js'
import { insertChronological, backfillStart } from './backfill.js'

const int = (v, min) => Math.max(min, Math.round(Number(v) || 0))
const num = v => Math.max(0, Math.round((Number(v) || 0) * 100) / 100)

/**
 * The history entry for `sets` identical sets of one exercise. `cfg` is the exercise's config
 * (mode, bodyweight, side); `values` is what the form holds. `snapshot` is the muscle snapshot
 * of a custom exercise, kept so its volume survives the exercise being deleted.
 */
export function buildExtraEntry(exId, cfg, values, snapshot) {
  const mode = modeOf({ ...cfg, id: exId })
  const n = int(values.sets, 1)
  const row = mode === 'cardio' ? { min: int(values.min, 1), speed: num(values.speed) }
    : mode === 'time' ? { sec: int(values.sec, 1), w: num(values.weight) }
      : { w: num(values.weight), r: int(values.reps, 1) }
  const target = { mode, sets: n }
  if (mode === 'cardio') { target.min = row.min; target.speed = row.speed }
  else if (mode === 'time') { target.sec = row.sec; target.weight = row.w }
  else { target.reps = row.r; target.weight = row.w }
  if (cfg && cfg.bodyweight != null) target.bodyweight = !!cfg.bodyweight
  if (cfg && cfg.side) target.side = true
  const entry = { id: exId, sets: Array.from({ length: n }, () => ({ ...row, done: true })), topW: null, target }
  if (snapshot && typeof snapshot === 'object' && Object.keys(snapshot).length) entry.muscleSnapshot = { ...snapshot }
  return entry
}

/**
 * History after filing `entry` on `iso`. The day's extra workout takes it if there is one —
 * more sets of an exercise already in it join that exercise's entry — otherwise a new extra
 * workout goes in at its place in date order. Returns a new array.
 */
export function fileExtraEntry(workouts, entry, { iso, today, now = Date.now(), id, name }) {
  const list = workouts || []
  const at = list.findIndex(w => w.extra === true && w.d === iso)
  if (at < 0) {
    const start = iso === today ? now : backfillStart(iso, '12:00')
    const w = {
      id, d: iso, start, end: start, routineId: null, name, bw: null,
      entries: [entry], prs: [], extra: true, excludeFromProgression: true,
    }
    w.vol = workoutVolume(w)
    return insertChronological(list, w)
  }
  const day = list[at]
  const same = day.entries.findIndex(e => e.id === entry.id && modeOf({ ...e.target, id: e.id }) === entry.target.mode)
  const entries = same < 0 ? [...day.entries, entry] : day.entries.map((e, i) => i !== same ? e : {
    ...e,
    sets: [...e.sets, ...entry.sets],
    target: { ...e.target, sets: e.sets.length + entry.sets.length },
  })
  const merged = { ...day, entries }
  merged.vol = workoutVolume(merged)
  return list.map((w, i) => (i === at ? merged : w))
}

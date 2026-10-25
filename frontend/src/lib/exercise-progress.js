// One exercise's progress across logged workouts: the curve Stats' "Exercise progress" card
// draws, for a single exercise, so the workout screen can show it in a sheet.
import { modeOf, metricModeForEntry, metricRowsForEntry, bestWeightForEntry } from './history.js'

/**
 * { mode, repsOnly, points: [{ t, y, d, sets, target }], best } for `id`, oldest first.
 * The mode is the latest logged one (a completed reps row wins, as in Stats); each point is the
 * session's top weight — or its most reps when nothing was ever loaded, its top speed for
 * cardio, its longest hold for a timed exercise. Sessions logged in another mode are left out.
 */
export function exerciseProgress(workouts, id) {
  const list = Array.isArray(workouts) ? workouts : []
  let mode = null
  for (let i = list.length - 1; i >= 0 && !mode; i--) {
    const en = list[i].entries?.find(e => e.id === id)
    if (en) mode = metricModeForEntry(en)
  }
  mode = mode || modeOf({ id })
  // A pull-up carries no weight: its progress is the rep count, until a loaded set shows up.
  const repsOnly = mode === 'reps' && !list.some(w => {
    const en = w.entries?.find(e => e.id === id)
    return en && bestWeightForEntry(en) > 0
  })
  const metric = s => mode === 'cardio' ? (s.speed || 0) : mode === 'time' ? (s.sec || 0) : (s.w || 0)
  const points = []
  let best = 0
  list.forEach(w => {
    const en = w.entries?.find(e => e.id === id)
    if (!en || metricModeForEntry(en) !== mode) return
    const sets = metricRowsForEntry(en, mode)
    const y = mode === 'reps'
      ? (repsOnly ? Math.max(0, ...sets.map(s => Number(s.r) || 0)) : bestWeightForEntry(en))
      : Math.max(0, ...sets.map(metric))
    if (!(y > 0)) return
    points.push({ t: w.start || new Date(w.d).getTime(), y, d: w.d, sets, target: en.target })
    if (y > best) best = y
  })
  return { mode, repsOnly, points, best }
}

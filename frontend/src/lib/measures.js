// Body measurements: tape-measure circumferences over time.
//
// Scale weight cannot tell muscle from fat; a waist that holds while the arms grow can. Each entry
// is one day's measurements, any subset of them, in cm (in on an lb profile — the unit follows the
// weight unit, as it does everywhere else): S.measures = [{ d, waist, arm, … }], oldest first, one
// entry per day.

import { todayISO } from './format.js'

/** The measurements offered, in the order the form shows them. */
export const MEASURES = ['arm', 'chest', 'waist', 'hips', 'thigh', 'calf', 'neck', 'shoulders', 'forearm']

/** Display names (English source strings, translated by the caller). */
export const MEASURE_NAME = {
  arm: 'Arm', chest: 'Chest', waist: 'Waist', hips: 'Hips', thigh: 'Thigh',
  calf: 'Calf', neck: 'Neck', shoulders: 'Shoulders', forearm: 'Forearm',
}

/** The length unit for a profile's weight unit. */
export const lengthUnit = S => (S && S.unit === 'lb' ? 'in' : 'cm')

const clean = v => { const n = Math.round(Number(v) * 10) / 10; return n > 0 && n < 1000 ? n : null }

/** One entry tidied: known keys with a positive value, or null when nothing is left. */
export function normalizeMeasure(e) {
  if (!e || typeof e !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.d || ''))) return null
  const out = { d: e.d }
  for (const k of MEASURES) { const v = clean(e[k]); if (v != null) out[k] = v }
  return Object.keys(out).length > 1 ? out : null
}

/** S.measures, tidied and sorted — old states have no such key. */
export const measuresOf = S => (Array.isArray(S && S.measures) ? S.measures.map(normalizeMeasure).filter(Boolean) : [])
  .sort((a, b) => a.d.localeCompare(b.d))

/**
 * The list with `entry` filed on its day: a day already measured takes the new values over its
 * old ones (a field left empty keeps what that day had), a new day is inserted in order.
 */
export function addMeasure(list, entry) {
  const e = normalizeMeasure({ d: todayISO(), ...entry })
  const all = (Array.isArray(list) ? list : []).map(normalizeMeasure).filter(Boolean)
  if (!e) return all
  const i = all.findIndex(x => x.d === e.d)
  if (i >= 0) all[i] = { ...all[i], ...e }
  else all.push(e)
  return all.sort((a, b) => a.d.localeCompare(b.d))
}

/** The list without the entry of day `d`. */
export const removeMeasure = (list, d) => (Array.isArray(list) ? list : []).filter(x => x && x.d !== d)

/** One measurement over time, as chart points { t, d, y }. */
export function seriesOf(list, key) {
  return (list || []).filter(e => e && e[key] > 0)
    .map(e => ({ t: new Date(e.d + 'T12:00:00').getTime(), d: e.d, y: e[key] }))
}

/** The measurements that have at least one value, in form order. */
export const measuredKeys = list => MEASURES.filter(k => (list || []).some(e => e && e[k] > 0))

/** Latest value of one measurement and its change since the first: { v, d, delta, since }. */
export function trendOf(list, key) {
  const pts = seriesOf(list, key)
  if (!pts.length) return null
  const first = pts[0], last = pts[pts.length - 1]
  return { v: last.y, d: last.d, delta: Math.round((last.y - first.y) * 10) / 10, since: first.d }
}

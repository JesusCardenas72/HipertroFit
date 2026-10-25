// The slots of one generated day as the user rearranges them in Plan ▸ Generate plan: add a
// pattern, take one out, drag them into another order, link neighbours into a superset.
//
// A day's slots are kept as plain definitions — `{ id, pattern, role, prefer?, sg? }` — under
// S.planGen.layout[dayKey], and only once the user changes that day; until then the split's own
// template is used (lib/plan-generator.js buildDraft). `id` is the slot's key for its picks and
// set counts, so it never changes when the slot moves. `sg` links slots into a superset exactly
// the way routine exercises are linked (lib/history.js cleanupSg), so dragging uses the same
// drop rules as the routine editor and the workout dock (lib/active-workout-order.js).

import { cleanupSg } from './history.js'
import { dropActiveWorkoutEntry, moveActiveWorkoutUnitTo } from './active-workout-order.js'
import { isPattern } from './movement-patterns.js'

// Patterns that load several joints: a slot added for one is secondary work, anything else an
// accessory. The role sets its starting sets and which exercises it suggests first.
const MULTI_JOINT = ['horizontal_push', 'incline_push', 'vertical_push', 'vertical_pull', 'horizontal_pull', 'squat', 'lunge', 'hinge']

/** The role a newly added slot of `pattern` gets. */
export const roleForPattern = pattern => (MULTI_JOINT.includes(pattern) ? 'secondary' : 'accessory')

/** A draft day's slots as editable definitions, in order. */
export const layoutOfDay = day => (day?.slots || []).map(sl => ({
  id: sl.key, pattern: sl.pattern, role: sl.role,
  ...(sl.prefer ? { prefer: sl.prefer } : {}), ...(sl.sg ? { sg: sl.sg } : {}),
}))

/** Append a slot for `pattern`; `newId` makes its key unique within the day. Returns the slot. */
export function addSlot(defs, dayKey, pattern, newId) {
  if (!isPattern(pattern)) return null
  const slot = { id: dayKey + ':x' + newId, pattern, role: roleForPattern(pattern) }
  defs.push(slot)
  return slot
}

/** Take slot `index` out, and loosen a superset it leaves with one member. */
export function removeSlot(defs, index) {
  if (!defs[index]) return false
  defs.splice(index, 1)
  cleanupSg(defs)
  return true
}

/** Link slot `index` with the one above into a superset, or unlink them if they already are. */
export function toggleLink(defs, index, newSg) {
  if (index < 1 || !defs[index]) return false
  const cur = defs[index], prev = defs[index - 1]
  if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
  else { const g = prev.sg || newSg; prev.sg = g; cur.sg = g }
  cleanupSg(defs)
  return true
}

/**
 * A slot let go in the day's list, as the routine editor drops an exercise: `{ slot, join }`
 * moves it (onto a neighbour it supersets them, clear of its capsule it leaves); `{ unit }` moves
 * its whole superset. False when nothing changes.
 */
export function dropSlot(defs, index, intent) {
  if (!Array.isArray(defs) || !intent) return false
  const day = { entries: defs, cur: 0 }
  return !!(intent.unit != null ? moveActiveWorkoutUnitTo(day, index, intent.unit) : dropActiveWorkoutEntry(day, index, intent))
}

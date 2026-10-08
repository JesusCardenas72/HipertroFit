import { cleanupSg, supersetUnits } from './history.js'

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

function moveTarget(active, index, direction) {
  if (!active || !Array.isArray(active.entries) || (direction !== -1 && direction !== 1)) return null
  const units = supersetUnits(active.entries)
  const source = units.findIndex(unit => unit.includes(index))
  const target = source + direction
  if (source < 0 || target < 0 || target >= units.length) return null
  return { units, source, target }
}

// Write a new unit order back into the live session. `order` is the entries' old indexes in
// their new sequence, which is also exactly what the caller needs to re-point everything else
// that is stored by index — the per-exercise progress marks, the rest timer's owner.
// `keep` is the entry that must stay current: reordering never changes which exercise you are
// looking at, only where it sits in the list.
function applyOrder(active, order, keep) {
  const reordered = order.map(index => active.entries[index])
  active.entries.splice(0, active.entries.length, ...reordered)
  active.cur = Math.max(0, active.entries.indexOf(keep))
  return { indices: order }
}

export function canMoveActiveWorkoutUnit(active, index, direction) {
  return moveTarget(active, index, direction) !== null
}

export function moveActiveWorkoutUnit(active, index, direction) {
  const move = moveTarget(active, index, direction)
  if (!move) return null

  const selected = active.entries[index]
  const reorderedUnits = [...move.units]
  const sourceUnit = reorderedUnits[move.source]
  reorderedUnits[move.source] = reorderedUnits[move.target]
  reorderedUnits[move.target] = sourceUnit
  return applyOrder(active, reorderedUnits.flat(), selected)
}

/**
 * Drop a display unit into an arbitrary slot — what dragging a thumbnail along the workout
 * dock does, where the ±1 walk above is what the Move up/down buttons do.
 *
 * Slots are numbered after the dragged unit has been lifted out (the same numbering
 * `reorderRoutineUnit` uses in the plan editor), so a superset can never be dropped into the
 * middle of another one: its members travel together and stay contiguous.
 *
 * Returns `{ indices }` like the sibling above, or null when nothing moved.
 */
export function moveActiveWorkoutUnitTo(active, index, targetSlot) {
  if (!active || !Array.isArray(active.entries) || !active.entries.length) return null
  const units = supersetUnits(active.entries)
  const source = units.findIndex(unit => unit.includes(index))
  if (source < 0) return null
  const remaining = units.filter((_, position) => position !== source)
  const slot = clamp(Number.isFinite(targetSlot) ? Math.trunc(targetSlot) : source, 0, remaining.length)
  if (slot === source) return null
  const keep = active.entries[Number.isInteger(active.cur) ? active.cur : 0]
  remaining.splice(slot, 0, units[source])
  return applyOrder(active, remaining.flat(), keep)
}

function freshSg(entries) {
  let n = 1
  while (entries.some(e => e.sg === 'sg-dock-' + n)) n++
  return 'sg-dock-' + n
}

/**
 * Drop one exercise where a thumbnail dragged along the workout dock was let go:
 * `{ slot, join }` from `dockIntent`. `slot` counts the other entries (the dragged one lifted
 * out); `join` is the neighbour it ends up supersetted with — taking that neighbour's superset,
 * or starting a new one with it — or null to stand alone, leaving any superset it was in.
 * A superset left with a single member stops being one.
 *
 * Returns `{ indices }` like the siblings above, or null when neither the order nor any
 * pairing changed.
 */
export function dropActiveWorkoutEntry(active, index, { slot, join = null } = {}) {
  if (!active || !Array.isArray(active.entries) || !active.entries[index]) return null
  const entries = active.entries
  const order = entries.map((_, i) => i).filter(i => i !== index)
  const at = clamp(Number.isFinite(slot) ? Math.trunc(slot) : index, 0, order.length)
  order.splice(at, 0, index)
  // Standing alone between two members of one superset is not a place: it joins them.
  if (join == null && entries[order[at - 1]]?.sg && entries[order[at - 1]].sg === entries[order[at + 1]]?.sg) join = order[at - 1]
  if (join != null && (!entries[join] || join === index || Math.abs(order.indexOf(join) - at) !== 1)) return null

  const sgs = order.map(i => ({ sg: entries[i].sg }))
  if (join == null) delete sgs[at].sg
  else {
    const group = entries[join].sg || freshSg(entries)
    sgs[at].sg = group
    sgs[order.indexOf(join)].sg = group
  }
  cleanupSg(sgs)
  const same = order.every((i, k) => i === k && (sgs[k].sg ?? null) === (entries[k].sg ?? null))
  if (same) return null

  const keep = entries[Number.isInteger(active.cur) ? active.cur : 0]
  const moved = applyOrder(active, order, keep)
  active.entries.forEach((e, k) => { if (sgs[k].sg) e.sg = sgs[k].sg; else delete e.sg })
  return moved
}

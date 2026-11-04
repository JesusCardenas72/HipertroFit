// The Plan screen's stack of sections: each folds on its own and can be dragged up or down the stack.
//
// S.planSections is { order: [id…], closed: [id…] }, absent until the first change. Whatever a saved
// value holds is read through planSectionOrder, so an old backup, or one naming a section that no
// longer exists, still draws every section exactly once.

import { dropSlot } from './workout-dock.js'

export const PLAN_SECTIONS = ['programming', 'sequence', 'routines']

/** The sections top to bottom: the saved order, then any it does not mention in their default place. */
export function planSectionOrder(st) {
  const saved = (st && st.planSections && st.planSections.order) || []
  const known = saved.filter((id, i) => PLAN_SECTIONS.includes(id) && saved.indexOf(id) === i)
  return [...known, ...PLAN_SECTIONS.filter(id => !known.includes(id))]
}

export function isSectionOpen(st, id) {
  return !((st && st.planSections && st.planSections.closed) || []).includes(id)
}

/** Where a section let go at `y` lands among the others, each with its measured `top` / `bottom`. */
export function sectionDropIntent(others, y) {
  return { slot: dropSlot(others.map(o => (o.top + o.bottom) / 2), y), join: null }
}

/* ---- mutations: run inside useStore.update on the draft state ---- */

export function toggleSection(s, id) {
  const closed = (s.planSections && s.planSections.closed) || []
  s.planSections = {
    ...s.planSections,
    closed: closed.includes(id) ? closed.filter(x => x !== id) : [...closed, id],
  }
}

/** Puts a section at `slot` among the others. False when it was already there. */
export function moveSection(s, id, slot) {
  const order = planSectionOrder(s)
  if (!order.includes(id)) return false
  const rest = order.filter(x => x !== id)
  rest.splice(Math.max(0, Math.min(rest.length, slot)), 0, id)
  if (rest.join() === order.join()) return false
  s.planSections = { ...s.planSections, order: rest }
  return true
}

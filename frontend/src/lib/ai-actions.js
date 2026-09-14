// Applying an analysis: turning a finding or an AI suggestion into a concrete, reviewable change.
//
// Nothing here trusts the model to edit anything. A suggestion only picks *what kind* of change to
// look at (a deload, more or fewer sets for a muscle group); the change itself is computed here,
// deterministically, from the same helpers the programming screens use, and shown to the user as a
// list of "routine · exercise: 3 → 4 sets" before anything is written. Applying it re-checks that
// the routines still say what the proposal read, so a proposal made before an edit cannot clobber it.
//
// Two kinds of proposal:
//   deload — mark the next microcycle as a deload, exactly as accepting the home-screen suggestion
//            does (mesocycle.js acceptDeload).
//   volume — add or remove work sets on the routine exercises that train a group, until the
//            *planned* volume of one microcycle (volume.js plannedVolume) reaches the 10–20 band.
//            Sets are a routine field (weight too); reps, rest and progression belong to the
//            exercise and are never touched here.

import { plannedVolume, VOLUME_GROUPS, VOLUME_TARGET } from './volume.js'
import { microcycleLen, trainingSteps } from './microcycle.js'
import { mesoState, acceptDeload } from './mesocycle.js'
import { musclesOf } from './muscles.js'
import { EXIDX } from './exercises.js'

const round1 = v => Math.round(v * 10) / 10
const setsOf = cfg => Math.max(1, Math.round(cfg && cfg.sets) || 1)

/** Most sets a single proposal adds to or removes from one exercise. */
export const MAX_STEP = 2

// How strongly an exercise trains a group: its strongest involvement of any of the group's muscles,
// the same per-set credit plannedVolume gives it.
function weightFor(S, cfg, group) {
  const custom = (S.customEx || []).find(x => x.id === cfg.id)
  const mus = musclesOf(EXIDX[cfg.id] || custom || cfg)
  return Math.max(0, ...group.muscles.map(slug => mus[slug] || 0))
}

/** The deload proposal, or null when one is already scheduled. */
export function deloadProposal(S) {
  const m = mesoState(S)
  if (m.scheduled) return null
  return { kind: 'deload', cycle: m.target, pct: m.pct, streak: m.streak }
}

/**
 * Sets to add (`dir: 'up'`) or remove (`'down'`) so the group's planned volume reaches the target band.
 *
 * Returns null when there is nothing to do (no programming, already at the edge the direction points
 * past, or no single step fits inside the band). A group no routine exercise trains as a primary
 * comes back with `missing: true` and no changes: that needs a new exercise, which is the user's call.
 *
 * Greedy and small on purpose: each step takes the exercise that moves the group most (a primary
 * mover before a secondary one, a routine trained twice a block before one trained once), at most
 * MAX_STEP sets per exercise, never below one set, never overshooting the other edge of the band.
 */
export function volumeProposal(S, groupKey, dir) {
  const group = VOLUME_GROUPS.find(g => g.key === groupKey)
  if (!group || (dir !== 'up' && dir !== 'down')) return null
  const steps = trainingSteps(S && S.program)
  if (!steps.length) return null
  const before = round1(plannedVolume(S).groups[group.key] || 0)
  const { min, max } = VOLUME_TARGET
  if (dir === 'up' && before >= max) return null
  if (dir === 'down' && before <= min) return null

  // How many times each routine is trained in one microcycle.
  const len = microcycleLen(S)
  const occ = {}
  for (let i = 0; i < len; i++) occ[steps[i % steps.length]] = (occ[steps[i % steps.length]] || 0) + 1

  const cands = []
  for (const r of S.routines || []) {
    if (!occ[r.id]) continue
    ;(r.ex || []).forEach((cfg, idx) => {
      if (!cfg) return
      const w = weightFor(S, cfg, group)
      // Adding sets to an exercise that only brushes the group adds fatigue for little volume.
      if (dir === 'up' ? w < 1 : w <= 0) return
      const from = setsOf(cfg)
      cands.push({ routineId: r.id, routineName: r.name || '', idx, exId: cfg.id, from, to: from, gain: occ[r.id] * w })
    })
  }
  if (!cands.length) return dir === 'up' ? { kind: 'volume', group: group.key, dir, before, after: before, changes: [], missing: true } : null

  let vol = before
  for (let guard = 0; guard < 60; guard++) {
    const moved = cands.some(c => c.to !== c.from)
    if (moved && (dir === 'up' ? vol >= min : vol <= max)) break
    const pickable = cands.filter(c => (dir === 'up'
      ? c.to - c.from < MAX_STEP && vol + c.gain <= max
      : c.from - c.to < MAX_STEP && c.to > 1 && vol - c.gain >= min))
    if (!pickable.length) break
    // Up: the biggest mover first, then the exercise with the fewest sets so the work spreads.
    // Down: the exercise carrying the most sets first, then the biggest mover.
    pickable.sort(dir === 'up'
      ? (a, b) => b.gain - a.gain || a.to - b.to || a.idx - b.idx
      : (a, b) => b.to - a.to || b.gain - a.gain || a.idx - b.idx)
    const c = pickable[0]
    c.to += dir === 'up' ? 1 : -1
    vol = round1(vol + (dir === 'up' ? c.gain : -c.gain))
  }
  const changes = cands.filter(c => c.to !== c.from).map(({ routineId, routineName, idx, exId, from, to }) => ({ routineId, routineName, idx, exId, from, to }))
  if (!changes.length) return null
  // The figure shown is recomputed, not the running sum: plannedVolume is the source of truth.
  const trial = { ...S, routines: (S.routines || []).map(r => ({ ...r, ex: (r.ex || []).map(c => ({ ...c })) })) }
  applyProposal(trial, { kind: 'volume', changes })
  return { kind: 'volume', group: group.key, dir, before, after: round1(plannedVolume(trial).groups[group.key] || 0), changes }
}

/**
 * The proposal a finding (ai-digest.js findingsOf) or a model suggestion (ai-report.js) leads to,
 * or null when it does not map to a change the app can make.
 */
export function proposalFor(S, item) {
  if (!item || typeof item !== 'object') return null
  // Deterministic findings.
  if (item.type === 'deload-suggested' || item.type === 'deload-mandatory') return deloadProposal(S)
  if (item.type === 'volume-low' && item.source === 'plan') return volumeProposal(S, item.group, 'up')
  if (item.type === 'volume-high' && item.source === 'plan') return volumeProposal(S, item.group, 'down')
  // Model suggestions: only the action and the group key are read, never free text.
  if (item.action === 'deload') return deloadProposal(S)
  if (item.action === 'add_volume') return volumeProposal(S, item.group, 'up')
  if (item.action === 'reduce_volume') return volumeProposal(S, item.group, 'down')
  return null
}

/**
 * Write a proposal into a state draft (mutates `S`). Returns false — and changes nothing — when the
 * state no longer matches what the proposal was computed from.
 */
export function applyProposal(S, p) {
  if (!S || !p) return false
  if (p.kind === 'deload') {
    if (mesoState(S).scheduled) return false
    S.meso = acceptDeload(S)
    return true
  }
  if (p.kind === 'volume') {
    if (!Array.isArray(p.changes) || !p.changes.length) return false
    const targets = p.changes.map(ch => {
      const r = (S.routines || []).find(x => x.id === ch.routineId)
      const cfg = r && r.ex && r.ex[ch.idx]
      return cfg && cfg.id === ch.exId && setsOf(cfg) === ch.from && ch.to >= 1 ? { cfg, to: ch.to } : null
    })
    if (targets.some(x => !x)) return false
    for (const { cfg, to } of targets) cfg.sets = to
    return true
  }
  return false
}

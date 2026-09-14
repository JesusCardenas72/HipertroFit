import { describe, it, expect } from 'vitest'
import { deloadProposal, volumeProposal, proposalFor, applyProposal, MAX_STEP } from './ai-actions.js'
import { plannedVolume } from './volume.js'
import { mesoState } from './mesocycle.js'

// Inline exercise metadata (ids not in the catalogue) so every muscle weight is known exactly:
// a primary counts 1, a secondary 0.4.
const bench = sets => ({ id: 'x-bench', tg: 'chest', sm: ['triceps'], sets })
const curl = sets => ({ id: 'x-curl', tg: 'biceps', sets })
const plank = sets => ({ id: 'x-plank', tg: 'abs', sets })

// Full body: one microcycle = 3 sessions, the one routine trained three times.
const fullBody = (ex, extra = {}) => ({
  program: { on: true, seq: ['A'], anchor: '2026-09-01', strategy: 'full-body' },
  routines: [{ id: 'A', name: 'Full A', ex }],
  workouts: [], meso: null,
  ...extra,
})

describe('volumeProposal', () => {
  it('adds a set to the primary mover until the planned volume reaches the band', () => {
    const S = fullBody([bench(3), curl(4)])
    expect(plannedVolume(S).groups.chest).toBe(9)
    const p = volumeProposal(S, 'chest', 'up')
    expect(p).toEqual({
      kind: 'volume', group: 'chest', dir: 'up', before: 9, after: 12,
      changes: [{ routineId: 'A', routineName: 'Full A', idx: 0, exId: 'x-bench', from: 3, to: 4 }],
    })
  })

  it('spreads the work and never adds more than MAX_STEP sets to one exercise', () => {
    const S = fullBody([curl(1), { ...curl(1), id: 'x-curl-2' }])
    const p = volumeProposal(S, 'biceps', 'up')        // 6 → needs 4 more: two exercises, +1 each… then +1 again
    expect(p.after).toBeGreaterThanOrEqual(10)
    for (const ch of p.changes) expect(ch.to - ch.from).toBeLessThanOrEqual(MAX_STEP)
    expect(p.changes.map(c => c.to - c.from)).toEqual([1, 1])
  })

  it('stops short rather than breaking MAX_STEP, and says how far it got', () => {
    const S = fullBody([plank(1)])                     // 3 abs sets; +2 max → 9, still under 10
    expect(volumeProposal(S, 'abs', 'up')).toMatchObject({ before: 3, after: 9, changes: [{ from: 1, to: 3 }] })
  })

  it('needs a primary mover to add volume — secondary work alone is reported as missing', () => {
    const S = fullBody([bench(3)])                     // triceps only as a secondary: 3.6 sets
    expect(volumeProposal(S, 'triceps', 'up')).toEqual({ kind: 'volume', group: 'triceps', dir: 'up', before: 3.6, after: 3.6, changes: [], missing: true })
  })

  it('removes sets from the heaviest-loaded exercise, never below the band or one set', () => {
    const S = fullBody([bench(8)])                     // 24 chest sets
    const p = volumeProposal(S, 'chest', 'down')
    expect(p).toMatchObject({ before: 24, after: 18, changes: [{ exId: 'x-bench', from: 8, to: 6 }] })
    expect(volumeProposal(fullBody([bench(7)]), 'chest', 'down')).toMatchObject({ after: 18, changes: [{ from: 7, to: 6 }] })
  })

  it('never overshoots the other edge of the band', () => {
    const ppl = { program: { on: true, seq: ['A'], anchor: '2026-09-01', strategy: 'ppl' }, routines: [{ id: 'A', name: 'A', ex: [bench(3)] }], workouts: [] }
    expect(plannedVolume(ppl).groups.chest).toBe(18)   // in band; one more set would be 24
    expect(volumeProposal(ppl, 'chest', 'up')).toBeNull()
  })

  it('does nothing without programming, past the edge, or for an unknown group or direction', () => {
    expect(volumeProposal({ routines: [{ id: 'A', ex: [bench(3)] }], program: null }, 'chest', 'up')).toBeNull()
    expect(volumeProposal(fullBody([bench(8)]), 'chest', 'up')).toBeNull()
    expect(volumeProposal(fullBody([bench(3)]), 'chest', 'down')).toBeNull()
    expect(volumeProposal(fullBody([bench(3)]), 'glutes', 'up')).toBeNull()
    expect(volumeProposal(fullBody([bench(3)]), 'chest', 'sideways')).toBeNull()
  })

  it('ignores routines the sequence does not train', () => {
    const S = fullBody([curl(3)], { routines: [{ id: 'A', name: 'A', ex: [curl(3)] }, { id: 'B', name: 'Unused', ex: [bench(3)] }] })
    expect(volumeProposal(S, 'chest', 'up')).toMatchObject({ missing: true, before: 0 })
  })

  it('does not modify the state it reads', () => {
    const S = fullBody([bench(3)])
    volumeProposal(S, 'chest', 'up')
    expect(S.routines[0].ex[0].sets).toBe(3)
  })
})

describe('applyProposal', () => {
  it('writes the proposed sets and lands on the proposed volume', () => {
    const S = fullBody([bench(3), curl(4)])
    const p = volumeProposal(S, 'chest', 'up')
    expect(applyProposal(S, p)).toBe(true)
    expect(S.routines[0].ex[0].sets).toBe(4)
    expect(plannedVolume(S).groups.chest).toBe(p.after)
  })

  it('refuses a stale proposal and changes nothing', () => {
    const S = fullBody([bench(3), curl(2)])
    const p = volumeProposal(S, 'biceps', 'up')
    S.routines[0].ex[1].sets = 5                        // edited after the proposal was made
    expect(applyProposal(S, p)).toBe(false)
    expect(S.routines[0].ex.map(e => e.sets)).toEqual([3, 5])
    const moved = fullBody([bench(3)])
    const q = volumeProposal(moved, 'chest', 'up')
    moved.routines[0].ex.unshift(curl(2))               // exercise moved to another position
    expect(applyProposal(moved, q)).toBe(false)
    expect(applyProposal(fullBody([]), { kind: 'volume', changes: [] })).toBe(false)
    expect(applyProposal(fullBody([]), { kind: 'nope' })).toBe(false)
  })
})

describe('deload proposals', () => {
  // Nine planned full-body sessions close three loading microcycles: the deload is suggested.
  const loaded = () => fullBody([bench(3)], {
    workouts: Array.from({ length: 9 }, (_, i) => ({ d: '2026-09-' + String(i + 1).padStart(2, '0'), start: i, routineId: 'A', entries: [] })),
  })

  it('proposes the next microcycle and applies it once, as accepting on the home screen does', () => {
    const S = loaded()
    expect(mesoState(S).suggest).toBe(true)
    const p = deloadProposal(S)
    expect(p).toEqual({ kind: 'deload', cycle: 3, pct: 0.4, streak: 3 })
    expect(applyProposal(S, p)).toBe(true)
    expect(S.meso.deloads).toEqual([3])
    expect(deloadProposal(S)).toBeNull()                // already scheduled
    expect(applyProposal(S, p)).toBe(false)
  })
})

describe('proposalFor', () => {
  const S = fullBody([bench(3), curl(4)])

  it('maps planned-volume findings and deload findings', () => {
    expect(proposalFor(S, { type: 'volume-low', group: 'chest', sets: 9, source: 'plan' })).toMatchObject({ kind: 'volume', dir: 'up' })
    expect(proposalFor(fullBody([bench(8)]), { type: 'volume-high', group: 'chest', source: 'plan' })).toMatchObject({ dir: 'down' })
    expect(proposalFor(S, { type: 'deload-suggested' })).toMatchObject({ kind: 'deload' })
  })

  it('does not act on volume measured from logged sessions — the plan is what it can change', () => {
    expect(proposalFor(S, { type: 'volume-low', group: 'chest', source: 'logged' })).toBeNull()
  })

  it('reads only the action and group of a model suggestion, never its free text', () => {
    expect(proposalFor(S, { action: 'add_volume', group: 'chest', target: 'Legs please', reason: 'x' })).toMatchObject({ group: 'chest', dir: 'up' })
    expect(proposalFor(S, { action: 'add_volume', target: 'Chest' })).toBeNull()
    expect(proposalFor(S, { action: 'increase_weight', group: 'chest' })).toBeNull()
    expect(proposalFor(S, null)).toBeNull()
  })
})

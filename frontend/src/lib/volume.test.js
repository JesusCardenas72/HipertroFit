import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_SECONDARY, setSecondaryWeight } from './muscles.js'
import {
  EFFECTIVE_RIR, VOLUME_TARGET, VOLUME_GROUPS,
  isEffectiveSet, groupVolume, cycleVolume, plannedVolume, volumeStatus, volumeColor,
} from './volume.js'

// A work set with an optional RIR. Inline exercise metadata (tg/mg/sm) resolves through
// musclesOf exactly as a catalogue entry would; ids here are intentionally not in EXIDX.
const set = (rir, extra = {}) => ({ done: true, w: 50, r: 8, ...(rir == null ? {} : { rir }), ...extra })
const entry = (meta, sets) => ({ id: meta.id || 'x', ...meta, sets })
const workout = (d, entries, routineId = 'a') => ({ d, start: Date.parse(d + 'T10:00:00'), routineId, entries })
// The same session logged with no routine: a freestyle workout, trained outside the plan.
const offPlan = (d, entries) => workout(d, entries, null)

// Single-muscle exercises so the group value equals the effective set count exactly.
const curl = sets => entry({ id: 'curl', tg: 'biceps' }, sets)          // biceps primary
const squat = sets => entry({ id: 'squat', tg: 'quads', sm: ['glutes', 'hamstrings'] }, sets)

describe('effective-set rule', () => {
  it('counts a set at or below RIR 4, and any unrated set', () => {
    expect(isEffectiveSet(set(0))).toBe(true)
    expect(isEffectiveSet(set(4))).toBe(true)
    expect(isEffectiveSet(set(null))).toBe(true)   // unrated is counted, per product
    expect(EFFECTIVE_RIR).toBe(4)
  })
  it('drops a set logged further than 4 reps from failure', () => {
    expect(isEffectiveSet(set(5))).toBe(false)
    expect(isEffectiveSet(set(6))).toBe(false)
  })
  it('reads RPE the same way (RPE 6 == RIR 4 counts, RPE 5 does not)', () => {
    expect(isEffectiveSet({ done: true, rpe: 6 })).toBe(true)
    expect(isEffectiveSet({ done: true, rpe: 5 })).toBe(false)
  })
})

describe('groupVolume', () => {
  it('sums one effective set per single-muscle set', () => {
    const { groups } = groupVolume([workout('2026-09-01', [curl([set(2), set(2), set(3)])])])
    expect(groups.biceps).toBe(3)
    expect(groups.legs).toBe(0)
  })

  it('credits a group with the strongest muscle per set, never the sum of its muscles', () => {
    // A squat trains quads (1) plus glutes and hamstrings as secondaries (0.4). All three
    // fold into "legs": one squat set must weigh 1 leg set, not 1.8.
    const { groups } = groupVolume([workout('2026-09-01', [squat([set(1), set(1)])])])
    expect(groups.legs).toBe(2)
  })

  it('excludes warm-ups and sets past the RIR threshold from the volume', () => {
    const { groups } = groupVolume([workout('2026-09-01', [curl([
      set(2),
      set(8),                          // too easy — not effective
      set(2, { phase: 'warmup' }),     // warm-up — never volume
    ])])])
    expect(groups.biceps).toBe(1)
  })

  it('reports rated/unrated coverage over every done work set, regardless of the pick', () => {
    const { rated, unrated, total } = groupVolume([workout('2026-09-01', [curl([
      set(2), set(8), set(null), set(null),
    ])])])
    expect(rated).toBe(2)      // the RIR-2 and RIR-8 sets are both rated
    expect(unrated).toBe(2)
    expect(total).toBe(4)
  })

  it('folds back as upper+lower and side delts as the whole deltoids group', () => {
    const row = entry({ id: 'pull', primaries: ['upper-back', 'lower-back'], secondaries: ['deltoids'] }, [set(2)])
    const { groups } = groupVolume([workout('2026-09-01', [row])])
    expect(groups.back).toBe(1)          // one set toward back (max of upper/lower = 1)
    expect(groups.delts).toBeCloseTo(0.4)
  })
})

describe('cycleVolume', () => {
  // Six sessions close a PPL block, so the seventh opens a new one and the count restarts:
  // the panel reports the block being built, not a rolling six.
  const SEQ = ['a', 'b', 'c', 'd', 'e', 'f']
  const S = n => ({
    program: { strategy: 'ppl', seq: SEQ, cycleStart: '2026-09-01' },
    workouts: Array.from({ length: n }, (_, i) =>
      workout(`2026-09-${String(i + 1).padStart(2, '0')}`, [curl([set(2)])], SEQ[i % 6])),
  })

  it('sums only the sessions logged since the block opened', () => {
    expect(cycleVolume(S(3))).toMatchObject({ sessions: 3 })
    expect(cycleVolume(S(3)).groups.biceps).toBe(3)
  })

  it('restarts at the block boundary instead of rolling', () => {
    expect(cycleVolume(S(6)).sessions).toBe(0)      // block closed, next one empty
    expect(cycleVolume(S(7)).sessions).toBe(1)
    expect(cycleVolume(S(7)).groups.biceps).toBe(1)
  })

  // An extra session trained outside the plan is still training: every set of it is volume
  // for the microcycle it happened in, and it must not shorten that microcycle by taking a
  // planned session's place — the block still runs its six planned sessions.
  it('adds an off-plan session to the volume of the microcycle it falls in', () => {
    const st = S(3)
    st.workouts.splice(2, 0, offPlan('2026-09-02', [curl([set(2), set(2)])]))
    const vol = cycleVolume(st)
    expect(vol.groups.biceps).toBe(5)               // 3 planned sets + the 2 extra ones
    expect(vol.sessions).toBe(4)
  })

  it('does not let an off-plan session close the block early', () => {
    const st = S(6)                                 // six planned sessions: block closed
    st.workouts.splice(3, 0, offPlan('2026-09-03', [curl([set(2)])]))
    expect(cycleVolume(st).sessions).toBe(0)        // still exactly six, still closed
    // ...and the last planned session stays inside the block instead of being pushed out.
    const five = S(5)
    five.workouts.splice(2, 0, offPlan('2026-09-02', [curl([set(2)])]))
    expect(cycleVolume(five).groups.biceps).toBe(6) // all five planned + the extra one
  })

  it('opens the next block with an off-plan session trained before it starts', () => {
    const st = S(6)
    st.workouts.push(offPlan('2026-09-07', [curl([set(2), set(2)])]))
    expect(cycleVolume(st).groups.biceps).toBe(2)   // the closed block did not take it
  })
})

describe('volume status', () => {
  it('bands against the 10–20 target', () => {
    expect(VOLUME_TARGET).toEqual({ min: 10, max: 20 })
    expect(volumeStatus(9.9)).toBe('low')
    expect(volumeStatus(10)).toBe('ok')
    expect(volumeStatus(20)).toBe('ok')
    expect(volumeStatus(20.1)).toBe('high')
  })
  it('maps each status to a colour token', () => {
    expect(volumeColor('ok')).toBe('var(--green)')
    expect(volumeColor('low')).toBe('var(--orange)')
    expect(volumeColor('high')).toBe('var(--red)')
  })
  it('exposes the seven home groups in order', () => {
    expect(VOLUME_GROUPS.map(g => g.key)).toEqual(
      ['legs', 'chest', 'back', 'delts', 'biceps', 'triceps', 'abs'])
  })
})

// The secondary-muscle weight is a user setting (Settings ▸ Training volume, pushed into
// lib/muscles.js by the store): it is the only source of the decimals on the volume panel,
// so the panel has to follow it.
describe('user-set secondary weight', () => {
  afterEach(() => setSecondaryWeight(DEFAULT_SECONDARY))

  // Bench: chest primary, triceps secondary. Four sets -> chest 4, triceps 4 * weight.
  const bench = sets => entry({ id: 'bench', tg: 'pectorals', sm: ['triceps'] }, sets)
  const tri = w => {
    setSecondaryWeight(w)
    return groupVolume([workout('2026-09-01', [bench([set(2), set(2), set(2), set(2)])])]).groups
  }

  it('defaults to 0.4 of a set', () => {
    expect(DEFAULT_SECONDARY).toBe(0.4)
    expect(tri(DEFAULT_SECONDARY).triceps).toBeCloseTo(1.6)
  })

  it('counts a secondary as a full set at 1, and not at all at 0', () => {
    expect(tri(1).triceps).toBe(4)
    expect(tri(0).triceps).toBe(0)
  })

  it('leaves the primary muscle at a full set whatever the weight is', () => {
    expect(tri(0).chest).toBe(4)
    expect(tri(1).chest).toBe(4)
    expect(tri(0.25).chest).toBe(4)
  })

  it('still credits a group with its strongest muscle, not the sum', () => {
    setSecondaryWeight(1)                 // squat: quads + glutes + hamstrings all "legs"
    const { groups } = groupVolume([workout('2026-09-01', [squat([set(1), set(1)])])])
    expect(groups.legs).toBe(2)
  })
})

describe('plannedVolume', () => {
  const routines = [
    { id: 'push', ex: [{ id: 'curl', tg: 'biceps', sets: 3, warmupSets: 2 }] },
    { id: 'legs', ex: [{ id: 'squat', tg: 'quads', sets: 4 }] },
  ]
  const S = (seq, strategy = 'custom') => ({ routines, workouts: [], program: { on: false, seq, anchor: '2026-09-01', strategy } })

  it('counts the configured work sets of each routine in the sequence, warm-ups aside', () => {
    const v = plannedVolume(S(['push', 'rest', 'legs']))
    expect(v.groups.biceps).toBe(3)
    expect(v.groups.legs).toBe(4)
    expect(v.sessions).toBe(2)
    expect(v.total).toBe(7)
    expect(v.unrated).toBe(0)
  })
  it('wraps the sequence to fill the strategy microcycle', () => {
    // Upper / Lower = 4 sessions: push, legs, push, legs.
    const v = plannedVolume(S(['push', 'legs'], 'upper-lower'))
    expect(v.groups.biceps).toBe(6)
    expect(v.groups.legs).toBe(8)
    expect(v.sessions).toBe(4)
  })
  it('skips rest days and deleted routines, and is empty without a sequence', () => {
    expect(plannedVolume(S(['gone', 'rest', 'push'])).groups.biceps).toBe(3)
    const empty = plannedVolume(S([]))
    expect(empty.total).toBe(0)
    expect(empty.sessions).toBe(0)
  })
})

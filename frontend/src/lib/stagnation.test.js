import { describe, it, expect } from 'vitest'
import { stalledExercises, bestsByMicro, STALL_MICROS } from './stagnation.js'

// Full body, 3 sessions per microcycle, counted from 2026-01-01 with no closed log: every three
// planned sessions are one microcycle. `micros` lists, per microcycle, the bench set of its
// sessions as [weight, reps]; other exercises can ride along in `extra`.
const day = i => '2026-01-' + String(i + 1).padStart(2, '0')
function state(micros, { extra = {}, deloads = [] } = {}) {
  const workouts = []
  micros.forEach((sets, m) => {
    for (let k = 0; k < 3; k++) {
      const i = m * 3 + k
      const entries = [{ id: 'bench', sets: [{ w: sets[0], r: sets[1], done: true }] }]
      for (const id in extra) if (extra[id][m]) entries.push({ id, sets: [{ w: extra[id][m][0], r: extra[id][m][1], done: true }] })
      workouts.push({ id: 'w' + i, d: day(i), start: i, routineId: 'a', entries, ...(deloads.includes(m) ? { deload: 0.4 } : {}) })
    }
  })
  return { program: { strategy: 'full-body', seq: ['a'], cycleStart: '2026-01-01' }, workouts, meso: null }
}

describe('stalledExercises', () => {
  it('names an exercise that has not beaten its earlier best for three microcycles', () => {
    const S = state([[100, 5], [102.5, 5], [102.5, 5], [100, 6], [102.5, 5]])
    expect(stalledExercises(S)).toEqual([{ id: 'bench', metric: 'e1rm', best: 119.6, recent: 120, micros: 3 }])   // 100×6 is +0.3 %
  })

  it('says nothing while it still climbs, or after fewer than three flat microcycles', () => {
    expect(stalledExercises(state([[100, 5], [102.5, 5], [105, 5], [107.5, 5]]))).toEqual([])
    expect(stalledExercises(state([[100, 5], [102.5, 5], [102.5, 5], [102.5, 5]]))).toEqual([])   // flat for 2
  })

  it('ignores gains under 1 % as noise', () => {
    // 100×8 → 126.7; 100.5×8 → 127.3 (+0.5 %)
    expect(stalledExercises(state([[100, 8], [100.5, 8], [100, 8], [100.5, 8]]))[0]).toMatchObject({ id: 'bench', micros: 3 })
  })

  it('counts how long it has really been flat', () => {
    const S = state([[100, 5], [102.5, 5], [100, 5], [102.5, 5], [100, 5], [102.5, 5]])
    expect(stalledExercises(S)[0].micros).toBe(4)
    expect(STALL_MICROS).toBe(3)
  })

  it('reads weight × reps when the sets are too long for a 1RM estimate', () => {
    const S = state([[100, 5], [100, 5], [100, 5], [100, 5]], { extra: { curl: [[20, 15], [20, 15], [20, 14], [17.5, 16]] } })
    expect(stalledExercises(S).find(x => x.id === 'curl')).toEqual({ id: 'curl', metric: 'work', best: 300, recent: 300, micros: 3 })
  })

  it('leaves deload microcycles out', () => {
    // The lighter fourth microcycle is a deload: without it bench is still climbing.
    const S = state([[100, 5], [102.5, 5], [105, 5], [70, 5], [107.5, 5]], { deloads: [3] })
    expect(bestsByMicro(S).byEx.bench).toHaveLength(4)
    expect(stalledExercises(S)).toEqual([])
  })

  it('forgets an exercise no longer trained', () => {
    const S = state([[100, 5], [100, 5], [100, 5], [100, 5], [100, 5], [100, 5]],
      { extra: { row: [[80, 8], [80, 8], [80, 8], [80, 8]] } })
    expect(stalledExercises(S).map(x => x.id)).toEqual(['bench'])
  })
})

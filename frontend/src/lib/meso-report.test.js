import { describe, it, expect } from 'vitest'
import { mesocycles, mesoReport, latestMesoReport } from './meso-report.js'

// Full body, 3 sessions per microcycle from 2026-01-01, no closed log: every three planned
// sessions are one microcycle. `micros` gives, per microcycle, [bench weight, reps, rir, goal]
// and whether it is a deload.
const day = i => '2026-01-' + String(i + 1).padStart(2, '0')
function state(micros, extra = {}) {
  const workouts = []
  micros.forEach(([w, r, rir, goal, deload], m) => {
    for (let k = 0; k < 3; k++) {
      const i = m * 3 + k
      workouts.push({
        id: 'w' + i, d: day(i), start: i, routineId: 'a',
        entries: [{ id: 'x-bench', tg: 'chest', sets: [{ w, r, rir, done: true }, { w, r, rir, done: true }] }],
        ...(goal != null ? { rirGoal: goal } : {}), ...(deload ? { deload: 0.4 } : {}),
      })
    }
  })
  return { program: { strategy: 'full-body', seq: ['a'], cycleStart: '2026-01-01' }, workouts, meso: null, bodyweight: [], ...extra }
}

describe('mesocycles', () => {
  it('splits the microcycles at each deload, which closes the block before it', () => {
    const S = state([[100, 5, 3, 3], [102.5, 5, 2, 2], [105, 5, 1, 1], [60, 5, 4, 4, true], [105, 5, 3, 3]])
    const m = mesocycles(S)
    expect(m.map(x => [x.micros.length, !!x.deload, x.running])).toEqual([[3, true, false], [1, false, true]])
  })
})

describe('mesoReport', () => {
  const S = state([[100, 5, 3, 3], [102.5, 5, 2, 2], [105, 5, 1, 1], [60, 5, 4, 4, true]], {
    bodyweight: [{ d: '2026-01-01', w: 80 }, { d: '2026-01-09', w: 81.2 }, { d: '2026-02-20', w: 90 }],
    measures: [{ d: '2026-01-02', arm: 37 }, { d: '2026-01-10', arm: 37.6 }],
  })
  const r = mesoReport(S, mesocycles(S)[0], '2026-01-31')

  it('counts microcycles and sessions done against planned', () => {
    expect(r).toMatchObject({ start: '2026-01-01', micros: 3, deload: true, running: false, sessions: 9, planned: 9, adherence: 100 })
  })

  it('lines up each group’s effective sets per microcycle against its band', () => {
    const chest = r.groups.find(g => g.key === 'chest')
    expect(chest.sets).toEqual([6, 6, 6])
    expect(chest.avg).toBe(6)
    expect(chest.band).toEqual({ min: 12, max: 20 })
  })

  it('reads the effort against the target RIR, microcycle by microcycle', () => {
    expect(r.effort).toEqual([{ avg: 3, goal: 3 }, { avg: 2, goal: 2 }, { avg: 1, goal: 1 }])
  })

  it('says what the block moved: 1RM, body weight and measurements inside its dates', () => {
    expect(r.strength).toEqual([{ id: 'x-bench', from: 116.7, to: 122.5, pct: 5 }])
    expect(r.bodyweight).toEqual({ from: 80, to: 81.2, delta: 1.2 })
    expect(r.measures).toEqual([{ key: 'arm', from: 37, to: 37.6, delta: 0.6 }])
  })

  it('reports the running mesocycle when no deload has closed one', () => {
    const run = latestMesoReport(state([[100, 5, 3, 3], [102.5, 5, 2, 2]]), '2026-01-31')
    expect(run).toMatchObject({ running: true, micros: 2, deload: false })
    expect(latestMesoReport({ workouts: [], program: null, bodyweight: [] })).toBeNull()
  })
})

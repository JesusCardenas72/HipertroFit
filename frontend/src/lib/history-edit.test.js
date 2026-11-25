import { describe, it, expect } from 'vitest'
import { removeSetFromHistory, removeEntryFromHistory, removalScope } from './history-edit.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const wk = (id, d, entries, extra = {}) => ({ id, d, start: 0, end: 0, routineId: 'r1', name: 'Push', entries, prs: [], vol: 0, ...extra })

describe('removeSetFromHistory', () => {
  it('takes the set out and works the volume out again', () => {
    const hist = [wk('a', '2026-11-20', [{ id: 'bench', sets: [set(100, 5), set(90, 8)], target: { sets: 3 } }], { vol: 1220 })]
    const res = removeSetFromHistory(hist, 'a', 0, 1)
    expect(res.removed).toBe('set')
    expect(res.workouts[0].entries[0].sets).toEqual([set(100, 5)])
    expect(res.workouts[0].vol).toBe(500)
    // a session's target is what was planned: untouched
    expect(res.workouts[0].entries[0].target.sets).toBe(3)
    // the input is not mutated
    expect(hist[0].entries[0].sets).toHaveLength(2)
    expect(hist[0].vol).toBe(1220)
  })

  it('leaves warm-ups out of the volume, as everywhere else', () => {
    const hist = [wk('a', '2026-11-20', [{ id: 'bench', sets: [set(40, 10, { phase: 'warmup' }), set(100, 5), set(100, 4)] }])]
    const res = removeSetFromHistory(hist, 'a', 0, 2)
    expect(res.workouts[0].vol).toBe(500)
  })

  it('removes the exercise with its last done set, and the workout with its last exercise', () => {
    const hist = [wk('a', '2026-11-20', [
      { id: 'bench', sets: [set(100, 5), { w: 100, r: 5, done: false }] },
      { id: 'row', sets: [set(60, 10)] },
    ])]
    const one = removeSetFromHistory(hist, 'a', 0, 0)
    expect(one.removed).toBe('entry')
    expect(one.workouts[0].entries.map(e => e.id)).toEqual(['row'])
    const two = removeSetFromHistory(one.workouts, 'a', 0, 0)
    expect(two.removed).toBe('workout')
    expect(two.workouts).toEqual([])
  })

  it('keeps the extra workout\'s set count in step', () => {
    const hist = [wk('x', '2026-11-20', [{ id: 'curl', sets: [set(12, 10), set(12, 10), set(12, 8)], target: { mode: 'reps', sets: 3 } }], { extra: true, routineId: null })]
    const res = removeSetFromHistory(hist, 'x', 0, 2)
    expect(res.workouts[0].entries[0].target.sets).toBe(2)
    expect(res.workouts[0].extra).toBe(true)
  })

  it('drops a PR the remaining sets no longer earn, keeps one they still do', () => {
    const earlier = wk('a', '2026-11-10', [{ id: 'bench', sets: [set(100, 5)] }])
    const pr = wk('b', '2026-11-20', [
      { id: 'bench', sets: [set(105, 3), set(100, 5)] },
      { id: 'row', sets: [set(70, 8)] },
    ], { prs: ['bench', 'row'] })
    const lost = removeSetFromHistory([earlier, pr], 'b', 0, 0)
    expect(lost.workouts[1].prs).toEqual(['row'])
    const kept = removeSetFromHistory([earlier, pr], 'b', 0, 1)
    expect(kept.workouts[1].prs).toEqual(['bench', 'row'])
  })

  it('resets a legacy topW to the heaviest set left', () => {
    const hist = [wk('a', '2026-11-20', [{ id: 'bench', topW: 110, sets: [set(110, 2), set(100, 5)] }])]
    const res = removeSetFromHistory(hist, 'a', 0, 0)
    expect(res.workouts[0].entries[0].topW).toBe(100)
  })

  it('returns null when the target is gone', () => {
    const hist = [wk('a', '2026-11-20', [{ id: 'bench', sets: [set(100, 5)] }])]
    expect(removeSetFromHistory(hist, 'zz', 0, 0)).toBe(null)
    expect(removeSetFromHistory(hist, 'a', 3, 0)).toBe(null)
    expect(removeSetFromHistory(hist, 'a', 0, 7)).toBe(null)
  })
})

describe('removeEntryFromHistory', () => {
  it('takes the whole exercise and its PR, leaving the others alone', () => {
    const others = { id: 'other', d: '2026-11-21', entries: [{ id: 'bench', sets: [set(80, 5)] }] }
    const hist = [wk('a', '2026-11-20', [
      { id: 'bench', sets: [set(100, 5)] },
      { id: 'row', sets: [set(60, 10)] },
    ], { prs: ['bench'] }), others]
    const res = removeEntryFromHistory(hist, 'a', 0)
    expect(res.removed).toBe('entry')
    expect(res.workouts[0].entries.map(e => e.id)).toEqual(['row'])
    expect(res.workouts[0].prs).toEqual([])
    expect(res.workouts[0].vol).toBe(600)
    expect(res.workouts[1]).toBe(others)
  })

  it('removes the workout with its only exercise', () => {
    const hist = [wk('a', '2026-11-20', [{ id: 'bench', sets: [set(100, 5)] }])]
    expect(removeEntryFromHistory(hist, 'a', 0)).toEqual({ workouts: [], removed: 'workout' })
  })
})

describe('removalScope', () => {
  const w = wk('a', '2026-11-20', [
    { id: 'bench', sets: [set(100, 5), set(100, 5)] },
    { id: 'row', sets: [set(60, 10)] },
  ])
  it('says what a removal would take with it', () => {
    expect(removalScope(w, 0, 0)).toBe('set')
    expect(removalScope(w, 1, 0)).toBe('entry')
    expect(removalScope(w, 0)).toBe('entry')
    expect(removalScope({ ...w, entries: [w.entries[1]] }, 0, 0)).toBe('workout')
    expect(removalScope(w, 5)).toBe(null)
  })
})

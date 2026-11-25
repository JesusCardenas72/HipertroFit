import { describe, it, expect } from 'vitest'
import { sessionNotice, nextSetOf, noticeKey } from './session-notice.js'

// Ids outside the catalogue keep the names predictable (exOr falls back to the id).
const A = (extra = {}) => ({
  name: 'Push Day', cur: 0,
  entries: [
    { id: 'x-bench', target: { id: 'x-bench' }, sets: [
      { w: 40, r: 5, phase: 'warmup', done: true },
      { w: 75, r: 8, rir: 1, done: true },
      { w: 75, r: 8, rir: 1, done: false },
    ] },
    { id: 'x-fly', target: { id: 'x-fly' }, sets: [{ w: 20, r: 12, done: false }] },
  ],
  ...extra,
})

describe('sessionNotice', () => {
  it('says where the session stands and what the next set is', () => {
    const n = sessionNotice({ active: A() }, null, 0)
    expect(n.title).toBe('Push Day · 2/4 sets')
    expect(n.body).toMatch(/ · Set 2\/2 · 75×8 \(RIR 1\)$/)
  })

  it('adds the end of a running rest, and leaves out one already over', () => {
    const endsAt = new Date(2026, 10, 23, 12, 34, 5).getTime()
    expect(sessionNotice({ active: A() }, { endsAt }, endsAt - 30000).body.split('\n')[0]).toBe('Resting until 12:34:05')
    expect(sessionNotice({ active: A() }, { endsAt }, endsAt + 1).body).not.toMatch(/Resting/)
  })

  it('walks on to the next exercise, and says so when everything is done', () => {
    const a = A()
    a.entries[0].sets[2].done = true
    expect(nextSetOf(a)).toEqual({ entry: a.entries[1], i: 0 })
    a.entries[1].sets[0].done = true
    expect(nextSetOf(a)).toBeNull()
    expect(sessionNotice({ active: a }, null, 0).body).toMatch(/finish the workout/)
  })

  it('is nothing without a running session, or for a past one being logged', () => {
    expect(sessionNotice({ active: null })).toBeNull()
    expect(sessionNotice({ active: A({ backfill: true }) })).toBeNull()
    expect(noticeKey({ active: null }, null)).toBe('')
  })

  it('changes its key when a set is ticked or a rest starts', () => {
    const a = A()
    const k1 = noticeKey({ active: a }, null)
    expect(noticeKey({ active: a }, { endsAt: 5 })).not.toBe(k1)
    a.entries[0].sets[2].done = true
    expect(noticeKey({ active: a }, null)).not.toBe(k1)
  })
})

import { describe, it, expect } from 'vitest'
import { railItems, exerciseRecords, repMaxTable, repMaxFor, estimateSessionSec, sessionRoom, WORK_SEC, tabDropIntent, unitDropIntent, DROP_LEAN } from './session-view.js'
import { supersetUnits } from './history.js'
import { dockItems } from './workout-dock.js'
import { estimate1RM } from './onerm.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const entry = (id, sets, sg) => ({ id, sets, ...(sg ? { sg } : {}) })

describe('railItems', () => {
  const entries = [
    entry('a', [set(10, 10)], 'g1'),
    entry('b', [set(10, 10), { w: 10, r: 10 }], 'g1'),
    entry('c', [{ w: 10, r: 10 }], 'g2'),
    entry('d', [{ w: 10, r: 10 }], 'g2'),
    entry('e', [{ w: 10, r: 10 }], 'g2'),
    entry('f', [{ w: 10, r: 10 }]),
  ]

  it('places every entry in its superset bar', () => {
    expect(railItems(entries, 0).map(i => i.pos)).toEqual(['first', 'last', 'first', 'mid', 'last', 'solo'])
  })

  it('uses the dock colours, so the rail and the dock agree', () => {
    const hues = dockItems(entries).map(i => i.hue)
    const rail = railItems(entries, 0)
    expect(rail[0].hue).toBe(hues[0])
    expect(rail[1].hue).toBe(hues[0])
    expect(rail[2].hue).toBe(hues[1])
    expect(rail[0].hue).not.toBe(rail[2].hue)
    expect(rail[5].hue).toBeNull()
  })

  it('marks the whole unit of the current entry as current', () => {
    const rail = railItems(entries, 1)
    expect(rail.filter(i => i.current).map(i => i.idx)).toEqual([0, 1])
  })

  it('marks an entry done only when every set is', () => {
    expect(railItems(entries, 0).map(i => i.done)).toEqual([true, false, false, false, false, false])
    expect(railItems([entry('x', [])], 0)[0].done).toBe(false)
  })

  it('copes with no entries', () => {
    expect(railItems(undefined, 0)).toEqual([])
  })
})

describe('exerciseRecords', () => {
  const S = {
    workouts: [
      { d: '2020-10-01', entries: [entry('ext', [set(10, 10), set(8, 12), set(20, 3, { warmup: true })])] },
      { d: '2020-12-01', entries: [entry('ext', [set(6, 20), set(10, 8)]), entry('other', [set(99, 1)])] },
      { d: '2021-01-01', entries: [entry('ext', [{ w: 30, r: 5 }])] },
    ],
  }

  it('finds the heaviest work set and the most reps, with their day', () => {
    expect(exerciseRecords(S, 'ext')).toEqual({
      maxWeight: { w: 10, r: 10, d: '2020-10-01' },
      maxReps: { r: 20, w: 6, d: '2020-12-01' },
    })
  })

  it('ignores warm-ups and sets never ticked off', () => {
    const { maxWeight } = exerciseRecords(S, 'ext')
    expect(maxWeight.w).toBe(10)
  })

  it('breaks a weight tie by reps and a reps tie by weight', () => {
    const tie = { workouts: [{ d: '1', entries: [entry('x', [set(50, 5), set(50, 8), set(40, 8)])] }] }
    expect(exerciseRecords(tie, 'x')).toEqual({ maxWeight: { w: 50, r: 8, d: '1' }, maxReps: { r: 8, w: 50, d: '1' } })
  })

  it('keeps a bodyweight exercise’s reps but has no weight record for it', () => {
    const bw = { workouts: [{ d: '1', entries: [entry('pull', [set(0, 12)])] }] }
    expect(exerciseRecords(bw, 'pull')).toEqual({ maxWeight: null, maxReps: { r: 12, w: 0, d: '1' } })
  })

  it('has nothing to show without history', () => {
    expect(exerciseRecords({ workouts: [] }, 'x')).toEqual({ maxWeight: null, maxReps: null })
    expect(exerciseRecords(undefined, 'x')).toEqual({ maxWeight: null, maxReps: null })
  })
})

describe('repMaxTable', () => {
  it('runs Epley backwards', () => {
    const rows = repMaxTable(100)
    expect(rows.find(r => r.r === 1).w).toBe(100)
    expect(rows.find(r => r.r === 10).w).toBe(75)        // 100 / (1 + 10/30)
    expect(rows.find(r => r.r === 5).w).toBe(85.7)
  })

  it('round-trips with estimate1RM within rounding', () => {
    repMaxTable(120).filter(r => !r.rough && r.r > 1).forEach(row => {
      expect(Math.abs(estimate1RM(row.w, row.r) - 120)).toBeLessThanOrEqual(0.2)
    })
  })

  it('goes down as the reps go up', () => {
    const ws = repMaxTable(100).map(r => r.w)
    ws.slice(1).forEach((w, i) => expect(w).toBeLessThan(ws[i]))
  })

  it('marks the rows past the estimate cap as rough', () => {
    const rows = repMaxTable(100)
    expect(rows.filter(r => r.rough).map(r => r.r)).toEqual([15, 20])
  })

  it('follows the chosen formula', () => {
    expect(repMaxTable(100, [10], 'brzycki')[0].w).toBe(75)   // 100 · (37 − 10) / 36
  })

  it('returns nothing for a missing estimate', () => {
    expect(repMaxTable(0)).toEqual([])
    expect(repMaxTable(null)).toEqual([])
    expect(repMaxTable(NaN)).toEqual([])
  })

  it('reads the all-time best estimate from history', () => {
    const S = { workouts: [{ d: '1', start: 1, entries: [entry('x', [set(75, 10)])] }] }
    expect(repMaxFor(S, 'x').find(r => r.r === 1).w).toBe(100)
    expect(repMaxFor(S, 'nope')).toEqual([])
  })
})

describe('estimateSessionSec', () => {
  const opts = { restSec: 90, warmupRestSec: 0, restExSec: 120 }

  it('adds the work, the rests between sets and the break between exercises', () => {
    const entries = [entry('a', [{}, {}, {}]), entry('b', [{}, {}])]
    const units = supersetUnits(entries)
    // a: 3 sets + 2 rests, break, b: 2 sets + 1 rest
    expect(estimateSessionSec(entries, units, opts)).toBe(5 * WORK_SEC + 3 * 90 + 120)
  })

  it('rests once per round of a superset, not after every member', () => {
    const entries = [entry('a', [{}, {}], 'g'), entry('b', [{}, {}], 'g')]
    expect(estimateSessionSec(entries, supersetUnits(entries), opts)).toBe(4 * WORK_SEC + 90)
  })

  it('takes a timed set’s own length and a warm-up’s own rest', () => {
    const entries = [entry('plank', [{ sec: 60, warmup: true }, { sec: 45 }])]
    expect(estimateSessionSec(entries, supersetUnits(entries), opts)).toBe(60 + 45)
    expect(estimateSessionSec(entries, supersetUnits(entries), { ...opts, warmupRestSec: 30 })).toBe(60 + 45 + 30)
  })

  it('honours the exercise’s own rest and the break override', () => {
    const entries = [entry('a', [{}, {}]), entry('b', [{}])]
    entries[0].target = { restSec: 180 }
    entries[0].restExSec = 60
    expect(estimateSessionSec(entries, supersetUnits(entries), opts)).toBe(3 * WORK_SEC + 180 + 60)
  })

  it('is zero for an empty session', () => {
    expect(estimateSessionSec([], [], opts)).toBe(0)
  })
})

describe('sessionRoom', () => {
  // Page coordinates: a last card low on the page, a foot of 120px below the session.
  const page = { cardTop: 1000, panelBottom: 1412, belowSession: 120, viewport: 812, header: 115 }

  it('is the room the page is short of, so the last card can come up under the header', () => {
    expect(sessionRoom(page)).toBe(153)
  })

  it('is zero when the page can already scroll the card up', () => {
    expect(sessionRoom({ ...page, cardTop: 300, panelBottom: 1200, belowSession: 300 })).toBe(0)
  })

  it('leaves the page long enough for the card to reach its place, and no longer', () => {
    const room = sessionRoom(page)
    const maxScroll = page.panelBottom + room + page.belowSession - page.viewport
    expect(maxScroll).toBe(page.cardTop - page.header - 12)
  })
})

describe('tabDropIntent and unitDropIntent', () => {
  // Four tabs of 60px in a column: a and b are a superset, c and d stand alone.
  const entries = [
    { id: 'a', sg: 'g1', sets: [] }, { id: 'b', sg: 'g1', sets: [] },
    { id: 'c', sets: [] }, { id: 'd', sets: [] },
  ]
  const spans = [0, 1, 2, 3].map(i => ({ index: i, top: i * 60, bottom: i * 60 + 60 }))

  it('lands a tab in a plain gap between two others, with the marker and the lean', () => {
    // 'a' dragged to the gap between 'c' and 'd' (y=180): not over anyone's middle, and no
    // superset to stay with, so it takes that slot
    const r = tabDropIntent(entries, 0, 180, spans)
    expect(r.join).toBeNull()
    expect(r.intent.slot).toBe(2)
    expect(r.markerY).toBe(180)
    expect(r.leans[2]).toBe(-DROP_LEAN)
    expect(r.leans[3]).toBe(DROP_LEAN)
  })

  it('joins the tab it is dropped over, in its middle', () => {
    const r = tabDropIntent(entries, 2, 30 + 60 * 3, spans)
    expect(r.join).toBe(3)
    expect(r.leans).toEqual({})
  })

  it('keeps a superset member standing by its own mate', () => {
    const r = tabDropIntent(entries, 0, 80, spans)
    expect(r.join).toBe(1)
  })

  it('moves a whole superset to a slot among the other units', () => {
    const r = unitDropIntent(entries, [0, 1], 250, spans)
    // the other units are c (centre 150) and d (centre 210)... 250 is past both
    expect(r.intent).toEqual({ unit: 2 })
    expect(r.markerY).toBe(240)
    expect(r.join).toBeNull()
  })

  it('puts a superset at the top when dropped above everything', () => {
    expect(unitDropIntent(entries, [0, 1], 5, spans).intent).toEqual({ unit: 0 })
  })
})

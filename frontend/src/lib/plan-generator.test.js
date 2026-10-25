import { afterEach, describe, expect, it } from 'vitest'
import { EXIDX, registerCustom } from './exercises.js'
import { patternOf } from './movement-patterns.js'
import { setVolumeSplit, VOLUME_GROUPS, targetOf } from './volume.js'
import { REST } from './program.js'
import { SPLITS, daysOf, layoutOf, splitForDays } from './split-templates.js'
import { LEVELS, SET_LIMITS, applyDraft, autoPick, buildDraft, candidatesFor, draftVolume, slotConfig } from './plan-generator.js'

const S0 = (over = {}) => ({ routines: [], folders: [], workouts: [], exDefaults: {}, favEx: [], customEx: [], program: null, meso: null, ...over })
const home = { id: 'p1', name: 'Home', equipment: ['dumbbell', 'band'] }
const slot = { pattern: 'horizontal_push', role: 'main' }

afterEach(() => { registerCustom([]); setVolumeSplit({}) })

describe('split templates', () => {
  it('picks the split by training days a week', () => {
    expect([2, 3, 4, 5, 6].map(splitForDays)).toEqual(['full-body', 'full-body', 'upper-lower', 'ppl', 'ppl'])
  })

  it('repeats the A days when variants are off', () => {
    expect(daysOf('ppl', false).map(d => d.key)).toEqual(['push-a', 'pull-a', 'legs-a'])
    expect(layoutOf('ppl', false)).toEqual(['push-a', 'pull-a', 'legs-a', 'push-a', 'pull-a', 'legs-a', 'rest'])
    expect(layoutOf('upper-lower', true)).toEqual(['up-a', 'lo-a', 'rest', 'up-b', 'lo-b', 'rest', 'rest'])
    expect(daysOf('full-body', false).length).toBe(3)   // full body is three different days anyway
  })

  it('only asks for patterns the catalogue can fill', () => {
    for (const sp of Object.values(SPLITS)) for (const d of sp.plan) for (const sl of d.slots) {
      expect(candidatesFor(S0(), sl, null).owned.length, sl.pattern).toBeGreaterThan(0)
    }
  })
})

describe('the exercises a slot offers', () => {
  it('lists every exercise of the pattern once: favourites, then your equipment, then the rest', () => {
    const S = S0({ favEx: ['0025'] })
    const g = candidatesFor(S, slot, home)
    const all = [...g.favorites, ...g.owned, ...g.rest]
    expect(new Set(all.map(e => e.id)).size).toBe(all.length)
    expect(all.every(e => patternOf(e) === 'horizontal_push')).toBe(true)
    expect(g.favorites.map(e => e.id)).toEqual(['0025'])                 // a barbell favourite stays a favourite
    expect(g.owned.every(e => ['dumbbell', 'band', 'body weight'].includes(e.eq))).toBe(true)
    expect(g.rest.some(e => e.eq === 'barbell')).toBe(true)
  })

  it('treats everything as owned without an equipment profile', () => {
    expect(candidatesFor(S0(), slot, null).rest).toEqual([])
  })

  it('offers a custom exercise of the pattern', () => {
    registerCustom([{ id: 'c1', n: 'my press', bp: 'chest', eq: 'dumbbell', pattern: 'horizontal_push', custom: true }])
    const S = S0({ customEx: [EXIDX.c1] })
    expect(candidatesFor(S, slot, null).owned.some(e => e.id === 'c1')).toBe(true)
  })

  it('starts each slot with an owned favourite, else the best owned, never twice in a day', () => {
    const S = S0({ favEx: ['0025', '0289'] })
    const g = candidatesFor(S, slot, home)
    expect(autoPick(g, home)).toBe('0289')                       // the dumbbell favourite, not the barbell one
    expect(autoPick(g, home, new Set(['0289']))).not.toBe('0289')
    expect(autoPick(candidatesFor(S0(), slot, null), null)).toBe('0025')   // barbell bench press
    const used = new Set(['0025'])
    expect(autoPick(candidatesFor(S0(), slot, null), null, new Set(), used)).not.toBe('0025')
  })
})

describe('building a draft', () => {
  it('fills every slot of every day for the level', () => {
    const d = buildDraft(S0(), { split: 'ppl', level: 'intermediate', variants: true })
    expect(d.days.map(x => x.key)).toEqual(['push-a', 'pull-a', 'legs-a', 'push-b', 'pull-b', 'legs-b'])
    expect(d.days.every(x => x.slots.length === LEVELS.intermediate.slots && x.slots.every(sl => sl.id))).toBe(true)
    // A and B days do not share their main lift.
    expect(d.days[0].slots[0].id).not.toBe(d.days[3].slots[1].id)
    const adv = buildDraft(S0(), { split: 'upper-lower', level: 'advanced', variants: true })
    expect(adv.days[0].slots.length).toBe(7)
  })

  it('keeps what the user picked and the sets they fixed', () => {
    const d = buildDraft(S0(), { split: 'ppl', level: 'intermediate', variants: true, picks: { 'push-a:0': '0251' }, sets: { 'push-a:1': 5 } })
    expect(d.days[0].slots[0]).toMatchObject({ id: '0251', picked: true })
    expect(d.days[0].slots[1]).toMatchObject({ sets: 5, pinned: true })
  })

  it('falls back to the split week when a saved order no longer fits the days', () => {
    const d = buildDraft(S0(), { split: 'ppl', level: 'intermediate', variants: false, seq: ['push-b', 'rest'] })
    expect(d.seq).toEqual(layoutOf('ppl', false))
    const mine = ['pull-a', 'push-a', 'rest', 'legs-a']
    expect(buildDraft(S0(), { split: 'ppl', level: 'beginner', variants: false, seq: mine }).seq).toEqual(mine)
  })

  it('moves the free sets until no group is over its band, within the set limits', () => {
    for (const split of Object.keys(SPLITS)) for (const level of Object.keys(LEVELS)) {
      const d = buildDraft(S0(), { split, level, variants: LEVELS[level].variants })
      const vol = draftVolume(S0(), d).groups
      for (const g of VOLUME_GROUPS.filter(x => !x.direct)) expect([split, level, g.key, vol[g.key] <= targetOf(g).max]).toEqual([split, level, g.key, true])
      for (const sl of d.days.flatMap(x => x.slots)) {
        const [lo, hi] = SET_LIMITS[sl.role]
        expect(sl.sets >= lo && sl.sets <= hi, sl.key).toBe(true)
      }
    }
  })

  it('reads the volume groups the user split', () => {
    setVolumeSplit({ legs: true })
    const d = buildDraft(S0(), { split: 'ppl', level: 'intermediate', variants: true })
    const vol = draftVolume(S0(), d).groups
    expect(vol.quads).toBeGreaterThan(0)
    expect(vol.legs).toBeUndefined()
  })
})

describe('applying a draft', () => {
  it('adds the routines in a folder and points the program at them', () => {
    const mine = { id: 'mine', name: 'Mine', ex: [] }
    const s = S0({ routines: [mine], workouts: [{ id: 'w', d: '2026-10-20', routineId: 'mine', entries: [] }] })
    const d = buildDraft(s, { split: 'ppl', level: 'intermediate', variants: true })
    const { folder, ids } = applyDraft(s, d, { name: 'PPL', label: n => 'ES ' + n, today: '2026-10-25' })
    expect(s.routines[0]).toBe(mine)                        // nothing you had is touched
    expect(s.routines.length).toBe(7)
    expect(s.folders).toEqual([folder])
    expect(s.routines.slice(1).every(r => r.folder === folder.id && r.name.startsWith('ES '))).toBe(true)
    expect(s.program).toMatchObject({ on: true, strategy: 'ppl', cycleStart: '2026-10-25', anchor: '2026-10-25', gen: { split: 'ppl', level: 'intermediate' } })
    expect(s.program.seq).toEqual([ids['push-a'], ids['pull-a'], ids['legs-a'], ids['push-b'], ids['pull-b'], ids['legs-b'], REST])
    expect(s.meso.deloads).toEqual([])
  })

  it('writes each exercise with double progression, its class range, its slot and its rest', () => {
    const s = S0()
    const d = buildDraft(s, { split: 'full-body', level: 'beginner', variants: false })
    applyDraft(s, d, { name: 'FB', today: '2026-10-25' })
    const first = s.routines[0].ex[0]
    expect(first).toMatchObject({ id: d.days[0].slots[0].id, prog: 'double', sets: d.days[0].slots[0].sets, restSec: 180, slot: { pattern: 'squat', role: 'main' } })
    expect(first.repsMin).toBeLessThan(first.reps)
  })

  it('lets the values the exercise already has win', () => {
    const s = S0({ exDefaults: { '0025': { restSec: 75 } } })
    expect(slotConfig(s, { id: '0025', sets: 4, pattern: 'horizontal_push', role: 'main' })).toMatchObject({ restSec: 75, sets: 4 })
  })

  it('leaves out a slot taken down to no sets', () => {
    const s = S0()
    const d = buildDraft(s, { split: 'full-body', level: 'beginner', variants: false, sets: { 'fb-a:5': 0 } })
    applyDraft(s, d, { name: 'FB', today: '2026-10-25' })
    expect(s.routines[0].ex.length).toBe(5)
  })
})

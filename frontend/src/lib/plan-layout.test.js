import { describe, expect, it } from 'vitest'
import { addSlot, dropSlot, layoutOfDay, removeSlot, roleForPattern, toggleLink } from './plan-layout.js'
import { applyDraft, buildDraft } from './plan-generator.js'

const S0 = () => ({ routines: [], folders: [], workouts: [], exDefaults: {}, favEx: [], customEx: [], program: null, meso: null })
const ppl = (extra = {}) => buildDraft(S0(), { split: 'ppl', level: 'intermediate', variants: true, ...extra })
const ids = defs => defs.map(d => d.id)

describe('editing the slots of a day', () => {
  it('reads a day as definitions keyed by slot, not by place', () => {
    const defs = layoutOfDay(ppl().days[2])          // Legs A
    expect(defs[0]).toEqual({ id: 'legs-a:0', pattern: 'squat', role: 'main' })
    expect(defs.length).toBe(6)
  })

  it('adds a slot with a role for its pattern and a key of its own', () => {
    const defs = layoutOfDay(ppl().days[2])
    expect(addSlot(defs, 'legs-a', 'lunge', 'k1')).toEqual({ id: 'legs-a:xk1', pattern: 'lunge', role: 'secondary' })
    expect(addSlot(defs, 'legs-a', 'hip_abduction', 'k2').role).toBe('accessory')
    expect(addSlot(defs, 'legs-a', 'bogus', 'k3')).toBe(null)
    expect(defs.length).toBe(8)
    expect(roleForPattern('hinge')).toBe('secondary')
  })

  it('removes a slot and loosens a superset left with one member', () => {
    const defs = layoutOfDay(ppl().days[2])
    toggleLink(defs, 3, 'g1')                         // leg extension + leg curl
    expect(defs[2].sg).toBe('g1')
    removeSlot(defs, 3)
    expect(defs.some(d => d.sg)).toBe(false)
    expect(defs.length).toBe(5)
  })

  it('links a slot with the one above, extends that superset, and unlinks', () => {
    const defs = layoutOfDay(ppl().days[0])
    toggleLink(defs, 4, 'g1')
    toggleLink(defs, 5, 'g2')                         // joins g1, does not start g2
    expect(defs.slice(3).map(d => d.sg)).toEqual(['g1', 'g1', 'g1'])
    toggleLink(defs, 5, 'g3')
    expect(defs.slice(3).map(d => d.sg ?? null)).toEqual(['g1', 'g1', null])
    expect(toggleLink(defs, 0, 'g4')).toBe(false)
  })

  it('drops a slot elsewhere, onto a neighbour as a superset, and moves a whole superset', () => {
    const defs = layoutOfDay(ppl().days[2])
    expect(dropSlot(defs, 5, { slot: 0 })).toBe(true)              // core to the top
    expect(defs[0].id).toBe('legs-a:5')
    expect(dropSlot(defs, 0, { slot: 0 })).toBe(false)             // nowhere new
    expect(dropSlot(defs, 4, { slot: 3, join: 3 })).toBe(true)     // onto its neighbour
    expect(defs[3].sg && defs[3].sg === defs[4].sg).toBe(true)
    const before = ids(defs)
    expect(dropSlot(defs, 3, { unit: 0 })).toBe(true)              // the pair, to the top
    expect(ids(defs).slice(0, 2)).toEqual([before[3], before[4]])
  })
})

describe('a draft built from a rearranged day', () => {
  it('uses the day’s own slots and keeps picks and sets on their keys after a move', () => {
    const defs = layoutOfDay(ppl().days[2])
    dropSlot(defs, 0, { slot: 5 })                   // squat to the end
    addSlot(defs, 'legs-a', 'hip_abduction', 'k1')
    const d = ppl({ layout: { 'legs-a': defs }, picks: { 'legs-a:0': '0042' }, sets: { 'legs-a:0': 5 } })
    const legs = d.days[2].slots
    expect(legs.map(s => s.key)).toEqual(ids(defs))
    expect(legs[5]).toMatchObject({ key: 'legs-a:0', pattern: 'squat', id: '0042', sets: 5 })
    expect(legs[6]).toMatchObject({ key: 'legs-a:xk1', pattern: 'hip_abduction' })
    expect(d.days[0].slots.length).toBe(6)           // other days keep the template
  })

  it('writes linked slots as a superset of the routine, and drops a link a left-out slot broke', () => {
    const defs = layoutOfDay(ppl().days[0])
    toggleLink(defs, 4, 'g1')                         // triceps + lateral raise
    toggleLink(defs, 1, 'g2')                         // horizontal + vertical push
    const s = S0()
    const d = ppl({ layout: { 'push-a': defs }, sets: { 'push-a:0': 0 } })
    applyDraft(s, d, { name: 'PPL', today: '2026-10-25' })
    const push = s.routines.find(r => r.name === 'Push A').ex
    expect(push.length).toBe(5)
    expect(push.filter(e => e.sg).length).toBe(2)     // g1 stays; g2 lost its partner
    expect(push[2].sg && push[2].sg === push[3].sg).toBe(true)
  })
})

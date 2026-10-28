import { describe, expect, test } from 'vitest'
import { ALL_EQUIPMENT, ADJUSTABLE, exAvailable, ownsEquipment, adjustableOf, adjustableFor } from './equipment.js'

const home = { id: 'h', name: 'Home', equipment: [ADJUSTABLE], adj: { from: 2, to: 20, step: 2 } }
const gym = { id: 'g', name: 'Gym', equipment: ['barbell', 'dumbbell'] }

describe('adjustable dumbbells as equipment', () => {
  test('are offered in the profile checklist, last', () => {
    expect(ALL_EQUIPMENT[ALL_EQUIPMENT.length - 1]).toBe(ADJUSTABLE)
    expect(ALL_EQUIPMENT.filter(k => k === ADJUSTABLE)).toHaveLength(1)
  })
  test('a profile with them can do dumbbell exercises, and only those', () => {
    const S = { equipFilterOn: true, equipProfiles: [home], activeEquipId: 'h' }
    expect(exAvailable(S, { eq: 'dumbbell' })).toBe(true)
    expect(exAvailable(S, { eq: 'barbell' })).toBe(false)
    expect(ownsEquipment(home, { eq: 'dumbbell' })).toBe(true)
    expect(ownsEquipment(home, { eq: 'cable' })).toBe(false)
  })
})

describe('the range an exercise starts from', () => {
  test('defaults to 4 to 32.5 kg, 1.5 kg a click', () => {
    expect(adjustableFor({})).toEqual({ from: 4, to: 32.5, step: 1.5 })
    expect(adjustableFor({ equipProfiles: [gym], activeEquipId: 'g' })).toEqual({ from: 4, to: 32.5, step: 1.5 })
    expect(adjustableOf(null)).toEqual({ from: 4, to: 32.5, step: 1.5 })
  })
  test('is the profile’s own when it has adjustable dumbbells, filter on or off', () => {
    expect(adjustableFor({ equipProfiles: [gym, home], activeEquipId: 'g' })).toEqual({ from: 2, to: 20, step: 2 })
    expect(adjustableFor({ equipFilterOn: false, equipProfiles: [home] })).toEqual({ from: 2, to: 20, step: 2 })
  })
  test('the selected profile wins over another one that has them', () => {
    const other = { ...home, id: 'o', adj: { from: 5, to: 25, step: 2.5 } }
    expect(adjustableFor({ equipProfiles: [home, other], activeEquipId: 'o' })).toEqual({ from: 5, to: 25, step: 2.5 })
  })
  test('a profile with the box ticked but no range yet gets the defaults', () => {
    expect(adjustableOf({ equipment: [ADJUSTABLE] })).toEqual({ from: 4, to: 32.5, step: 1.5 })
  })
})

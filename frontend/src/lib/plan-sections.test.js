import { describe, it, expect } from 'vitest'
import { PLAN_SECTIONS, isSectionOpen, moveSection, planSectionOrder, sectionDropIntent, toggleSection } from './plan-sections.js'

describe('planSectionOrder', () => {
  it('is the default order until something is saved', () => {
    expect(planSectionOrder({})).toEqual(PLAN_SECTIONS)
    expect(planSectionOrder(null)).toEqual(PLAN_SECTIONS)
  })
  it('keeps the saved order', () => {
    const order = ['routines', 'programming', 'sequence']
    expect(planSectionOrder({ planSections: { order } })).toEqual(order)
  })
  it('draws every section exactly once, whatever was saved', () => {
    const order = ['routines', 'gone', 'routines']
    expect(planSectionOrder({ planSections: { order } })).toEqual(['routines', 'programming', 'sequence'])
  })
})

describe('toggleSection', () => {
  it('starts open, folds and unfolds', () => {
    const s = {}
    expect(isSectionOpen(s, 'sequence')).toBe(true)
    toggleSection(s, 'sequence')
    expect(isSectionOpen(s, 'sequence')).toBe(false)
    expect(isSectionOpen(s, 'routines')).toBe(true)
    toggleSection(s, 'sequence')
    expect(isSectionOpen(s, 'sequence')).toBe(true)
  })
  it('leaves the order alone', () => {
    const order = ['routines', 'sequence', 'programming']
    const s = { planSections: { order } }
    toggleSection(s, 'routines')
    expect(s.planSections.order).toEqual(order)
  })
})

describe('moveSection', () => {
  it('places it at the slot among the others', () => {
    const s = {}
    expect(moveSection(s, 'programming', 2)).toBe(true)
    expect(planSectionOrder(s)).toEqual(['sequence', 'routines', 'programming'])
    expect(moveSection(s, 'routines', 0)).toBe(true)
    expect(planSectionOrder(s)).toEqual(['routines', 'sequence', 'programming'])
  })
  it('changes nothing when dropped back in its place, so nothing persists', () => {
    const s = {}
    expect(moveSection(s, 'sequence', 1)).toBe(false)
    expect(s).toEqual({})
  })
  it('refuses an unknown section and keeps the folded ones', () => {
    const s = { planSections: { closed: ['sequence'] } }
    expect(moveSection(s, 'gone', 0)).toBe(false)
    moveSection(s, 'routines', 0)
    expect(isSectionOpen(s, 'sequence')).toBe(false)
  })
})

describe('sectionDropIntent', () => {
  const others = [{ top: 0, bottom: 40 }, { top: 50, bottom: 90 }]
  it('counts the sections whose middle it has passed, and never joins one', () => {
    expect(sectionDropIntent(others, 10)).toEqual({ slot: 0, join: null })
    expect(sectionDropIntent(others, 45)).toEqual({ slot: 1, join: null })
    expect(sectionDropIntent(others, 80)).toEqual({ slot: 2, join: null })
  })
})

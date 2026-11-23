import { describe, it, expect } from 'vitest'
import { facetSearch, ALL_DB, APP_DB } from './exercise-search.js'

const E = [
  { id: 1, db: 'app', bp: 'chest', eq: 'barbell' },
  { id: 2, db: 'app', bp: 'chest', eq: 'dumbbell' },
  { id: 3, db: 'app', bp: 'back', eq: 'cable' },
  { id: 4, db: 'repdb', bp: 'chest', eq: 'dumbbell' },
  { id: 5, db: 'repdb', bp: 'upper legs', eq: 'band' },
  { id: 6, db: 'exerciseapi', bp: 'back', eq: 'dumbbell' },
  { id: 7, db: 'exerciseapi', bp: '', eq: '' },
]
const ids = r => r.list.map(e => e.id)

describe('facetSearch', () => {
  it('lists one database, or all of them', () => {
    expect(ids(facetSearch(E, { db: APP_DB }))).toEqual([1, 2, 3])
    expect(ids(facetSearch(E, { db: 'repdb' }))).toEqual([4, 5])
    expect(ids(facetSearch(E, { db: ALL_DB }))).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('combines database, body part and equipment', () => {
    expect(ids(facetSearch(E, { db: ALL_DB, bp: 'chest', eq: 'dumbbell' }))).toEqual([2, 4])
    expect(ids(facetSearch(E, { db: APP_DB, bp: 'chest', eq: 'dumbbell' }))).toEqual([2])
    expect(ids(facetSearch(E, { db: ALL_DB, eq: 'dumbbell' }))).toEqual([2, 4, 6])
  })

  it('offers only body parts and equipment that have exercises under the other filters', () => {
    const r = facetSearch(E, { db: ALL_DB, eq: 'dumbbell' }, ['back', 'chest', 'upper legs'])
    expect(r.bpOpts).toEqual(['back', 'chest'])
    expect(facetSearch(E, { db: ALL_DB, bp: 'chest' }).eqOpts).toEqual(['dumbbell', 'barbell'])
    expect(facetSearch(E, { db: 'repdb' }).eqOpts).toEqual(['band', 'dumbbell'])
  })

  it('ignores a body part or equipment the database lacks, without dropping the database', () => {
    const r = facetSearch(E, { db: 'repdb', bp: 'back', eq: 'cable' })
    expect(r.bpOn).toBe('')
    expect(r.eqOn).toBe('')
    expect(ids(r)).toEqual([4, 5])
    // equipment missing for that body part is ignored, the body part still applies
    const s = facetSearch(E, { db: APP_DB, bp: 'back', eq: 'barbell' })
    expect([s.bpOn, s.eqOn]).toEqual(['back', ''])
    expect(ids(s)).toEqual([3])
  })

  it('counts each database for the chosen body part and equipment', () => {
    expect(facetSearch(E, { db: APP_DB, eq: 'dumbbell' }).dbCounts).toEqual({ app: 1, repdb: 1, exerciseapi: 1, all: 3 })
    expect(facetSearch(E, { db: ALL_DB }).dbCounts.all).toBe(7)
    // a choice set aside in this database still counts in the others
    expect(facetSearch(E, { db: 'repdb', bp: 'back', eq: 'cable' }).dbCounts).toEqual({ app: 1, all: 1 })
  })

  it('handles no entries', () => {
    expect(facetSearch(undefined, {})).toMatchObject({ list: [], bpOpts: [], eqOpts: [], dbCounts: { all: 0 } })
  })
})

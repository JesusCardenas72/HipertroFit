import { describe, expect, it } from 'vitest'
import { canFavorite, favoriteMap, favoritesFirst, isFavorite, toggleFavorite, usageMap } from './favorites.js'

const ex = ids => ids.map(id => ({ id }))
const S0 = (over = {}) => ({
  routines: [{ ex: [{ id: 'a' }, { id: 'b' }] }],
  workouts: [{ entries: [{ id: 'a' }, { id: 'c' }] }],
  ...over,
})

describe('favourite exercises', () => {
  it('are what routines and the log use', () => {
    expect(usageMap(S0())).toEqual({ a: 2, b: 1, c: 1 })
    expect(favoriteMap(S0())).toEqual({ a: 2, b: 1, c: 1 })
    expect(isFavorite(S0(), 'd')).toBe(false)
    expect(canFavorite(S0(), 'd')).toBe(false)
  })

  it('leave out the ones taken out by hand', () => {
    const S = S0({ favOff: ['b'] })
    expect(favoriteMap(S)).toEqual({ a: 2, c: 1 })
    expect(isFavorite(S, 'b')).toBe(false)
    expect(canFavorite(S, 'b')).toBe(true)
  })

  it('takes one out and puts it back', () => {
    const s = S0()
    expect(isFavorite(s, 'a')).toBe(true)                 // fills the cache
    expect(toggleFavorite(s, 'a')).toBe(false)
    expect(isFavorite(s, 'a')).toBe(false)                // the cache follows the toggle
    expect(toggleFavorite(s, 'a')).toBe(true)
    expect(s.favOff).toEqual([])
    expect(isFavorite(s, 'a')).toBe(true)
  })

  it('follows a draft changed in place', () => {
    const s = S0()
    expect(isFavorite(s, 'd')).toBe(false)
    s.workouts.push({ entries: [{ id: 'd' }] })
    expect(isFavorite(s, 'd')).toBe(true)
  })

  it('works on a profile saved before removal existed', () => {
    const s = { routines: [], workouts: [] }
    expect(isFavorite(s, '0025')).toBe(false)
    expect(isFavorite(null, '0025')).toBe(false)
    toggleFavorite(s, '0025')
    expect(s.favOff).toEqual(['0025'])
  })

  it('lists favourites first, each part in its own order', () => {
    const S = S0({ routines: [{ ex: ex(['c', 'a']) }], workouts: [] })
    expect(favoritesFirst(S, ex(['a', 'b', 'c', 'd'])).map(e => e.id)).toEqual(['a', 'c', 'b', 'd'])
    const list = ex(['x', 'y'])
    expect(favoritesFirst(S, list)).toBe(list)
  })
})

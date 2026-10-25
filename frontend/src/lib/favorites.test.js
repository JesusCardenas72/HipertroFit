import { describe, expect, it } from 'vitest'
import { favoritesFirst, isFavorite, toggleFavorite } from './favorites.js'

const ex = ids => ids.map(id => ({ id }))

describe('favourite exercises', () => {
  it('marks and unmarks an exercise', () => {
    const s = { favEx: [] }
    expect(toggleFavorite(s, '0025')).toBe(true)
    expect(isFavorite(s, '0025')).toBe(true)
    expect(toggleFavorite(s, '0025')).toBe(false)
    expect(s.favEx).toEqual([])
  })

  it('works on a profile saved before favourites existed', () => {
    const s = {}
    expect(isFavorite(s, '0025')).toBe(false)
    toggleFavorite(s, '0025')
    expect(s.favEx).toEqual(['0025'])
    expect(isFavorite(null, '0025')).toBe(false)
  })

  it('lists favourites first, each part in its own order', () => {
    const S = { favEx: ['c', 'a'] }
    expect(favoritesFirst(S, ex(['a', 'b', 'c', 'd'])).map(e => e.id)).toEqual(['a', 'c', 'b', 'd'])
    const list = ex(['a', 'b'])
    expect(favoritesFirst({ favEx: [] }, list)).toBe(list)
  })
})

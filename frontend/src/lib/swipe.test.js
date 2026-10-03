import { describe, it, expect } from 'vitest'
import {
  swipeLock, rowOffset, rowArmed, navDirection, navCommit,
  SWIPE_LOCK_DISTANCE, SWIPE_FLICK, SWIPE_MIN_DISTANCE, ROW_DELETE_DISTANCE, ROW_MAX_OFFSET
} from './swipe.js'

describe('swipeLock', () => {
  it('stays undecided until the drag is long enough to mean anything', () => {
    expect(swipeLock({ dx: SWIPE_LOCK_DISTANCE - 1, dy: 0, row: true })).toBe(null)
    expect(swipeLock({ dx: -(SWIPE_LOCK_DISTANCE - 1), dy: 0, row: true })).toBe(null)
  })
  it('leaves a vertical drag to the browser so the page still scrolls', () => {
    expect(swipeLock({ dx: 4, dy: 40, row: true })).toBe('none')
    expect(swipeLock({ dx: -4, dy: -40, row: null })).toBe('none')
  })
  it('peels a set row open only when the drag runs right from a removable row', () => {
    expect(swipeLock({ dx: 60, dy: 0, row: { entry: 0, set: 1 } })).toBe('row')
    // leftwards on a row is not a delete — it pages forward like anywhere else
    expect(swipeLock({ dx: -60, dy: 0, row: { entry: 0, set: 1 } })).toBe('nav')
    // the last remaining set is not removable, so the caller passes no row at all
    expect(swipeLock({ dx: 60, dy: 0, row: null })).toBe('nav')
  })
  it('pages between exercises anywhere else', () => {
    expect(swipeLock({ dx: -60, dy: 0, row: null })).toBe('nav')
    expect(swipeLock({ dx: 60, dy: 10, row: null })).toBe('nav')
  })
  it('needs horizontal to clearly beat vertical', () => {
    expect(swipeLock({ dx: 20, dy: 19, row: null })).toBe(null)
    expect(swipeLock({ dx: 40, dy: 10, row: null })).toBe('nav')
  })
})

describe('rowOffset / rowArmed', () => {
  it('follows the finger rightwards only', () => {
    expect(rowOffset(40)).toBe(40)
    expect(rowOffset(-40)).toBe(0)
  })
  it('stops at the end of the track', () => {
    expect(rowOffset(9999)).toBe(ROW_MAX_OFFSET)
  })
  it('arms the delete once the row is pulled past the threshold', () => {
    expect(rowArmed(ROW_DELETE_DISTANCE - 1)).toBe(false)
    expect(rowArmed(ROW_DELETE_DISTANCE)).toBe(true)
    expect(rowArmed(9999)).toBe(true)
    expect(rowArmed(-9999)).toBe(false)
  })
})

describe('navDirection', () => {
  it('drags left to the next exercise and right to the previous one', () => {
    expect(navDirection(-SWIPE_MIN_DISTANCE, 0)).toBe(1)
    expect(navDirection(SWIPE_MIN_DISTANCE, 0)).toBe(-1)
  })
  it('ignores a drag too short or too diagonal to be meant', () => {
    expect(navDirection(SWIPE_MIN_DISTANCE - 1, 0)).toBe(0)
    expect(navDirection(60, 60)).toBe(0)
  })
})

describe('navCommit', () => {
  it('pages once the drag has gone far enough towards the neighbour', () => {
    expect(navCommit({ dx: -SWIPE_MIN_DISTANCE, dir: 1 })).toBe(true)
    expect(navCommit({ dx: SWIPE_MIN_DISTANCE, dir: -1 })).toBe(true)
    expect(navCommit({ dx: -(SWIPE_MIN_DISTANCE - 1), dir: 1 })).toBe(false)
  })
  it('pages on a flick short of the distance, the way the set drum does', () => {
    expect(navCommit({ dx: -20, v: -SWIPE_FLICK, dir: 1 })).toBe(true)
    expect(navCommit({ dx: 20, v: SWIPE_FLICK, dir: -1 })).toBe(true)
  })
  it('ignores a flick that barely moved or went the other way from the drag', () => {
    expect(navCommit({ dx: -(SWIPE_LOCK_DISTANCE - 1), v: -2, dir: 1 })).toBe(false)
    expect(navCommit({ dx: 20, v: -2, dir: 1 })).toBe(false)
  })
  it('springs back when the finger flicks back, however far it had gone', () => {
    expect(navCommit({ dx: -150, v: SWIPE_FLICK, dir: 1 })).toBe(false)
  })
  it('never pages a diagonal drag or one with nowhere to go', () => {
    expect(navCommit({ dx: -60, dy: 80, dir: 1 })).toBe(false)
    expect(navCommit({ dx: -200, dir: 0 })).toBe(false)
  })
})

import { describe, expect, test } from 'vitest'
import { ADJUSTABLE_DUMBBELLS, ladderOf, snapLoad, stepLoad, stepOf, minLoadOf } from './load-scale.js'

const L = ADJUSTABLE_DUMBBELLS

describe('ladderOf', () => {
  test('reads the adjustable-dumbbell ladder off a config', () => {
    expect(ladderOf({ adj: { from: 4, step: 1.5 } })).toEqual({ from: 4, step: 1.5 })
  })
  test('no ladder without the flag, or with a ladder that cannot load anything', () => {
    expect(ladderOf({})).toBeNull()
    expect(ladderOf(null)).toBeNull()
    expect(ladderOf({ adj: { from: 0, step: 1.5 } })).toBeNull()
    expect(ladderOf({ adj: { from: 4, step: 0 } })).toBeNull()
  })
})

describe('stepLoad on adjustable dumbbells (4 kg, +1.5 kg)', () => {
  test('walks the rungs 4 → 5.5 → 7 → 8.5', () => {
    let w = 0
    const seen = []
    for (let i = 0; i < 6; i++) { w = stepLoad(w, 1, L); seen.push(w) }
    expect(seen).toEqual([4, 5.5, 7, 8.5, 10, 11.5])
  })
  test('walks back down and stops at the first rung', () => {
    expect(stepLoad(8.5, -1, L)).toBe(7)
    expect(stepLoad(5.5, -1, L)).toBe(4)
    expect(stepLoad(4, -1, L)).toBe(4)
    expect(stepLoad(0, -1, L)).toBe(0)
  })
  test('a weight between rungs moves to the rung on that side', () => {
    expect(stepLoad(6, 1, L)).toBe(7)
    expect(stepLoad(6, -1, L)).toBe(5.5)
    expect(stepLoad(2, 1, L)).toBe(4)
  })
  test('stays exact far up the ladder (no binary drift)', () => {
    let w = 4
    for (let i = 0; i < 40; i++) w = stepLoad(w, 1, L)
    expect(w).toBe(64)
  })
})

describe('stepLoad on a plain step keeps the old behaviour', () => {
  test('adds and removes the step, never below 0', () => {
    expect(stepLoad(20, 1, 2.5)).toBe(22.5)
    expect(stepLoad(2.5, -1, 2.5)).toBe(0)
    expect(stepLoad(0, -1, 2.5)).toBe(0)
    expect(stepLoad(6, 1, 2.5)).toBe(8.5)
  })
})

describe('snapLoad', () => {
  test('rounds onto the ladder, never into the gaps of a multiples-of-1.5 grid', () => {
    expect(snapLoad(7.5, L)).toBe(7)
    expect(snapLoad(7.9, L)).toBe(8.5)
    expect(snapLoad(9.1, L)).toBe(8.5)
    expect(snapLoad(9.3, L)).toBe(10)
  })
  test('floors onto the ladder, and a rung floors to itself', () => {
    expect(snapLoad(8.4, L, 'floor')).toBe(7)
    expect(snapLoad(8.5, L, 'floor')).toBe(8.5)
  })
  test('nothing lighter than the first rung, but 0 stays 0', () => {
    expect(snapLoad(1, L)).toBe(4)
    expect(snapLoad(2.5, L, 'floor')).toBe(4)
    expect(snapLoad(0, L)).toBe(0)
  })
  test('a plain step rounds to its multiples as before', () => {
    expect(snapLoad(23.4, 2.5)).toBe(22.5)
    expect(snapLoad(24, 2.5, 'floor')).toBe(22.5)
    expect(snapLoad(7.5, 2.5, 'floor')).toBe(7.5)
  })
  test('stepOf / minLoadOf read either form', () => {
    expect(stepOf(L)).toBe(1.5)
    expect(stepOf(2.5)).toBe(2.5)
    expect(minLoadOf(L)).toBe(4)
    expect(minLoadOf(2.5)).toBe(2.5)
  })
})

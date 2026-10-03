import { describe, it, expect } from 'vitest'
import { dragOffsets, settlePlan, edgeOffset, EDGE_MAX, turnFace, turnStyle, turnVars, TURN_DEG, TURN_SHRINK } from './slide.js'

const W = 400

describe('dragOffsets', () => {
  it('moves both screens together, the neighbour a screen away from the current one', () => {
    // Dragging left (dx < 0) towards the next screen: it waits off the right border.
    expect(dragOffsets({ current: 'a', peek: 'b', dir: 1, dx: -120 }, W)).toEqual({ a: -120, b: 280 })
    // And the previous one waits off the left border.
    expect(dragOffsets({ current: 'a', peek: 'b', dir: -1, dx: 120 }, W)).toEqual({ a: 120, b: -280 })
  })
  it('is one screen at rest, and one while a drag has nowhere to go', () => {
    expect(dragOffsets({ current: 'a', peek: null, dir: 0, dx: 0 }, W)).toEqual({ a: 0 })
    expect(dragOffsets({ current: 'a', peek: null, dir: 1, dx: -30 }, W)).toEqual({ a: -30 })
  })
})

describe('settlePlan', () => {
  const dragged = { current: 'a', peek: 'b', dir: 1, offsets: { a: -120, b: 280 } }

  it('carries a committed swipe on from where the finger let go', () => {
    // Not from the border: picking up mid-drag is what makes it one movement, not two.
    expect(settlePlan(dragged, 'b', 0, W)).toEqual([
      { id: 'a', from: -120, to: -W },
      { id: 'b', from: 280, to: 0 },
    ])
  })

  it('sends the neighbour back and the current screen home when the drag is cancelled', () => {
    expect(settlePlan(dragged, 'a', 0, W)).toEqual([
      { id: 'a', from: -120, to: 0 },
      { id: 'b', from: 280, to: W },
    ])
  })

  it('starts a gestureless navigation at the border, using the direction it is given', () => {
    const idle = { current: 'a', peek: null, dir: 0, offsets: { a: 0 } }
    expect(settlePlan(idle, 'b', 1, W)).toEqual([
      { id: 'a', from: 0, to: -W },
      { id: 'b', from: W, to: 0 },
    ])
    expect(settlePlan(idle, 'b', -1, W)).toEqual([
      { id: 'a', from: 0, to: W },
      { id: 'b', from: -W, to: 0 },
    ])
  })

  it('has nothing to animate when nothing moved', () => {
    const idle = { current: 'a', peek: null, dir: 0, offsets: { a: 0 } }
    expect(settlePlan(idle, 'a', 1, W)).toBe(null)   // still on the same screen
    expect(settlePlan(idle, 'b', 0, W)).toBe(null)   // no direction to travel in
  })

  // A drag that never left the resting position, released: there is no distance to cover, and
  // animating zero would still cost a frame of the outgoing layer sitting on top.
  it('has nothing to animate when a cancelled drag never moved', () => {
    const still = { current: 'a', peek: 'b', dir: 1, offsets: { a: 0, b: W } }
    expect(settlePlan(still, 'a', 0, W)).toBe(null)
  })
})

describe('edgeOffset', () => {
  it('follows the finger a fraction of the way at the end of the row', () => {
    expect(edgeOffset(100)).toBeCloseTo(30, 5)
    expect(edgeOffset(-100)).toBeCloseTo(-30, 5)
  })
  it('stops well short of uncovering the page, however hard it is pulled', () => {
    expect(edgeOffset(10000)).toBe(EDGE_MAX)
    expect(edgeOffset(-10000)).toBe(-EDGE_MAX)
  })
})

describe('turnFace', () => {
  it('is square on, full size and fully lit at the front', () => {
    expect(turnFace(0, W)).toEqual({ x: 0, deg: 0, scale: 1, opacity: 1 })
  })
  it('turns round the side it travels to, a screen away by the full tilt', () => {
    expect(turnFace(-W, W).deg).toBe(-TURN_DEG)
    expect(turnFace(W, W).deg).toBe(TURN_DEG)
    expect(turnFace(W, W).scale).toBeCloseTo(1 - TURN_SHRINK, 5)
  })
  // Linear in the distance, so the settle animation (which interpolates its two ends) draws the
  // same faces the finger did — and the two screens of a drag are always mirror images.
  it('grows as the other shrinks: halfway, both faces are the same', () => {
    const leaving = turnFace(-W / 2, W), arriving = turnFace(W / 2, W)
    expect(leaving.deg).toBe(-arriving.deg)
    expect(leaving.scale).toBe(arriving.scale)
    expect(leaving.opacity).toBe(arriving.opacity)
    expect(turnFace(-W / 4, W).deg).toBeCloseTo(turnFace(-W / 2, W).deg / 2, 2)
  })
  it('keeps its shift exact, so the drag follows the finger one to one', () => {
    expect(turnFace(-123, W).x).toBe(-123)
  })
})

describe('turnStyle / turnVars', () => {
  it('leaves a face at rest untouched', () => {
    expect(turnStyle(0, W)).toBeUndefined()
  })
  it('draws a held face with its shift, tilt and size', () => {
    const st = turnStyle(-W / 2, W)
    expect(st.transform).toContain('translateX(-200px)')
    expect(st.transform).toContain('rotateY(-' + TURN_DEG / 2 + 'deg)')
    expect(st.opacity).toBeLessThan(1)
  })
  it('hands both ends of a settle to the keyframe', () => {
    const v = turnVars(-120, -W, W)
    expect(v['--slide-from']).toBe('-120px')
    expect(v['--slide-to']).toBe(-W + 'px')
    expect(v['--turn-to']).toBe(-TURN_DEG + 'deg')
    expect(turnVars(W, 0, W)['--scale-to']).toBe(1)
  })
})

import { describe, it, expect } from 'vitest'
import { cutoutBackground } from './thumb-cutout.js'

// 5×5 opaque white, with a 3×3 black figure in the middle whose centre is a white highlight.
function sample() {
  const w = 5, h = 5, px = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
    const p = (y * w + x) * 4
    px[p] = px[p + 1] = px[p + 2] = 0
  }
  const centre = (2 * w + 2) * 4
  px[centre] = px[centre + 1] = px[centre + 2] = 255
  return { px, w, h }
}

const alphaAt = (px, w, x, y) => px[(y * w + x) * 4 + 3]

describe('cutoutBackground', () => {
  it('clears the white background connected to the edge', () => {
    const { px, w, h } = sample()
    cutoutBackground(px, w, h)
    expect(alphaAt(px, w, 0, 0)).toBe(0)
    expect(alphaAt(px, w, 4, 2)).toBe(0)
    expect(alphaAt(px, w, 2, 0)).toBe(0)
  })

  it('keeps the figure and the white highlight it encloses', () => {
    const { px, w, h } = sample()
    cutoutBackground(px, w, h)
    expect(alphaAt(px, w, 1, 1)).toBe(255)
    expect(alphaAt(px, w, 2, 2)).toBe(255)
  })

  it('leaves non-white edge pixels opaque', () => {
    const w = 3, h = 3, px = new Uint8ClampedArray(w * h * 4).fill(255)
    px[0] = 200 // top-left is grey, not background
    cutoutBackground(px, w, h)
    expect(px[3]).toBe(255)
    expect(alphaAt(px, w, 1, 0)).toBe(0)
  })
})

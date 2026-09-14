import { describe, it, expect } from 'vitest'
import { parseGif, renderFrame, lzwDecode, dataUrlToBytes } from './gif-frames.js'

// A minimal GIF writer for the tests: real LZW (dictionary growth, code-size bumps, the KwKwK
// case) so the decoder is checked against the actual format, not a shortcut.
function lzwEncode(minCode, indices) {
  const clear = 1 << minCode, eoi = clear + 1
  const bytes = []
  let acc = 0, bits = 0, size = minCode + 1
  const emit = code => {
    acc |= code << bits; bits += size
    while (bits >= 8) { bytes.push(acc & 255); acc >>>= 8; bits -= 8 }
  }
  let dict = new Map(), next = eoi + 1
  emit(clear)
  let w = String(indices[0])
  for (let i = 1; i < indices.length; i++) {
    const k = String(indices[i])
    const wk = w + ',' + k
    if (dict.has(wk)) { w = wk; continue }
    emit(w.includes(',') ? dict.get(w) : +w)
    if (next < 4096) {
      dict.set(wk, next++)
      if (next - 1 === (1 << size) && size < 12) size++
    } else { emit(clear); dict = new Map(); next = eoi + 1; size = minCode + 1 }
    w = k
  }
  emit(w.includes(',') ? dict.get(w) : +w)
  emit(eoi)
  if (bits) bytes.push(acc & 255)
  return bytes
}

const le = n => [n & 255, n >> 8]
const subBlocks = data => { const out = []; for (let i = 0; i < data.length; i += 255) { const c = data.slice(i, i + 255); out.push(c.length, ...c) } out.push(0); return out }

// palette: 0 red, 1 green, 2 blue, 3 white
const PAL = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]
function gif(width, height, frames) {
  const out = [...'GIF89a'].map(c => c.charCodeAt(0))
  out.push(...le(width), ...le(height), 0x80 | 1, 0, 0, ...PAL)
  frames.forEach(f => {
    const p = ((f.disposal || 0) << 2) | (f.transparent >= 0 ? 1 : 0)
    out.push(0x21, 0xF9, 4, p, ...le(f.delay || 10), f.transparent >= 0 ? f.transparent : 0, 0)
    out.push(0x2C, ...le(f.x || 0), ...le(f.y || 0), ...le(f.w), ...le(f.h), f.interlaced ? 0x40 : 0)
    out.push(2, ...subBlocks(lzwEncode(2, f.pixels)))
  })
  out.push(0x3B)
  return new Uint8Array(out)
}
const rgb = (px, width, x, y) => Array.from(px.slice((y * width + x) * 4, (y * width + x) * 4 + 4))

describe('lzwDecode', () => {
  it('round-trips long runs and repeats (dictionary growth past 12-bit resets)', () => {
    const data = Array.from({ length: 20000 }, (_, i) => (i % 7 === 0 ? 3 : (i * i) % 4))
    expect(Array.from(lzwDecode(2, new Uint8Array(lzwEncode(2, data)), data.length))).toEqual(data)
    const runs = new Array(5000).fill(1)
    expect(Array.from(lzwDecode(2, new Uint8Array(lzwEncode(2, runs)), runs.length))).toEqual(runs)
  })
})

describe('parseGif + renderFrame', () => {
  const g = parseGif(gif(2, 2, [
    { w: 2, h: 2, pixels: [0, 0, 0, 0], delay: 20 },                              // all red
    { x: 1, y: 1, w: 1, h: 1, pixels: [1], disposal: 2 },                         // green corner, then cleared
    { w: 2, h: 2, pixels: [2, 3, 3, 3], transparent: 3, disposal: 3 },            // blue top-left over what is there
    { w: 1, h: 1, pixels: [1] },                                                  // after restore: frame 2 state
  ]))

  it('reads size, frame count and delays', () => {
    expect(g.width).toBe(2)
    expect(g.height).toBe(2)
    expect(g.frames).toHaveLength(4)
    expect(g.frames[0].delay).toBe(200)
  })

  it('composites each frame over the previous ones', () => {
    expect(rgb(renderFrame(g, 0), 2, 1, 1)).toEqual([255, 0, 0, 255])
    expect(rgb(renderFrame(g, 1), 2, 1, 1)).toEqual([0, 255, 0, 255])
    expect(rgb(renderFrame(g, 1), 2, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('applies disposal: 2 clears to transparent, 3 restores what was under the frame', () => {
    const f2 = renderFrame(g, 2)
    expect(rgb(f2, 2, 1, 1)).toEqual([0, 0, 0, 0])       // green corner was disposed
    expect(rgb(f2, 2, 0, 0)).toEqual([0, 0, 255, 255])   // blue drawn
    expect(rgb(f2, 2, 1, 0)).toEqual([255, 0, 0, 255])   // transparent pixel shows red
    const f3 = renderFrame(g, 3)
    expect(rgb(f3, 2, 0, 0)).toEqual([0, 255, 0, 255])   // frame 3 drew green here
    expect(rgb(f3, 2, 1, 0)).toEqual([255, 0, 0, 255])
  })

  it('gives the same picture going backwards as forwards', () => {
    const forward = renderFrame(g, 1)
    renderFrame(g, 3)
    expect(renderFrame(g, 1)).toEqual(forward)
  })

  it('reads interlaced rows in GIF order', () => {
    // 1×5 image; stored rows in pass order 0,4,2,1,3
    const inter = parseGif(gif(1, 5, [{ w: 1, h: 5, interlaced: true, pixels: [0, 2, 1, 3, 3] }]))
    const px = renderFrame(inter, 0)
    expect([0, 1, 2, 3, 4].map(y => rgb(px, 1, 0, y)[0] + ',' + rgb(px, 1, 0, y)[1])).toEqual(['255,0', '255,255', '0,255', '255,255', '0,0'])
  })

  it('rejects files that are not GIFs', () => {
    expect(() => parseGif(new Uint8Array([0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow('not-gif')
  })

  it('decodes a data: URL', () => {
    expect(Array.from(dataUrlToBytes('data:image/gif;base64,R0lG'))).toEqual([71, 73, 70])
  })
})

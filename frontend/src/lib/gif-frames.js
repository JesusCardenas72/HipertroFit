// Reads the frames of an animated GIF, so a custom exercise can use any of them as its still.
//
// The browser can show a GIF but gives no access to its frames (<img> and canvas only ever
// see the one on screen, and ImageDecoder is missing on Safari/iOS), and a dependency is not an
// option here — so this is a small decoder of our own: the GIF89a block structure, LZW, the
// interlaced row order and the frame disposal methods that decide what each frame looks like
// composited over the previous ones.
//
// parseGif keeps each frame's compressed data only; renderFrame decompresses and composites on
// demand, continuing from the last frame it rendered when moving forward, so scrubbing through
// a long animation never holds every full frame in memory.

const u16 = (b, i) => b[i] | (b[i + 1] << 8)

function readTable(b, pos, size) {
  return { table: b.subarray(pos, pos + 3 * size), next: pos + 3 * size }
}

// Concatenates the data sub-blocks starting at pos (a 0-length block ends them).
function readSubBlocks(b, pos) {
  const parts = []
  let len = 0
  while (pos < b.length) {
    const n = b[pos++]
    if (!n) break
    parts.push(b.subarray(pos, pos + n))
    len += n
    pos += n
  }
  const data = new Uint8Array(len)
  let o = 0
  parts.forEach(p => { data.set(p, o); o += p.length })
  return { data, next: pos }
}

const skipSubBlocks = (b, pos) => {
  while (pos < b.length) { const n = b[pos++]; if (!n) break; pos += n }
  return pos
}

/**
 * GIF bytes → { width, height, frames: [{ x, y, w, h, delay, disposal, transparent,
 * interlaced, table, minCode, data }] }. Throws 'not-gif' on anything else.
 */
export function parseGif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const sig = String.fromCharCode(...b.subarray(0, 6))
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('not-gif')
  const width = u16(b, 6), height = u16(b, 8)
  const packed = b[10]
  let pos = 13
  let global = null
  if (packed & 0x80) ({ table: global, next: pos } = readTable(b, pos, 1 << ((packed & 7) + 1)))
  const frames = []
  let gce = null
  while (pos < b.length) {
    const block = b[pos++]
    if (block === 0x3B) break
    if (block === 0x21) {
      const label = b[pos++]
      if (label === 0xF9 && b[pos] >= 4) {
        const p = b[pos + 1]
        gce = { disposal: (p >> 2) & 7, transparent: p & 1 ? b[pos + 4] : -1, delay: u16(b, pos + 2) * 10 }
      }
      pos = skipSubBlocks(b, pos)
    } else if (block === 0x2C) {
      const x = u16(b, pos), y = u16(b, pos + 2), w = u16(b, pos + 4), h = u16(b, pos + 6)
      const p = b[pos + 8]
      pos += 9
      let table = global
      if (p & 0x80) ({ table, next: pos } = readTable(b, pos, 1 << ((p & 7) + 1)))
      const minCode = b[pos++]
      const { data, next } = readSubBlocks(b, pos)
      pos = next
      frames.push({
        x, y, w, h, interlaced: !!(p & 0x40), table, minCode, data,
        delay: gce ? gce.delay : 0, disposal: gce ? gce.disposal : 0, transparent: gce ? gce.transparent : -1,
      })
      gce = null
    } else {
      break // corrupt or truncated: keep the frames read so far
    }
  }
  if (!frames.length) throw new Error('not-gif')
  return { width, height, frames }
}

/** LZW-decompress one frame's data into `count` colour indices. */
export function lzwDecode(minCode, data, count) {
  const out = new Uint8Array(count)
  const clear = 1 << minCode, eoi = clear + 1
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097)
  for (let i = 0; i < clear; i++) suffix[i] = i
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1
  let prev = -1, first = 0
  let bits = 0, acc = 0, o = 0
  for (let i = 0; o < count;) {
    while (bits < size && i < data.length) { acc |= data[i++] << bits; bits += 8 }
    if (bits < size) break
    const code = acc & mask
    acc >>>= size; bits -= size
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; prev = -1; continue }
    if (code === eoi) break
    let c = code, sp = 0
    if (prev === -1) { out[o++] = suffix[code]; first = suffix[code]; prev = code; continue }
    if (code >= next) { stack[sp++] = first; c = prev } // the KwKwK case
    while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c] }
    first = suffix[c]
    stack[sp++] = first
    while (sp && o < count) out[o++] = stack[--sp]
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = first; next++
      if (next === mask + 1 && size < 12) { size++; mask = (1 << size) - 1 }
    }
    prev = code
  }
  return out
}

// Row order of an interlaced frame: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
function rowOrder(h, interlaced) {
  if (!interlaced) return Array.from({ length: h }, (_, i) => i)
  const rows = []
  ;[[0, 8], [4, 8], [2, 4], [1, 2]].forEach(([start, step]) => { for (let r = start; r < h; r += step) rows.push(r) })
  return rows
}

function draw(gif, f, px) {
  const idx = lzwDecode(f.minCode, f.data, f.w * f.h)
  const rows = rowOrder(f.h, f.interlaced)
  const table = f.table
  for (let r = 0; r < f.h; r++) {
    const y = f.y + rows[r]
    if (y >= gif.height) continue
    for (let c = 0; c < f.w; c++) {
      const x = f.x + c
      if (x >= gif.width) continue
      const ci = idx[r * f.w + c]
      if (ci === f.transparent || !table || ci * 3 + 2 >= table.length) continue
      const p = (y * gif.width + x) * 4
      px[p] = table[ci * 3]; px[p + 1] = table[ci * 3 + 1]; px[p + 2] = table[ci * 3 + 2]; px[p + 3] = 255
    }
  }
}

function clearRect(gif, f, px) {
  for (let y = f.y; y < Math.min(gif.height, f.y + f.h); y++) {
    px.fill(0, (y * gif.width + f.x) * 4, (y * gif.width + Math.min(gif.width, f.x + f.w)) * 4)
  }
}

const cache = new WeakMap()

/** RGBA pixels (Uint8ClampedArray, width × height × 4) of frame `i` as it appears on screen. */
export function renderFrame(gif, i) {
  const target = Math.max(0, Math.min(gif.frames.length - 1, i | 0))
  let st = cache.get(gif)
  if (!st || st.index > target) {
    st = { index: -1, px: new Uint8ClampedArray(gif.width * gif.height * 4), saved: null }
    cache.set(gif, st)
  }
  while (st.index < target) {
    if (st.index >= 0) {
      const prev = gif.frames[st.index]
      if (prev.disposal === 2) clearRect(gif, prev, st.px)
      else if (prev.disposal === 3 && st.saved) st.px.set(st.saved)
    }
    const f = gif.frames[st.index + 1]
    st.saved = f.disposal === 3 ? st.px.slice() : null
    draw(gif, f, st.px)
    st.index++
  }
  return st.px.slice()
}

/** data: URL → bytes. */
export function dataUrlToBytes(url) {
  const bin = atob(String(url).slice(String(url).indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

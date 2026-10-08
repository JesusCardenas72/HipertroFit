import { dockItems, dockKeys } from '../lib/workout-dock.js'
import { springStep, atRest, gooStack } from '../lib/dock-physics.js'

/* The plan editor's list of exercises, given the workout dock's physics turned on its side: every
   row rides a spring, a superset is one liquid capsule drawn behind its rows, and a row being
   dragged pulls, stretches and snaps that capsule exactly the way a thumbnail does in the strip
   (components/WorkoutDock.jsx). The gesture itself lives in RoutineEdit; this is what it moves. */

// The capsule's margin around its rows; a row with no capsule tucks its drop this far under itself.
export const ROW_PAD = 5
// The lifted row follows the finger on a stiff spring; everything else wobbles.
const LIFT = { k: 0.45, d: 0.6 }
export const rowHsl = hue => `hsl(${hue},70%,55%)`

function gooMarkup(layers) {
  const f = n => n.toFixed(1)
  return layers.map(layer => `<g filter="url(#routine-goo)" fill="${layer.fill}">`
    + layer.rects.map(r => `<rect x="${f(r.cx - r.w / 2)}" y="${f(r.cy - r.h / 2)}" width="${f(r.w)}" height="${f(r.h)}" rx="${f(Math.min(18, r.h / 2))}"/>`).join('')
    + layer.bridges.map(b => `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}"/>`).join('')
    + '</g>').join('')
}

/* Springs for every row, keyed by entry, and the capsules drawn behind them. Positions are kept
   relative to the list, so scrolling the page moves nothing. */
export function createListEngine({ list, svg, goo, getEntries }) {
  const springs = new Map()
  const applied = new WeakMap()
  let base = null
  let targetFn = null
  let raf = null

  const restOf = row => ({
    y: 0, s: 1, k: 0.16, d: 0.74,
    layer: row.size > 1 ? 'u' + row.unit : null,
    fill: row.hue == null ? null : rowHsl(row.hue),
  })

  // Where every row sits with no transform of ours on it: what is measured, minus what was
  // applied. Any row that cannot be measured makes the whole picture invalid.
  function measure() {
    const entries = getEntries()
    const items = dockItems(entries)
    const unitOf = new Map(items.flatMap(item => item.indices.map(index => [index, item])))
    const keys = dockKeys(entries)
    const listRect = list.getBoundingClientRect()
    const rows = []
    let valid = !!listRect
    list.querySelectorAll('[data-routine-row]').forEach(node => {
      const index = Number(node.dataset.exIndex)
      const rect = node.getBoundingClientRect()
      if (!rect || !listRect) { valid = false; return }
      const ap = applied.get(node) || { y: 0, s: 1 }
      const item = unitOf.get(index)
      const h = rect.height / ap.s
      const w = rect.width / ap.s
      const cy = rect.top + rect.height / 2 - listRect.top - ap.y
      rows.push({
        node, index, key: keys[index], unit: item?.position ?? index,
        size: item?.indices.length || 1, hue: item?.hue ?? null, sg: entries[index]?.sg ?? null,
        cx: rect.left + rect.width / 2 - listRect.left, cy, w, h, top: cy - h / 2, bottom: cy + h / 2,
      })
    })
    rows.sort((a, b) => a.index - b.index)
    // The tightest gap is the one between two rows of a capsule: a capsule's edges stand further
    // off its neighbours (.ss-start / .ss-end), and those gaps must not read as a stretch.
    let spacing = null
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i].top - rows[i - 1].bottom
      if (spacing == null || gap < spacing) spacing = gap
    }
    if (svg) {
      const width = list.clientWidth || 0
      const height = list.scrollHeight || 0
      svg.setAttribute('width', String(width))
      svg.setAttribute('height', String(height))
      // The capsules stand out past the rows (and a lifted row past the list): give the filter
      // room around the list, or their outer edge is cut off straight.
      const filter = svg.querySelector('filter')
      const room = 80
      if (filter) {
        filter.setAttribute('x', String(-room)); filter.setAttribute('y', String(-room))
        filter.setAttribute('width', String(width + 2 * room)); filter.setAttribute('height', String(height + 2 * room))
      }
    }
    return {
      rows, valid: valid && rows.length === entries.length,
      height: listRect ? listRect.height : 0,
      spacing: spacing ?? 8,
      byIndex: new Map(rows.map(row => [row.index, row])),
      byKey: new Map(rows.map(row => [row.key, row])),
    }
  }

  function step() {
    if (!base) return true
    const targets = targetFn ? targetFn(base, restOf) : new Map(base.rows.map(row => [row.key, restOf(row)]))
    // A layer of one is no capsule: its drop tucks back under the row.
    const count = new Map()
    targets.forEach(tg => { if (tg.layer) count.set(tg.layer, (count.get(tg.layer) || 0) + 1) })
    let still = true
    const blobs = []
    for (const row of base.rows) {
      const tg = targets.get(row.key) || restOf(row)
      const layer = tg.layer && count.get(tg.layer) > 1 ? tg.layer : null
      let sp = springs.get(row.key)
      if (!sp) {
        sp = { y: 0, v: 0, s: 1, vs: 0, p: layer ? ROW_PAD : -ROW_PAD, vp: 0, fill: tg.fill }
        springs.set(row.key, sp)
      }
      if (layer && tg.fill) sp.fill = tg.fill
      const pTarget = layer ? ROW_PAD : -ROW_PAD
      const my = springStep({ x: sp.y, v: sp.v }, tg.y, tg.k, tg.d)
      const ms = springStep({ x: sp.s, v: sp.vs }, tg.s, 0.2, 0.7)
      const mp = springStep({ x: sp.p, v: sp.vp }, pTarget, 0.14, 0.72)
      if (!atRest(my, tg.y) || !atRest(ms, tg.s, 0.002) || !atRest(mp, pTarget)) still = false
      sp.y = my.x; sp.v = my.v; sp.s = ms.x; sp.vs = ms.v; sp.p = mp.x; sp.vp = mp.v
      if (!targetFn && atRest(my, 0) && atRest(ms, 1, 0.002)) {
        Object.assign(sp, { y: 0, v: 0, s: 1, vs: 0 })
        row.node.style.transform = ''
        applied.delete(row.node)
      } else {
        row.node.style.transform = `translate3d(0,${sp.y.toFixed(2)}px,0) scale(${sp.s.toFixed(3)})`
        applied.set(row.node, { y: sp.y, s: sp.s })
      }
      if (sp.fill && sp.p > -ROW_PAD + 0.5) {
        const scale = layer ? sp.s : 1
        blobs.push({
          cx: row.cx, cy: row.cy + sp.y, w: row.w * scale + 2 * sp.p, h: row.h * scale + 2 * sp.p,
          fill: sp.fill, layer: layer || 'solo:' + row.key,
        })
      }
    }
    if (goo) goo.innerHTML = gooMarkup(gooStack(blobs, base.spacing - 2 * ROW_PAD))
    return still
  }

  function tick() {
    raf = null
    const still = step()
    const live = !still || !!targetFn
    list.classList.toggle('routine-live', live)
    if (live) raf = window.requestAnimationFrame(tick)
  }
  const kick = () => {
    if (raf != null) return
    if (typeof window.requestAnimationFrame === 'function') { raf = window.requestAnimationFrame(tick); return }
    for (let i = 0; i < 400 && !step() && !targetFn; i++);
  }

  return {
    get base() { return base },
    remeasure() { base = measure(); return base },
    // After the list re-renders, every row starts from where it was drawn a moment ago and
    // springs to where it now belongs — a drop is a glide, not a jump.
    relayout() {
      const old = base
      base = measure()
      const live = new Set(base.rows.map(row => row.key))
      for (const key of springs.keys()) if (!live.has(key)) springs.delete(key)
      if (old) {
        for (const row of base.rows) {
          const sp = springs.get(row.key)
          const was = old.byKey.get(row.key)
          if (sp && was) sp.y = was.cy + sp.y - row.cy
        }
      }
      if (!step()) kick()
      else list.classList.remove('routine-live')
    },
    drive(fn) { targetFn = fn; kick() },
    release() { targetFn = null; kick() },
    destroy() { if (raf != null) window.cancelAnimationFrame(raf); raf = null },
  }
}

/** Runs of consecutive rows that belong to one unit, with their outer edges. */
export function rowUnits(b) {
  const units = []
  for (const row of b.rows) {
    const last = units[units.length - 1]
    if (last && last.unit === row.unit) last.members.push(row)
    else units.push({ unit: row.unit, members: [row] })
  }
  return units.map(u => {
    const top = Math.min(...u.members.map(row => row.top))
    const bottom = Math.max(...u.members.map(row => row.bottom))
    return { ...u, top, bottom, cy: (top + bottom) / 2 }
  })
}

/* Where each row wants to be while one is lifted — the strip's dragTargets, down a column: the
   lifted row under the finger (drawn a little toward whatever is pulling it in), the one it would
   pair with leaning in to meet it, its own capsule mates stretching after it, and everything else
   giving way like two magnets of a kind would. */
export function listTargets(g, b, restOf) {
  const out = new Map(b.rows.map(row => [row.key, restOf(row)]))
  const src = b.byIndex.get(g.index)
  if (!src) return out
  const delta = g.dy || 0
  const lean = (row, dy) => { const o = row && out.get(row.key); if (o) o.y += dy }
  const restBetween = (a, c) => (a.h + c.h) / 2 + b.spacing

  if (g.mode === 'unit') {
    b.rows.filter(row => row.unit === src.unit).forEach(row => Object.assign(out.get(row.key), { y: delta, s: 1.02, ...LIFT }))
    const units = rowUnits(b).filter(u => u.unit !== src.unit)
    const slot = g.intent?.unit
    if (slot != null) {
      units[slot - 1]?.members.forEach(row => lean(row, -8))
      units[slot]?.members.forEach(row => lean(row, 8))
    }
    return out
  }

  const intent = g.intent || { slot: null, join: null }
  const others = b.rows.filter(row => row !== src)
  const join = intent.join != null ? b.byIndex.get(intent.join) : null
  const own = !!join && join.unit === src.unit && src.size > 1
  const srcCy = src.cy + delta
  const so = out.get(src.key)
  if (join) {
    const side = intent.slot <= others.indexOf(join) ? -1 : 1
    const pull = (join.cy + side * restBetween(join, src) - srcCy) * 0.3
    const layer = join.size > 1 ? 'u' + join.unit : 'n' + join.index
    const fill = join.size > 1 && join.hue != null ? rowHsl(join.hue) : g.previewFill
    Object.assign(so, { y: delta + pull, s: 1.03, ...LIFT, layer, fill })
    if (join.size === 1) Object.assign(out.get(join.key), { layer, fill })
  } else Object.assign(so, { y: delta, s: 1.03, ...LIFT, layer: null })

  if (join && !own) {
    const dir = Math.sign(srcCy - join.cy) || 1
    lean(join, 6 * dir)
    out.get(join.key).s = 1.01
    b.rows.filter(row => row.unit === join.unit && row !== join && row !== src).forEach(row => lean(row, 3 * dir))
  }
  // Still held by its capsule: the mates lean after it, harder the further it is stretched.
  if (own) {
    b.rows.filter(row => row.unit === src.unit && row !== src).forEach(row => {
      const d = srcCy - row.cy
      lean(row, Math.sign(d) * Math.min(12, Math.max(0, Math.abs(d) - restBetween(row, src)) * 0.25))
    })
  }
  const joined = new Set(b.rows.filter(row => join && row.unit === join.unit).map(row => row.key))
  b.rows.forEach(row => {
    if (row === src || joined.has(row.key) || (own && row.unit === src.unit)) return
    const d = row.cy - srcCy
    const room = restBetween(row, src) * 1.15 - Math.abs(d)
    if (room > 0) lean(row, Math.sign(d || 1) * Math.min(16, room * 0.4))
  })
  if (!join && intent.slot != null) {
    lean(others[intent.slot - 1], -8); lean(others[intent.slot], 8)
    lean(others[intent.slot - 2], -3); lean(others[intent.slot + 1], 3)
  }
  return out
}

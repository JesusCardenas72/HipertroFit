import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { dockItems, dockIntent, dockKeys, dropSlot, joinHue } from '../lib/workout-dock.js'
import { springStep, atRest, gooLayers } from '../lib/dock-physics.js'
import { vibrate } from '../lib/sound.js'
import Icon from './Icon.jsx'
import { Thumb } from './Media.jsx'

// Press-and-hold before a thumbnail lifts, so the strip can still be flicked sideways with a
// finger, and a little slop so the hold survives a shaky thumb. Same feel as the plan editor's
// row dragging (ROUTINE_LONG_PRESS_MS / ROUTINE_DRAG_SLOP) — one gesture vocabulary for the app.
const DOCK_LONG_PRESS_MS = 380
// Held still this much longer, a superset member takes its whole capsule with it.
const DOCK_UNIT_PRESS_MS = 420
const DOCK_DRAG_SLOP = 8
// How close to an edge the finger has to get before the strip scrolls itself along.
const DOCK_EDGE = 44
const DOCK_SCROLL_STEP = 12
// The capsule's padding around its thumbnails (.wdock-unit.ss).
const CAPSULE_PAD = 5
// The lifted thumbnail follows the finger on a stiff spring; everything else wobbles.
const LIFT = { k: 0.45, d: 0.6 }
const hsl = hue => `hsl(${hue},70%,55%)`

function gooMarkup(layers) {
  const f = n => n.toFixed(1)
  return layers.map(layer => `<g filter="url(#wdock-goo)" fill="${layer.fill}">`
    + layer.circles.map(c => `<circle cx="${f(c.cx)}" cy="${f(c.cy)}" r="${f(c.r)}"/>`).join('')
    + layer.bridges.map(b => `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}"/>`).join('')
    + '</g>').join('')
}

/* Springs for every thumbnail, keyed by entry, and the drops drawn behind them. Positions are
   kept in the strip's content coordinates, so scrolling the strip moves nothing. Every frame
   asks `targetFn` (or rests) where each thumbnail wants to be, steps the springs, writes the
   transforms and repaints the capsules from where the thumbnails actually are. */
function createDockEngine({ strip, svg, goo, getEntries }) {
  const springs = new Map()
  const applied = new WeakMap()
  let base = null
  let targetFn = null
  let raf = null

  const R = th => th.w / 2 + CAPSULE_PAD
  const hidden = th => th.w / 2 - 4
  const restOf = th => ({
    x: 0, s: 1, k: 0.16, d: 0.74,
    layer: th.size > 1 ? 'u' + th.unit : null,
    fill: th.hue == null ? null : hsl(th.hue),
  })

  // Where every thumbnail sits with no transform of ours on it: what is measured, minus what
  // was applied. Works mid-animation, so the strip can be re-measured on every move.
  function measure() {
    const list = getEntries()
    const items = dockItems(list)
    const keys = dockKeys(list)
    const stripRect = strip.getBoundingClientRect()
    const thumbs = []
    strip.querySelectorAll('[data-dock-index]').forEach(node => {
      const index = Number(node.dataset.dockIndex)
      const unit = Number(node.closest('[data-dock-unit]')?.dataset.dockUnit)
      const item = items[unit]
      const rect = node.getBoundingClientRect()
      const ap = applied.get(node) || { x: 0, s: 1 }
      const w = rect.width / ap.s
      const cx = rect.left + rect.width / 2 - stripRect.left + strip.scrollLeft - ap.x
      thumbs.push({
        node, index, unit, key: keys[index],
        size: item?.indices.length || 1, hue: item?.hue ?? null, sg: list[index]?.sg ?? null,
        cx, cy: rect.top + rect.height / 2 - stripRect.top, w, left: cx - w / 2, right: cx + w / 2,
      })
    })
    let rest = null
    for (let i = 1; i < thumbs.length && rest == null; i++) {
      if (thumbs[i].unit === thumbs[i - 1].unit) rest = thumbs[i].cx - thumbs[i - 1].cx
    }
    svg.setAttribute('width', String(strip.scrollWidth || 0))
    svg.setAttribute('height', String(strip.clientHeight || 0))
    return {
      thumbs, valid: thumbs.length === list.length,
      rest: rest ?? (thumbs[0]?.w || 54) + 8,
      byIndex: new Map(thumbs.map(th => [th.index, th])),
      byKey: new Map(thumbs.map(th => [th.key, th])),
    }
  }

  function step() {
    if (!base) return true
    const targets = targetFn ? targetFn(base, restOf) : new Map(base.thumbs.map(th => [th.key, restOf(th)]))
    // A layer of one is no capsule: its drop shrinks back under the thumbnail.
    const count = new Map()
    targets.forEach(tg => { if (tg.layer) count.set(tg.layer, (count.get(tg.layer) || 0) + 1) })
    let still = true
    const blobs = []
    for (const th of base.thumbs) {
      const tg = targets.get(th.key) || restOf(th)
      const layer = tg.layer && count.get(tg.layer) > 1 ? tg.layer : null
      let sp = springs.get(th.key)
      if (!sp) {
        sp = { x: 0, v: 0, s: 1, vs: 0, r: layer ? R(th) : hidden(th), vr: 0, fill: tg.fill }
        springs.set(th.key, sp)
      }
      if (layer && tg.fill) sp.fill = tg.fill
      const rTarget = layer ? R(th) : hidden(th)
      const mx = springStep({ x: sp.x, v: sp.v }, tg.x, tg.k, tg.d)
      const ms = springStep({ x: sp.s, v: sp.vs }, tg.s, 0.2, 0.7)
      const mr = springStep({ x: sp.r, v: sp.vr }, rTarget, 0.14, 0.72)
      if (!atRest(mx, tg.x) || !atRest(ms, tg.s, 0.002) || !atRest(mr, rTarget)) still = false
      sp.x = mx.x; sp.v = mx.v; sp.s = ms.x; sp.vs = ms.v; sp.r = mr.x; sp.vr = mr.v
      if (!targetFn && atRest(mx, 0) && atRest(ms, 1, 0.002)) {
        Object.assign(sp, { x: 0, v: 0, s: 1, vs: 0 })
        th.node.style.transform = ''
        applied.delete(th.node)
      } else {
        th.node.style.transform = `translate3d(${sp.x.toFixed(2)}px,0,0) scale(${sp.s.toFixed(3)})`
        applied.set(th.node, { x: sp.x, s: sp.s })
      }
      if (sp.fill && sp.r > hidden(th) + 0.5) {
        blobs.push({ cx: th.cx + sp.x, cy: th.cy, r: sp.r * (layer ? sp.s : 1), fill: sp.fill, layer: layer || 'solo:' + th.key })
      }
    }
    goo.innerHTML = gooMarkup(gooLayers(blobs, base.rest))
    return still
  }

  function tick() {
    raf = null
    const still = step()
    const live = !still || !!targetFn
    strip.classList.toggle('wdock-live', live)
    if (live) raf = window.requestAnimationFrame(tick)
  }
  const kick = () => {
    if (raf != null) return
    if (typeof window.requestAnimationFrame === 'function') { raf = window.requestAnimationFrame(tick); return }
    // No frames to animate on: land where the springs were heading.
    for (let i = 0; i < 400 && !step() && !targetFn; i++);
  }

  return {
    get base() { return base },
    remeasure() { base = measure(); return base },
    // After the list re-renders, every thumbnail starts from where it was drawn a moment ago
    // and springs to where it now belongs — a reorder is a glide, not a jump.
    relayout() {
      const old = base
      base = measure()
      const live = new Set(base.thumbs.map(th => th.key))
      for (const key of springs.keys()) if (!live.has(key)) springs.delete(key)
      if (old) {
        for (const th of base.thumbs) {
          const sp = springs.get(th.key)
          const was = old.byKey.get(th.key)
          if (sp && was) sp.x = was.cx + sp.x - th.cx
        }
      }
      if (!step()) kick()
      else strip.classList.remove('wdock-live')
    },
    drive(fn) { targetFn = fn; kick() },
    release() { targetFn = null; kick() },
    destroy() { if (raf != null) window.cancelAnimationFrame(raf); raf = null },
  }
}

/* Where each thumbnail wants to be while one is lifted: the lifted one under the finger (drawn a
   little toward whatever is pulling it in), the one it would pair with leaning in to meet it, its
   own capsule mates stretching after it, and the neighbours of an empty landing spot easing apart. */
function dragTargets(g, b, restOf) {
  const out = new Map(b.thumbs.map(th => [th.key, restOf(th)]))
  const src = b.byIndex.get(g.index)
  if (!src) return out
  const delta = g.cx - g.grabCx
  const lean = (th, dx) => { const o = th && out.get(th.key); if (o) o.x += dx }

  if (g.mode === 'unit') {
    b.thumbs.filter(th => th.unit === src.unit).forEach(th => Object.assign(out.get(th.key), { x: delta, s: 1.06, ...LIFT }))
    const units = unitsOf(b).filter(u => u.unit !== src.unit)
    const slot = g.intent?.unit
    if (slot != null) {
      units[slot - 1]?.members.forEach(th => lean(th, -8))
      units[slot]?.members.forEach(th => lean(th, 8))
    }
    return out
  }

  const intent = g.intent || { slot: null, join: null }
  const others = b.thumbs.filter(th => th !== src)
  const join = intent.join != null ? b.byIndex.get(intent.join) : null
  const own = !!join && join.unit === src.unit && src.size > 1
  const srcCx = src.cx + delta
  const so = out.get(src.key)
  if (join) {
    const side = intent.slot <= others.indexOf(join) ? -1 : 1
    const pull = (join.cx + side * b.rest - srcCx) * 0.3
    const layer = join.size > 1 ? 'u' + join.unit : 'n' + join.index
    const fill = join.size > 1 && join.hue != null ? hsl(join.hue) : g.previewFill
    Object.assign(so, { x: delta + pull, s: 1.1, ...LIFT, layer, fill })
    if (join.size === 1) Object.assign(out.get(join.key), { layer, fill })
  } else Object.assign(so, { x: delta, s: 1.1, ...LIFT, layer: null })

  if (join && !own) {
    const dir = Math.sign(srcCx - join.cx) || 1
    lean(join, 6 * dir)
    out.get(join.key).s = 1.06
    b.thumbs.filter(th => th.unit === join.unit && th !== join && th !== src).forEach(th => lean(th, 3 * dir))
  }
  // Still held by its capsule: the mates lean after it, harder the further it is stretched.
  if (own) {
    b.thumbs.filter(th => th.unit === src.unit && th !== src).forEach(th => {
      const d = srcCx - th.cx
      lean(th, Math.sign(d) * Math.min(12, Math.max(0, Math.abs(d) - b.rest) * 0.25))
    })
  }
  // Anything it is not joining gives way as it comes close, the way two magnets of a kind would.
  const joined = new Set(b.thumbs.filter(th => join && th.unit === join.unit).map(th => th.key))
  b.thumbs.forEach(th => {
    if (th === src || joined.has(th.key) || (own && th.unit === src.unit)) return
    const d = th.cx - srcCx
    const room = b.rest * 1.15 - Math.abs(d)
    if (room > 0) lean(th, Math.sign(d || 1) * Math.min(16, room * 0.4))
  })
  if (!join && intent.slot != null) {
    lean(others[intent.slot - 1], -8); lean(others[intent.slot], 8)
    lean(others[intent.slot - 2], -3); lean(others[intent.slot + 1], 3)
  }
  return out
}

function unitsOf(b) {
  const units = []
  for (const th of b.thumbs) {
    const last = units[units.length - 1]
    if (last && last.unit === th.unit) last.members.push(th)
    else units.push({ unit: th.unit, members: [th] })
  }
  return units.map(u => {
    const left = Math.min(...u.members.map(th => th.left)) - (u.members.length > 1 ? CAPSULE_PAD : 0)
    const right = Math.max(...u.members.map(th => th.right)) + (u.members.length > 1 ? CAPSULE_PAD : 0)
    return { ...u, left, right, cx: (left + right) / 2 }
  })
}

/**
 * The strip of exercise thumbnails under the running session: where you are, what is done,
 * what is left, and the whole running order in one glance. The plan editor shows the same strip
 * over a routine's exercises (no current one, nothing done), so a routine is arranged and
 * supersetted with exactly the gestures a running session uses. Tap a thumbnail to jump to that
 * exercise; press and hold one to drag it somewhere else in the session, or hold on a little
 * longer to take its whole superset along.
 *
 * Exercises attract each other: let go over another one and the two become a superset, move a
 * member around inside its capsule and only the order changes, pull it clear and it leaves
 * (lib/workout-dock.js decides which, lib/active-workout-order.js applies it). The capsules are
 * drawn as liquid (lib/dock-physics.js): they stretch after a member being pulled away, neck
 * down and snap apart, and everything around moves on springs.
 */
export default function WorkoutDock({ entries, cur, onSelect, onReorder, onAdd, disabled, className = '' }) {
  const stripRef = useRef(null)
  const svgRef = useRef(null)
  const gooRef = useRef(null)
  const engineRef = useRef(null)
  const gestureRef = useRef(null)
  const entriesRef = useRef(entries)
  const onReorderRef = useRef(onReorder)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState(null)
  entriesRef.current = entries
  onReorderRef.current = onReorder
  const items = dockItems(entries)

  useLayoutEffect(() => {
    if (!stripRef.current) { engineRef.current?.destroy(); engineRef.current = null; return }
    if (!engineRef.current) {
      engineRef.current = createDockEngine({
        strip: stripRef.current, svg: svgRef.current, goo: gooRef.current, getEntries: () => entriesRef.current,
      })
    }
    engineRef.current.relayout()
  }, [entries, items.length])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => engineRef.current?.relayout())
    ro.observe(strip)
    return () => { ro.disconnect(); engineRef.current?.destroy(); engineRef.current = null }
  }, [items.length > 0])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || disabled) return undefined
    let frame = null
    setDrag(current => (current ? null : current))

    const clearFrame = () => {
      if (frame != null) window.cancelAnimationFrame(frame)
      frame = null
    }
    const finish = (gesture, commit) => {
      if (!gesture || gestureRef.current !== gesture) return
      window.clearTimeout(gesture.timer)
      window.clearTimeout(gesture.unitTimer)
      clearFrame()
      gestureRef.current = null
      if (!gesture.active) return
      try { gesture.captureTarget?.releasePointerCapture?.(gesture.pointerId) } catch { /* already released */ }
      setDrag(null)
      // Everything springs home — or, once the list re-renders in its new order, to its new place.
      engineRef.current?.release()
      // The compatibility click lands right after pointerup — a drop must not also count as a
      // tap on whatever thumbnail the finger happened to end over.
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 150)
      if (commit && gesture.entries === entriesRef.current && gesture.intent) {
        onReorderRef.current?.(gesture.index, gesture.intent)
      }
    }
    // The measured strip has to still describe the list we started from: an exercise finishing,
    // being added or being removed mid-drag invalidates every position we are about to compare.
    const update = (gesture, clientX, schedule = true) => {
      const engine = engineRef.current
      const b = engine?.remeasure()
      const src = b?.byIndex.get(gesture.index)
      if (!b?.valid || !src || gesture.entries !== entriesRef.current) { finish(gesture, false); return }
      const stripRect = strip.getBoundingClientRect()
      gesture.lastX = clientX
      gesture.cx = clientX - stripRect.left + strip.scrollLeft
      let marker
      let join = null
      if (gesture.mode === 'unit') {
        const units = unitsOf(b)
        const own = units.find(u => u.unit === src.unit)
        const others = units.filter(u => u !== own)
        const slot = dropSlot(others.map(u => u.cx), gesture.cx)
        gesture.intent = { unit: slot }
        marker = slot <= 0 ? (others[0]?.left ?? own.left)
          : slot >= others.length ? (others.at(-1)?.right ?? own.right)
            : (others[slot - 1].right + others[slot].left) / 2
      } else {
        const others = b.thumbs.filter(th => th !== src)
        const intent = dockIntent(others, gesture.cx, src.sg)
        // The click under the thumb as the magnet takes hold, and again as it lets go.
        if (gesture.intent && intent.join !== gesture.intent.join) vibrate(8)
        if (intent.join != null && intent.join !== gesture.intent?.join) {
          gesture.previewFill = hsl(joinHue(entriesRef.current, gesture.index, intent))
        }
        gesture.intent = intent
        join = intent.join
        marker = intent.slot <= 0 ? (others[0]?.left ?? src.left)
          : intent.slot >= others.length ? (others.at(-1)?.right ?? src.right)
            : (others[intent.slot - 1].right + others[intent.slot].left) / 2
      }
      setDrag({ index: gesture.index, unit: gesture.mode === 'unit' ? src.unit : null, join, markerLeft: marker })
      if (schedule && frame == null) frame = window.requestAnimationFrame(autoScroll)
    }
    function autoScroll() {
      frame = null
      const gesture = gestureRef.current
      if (!gesture?.active) return
      const rect = strip.getBoundingClientRect()
      const max = strip.scrollWidth - strip.clientWidth
      let step = 0
      if (gesture.lastX < rect.left + DOCK_EDGE && strip.scrollLeft > 0) step = -DOCK_SCROLL_STEP
      else if (gesture.lastX > rect.right - DOCK_EDGE && strip.scrollLeft < max) step = DOCK_SCROLL_STEP
      if (!step) return
      strip.scrollLeft += step
      update(gesture, gesture.lastX, false)
      if (gestureRef.current === gesture) frame = window.requestAnimationFrame(autoScroll)
    }
    const lift = gesture => {
      if (gestureRef.current !== gesture || gesture.entries !== entriesRef.current) { finish(gesture, false); return }
      const engine = engineRef.current
      const b = engine?.remeasure()
      const src = b?.byIndex.get(gesture.index)
      if (!src) { finish(gesture, false); return }
      gesture.active = true
      gesture.mode = 'entry'
      gesture.grabX = gesture.lastX
      const stripRect = strip.getBoundingClientRect()
      gesture.grabCx = gesture.lastX - stripRect.left + strip.scrollLeft
      gesture.captureTarget = gesture.downTarget
      try { gesture.captureTarget.setPointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      suppressClick.current = true
      vibrate(8)
      engine.drive((base, restOf) => dragTargets(gesture, base, restOf))
      if (src.size > 1) gesture.unitTimer = window.setTimeout(() => liftUnit(gesture), DOCK_UNIT_PRESS_MS)
      update(gesture, gesture.lastX)
    }
    const liftUnit = gesture => {
      if (gestureRef.current !== gesture || !gesture.active) return
      gesture.mode = 'unit'
      vibrate(15)
      update(gesture, gesture.lastX)
    }
    const onPointerDown = event => {
      suppressClick.current = false
      const current = gestureRef.current
      if (current) { if (event.pointerId !== current.pointerId) finish(current, false); return }
      if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
      const thumb = event.target.closest?.('[data-dock-index]')
      if (!thumb || !strip.contains(thumb)) return
      const index = Number(thumb.dataset.dockIndex)
      if (!Number.isInteger(index)) return
      const gesture = {
        pointerId: event.pointerId, index, intent: null, downTarget: event.target,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX,
        entries: entriesRef.current, active: false, timer: null, unitTimer: null,
      }
      gesture.timer = window.setTimeout(() => lift(gesture), DOCK_LONG_PRESS_MS)
      gestureRef.current = gesture
    }
    const onPointerMove = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (!gesture.active) {
        // Moved before the hold completed: that was a scroll of the strip, not a drag.
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > DOCK_DRAG_SLOP) {
          window.clearTimeout(gesture.timer)
          gestureRef.current = null
        } else gesture.lastX = event.clientX
        return
      }
      // Moving off before the longer hold settles it: it is the one exercise that travels.
      if (gesture.unitTimer != null && Math.abs(event.clientX - gesture.grabX) > DOCK_DRAG_SLOP) {
        window.clearTimeout(gesture.unitTimer)
        gesture.unitTimer = null
      }
      event.preventDefault()
      update(gesture, event.clientX)
    }
    const onPointerUp = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (gesture.active) event.preventDefault()
      finish(gesture, gesture.active)
    }
    const onPointerCancel = event => {
      const gesture = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const cancel = () => finish(gestureRef.current, false)
    const onKeyDown = event => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault(); cancel()
    }
    // Once a thumbnail is lifted the browser must not also claim the move as a sideways pan of
    // the strip — it would fire pointercancel and scroll instead. Only a non-passive touchmove
    // listener can stop that, and only while a drag is actually running.
    const onTouchMove = event => { if (gestureRef.current?.active) event.preventDefault() }
    const onContextMenu = event => { if (gestureRef.current?.active) event.preventDefault() }
    const onDragStart = event => { if (event.target.closest?.('[data-dock-index]')) event.preventDefault() }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp, { passive: false })
    document.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('lostpointercapture', onPointerCancel)
    document.addEventListener('keydown', onKeyDown)
    strip.addEventListener('contextmenu', onContextMenu)
    strip.addEventListener('dragstart', onDragStart)
    window.addEventListener('blur', cancel)
    return () => {
      const gesture = gestureRef.current
      window.clearTimeout(gesture?.timer)
      window.clearTimeout(gesture?.unitTimer)
      clearFrame()
      gestureRef.current = null
      if (gesture?.active) engineRef.current?.release()
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('lostpointercapture', onPointerCancel)
      document.removeEventListener('keydown', onKeyDown)
      strip.removeEventListener('contextmenu', onContextMenu)
      strip.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('blur', cancel)
    }
  }, [disabled, entries])

  if (!items.length) return null

  const onClickCapture = event => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault(); event.stopPropagation()
  }

  return <div className={'wdock' + (className ? ' ' + className : '') + (drag ? ' is-dragging' : '')} data-testid="workout-dock" data-swipe-ignore onClickCapture={onClickCapture}>
    <div className="wdock-strip" ref={stripRef}>
      {/* The capsules, drawn as liquid: blurred together and cut back to a sharp edge, so two
          drops close enough melt into one and a stretched one necks down before it snaps. */}
      <svg className="wdock-goo" ref={svgRef} aria-hidden="true">
        <defs>
          <filter id="wdock-goo" filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="drop" />
            <feMorphology in="drop" operator="erode" radius="1.5" result="inner" />
            <feComposite in="drop" in2="inner" operator="out" result="ring" />
            <feComponentTransfer in="drop" result="fill"><feFuncA type="linear" slope="0.16" /></feComponentTransfer>
            <feComponentTransfer in="ring" result="edge"><feFuncA type="linear" slope="0.6" /></feComponentTransfer>
            <feMerge><feMergeNode in="fill" /><feMergeNode in="edge" /></feMerge>
          </filter>
        </defs>
        <g ref={gooRef} />
      </svg>
      {items.map(item => {
        return <div key={item.position} data-dock-unit={item.position}
          className={'wdock-unit' + (item.sg ? ' ss' : '')}>
          {item.indices.map(index => {
            const ex = exOr(entries[index].id)
            const name = exerciseNameFor(ex)
            const lifted = !!drag && (drag.unit != null ? drag.unit === item.position : drag.index === index)
            return <button key={index} type="button" data-dock-index={index}
              className={'wdock-thumb' + (index === cur ? ' on' : '') + (item.done ? ' done' : '')
                + (lifted ? ' lifted' : '') + (drag && drag.join === index ? ' magnet' : '')}
              aria-label={name} aria-current={index === cur ? 'true' : undefined} title={name}
              onClick={() => onSelect(index)}>
              <Thumb ex={ex} />
              {item.done && <span className="wdock-check" aria-hidden="true"><Icon name="check" /></span>}
            </button>
          })}
        </div>
      })}
      <button type="button" className="wdock-add" aria-label={t('Add exercise')} title={t('Add exercise')}
        onClick={onAdd}><Icon name="plus" /></button>
      {drag && <div className={'wdock-marker' + (drag.join != null ? ' join' : '')} data-testid="workout-dock-marker"
        aria-hidden="true" style={{ left: drag.markerLeft + 'px' }} />}
    </div>
  </div>
}

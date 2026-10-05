import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { drumHome, drumSettle, drumArmed, drumRubber, drumSteps, drumCylinder, drumReach, drumFace, drumBend, drumShade, clampChamber, DRUM_LOCK } from '../lib/drum.js'
import { SWIPE_MIN_DISTANCE } from '../lib/swipe.js'
import { vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { copyFace, followFace } from './faceCopy.js'

/**
 * The sets of one workout screen as the chambers of a revolver drum.
 *
 * The chamber in front is drawn at full size — the set being worked, with numbers big enough to
 * read from the bench — and its neighbours sit above and below it as capsules, round the curve
 * of the cylinder. Drag vertically and the drum rolls with the finger, the chamber leaving
 * shrinking into a capsule as the one arriving grows to full size; past a margin
 * (lib/drum.js) the next chamber lights up, the phone clicks, and letting go lands on it. Short
 * of it, the drum springs back. A rail down the left edge is the whole cylinder at a glance:
 * every set of the exercise, or every round of the superset, tap or scrub to jump — the drum
 * rolls there through every chamber in between, clicking past each one like a revolver's.
 *
 * Turning only changes what is *shown*. Ticking a set off stays an explicit tap on the hero's
 * own button — and once a set is ticked, the drum turns by itself to the next one still to do.
 *
 * The component owns the gesture, the geometry and the rail; what a chamber looks like is the
 * caller's (renderHero / renderStrip), because only the workout knows how to edit a set.
 *
 * A sideways drag is not the drum's: it turns the deck of exercises around it. With onSwipe /
 * onSwipeEnd the drag is handed over live, so the next exercise follows the thumb exactly as
 * the next set does vertically; with only onNav the drum gives a little and pages on release.
 */

const STRIP = 50      // a resting chamber's height, px
const GAP = 10        // between chambers
const PERSPECTIVE = 900 // px, the .drum-stage perspective in index.css
const LETTERS = 'ABCDEFGH'
const RAIL = 0.8      // the rail's height, as a share of the hero's
const RAIL_W = 36     // the rail's width, px
const THUMB = 36      // the exercise thumbnail's smallest side, px (the rail's width)
const THUMB_MAX = 140 // ... and its largest: the hero gives up the difference in width
const THUMB_SHARE = 0.27 // the most of the drum's width the thumbnail's column may take
const HERO_MIN = 240  // the narrowest the hero may get, px: its tool bar still fits its labels
const RAIL_SLOT = 24 // the least a pip's slot may shrink to, px: the rail never gets cramped
const THUMB_GAP = 8   // between the thumbnail and the rail below it
const PAD = 8         // air round the hero inside the stage: the mask clips whatever pokes out of it
const BANDS = 9       // a bent face is cut into this many bands, each laid on the cylinder on its own

const WATCH = ['class', 'value', 'aria-checked', 'aria-label', 'disabled']

/* The bands of a bent chamber (see faceCopy.js). The chamber is a sticker laid on the drum, not a
   window onto it: all of its content is laid on the face, so a hero that is leaving is squeezed
   round the curve whole — never cropped — and the capsule arriving in its place is stretched out,
   as the face between them grows and shrinks. Band j carries its own slice of each (`--ef` / `--ec`
   say which, `--sf` / `--sc` how much to squeeze it). The copy follows the real chamber, but not
   its style, which fades with every frame of the turn (that is the band's --full / --cap). */
function BentFace({ chamber, bands, className, onClick, full: fallback }) {
  const hosts = useRef([])
  const [hc, setHc] = useState(fallback)
  useLayoutEffect(() => {
    // Found from the picture's own place: a child's effect runs before its parent's ref is set.
    const src = hosts.current[0]?.closest('.drum-stage')?.querySelector(`[data-ch="${chamber}"]`)
    if (!src) return
    return followFace(src, () => {
      hosts.current.forEach(h => { if (h) copyFace(h, src) })
      const m = src.querySelector('.drum-full')?.offsetHeight
      if (m) setHc(h => (Math.abs(h - m) > 0.5 ? m : h))
    }, WATCH)
  }, [])
  const n = bands.length
  return bands.map((b, j) => <div key={j} className={className} onClick={onClick} aria-hidden="true"
    style={{
      ...b.style,
      '--sf': b.unit * n / hc, '--ef': (-hc / 2 + (j + 0.5) * hc / n) + 'px',
      '--sc': b.unit * n / STRIP, '--ec': (-STRIP / 2 + (j + 0.5) * STRIP / n) + 'px',
    }}>
    <div className="bent-in" ref={el => { hosts.current[j] = el }} inert />
  </div>)
}

export default function SetDrum({
  chambers, entries, members = 1, inert = false,
  renderHead, renderHero, renderStrip, renderThumb, onNav, onSwipe, onSwipeEnd, onHeroRef, memberLabel,
  headOpen, onToggleHead,
}) {
  const count = chambers.length
  const home = drumHome(entries, chambers)
  const [focus, setFocus] = useState(home)
  const f = clampChamber(focus, count)
  const fc = chambers[f]
  // { axis: 'y' | 'x', dy, dx } while a finger is on the drum, else null.
  const [drag, setDrag] = useState(null)
  const gesture = useRef(null)
  const swallowClick = useRef(false)
  const lastSteps = useRef(0)
  const [heroH, setHeroH] = useState(280)
  // The tallest hero among the sets shown so far, the column's height (see colH below).
  const [colH, setColH] = useState(0)
  const heights = useRef(new Map())
  const [bodyW, setBodyW] = useState(0)
  const heroEl = useRef(null)
  const bodyEl = useRef(null)
  const stageEl = useRef(null)
  const [fuse, setFuse] = useState(null)
  const isDone = c => !!entries[c?.entry]?.sets?.[c?.set]?.done
  // Where the drum is drawn while it rolls on by itself after a turn (a fractional index), else
  // null. Driven frame by frame rather than by CSS transitions, so a chamber's place, tilt and
  // size move together and no chamber ever covers another on the way.
  const [glide, setGlide] = useState(null)
  const raf = useRef(0)
  const glideEnd = useRef(0)
  const stopGlide = () => {
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf.current)
    clearTimeout(glideEnd.current)
  }
  const run = (from, to, { clicks = false } = {}) => {
    stopGlide()
    const still = typeof requestAnimationFrame === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (still || Math.abs(from - to) < 0.001) { setGlide(null); return }
    // A longer roll takes longer, but not in proportion: the cylinder spins up for a far jump.
    const dur = 360 + 170 * Math.sqrt(Math.max(0, Math.abs(to - from) - 1))
    const t0 = performance.now()
    // easeOutBack: a small overshoot is the chamber clicking into place.
    const ease = k => 1 + 2 * (k - 1) ** 3 + (k - 1) ** 2
    let passed = Math.round(from)
    const step = now => {
      const k = Math.min(1, (now - t0) / dur)
      if (k >= 1) { setGlide(null); return }
      const at = from + (to - from) * ease(k)
      // Every chamber the roll passes clicks under the hand, as a revolver's drum does.
      if (clicks && Math.round(at) !== passed) { passed = Math.round(at); vibrate(6) }
      setGlide(at)
      raf.current = requestAnimationFrame(step)
    }
    setGlide(from)
    raf.current = requestAnimationFrame(step)
    // No frames while the page is hidden: the drum still has to come to rest.
    glideEnd.current = setTimeout(() => { stopGlide(); setGlide(null) }, dur + 150)
  }
  useEffect(() => () => stopGlide(), [])

  const go = (i, { haptic = true, from = glide ?? f } = {}) => {
    const n = clampChamber(i, count)
    run(from, n, { clicks: haptic })
    if (n === f) return
    if (haptic) vibrate(12)
    setFocus(n)
  }
  const goRef = useRef(go)
  useEffect(() => { goRef.current = go })

  /* A set just ticked off: wait a beat for the check to land, then turn to the next one still
     to do. A row added or removed re-homes too, since the indexes it was resting on moved. */
  const doneCount = chambers.reduce((n, c) => n + (isDone(c) ? 1 : 0), 0)
  const seen = useRef({ done: doneCount, count })
  useEffect(() => {
    const was = seen.current
    seen.current = { done: doneCount, count }
    const grew = doneCount > was.done
    if (!grew && count === was.count) return
    const tm = setTimeout(() => goRef.current(home, { haptic: false }), grew ? 420 : 0)
    return () => clearTimeout(tm)
  }, [doneCount, count, home])

  // The hero's height sets the drum's geometry; it changes with drops, notes and focus. Each set's
  // last height is kept, per size the workout screen fits it to (data-fit), so the column beside
  // the drum can take the tallest of them and keep one size from set to set, superset members
  // included; a size step of its own, so a tighter screen does not inherit a roomier column.
  const chamberKeys = chambers.map(c => c.entry + ':' + c.set).join(' ')
  useLayoutEffect(() => {
    const el = heroEl.current
    if (!el) return
    const measure = () => {
      const now = el.offsetHeight
      setHeroH(h => (Math.abs(h - now) > 1 ? now : h))
      const step = (el.closest('[data-fit]')?.dataset.fit ?? '') + '|'
      heights.current.set(step + fc.entry + ':' + fc.set, now)
      const tallest = Math.max(now, ...chamberKeys.split(' ').map(k => heights.current.get(step + k) || 0))
      setColH(h => (Math.abs(h - tallest) > 1 ? tallest : h))
    }
    measure()
    // The workout screen shrinks the hero to fit and has to know at once how tall the drum came out
    // (see 'drum:measure' in views/Workout.jsx): it asks, and the drum answers before it returns.
    const now = () => flushSync(measure)
    window.addEventListener('drum:measure', now)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('drum:measure', now)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect(); window.removeEventListener('drum:measure', now) }
  }, [f, count, chamberKeys])

  // The drum's width sets how big the exercise's thumbnail may be (see thumbSize).
  useLayoutEffect(() => {
    const el = bodyEl.current
    if (!el) return
    const measure = () => setBodyW(w => (Math.abs(w - el.offsetWidth) > 1 ? el.offsetWidth : w))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [count])

  // A finger's worth of travel per chamber: the hero follows the finger exactly one to one
  // until the neighbour has taken its place.
  const pitch = heroH / 2 + STRIP / 2 + GAP
  const live = drag?.axis === 'y' ? drumRubber({ from: f, drag: drag.dy, pitch, count }) : 0
  const pos = drag?.axis === 'y' ? f - live / pitch : (glide ?? f)
  // Room for the neighbours on each side, only as much as they take on screen once tilted round
  // the curve: the first set has nothing above it, so no empty band opens between the head and
  // the hero, and the last none between it and the buttons below. Read from the fractional
  // position, so the room grows and shrinks smoothly as the drum rolls.
  const radius = heroH * 0.8
  const reach = drumReach({ pos, count, hero: heroH, strip: STRIP, gap: GAP, radius, perspective: PERSPECTIVE })
  const above = Math.ceil(reach.above)
  const below = Math.ceil(reach.below)
  const stageH = (count > 1 ? heroH + above + below : heroH) + 2 * PAD
  // The hero's centre line within the stage: where the chambers meet.
  const mid = count > 1 ? PAD + above + heroH / 2 : stageH / 2
  const armed = drag?.axis === 'y' && drumArmed({ from: f, drag: drag.dy, pitch, count })
  const aim = drag?.axis === 'y' ? drumSettle({ from: f, drag: drag.dy, pitch, count }) : f

  // The column beside the drum — the exercise's thumbnail over the rail — stays put at the top of
  // the drum and keeps one size: as the drum rolls, the room for the neighbour above opens and the
  // hero moves down, but the column does not follow it, and it is cut to the tallest hero shown so
  // far (colH), so a shorter set, or a superset member's, does not shrink it. The rail is a window
  // five pips tall: the set on screen in the middle, the two before it above and the two after
  // below. The track of pips rolls behind it with the drum, so the live pip never moves. Everything
  // the rail leaves free above it, up to THUMB_MAX, goes to the thumbnail, level with the first
  // hero's top; the column is as wide as the thumbnail, the hero takes the rest.
  // The hero's face sits a little behind the front of the cylinder, so on screen the box is
  // smaller than its layout height: the column goes by the box as drawn.
  const faceH = heroH * PERSPECTIVE / (PERSPECTIVE - drumCylinder({ pos: f, count, hero: heroH, strip: STRIP, gap: GAP, radius })[f].z)
  const tallH = Math.max(heroH, colH)
  const colFace = tallH * faceH / heroH
  // The thumbnail is as large as the room allows, on both axes: no wider than its share of the
  // drum (the hero keeps the rest) and no taller than what the face leaves above a rail that
  // still has its five readable pips. It follows the drum's measured width and the hero's
  // height, so a phone, a tablet and a rotated screen each get the biggest picture that fits.
  const thumbSize = renderThumb
    ? Math.max(THUMB, Math.min(THUMB_MAX,
      bodyW ? 2 * Math.floor(Math.min(bodyW * THUMB_SHARE, bodyW - HERO_MIN - 10) / 2) : THUMB_MAX,
      2 * Math.floor((colFace - 5 * RAIL_SLOT - THUMB_GAP) / 2)))
    : RAIL_W
  const railH = renderThumb ? Math.max(5 * RAIL_SLOT, colFace - thumbSize - THUMB_GAP) : colFace * RAIL
  const colTop = Math.round(PAD + (tallH - colFace) / 2)
  const railTop = colTop + colFace - railH
  // A set shorter than the column, alone or last with nothing below it, still has the whole
  // column beside it: the drum is never shorter than the column.
  const bodyH = Math.max(stageH, railTop + railH + PAD)
  const slot = railH / 5
  const pipSize = Math.max(14, Math.min(28, slot - 8))
  const track = railH / 2 - pos * slot - pipSize / 2
  const railMid = railTop + railH / 2

  // The fuse: a thin curve from the rail's live pip into the hero, so the eye never loses
  // which dot is the set on screen. Its x is read from layout; its y follows from the window.
  const railEl = useRef(null)
  useLayoutEffect(() => {
    const rail = railEl.current
    if (!rail) return
    const x1 = rail.offsetLeft + rail.offsetWidth - 4
    setFuse(was => (was?.x1 === x1 ? was : { x1 }))
  }, [count, heroH, thumbSize, bodyW])
  const fuseY1 = railMid + (aim - pos) * slot

  /* ---------- the gesture ---------- */
  const IGNORE = 'input,textarea,select,[contenteditable="true"]'
  // A drag may start on a number field — the hero is mostly steppers, and a drag that cannot
  // begin on them leaves dead patches in the middle of the box. A tap still focuses the field:
  // the gesture only takes over once the finger has travelled DRUM_LOCK.
  const IGNORE_DOWN = 'textarea,select,[contenteditable="true"]'
  // The same gesture drives the drum from the stage and from the rail. On the rail a pip's slot
  // is a whole chamber, so the finger's travel is scaled up: the pips stay under the finger
  // while the chambers roll beside them, and it springs, clicks and settles just the same.
  const onDown = (e, { onRail = false } = {}) => {
    if (inert || (e.button ?? 0) !== 0 || e.target.closest?.(IGNORE_DOWN)) return
    gesture.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, t: e.timeStamp, ly: e.clientY, lt: e.timeStamp, v: 0,
      onRail, scale: onRail ? pitch / slot : 1, el: onRail ? railEl.current : stageEl.current,
    }
    swallowClick.current = false
    lastSteps.current = 0
  }
  const onMove = e => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x, dy = (e.clientY - g.y) * g.scale
    if (!g.axis) {
      if (Math.max(Math.abs(dx), Math.abs(e.clientY - g.y)) < DRUM_LOCK) return
      // Sideways is the exercise deck's anywhere on the box, the rail included. The rail's own
      // travel is scaled, so which axis wins is judged on the finger's raw movement.
      g.axis = Math.abs(e.clientY - g.y) >= Math.abs(dx) ? 'y' : 'x'
      swallowClick.current = true
      try { g.el?.setPointerCapture?.(e.pointerId) } catch { /* moves still arrive while over it */ }
      if (e.pointerType === 'mouse') window.getSelection?.()?.removeAllRanges()
      // Grabbing the drum while it still rolls stops it where the finger takes over.
      if (g.axis === 'y') { stopGlide(); setGlide(null) }
    }
    if (g.axis === 'x' && onSwipe) { onSwipe(dx, e); return }
    // Velocity from the last sample only: a flick is what the finger was doing as it left.
    const dt = e.timeStamp - g.lt
    if (dt > 0) { g.v = (e.clientY - g.ly) * g.scale / dt; g.ly = e.clientY; g.lt = e.timeStamp }
    if (g.axis === 'y') {
      // A detent: every chamber the drag crosses clicks once under the finger.
      const steps = drumSteps(dy, pitch)
      const landing = clampChamber(f + steps, count)
      if (landing !== clampChamber(f + lastSteps.current, count)) vibrate(8)
      lastSteps.current = steps
    }
    setDrag({ axis: g.axis, dx, dy })
  }
  const onUp = (e, commit = true) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    setDrag(null)
    try { if (g.el?.hasPointerCapture?.(e.pointerId)) g.el.releasePointerCapture(e.pointerId) } catch { /* gone */ }
    if (g.axis === 'y' && !commit) run(pos, f)
    const dx = e.clientX - g.x, dy = (e.clientY - g.y) * g.scale
    if (g.axis === 'x' && onSwipe) { onSwipeEnd?.(dx, e, commit); return }
    if (!commit || !g.axis) return
    if (g.axis === 'y') {
      // A stale velocity (the finger paused before lifting) is no flick.
      const v = e.timeStamp - g.lt > 90 ? 0 : g.v
      go(drumSettle({ from: f, drag: dy, pitch, velocity: v, count }), { haptic: false, from: pos })
    } else if (Math.abs(dx) >= SWIPE_MIN_DISTANCE) {
      onNav?.(dx < 0 ? 1 : -1)
    }
  }
  // A pointer that ends outside (or is taken back by the browser) still ends the gesture.
  const upRef = useRef(onUp)
  useEffect(() => { upRef.current = onUp })
  useEffect(() => {
    const end = e => upRef.current(e, e.type === 'pointerup')
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
  }, [])

  // Desktop: the wheel turns it a chamber per notch, with a short dead time so a trackpad's
  // stream of tiny deltas does not spin it through the whole exercise.
  const wheel = useRef({ acc: 0, at: 0 })
  const onWheel = e => {
    if (inert || e.target.closest?.(IGNORE)) return
    const w = wheel.current
    if (e.timeStamp - w.at < 200) return
    w.acc += e.deltaY
    if (Math.abs(w.acc) >= 40) { go(f + Math.sign(w.acc)); w.acc = 0; w.at = e.timeStamp }
  }
  const onKey = e => {
    if (e.target.closest?.(IGNORE)) return
    const d = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key]
    if (d) { e.preventDefault(); go(f + d) }
    else if (e.key === 'Home') { e.preventDefault(); go(0) }
    else if (e.key === 'End') { e.preventDefault(); go(count - 1) }
  }

  if (!count) return null

  // The cylinder: every chamber a flat face round it, as tall as it has grown (lib/drum.js).
  // The radius keeps the neighbours readable while still curving visibly away. Those near the
  // front are mounted; the rest of the drum only exists on the rail.
  const drum = drumCylinder({ pos, count, hero: heroH, strip: STRIP, gap: GAP, radius })
  const visible = chambers.map((c, i) => i).filter(i => i === f || (Math.abs(i - pos) <= 2.4 && !drum[i].back))
  const nextTodo = chambers.findIndex(c => !isDone(c))
  // Member tabs: in a superset, one tap jumps to that exercise's next set still to do.
  const memberIdx = [...new Set(chambers.map(c => c.entry))]

  /* No data-swipe-ignore on the root: the whole box answers to the workout's swipe surface, so a
     sideways drag on the header, the tabs or the gaps pages between exercises. Only the stage
     and the rail take their own pointer (they roll the drum, and hand sideways drags over
     through onSwipe), so only they keep the attribute. */
  return <div className={'drum' + (inert ? ' inert' : '')}>
    {members <= 1 && renderHead && fc && <div className="drum-head" key={fc.entry}>{renderHead(fc.entry)}</div>}
    {/* In a superset the member's box is its name, so the head is not repeated above it: the box
        on screen is the head's toggle, and what it unfolds hangs right under it. Tapping any other
        box still jumps to that exercise's next set. */}
    {members > 1 && <div className="drum-tabs" role="tablist">
      {memberIdx.map((entry, m) => {
        const mine = chambers.map((c, i) => [c, i]).filter(([c]) => c.entry === entry)
        const left = mine.filter(([c]) => !isDone(c)).length
        const target = (mine.find(([c]) => !isDone(c)) || mine[mine.length - 1])?.[1]
        const on = fc?.entry === entry
        const fold = on && !!onToggleHead
        const open = fold && !!headOpen?.(entry)
        return <Fragment key={entry}>
          <button role="tab" aria-selected={on} aria-expanded={fold ? open : undefined}
            className={'drum-tab m' + m + (on ? ' on' : '')} onClick={() => (fold ? onToggleHead(entry) : go(target))}>
            <b>{LETTERS[m]}</b><span>{memberLabel?.(entry)}</span><i>{left ? left : <Icon name="check" />}</i>
            {/* every box keeps the chevron's room, so a name wraps the same on screen or not
                and the drum below never jumps when the box on screen changes */}
            {onToggleHead && <Icon name={open ? 'chevronUp' : 'chevronDown'} className={'drum-tab-chev' + (fold ? '' : ' off')} />}
          </button>
          {on && renderHead && <div className="drum-head" key={'h' + entry}>{renderHead(entry)}</div>}
        </Fragment>
      })}
    </div>}
    <div className="drum-body" ref={bodyEl} style={{ height: bodyH }}>
      {renderThumb && fc && <div className="drum-thumb" key={fc.entry} aria-hidden="true"
        style={{ top: colTop, width: thumbSize, height: thumbSize }}>{renderThumb(fc.entry)}</div>}
      <div className="drum-rail" data-swipe-ignore ref={railEl} role="tablist" aria-label={t('Sets')} aria-orientation="vertical"
        onPointerDown={e => onDown(e, { onRail: true })} onPointerMove={onMove}
        onPointerUp={e => onUp(e, true)} onPointerCancel={e => onUp(e, false)}
        onClickCapture={e => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation() } }}
        style={{ height: railH, marginTop: railTop, marginInline: (thumbSize - RAIL_W) / 2,'--pip': pipSize + 'px', '--pip-gap': slot - pipSize + 'px' }}>
        <span className="drum-axis" aria-hidden="true" />
        <div className="drum-track" style={{ transform: `translateY(${track}px)` }}>
        {chambers.map((c, i) => {
          const roundStart = members > 1 && i > 0 && c.member === 0 && !c.warm
          return <button key={c.entry + ':' + c.set}
            role="tab" aria-selected={i === f} aria-label={(c.warm ? t('Warm-up') : t('Set {0}', c.num)) + (members > 1 ? ' ' + LETTERS[c.member] : '')}
            className={'drum-pip m' + c.member + (c.warm ? ' warm' : '') + (isDone(c) ? ' done' : '') + (i === f ? ' on' : '') + (i === aim && i !== f ? ' aim' : '') + (i === nextTodo ? ' todo' : '') + (roundStart ? ' round' : '')}
            tabIndex={-1} onClick={() => go(i)}>
            {isDone(c) ? <Icon name="check" /> : c.warm ? <Icon name="flame" /> : c.num}
          </button>
        })}
        </div>
      </div>
      {fuse && <svg className={'drum-fuse' + (armed ? ' armed' : '')} aria-hidden="true">
        <path d={`M${fuse.x1},${fuseY1} C${fuse.x1 + 14},${fuseY1} ${fuse.x1 + 10},${railMid} ${fuse.x1 + 24},${railMid}`} />
        <circle cx={fuse.x1 + 24} cy={railMid} r="3" />
      </svg>}
      <div className={'drum-stage' + (drag ? ' grabbing' : '') + (count > 1 ? '' : ' solo')} data-swipe-ignore ref={stageEl} tabIndex={inert ? -1 : 0}
        aria-roledescription={t('Drum')} aria-label={t('Set {0} of {1}', f + 1, count)}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={e => onUp(e, true)} onPointerCancel={e => onUp(e, false)}
        onWheel={onWheel} onKeyDown={onKey}
        onClickCapture={e => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation() } }}
        style={{ '--mid': mid + 'px', '--pad': PAD + 'px',
          '--fade-a': above * 0.7 + PAD * Math.min(1, above / PAD) + 'px', '--fade-b': below * 0.7 + PAD * Math.min(1, below / PAD) + 'px',
          ...(drag?.axis === 'x' && !onSwipe ? { transform: `translateX(${Math.max(-60, Math.min(60, drag.dx * 0.3))}px)` } : {}) }}>
        {visible.map(i => {
          const c = chambers[i]
          const a = Math.abs(i - pos)
          const hero = i === f
          const { y, z, tilt, h, grow, back } = drum[i]
          // A chamber on its way in or out is its full set and its capsule at once: the full set
          // is clipped to the band the drum gives it — clip-path, not height, so the layout
          // never shifts under the finger — and the capsule fades out early, so mid-turn shows
          // one, not both.
          const morph = hero || grow > 0
          const full = Math.max(0, Math.min(1, (grow - 0.06) / 0.24))
          const capsule = Math.max(0, 1 - grow / 0.12)
          // Room for the hero's shadow, given only near full size so two chambers never touch.
          const slack = 2 + 46 * Math.max(0, grow - 0.8) / 0.2
          // A chamber on its way in or out is not a flat card leaning over: its surface wraps the
          // cylinder (drumFace), so it is drawn as bands, each placed round the curve, and the real
          // chamber hides behind them. Resting in front it is not bent, and not drawn this way.
          const bands = morph && drumBend(grow) > 0 ? drumFace({ pos, index: i, count, hero: heroH, strip: STRIP, gap: GAP, radius, slices: BANDS }) : null
          const style = {
            transform: `translate3d(0, calc(-50% + ${y}px), ${z}px) rotateX(${-tilt}rad)`,
            // Faces turned away from you catch less light, as round a real cylinder.
            opacity: back ? 0 : Math.max(0, Math.cos(tilt)) ** 0.7,
            zIndex: 20 - Math.round(a * 4),
            clipPath: morph ? `inset(calc(50% - ${h / 2 + slack}px) ${-slack / 3}px round ${15 + 7 * grow}px)` : undefined,
            ...(bands ? { opacity: 0, pointerEvents: 'none' } : {}),
          }
          const flags = (hero ? ' hero' : ' strip') + (i === aim && armed ? ' armed' : '') + (isDone(c) ? ' done' : '')
          const edge = 15 + 7 * grow
          const bandStyle = bands?.map((b, j) => ({
            unit: b.unit,
            style: {
              height: b.len,
              transform: `translate3d(0, calc(-50% + ${b.y}px), ${b.z}px) rotateX(${-b.rot}rad)`,
              visibility: b.back ? 'hidden' : undefined,
              zIndex: 20 - Math.round(a * 4),
              '--sa': drumShade(b.rot - b.step / 2) * 100 + '%', '--sb': drumShade(b.rot + b.step / 2) * 100 + '%', '--full': full, '--cap': capsule,
              // Only the ends of the face are rounded, and the hero's shadow only has room past them.
              clipPath: j === 0 ? `inset(${-slack}px ${-slack / 3}px 0 round ${edge}px ${edge}px 0 0)`
                : j === bands.length - 1 ? `inset(0 ${-slack / 3}px ${-slack}px round 0 0 ${edge}px ${edge}px)`
                  : `inset(0 ${-slack / 3}px)`,
            },
          }))
          return <Fragment key={c.entry + ':' + c.set}>
            <div style={style} data-ch={c.entry + ':' + c.set}
              className={'drum-ch' + flags}
              ref={hero ? el => { heroEl.current = el; onHeroRef?.(c, el) } : undefined}
              onClick={hero ? undefined : () => go(i)}
              {...(inert ? { inert: true } : {})}>
              {morph ? <>
                <div className="drum-full" key={'h' + i} style={{ opacity: full }}
                  {...(hero ? {} : { inert: true, 'aria-hidden': true })}>{renderHero(c, i)}</div>
                {(capsule > 0 || bands) && <div className="drum-capsule" aria-hidden="true" style={{ opacity: capsule }}>{renderStrip(c, i)}</div>}
              </> : renderStrip(c, i)}
            </div>
            {bands && <BentFace chamber={c.entry + ':' + c.set} bands={bandStyle} full={heroH}
              className={'drum-ch bent' + flags} onClick={hero ? undefined : () => go(i)} />}
          </Fragment>
        })}
      </div>
    </div>
  </div>
}

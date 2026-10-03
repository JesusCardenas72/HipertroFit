import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drumHome, drumSettle, drumArmed, drumRubber, drumSteps, drumCylinder, drumReach, clampChamber, DRUM_LOCK } from '../lib/drum.js'
import { SWIPE_MIN_DISTANCE } from '../lib/swipe.js'
import { vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

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
 */

const STRIP = 50      // a resting chamber's height, px
const GAP = 10        // between chambers
const PERSPECTIVE = 900 // px, the .drum-stage perspective in index.css
const LETTERS = 'ABCDEFGH'

export default function SetDrum({
  chambers, entries, members = 1, inert = false,
  renderHead, renderHero, renderStrip, renderTools, onNav, onHeroRef, memberLabel,
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

  // The hero's height sets the drum's geometry; it changes with drops, notes and focus.
  useLayoutEffect(() => {
    const el = heroEl.current
    if (!el) return
    const measure = () => setHeroH(h => (Math.abs(h - el.offsetHeight) > 1 ? el.offsetHeight : h))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [f, count])

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
  const stageH = count > 1 ? heroH + above + below : heroH + 8
  // The hero's centre line within the stage: where the chambers, the rail and the fuse meet.
  const mid = count > 1 ? above + heroH / 2 : stageH / 2
  const armed = drag?.axis === 'y' && drumArmed({ from: f, drag: drag.dy, pitch, count })
  const aim = drag?.axis === 'y' ? drumSettle({ from: f, drag: drag.dy, pitch, count }) : f

  // The rail is exactly as tall as the hero, a window five pips tall: the set on screen in the
  // middle, the two before it above and the two after below. The track of pips rolls behind it
  // with the drum, so the live pip always sits level with the hero.
  const slot = heroH / 5
  const pipSize = Math.max(14, Math.min(28, slot - 8))
  const track = heroH / 2 - pos * slot - pipSize / 2

  // The fuse: a thin curve from the rail's live pip into the hero, so the eye never loses
  // which dot is the set on screen. Its x is read from layout; its y follows from the window.
  const railEl = useRef(null)
  useLayoutEffect(() => {
    const rail = railEl.current
    if (!rail) return
    const x1 = rail.offsetLeft + rail.offsetWidth - 4
    setFuse(was => (was?.x1 === x1 ? was : { x1 }))
  }, [count, heroH])
  const fuseY1 = mid + (aim - pos) * slot

  /* ---------- the gesture ---------- */
  const IGNORE = 'input,textarea,select,[contenteditable="true"]'
  // The same gesture drives the drum from the stage and from the rail. On the rail a pip's slot
  // is a whole chamber, so the finger's travel is scaled up: the pips stay under the finger
  // while the chambers roll beside them, and it springs, clicks and settles just the same.
  const onDown = (e, { onRail = false } = {}) => {
    if (inert || (e.button ?? 0) !== 0 || e.target.closest?.(IGNORE)) return
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
      // The rail only ever rolls the drum; swiping sideways on it is not a change of exercise.
      g.axis = g.onRail || Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
      swallowClick.current = true
      try { g.el?.setPointerCapture?.(e.pointerId) } catch { /* moves still arrive while over it */ }
      if (e.pointerType === 'mouse') window.getSelection?.()?.removeAllRanges()
      // Grabbing the drum while it still rolls stops it where the finger takes over.
      if (g.axis === 'y') { stopGlide(); setGlide(null) }
    }
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
    if (!commit || !g.axis) return
    const dx = e.clientX - g.x, dy = (e.clientY - g.y) * g.scale
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

  return <div className={'drum' + (inert ? ' inert' : '')} data-swipe-ignore>
    {renderHead && fc && <div className="drum-head" key={fc.entry}>{renderHead(fc.entry)}</div>}
    {members > 1 && <div className="drum-tabs" role="tablist">
      {memberIdx.map((entry, m) => {
        const mine = chambers.map((c, i) => [c, i]).filter(([c]) => c.entry === entry)
        const left = mine.filter(([c]) => !isDone(c)).length
        const target = (mine.find(([c]) => !isDone(c)) || mine[mine.length - 1])?.[1]
        return <button key={entry} role="tab" aria-selected={fc?.entry === entry}
          className={'drum-tab m' + m + (fc?.entry === entry ? ' on' : '')} onClick={() => go(target)}>
          <b>{LETTERS[m]}</b><span>{memberLabel?.(entry)}</span><i>{left ? left : <Icon name="check" />}</i>
        </button>
      })}
    </div>}
    <div className="drum-body" ref={bodyEl} style={{ height: stageH }}>
      <div className="drum-rail" ref={railEl} role="tablist" aria-label={t('Sets')} aria-orientation="vertical"
        onPointerDown={e => onDown(e, { onRail: true })} onPointerMove={onMove}
        onPointerUp={e => onUp(e, true)} onPointerCancel={e => onUp(e, false)}
        onClickCapture={e => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation() } }}
        style={{ height: heroH, marginTop: mid - heroH / 2, '--pip': pipSize + 'px', '--pip-gap': slot - pipSize + 'px' }}>
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
        <path d={`M${fuse.x1},${fuseY1} C${fuse.x1 + 14},${fuseY1} ${fuse.x1 + 10},${mid} ${fuse.x1 + 24},${mid}`} />
        <circle cx={fuse.x1 + 24} cy={mid} r="3" />
      </svg>}
      <div className={'drum-stage' + (drag ? ' grabbing' : '') + (count > 1 ? '' : ' solo')} ref={stageEl} tabIndex={inert ? -1 : 0}
        aria-roledescription={t('Drum')} aria-label={t('Set {0} of {1}', f + 1, count)}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={e => onUp(e, true)} onPointerCancel={e => onUp(e, false)}
        onWheel={onWheel} onKeyDown={onKey}
        onClickCapture={e => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation() } }}
        style={{ '--mid': mid + 'px', '--fade-a': above * 0.7 + 'px', '--fade-b': below * 0.7 + 'px',
          ...(drag?.axis === 'x' ? { transform: `translateX(${Math.max(-60, Math.min(60, drag.dx * 0.3))}px)` } : {}) }}>
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
          const style = {
            transform: `translate3d(0, calc(-50% + ${y}px), ${z}px) rotateX(${-tilt}rad)`,
            // Faces turned away from you catch less light, as round a real cylinder.
            opacity: back ? 0 : Math.max(0, Math.cos(tilt)) ** 0.7,
            zIndex: 20 - Math.round(a * 4),
            clipPath: morph ? `inset(calc(50% - ${h / 2 + slack}px) ${-slack / 3}px round ${15 + 7 * grow}px)` : undefined,
          }
          return <div key={c.entry + ':' + c.set} style={style}
            className={'drum-ch' + (hero ? ' hero' : ' strip') + (i === aim && armed ? ' armed' : '') + (isDone(c) ? ' done' : '')}
            ref={hero ? el => { heroEl.current = el; onHeroRef?.(c, el) } : undefined}
            onClick={hero ? undefined : () => go(i)}
            {...(inert ? { inert: true } : {})}>
            {morph ? <>
              <div className="drum-full" key={'h' + i} style={{ opacity: full }}
                {...(hero ? {} : { inert: true, 'aria-hidden': true })}>{renderHero(c, i)}</div>
              {capsule > 0 && <div className="drum-capsule" aria-hidden="true" style={{ opacity: capsule }}>{renderStrip(c, i)}</div>}
            </> : renderStrip(c, i)}
          </div>
        })}
      </div>
    </div>
    {renderTools && fc && <div className="drum-tools">{renderTools(fc.entry)}</div>}
  </div>
}

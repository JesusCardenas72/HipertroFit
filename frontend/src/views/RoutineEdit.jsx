import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { uid } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { supersetUnits, moveSupersetUnit, cleanupSg, exLine } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet, addExerciseToRoutine } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, Row, SelectRow, Switch } from '../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { folderOf, moveRoutineToFolder } from '../lib/folders.js'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { dropActiveWorkoutEntry, moveActiveWorkoutUnitTo } from '../lib/active-workout-order.js'
import WorkoutDock from '../components/WorkoutDock.jsx'
import { dockIntent, dockItems, dockKeys, dropSlot, joinHue } from '../lib/workout-dock.js'
import { createListEngine, listTargets, rowHsl, rowUnits } from '../components/routineMagnets.js'
import { vibrate } from '../lib/sound.js'

export const ROUTINE_LONG_PRESS_MS = 380
// Held still this much longer, a superset member takes its whole capsule with it — the dock's
// DOCK_UNIT_PRESS_MS, so the two places answer a hold the same way.
export const ROUTINE_UNIT_PRESS_MS = 420
export const ROUTINE_DRAG_SLOP = 8

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

// A row let go in the list, or a thumbnail on the dock above it: the same drop a running
// session makes (lib/active-workout-order.js), applied to the routine's exercises in place.
// `intent.unit` is a whole superset moved by a longer hold; otherwise `{ slot, join }` also
// decides its superset — onto another exercise it pairs with it, clear of its capsule it leaves.
export function dropRoutineEntry(exercises, index, intent) {
  if (!Array.isArray(exercises) || !intent) return false
  const active = { entries: exercises, cur: 0 }
  return !!(intent.unit != null
    ? moveActiveWorkoutUnitTo(active, index, intent.unit)
    : dropActiveWorkoutEntry(active, index, intent))
}

// Put another exercise in the place of one occurrence, found by its dock key (id + which
// occurrence) rather than its index, so a list that moved while the picker was open still swaps
// the right row — and one that lost it swaps nothing. The new exercise brings its own config;
// only the place and the superset it sits in are kept.
export function replaceRoutineEntry(exercises, key, id, cfg) {
  if (!Array.isArray(exercises) || !id) return false
  const at = dockKeys(exercises).indexOf(key)
  if (at < 0) return false
  const { sg } = exercises[at]
  const { id: _id, sg: _sg, ...rest } = cfg || {}
  exercises[at] = { id, ...(sg ? { sg } : {}), ...rest }
  return true
}

function scrollHostFor(node) {
  for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return window
}

function autoScrollStep(host, clientY) {
  const edge = 64
  const maxStep = 14
  let top, bottom, scrollTop, maxScroll
  if (host === window) {
    const root = document.scrollingElement || document.documentElement
    top = window.visualViewport?.offsetTop || 0
    bottom = top + (window.visualViewport?.height || window.innerHeight || root.clientHeight)
    scrollTop = window.scrollY || root.scrollTop || 0
    maxScroll = Math.max(root.scrollHeight, document.body?.scrollHeight || 0) - (bottom - top)
  } else {
    const rect = host.getBoundingClientRect()
    top = rect.top; bottom = rect.bottom
    scrollTop = host.scrollTop; maxScroll = host.scrollHeight - host.clientHeight
  }
  if (clientY < top + edge && scrollTop > 0) return -Math.ceil(maxStep * clamp((top + edge - clientY) / edge, 0, 1))
  if (clientY > bottom - edge && scrollTop < maxScroll) return Math.ceil(maxStep * clamp((clientY - bottom + edge) / edge, 0, 1))
  return 0
}

/* Press and hold a row to lift that one exercise; hold on a little longer and a superset member
   takes its whole capsule along. While it is lifted the rows behave like the dock's thumbnails
   (components/routineMagnets.js): let go over another exercise and the two become a superset,
   move it inside its capsule and only the order changes, pull it clear and it leaves. */
function useRoutineReorder(routineIdentity, exercises, onDrop) {
  const listRef = useRef(null)
  const svgRef = useRef(null)
  const gooRef = useRef(null)
  const engineRef = useRef(null)
  const gestureRef = useRef(null)
  const exercisesRef = useRef(exercises)
  const routineIdentityRef = useRef(routineIdentity)
  const onDropRef = useRef(onDrop)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef(null)
  const [drag, setDrag] = useState(null)
  exercisesRef.current = exercises
  routineIdentityRef.current = routineIdentity
  onDropRef.current = onDrop
  const hasRows = exercises.length > 0

  useEffect(() => () => {
    suppressClickRef.current = false
    window.clearTimeout(suppressTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    if (engineRef.current && engineRef.current.list !== list) { engineRef.current.destroy(); engineRef.current = null }
    if (!list) return
    if (!engineRef.current) {
      engineRef.current = createListEngine({
        list, svg: svgRef.current, goo: gooRef.current, getEntries: () => exercisesRef.current,
      })
      engineRef.current.list = list
    }
    engineRef.current.relayout()
  }, [hasRows, exercises])

  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { if (!gestureRef.current?.active) engineRef.current?.relayout() })
    ro.observe(list)
    return () => ro.disconnect()
  }, [hasRows])

  useEffect(() => () => { engineRef.current?.destroy(); engineRef.current = null }, [])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    let frame = null
    setDrag(current => current ? null : current)

    const clearFrame = () => {
      if (frame != null) window.cancelAnimationFrame(frame)
      frame = null
    }
    const clearTimers = gesture => {
      if (!gesture) return
      window.clearTimeout(gesture.timer); window.clearTimeout(gesture.unitTimer)
      gesture.timer = null; gesture.unitTimer = null
    }
    const matchesSnapshot = gesture => routineIdentityRef.current === gesture.routineIdentity
      && exercisesRef.current === gesture.listIdentity
      && JSON.stringify(exercisesRef.current) === gesture.snapshot
    // Every row still measurable: one vanishing mid-drag invalidates every position we compare.
    const rowsMeasurable = () => {
      const rows = list.querySelectorAll('[data-routine-row]')
      return rows.length === exercisesRef.current.length && [...rows].every(row => !!row.getBoundingClientRect())
    }
    const releaseCapture = gesture => {
      const target = gesture?.captureTarget
      if (!target?.releasePointerCapture) return
      try { target.releasePointerCapture(gesture.pointerId) } catch { /* already released */ }
    }
    const finish = (gesture, commit, x = gesture?.lastX, y = gesture?.lastY) => {
      if (!gesture || gestureRef.current !== gesture) return
      clearTimers(gesture)
      clearFrame()
      gestureRef.current = null
      if (!gesture.active) return
      releaseCapture(gesture)
      suppressClickRef.current = true
      window.clearTimeout(suppressTimerRef.current)
      // The compatibility click lands synchronously after pointerup; anything
      // later is a real tap, so the guard only needs to outlive that one event.
      suppressTimerRef.current = window.setTimeout(() => { suppressClickRef.current = false }, 150)
      setDrag(null)
      // Everything springs home — or, once the list re-renders in its new order, to its new place.
      engineRef.current?.release()
      const rect = list.getBoundingClientRect()
      const inside = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      if (commit && inside && gesture.intent && rowsMeasurable() && matchesSnapshot(gesture)) {
        onDropRef.current(gesture.index, gesture.intent)
      }
    }
    const updateDrag = (gesture, x, y, schedule = true) => {
      if (gestureRef.current !== gesture || !gesture.active || !matchesSnapshot(gesture) || !rowsMeasurable()) {
        if (gestureRef.current === gesture) finish(gesture, false)
        return
      }
      const b = engineRef.current?.base
      const src = b?.byIndex.get(gesture.index)
      const listRect = list.getBoundingClientRect()
      if (!b?.valid || !src || !listRect) { finish(gesture, false); return }
      gesture.lastX = x; gesture.lastY = y
      // The rows keep the positions measured at lift, relative to the list: a scroll moves the
      // list, not them, so only the finger has to be brought into the same frame.
      const moving = gesture.mode === 'unit' ? b.rows.filter(row => row.unit === src.unit) : [src]
      const top = Math.min(...moving.map(row => row.top))
      const bottom = Math.max(...moving.map(row => row.bottom))
      const raw = (y - listRect.top) - (gesture.grabY - gesture.grabListTop)
      // It may hang half out of the list, or the first and last places could only ever be
      // reached by landing on the exercise already there.
      const overhang = src.h / 2
      gesture.dy = clamp(raw, -top - overhang, Math.max(-top - overhang, b.height - bottom + overhang))
      let indicator
      let join = null
      if (gesture.mode === 'unit') {
        const units = rowUnits(b)
        const own = units.find(u => u.unit === src.unit)
        const others = units.filter(u => u !== own)
        const slot = dropSlot(others.map(u => u.cy), own.cy + gesture.dy)
        gesture.intent = { unit: slot }
        indicator = slot <= 0 ? (others[0]?.top ?? own.top)
          : slot >= others.length ? (others.at(-1)?.bottom ?? own.bottom)
            : (others[slot - 1].bottom + others[slot].top) / 2
      } else {
        const others = b.rows.filter(row => row !== src)
        const intent = dockIntent(others.map(row => ({ index: row.index, sg: row.sg, left: row.top, right: row.bottom })),
          src.cy + gesture.dy, src.sg)
        // The click under the thumb as the magnet takes hold, and again as it lets go.
        if (gesture.intent && intent.join !== gesture.intent.join) vibrate(8)
        if (intent.join != null && intent.join !== gesture.intent?.join) {
          gesture.previewFill = rowHsl(joinHue(exercisesRef.current, gesture.index, intent))
        }
        gesture.intent = intent
        join = intent.join
        indicator = intent.slot <= 0 ? (others[0]?.top ?? src.top)
          : intent.slot >= others.length ? (others.at(-1)?.bottom ?? src.bottom)
            : (others[intent.slot - 1].bottom + others[intent.slot].top) / 2
      }
      setDrag({ first: moving[0].index, last: moving.at(-1).index, join, indicatorTop: clamp(indicator, 0, b.height) })
      if (schedule && frame == null) frame = window.requestAnimationFrame(runAutoScroll)
    }
    function runAutoScroll() {
      frame = null
      const gesture = gestureRef.current
      if (!gesture?.active) return
      const step = autoScrollStep(gesture.scrollHost, gesture.lastY)
      if (!step) return
      if (gesture.scrollHost === window) window.scrollBy(0, step)
      else gesture.scrollHost.scrollTop += step
      updateDrag(gesture, gesture.lastX, gesture.lastY, false)
      if (gestureRef.current === gesture) frame = window.requestAnimationFrame(runAutoScroll)
    }
    const lift = gesture => {
      if (gestureRef.current !== gesture) return
      gesture.timer = null
      if (!matchesSnapshot(gesture) || !rowsMeasurable()) { finish(gesture, false); return }
      const engine = engineRef.current
      const b = engine?.remeasure()
      const src = b?.valid ? b.byIndex.get(gesture.index) : null
      const listRect = list.getBoundingClientRect()
      if (!src || !listRect) { finish(gesture, false); return }
      gesture.active = true
      gesture.mode = 'entry'
      gesture.grabY = gesture.lastY
      gesture.grabListTop = listRect.top
      gesture.scrollHost = scrollHostFor(list)
      gesture.captureTarget = gesture.downTarget
      try { gesture.captureTarget.setPointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      suppressClickRef.current = true
      window.clearTimeout(suppressTimerRef.current)
      vibrate(8)
      engine.drive((base, restOf) => listTargets(gesture, base, restOf))
      if (src.size > 1) gesture.unitTimer = window.setTimeout(() => liftUnit(gesture), ROUTINE_UNIT_PRESS_MS)
      updateDrag(gesture, gesture.lastX, gesture.lastY)
    }
    const liftUnit = gesture => {
      if (gestureRef.current !== gesture || !gesture.active) return
      gesture.unitTimer = null
      gesture.mode = 'unit'
      vibrate(15)
      updateDrag(gesture, gesture.lastX, gesture.lastY)
    }
    const onPointerDown = event => {
      // a new touch is intentional — never let the post-drop guard eat its click
      suppressClickRef.current = false
      window.clearTimeout(suppressTimerRef.current)
      const current = gestureRef.current
      if (current) {
        if (event.pointerId !== current.pointerId) finish(current, false)
        return
      }
      if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
      const target = event.target
      if (!target?.closest || target.closest('button,a,input,textarea,select,[data-nodrag]')) return
      const row = target.closest('[data-routine-row]')
      if (!row || !list.contains(row)) return
      const index = Number(row.dataset.exIndex)
      if (!Number.isInteger(index)) return
      const gesture = {
        pointerId: event.pointerId, index, downTarget: target, intent: null, mode: 'entry', dy: 0,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
        routineIdentity: routineIdentityRef.current,
        listIdentity: exercisesRef.current,
        snapshot: JSON.stringify(exercisesRef.current), active: false, timer: null, unitTimer: null,
      }
      gesture.timer = window.setTimeout(() => lift(gesture), ROUTINE_LONG_PRESS_MS)
      gestureRef.current = gesture
    }
    const onPointerMove = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (!gesture.active) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > ROUTINE_DRAG_SLOP) {
          clearTimers(gesture); gestureRef.current = null
        } else { gesture.lastX = event.clientX; gesture.lastY = event.clientY }
        return
      }
      // Moving off before the longer hold settles it: it is the one exercise that travels.
      if (gesture.unitTimer != null && Math.abs(event.clientY - gesture.grabY) > ROUTINE_DRAG_SLOP) {
        window.clearTimeout(gesture.unitTimer)
        gesture.unitTimer = null
      }
      event.preventDefault()
      updateDrag(gesture, event.clientX, event.clientY)
    }
    const onPointerUp = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (gesture.active) event.preventDefault()
      finish(gesture, gesture.active, event.clientX, event.clientY)
    }
    const onPointerCancel = event => {
      const gesture = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const onLostCapture = event => {
      const gesture = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const cancelActive = () => finish(gestureRef.current, false)
    const onKeyDown = event => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault(); cancelActive()
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancelActive() }
    const onContextMenu = event => { if (gestureRef.current?.active && event.target.closest?.('[data-routine-row]')) event.preventDefault() }
    const onDragStart = event => { if (event.target.closest?.('[data-routine-row]')) event.preventDefault() }

    // Touch: the rows keep `touch-action: pan-y` so the list still scrolls with a finger, but once
    // a long-press has lifted a row the browser must not claim the vertical drag as a pan — it
    // would fire pointercancel and scroll instead. preventDefault on a pointer event cannot stop
    // that; only a non-passive touchmove listener can, and only while a drag is actually active.
    const onTouchMove = event => { if (gestureRef.current?.active) event.preventDefault() }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerUp, { passive: false })
    document.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('lostpointercapture', onLostCapture)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)
    list.addEventListener('contextmenu', onContextMenu)
    list.addEventListener('dragstart', onDragStart)
    window.addEventListener('blur', cancelActive)
    return () => {
      const gesture = gestureRef.current
      clearTimers(gesture); clearFrame(); gestureRef.current = null
      releaseCapture(gesture)
      if (gesture?.active) engineRef.current?.release()
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('lostpointercapture', onLostCapture)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
      list.removeEventListener('contextmenu', onContextMenu)
      list.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('blur', cancelActive)
    }
  }, [hasRows, routineIdentity, exercises])

  const onClickCapture = event => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    window.clearTimeout(suppressTimerRef.current)
    event.preventDefault(); event.stopPropagation()
  }
  return { listRef, svgRef, gooRef, drag, onClickCapture }
}

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  // Editing here has no explicit "save" — every field change persists immediately. A single
  // auto-backup on the way out (not per keystroke) covers the whole editing session, deletion
  // included: this still unmounts after the delete button navigates away.
  useEffect(() => () => useStore.getState().autoBackupNow(), [])
  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  // A drop from the list or from the dock above it. Guarded before update so a drop that changes
  // nothing never persists or backs up.
  const dropEntry = (index, intent) => {
    if (!r || !dropRoutineEntry(r.ex.map(e => ({ ...e })), index, intent)) return
    edit(ex => { dropRoutineEntry(ex, index, intent) })
  }
  const reorder = useRoutineReorder(r, r?.ex || [], dropEntry)
  if (!r) return null
  const move = (i, dir) => {
    // Guard before update so a stale/boundary activation cannot trigger persistence or cleanup.
    if (!moveSupersetUnit(r.ex, i, dir)) return
    edit(ex => {
      const reordered = moveSupersetUnit(ex, i, dir)
      if (!reordered) return
      ex.splice(0, ex.length, ...reordered)
      cleanupSg(ex)
    })
  }
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })
  const configure = i => {
    const e = r.ex[i]
    if (!e) return
    exConfigSheet(exOr(e.id), e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }), r)
  }
  const addExercise = () => exercisePicker(ex => addExerciseToRoutine(ex, r, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) })))
  // Same choosing and configuring as adding one (its config from another routine, or seeded for
  // its class), but it lands in this row's place and superset. One pick, then back to the plan.
  const swapExercise = i => {
    const key = dockKeys(r.ex)[i]
    if (!key) return
    const picker = exercisePicker(ex => addExerciseToRoutine(ex, r, cfg => {
      picker.close()
      edit(x => { replaceRoutineEntry(x, key, ex.id, cfg) })
    }))
  }

  const units = supersetUnits(r.ex)
  const unitIndex = new Map(units.flatMap((unit, index) => unit.map(i => [i, index])))
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const unitLast = new Set(units.filter(u => u.length > 1).map(u => u.at(-1)))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  // Each superset in the colour its capsule has here and on the dock.
  const hueOf = new Map(dockItems(r.ex).flatMap(item => item.hue == null ? [] : item.indices.map(i => [i, item.hue])))
  const profile = activeProfile(S)
  const missingCount = profile ? r.ex.filter(e => !exAvailable(S, exOr(e.id))).length : 0

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      {(S.folders || []).length > 0 && <SelectRow icon="folder" title={t('Folder')} sheetTitle={t('Move to folder')}
        value={folderOf(S, r) || ''} onChange={v => update(s => { moveRoutineToFolder(s, id, v || null) })}
        options={[{ value: '', label: t('No folder') }, ...S.folders.map(f => ({ value: f.id, label: f.name }))]} />}
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
      <Row icon="pause" iconTint="var(--orange)" title={t('Exclude from automatic progression')}
        subtitle={t('Use for planned deloads. Workouts stay in history and statistics.')}>
        <Switch checked={r.excludeFromProgression === true} onChange={v => update(s => {
          const routine = s.routines.find(x => x.id === id)
          if (v) routine.excludeFromProgression = true
          else delete routine.excludeFromProgression
        })} />
      </Row>
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {r.excludeFromProgression
        ? t('The next regular target continues from the last included workout.')
        : t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>

    {missingCount > 0 && <div className="card" style={{ marginBottom: 16, borderColor: 'var(--orange)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="warning" style={{ color: 'var(--orange)' }} />
        <div className="small">{t('{0} of {1} exercises need equipment outside "{2}"', missingCount, r.ex.length, profile.name)}</div>
      </div>
    </div>}

    {/* The routine's running order as the session will show it: the same strip, magnets and
        liquid capsules. Hold a thumbnail to drag it, let go on another to superset the two,
        pull it clear of its capsule to leave; hold longer to carry the whole superset. */}
    <WorkoutDock className="routine-dock" entries={r.ex} cur={null}
      onSelect={configure} onReorder={dropEntry} onAdd={addExercise} />

    {r.ex.length ? <div ref={reorder.listRef} onClickCapture={reorder.onClickCapture}
      className={'list routine-list' + (reorder.drag ? ' is-reordering' : '')}>
      {/* The superset capsules, drawn as liquid behind the rows the way the dock draws its own:
          blurred together and cut back to a sharp edge, so a row pulled away stretches its
          capsule into a neck before it snaps. */}
      <svg className="routine-goo" ref={reorder.svgRef} aria-hidden="true">
        <defs>
          <filter id="routine-goo" filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="drop" />
            <feMorphology in="drop" operator="erode" radius="1.5" result="inner" />
            <feComposite in="drop" in2="inner" operator="out" result="ring" />
            <feComponentTransfer in="drop" result="fill"><feFuncA type="linear" slope="0.16" /></feComponentTransfer>
            <feComponentTransfer in="ring" result="edge"><feFuncA type="linear" slope="0.6" /></feComponentTransfer>
            <feMerge><feMergeNode in="fill" /><feMergeNode in="edge" /></feMerge>
          </filter>
        </defs>
        <g ref={reorder.gooRef} />
      </svg>
      {r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const noEquip = profile && !exAvailable(S, ex)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const isDragging = reorder.drag && i >= reorder.drag.first && i <= reorder.drag.last
      const hue = hueOf.get(i)
      return <div key={i} data-routine-row data-ex-index={i}
        className={'routine-drag-row' + (isDragging ? ' is-dragging' : '') + (reorder.drag?.join === i ? ' magnet' : '')
          + (unitFirst.has(i) && i > 0 ? ' ss-start' : '') + (unitLast.has(i) && i < r.ex.length - 1 ? ' ss-end' : '')}
        style={hue == null ? undefined : { '--ss': rowHsl(hue) }}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" />{t('Superset')}</div>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => configure(i)}>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{exerciseNameFor(ex)}</div><div className="ss">{exLine(e, S.unit)}</div>
            {e.note && <div className="small dim" style={{ marginTop: 2 }}>{e.note}</div>}</div>
          {noEquip && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }} title={t('Needs {0} — not in your active profile', t(ex.eq))}><Icon name="warning" /></span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 28, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
              <button className="iconbtn" aria-label={t('Swap exercise')} title={t('Swap exercise')} style={{ width: 28, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); swapExercise(i) }}><Icon name="shuffle" /></button>
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" aria-label={t('Move up')} title={t('Move up')} disabled={unitIndex.get(i) === 0} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label={t('Move down')} title={t('Move down')} disabled={unitIndex.get(i) === units.length - 1} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>
          </div>
        </div>
      </div>
    })}{reorder.drag && <div className={'routine-drop-indicator' + (reorder.drag.join != null ? ' join' : '')} data-testid="routine-drop-indicator"
      aria-hidden="true" style={{ top: `${reorder.drag.indicatorTop}px` }} />}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}</div>
    <Button variant="primary" onClick={addExercise} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}

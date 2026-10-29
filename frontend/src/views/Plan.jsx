import { useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { folderSheet, loadStarterPlan, planToolsSheet, ProgramSheet, startFlow } from '../sheets.jsx'
import { dropRoutine, groupRoutines, planDropIntent, planRows, toggleFolder } from '../lib/folders.js'
import Icon from '../components/Icon.jsx'
import MicrocycleActions from '../components/MicrocycleActions.jsx'

import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { autoScrollStep, createListEngine, listTargets, scrollHostFor } from '../components/routineMagnets.js'
import { ROUTINE_DRAG_SLOP, ROUTINE_LONG_PRESS_MS } from './RoutineEdit.jsx'
import { vibrate } from '../lib/sound.js'

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

/* Press and hold a routine to lift it, then drag it anywhere on the list: between two routines to
   reorder it, over a folder's header to file it there, below the loose ones to take it out. The
   rows ride the same springs as the plan editor's exercises (components/routineMagnets.js) — the
   lifted one follows the finger, its neighbours give way, a folder it hovers leans in to meet it
   and everything glides into its new place once it is let go. Every visible row (folder headers
   included) is one `[data-routine-row]`, numbered top to bottom in `data-ex-index`. */
function usePlanReorder(rows, onDrop) {
  const listRef = useRef(null)
  const engineRef = useRef(null)
  const gestureRef = useRef(null)
  const rowsRef = useRef(rows)
  const onDropRef = useRef(onDrop)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef(null)
  const [drag, setDrag] = useState(null)
  rowsRef.current = rows
  onDropRef.current = onDrop
  const hasRows = rows.length > 0
  // The engine keys its springs by entry id, so a row keeps its spring wherever it is drawn.
  const entries = useMemo(() => rows.map(row => ({ id: row.kind + ':' + row.id })), [rows])
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(() => () => {
    suppressClickRef.current = false
    window.clearTimeout(suppressTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    if (engineRef.current && engineRef.current.list !== list) { engineRef.current.destroy(); engineRef.current = null }
    if (!list) return
    if (!engineRef.current) {
      engineRef.current = createListEngine({ list, svg: null, goo: null, getEntries: () => entriesRef.current })
      engineRef.current.list = list
    }
    engineRef.current.relayout()
  }, [hasRows, entries])

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
    const matchesSnapshot = gesture => JSON.stringify(rowsRef.current) === gesture.snapshot
    // Every row still measurable: one vanishing mid-drag invalidates every position we compare.
    const rowsMeasurable = () => {
      const nodes = list.querySelectorAll('[data-routine-row]')
      return nodes.length === rowsRef.current.length && [...nodes].every(node => !!node.getBoundingClientRect())
    }
    const releaseCapture = gesture => {
      const target = gesture?.captureTarget
      if (!target?.releasePointerCapture) return
      try { target.releasePointerCapture(gesture.pointerId) } catch { /* already released */ }
    }
    const finish = (gesture, commit, x = gesture?.lastX) => {
      if (!gesture || gestureRef.current !== gesture) return
      window.clearTimeout(gesture.timer)
      clearFrame()
      gestureRef.current = null
      if (!gesture.active) return
      releaseCapture(gesture)
      suppressClickRef.current = true
      window.clearTimeout(suppressTimerRef.current)
      // The compatibility click lands synchronously after pointerup; the guard only has to outlive it.
      suppressTimerRef.current = window.setTimeout(() => { suppressClickRef.current = false }, 150)
      setDrag(null)
      // Everything springs home — or, once the list re-renders in its new order, to its new place.
      engineRef.current?.release()
      // Above or below the list still lands (the row is held at its first / last place); only a
      // finger taken off to the side calls it off.
      const rect = list.getBoundingClientRect()
      const inside = !!rect && x >= rect.left && x <= rect.right
      if (commit && inside && gesture.intent && rowsMeasurable() && matchesSnapshot(gesture)) {
        onDropRef.current(rowsRef.current[gesture.index].id, gesture.intent)
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
      // Positions are the ones measured at lift, relative to the list: a scroll moves the list,
      // not them, so only the finger is brought into that frame.
      const raw = (y - listRect.top) - (gesture.grabY - gesture.grabListTop)
      const overhang = src.h / 2
      gesture.dy = clamp(raw, -src.top - overhang, Math.max(-src.top - overhang, b.height - src.bottom + overhang))
      const others = b.rows.filter(row => row !== src)
      const placed = planDropIntent(others.map(row => ({ ...rowsRef.current[row.index], top: row.top, bottom: row.bottom })),
        src.cy + gesture.dy)
      // listTargets wants the folder it leans toward by its place in the whole list.
      const join = placed.join == null ? null : others[placed.join].index
      // The click under the thumb as a folder takes hold of it, and again as it lets go.
      if (gesture.intent && join !== gesture.intent.join) vibrate(8)
      gesture.intent = { ...placed, join }
      const indicator = placed.slot <= 0 ? (others[0]?.top ?? src.top)
        : placed.slot >= others.length ? (others.at(-1)?.bottom ?? src.bottom)
          : (others[placed.slot - 1].bottom + others[placed.slot].top) / 2
      setDrag({ index: gesture.index, join, indicatorTop: clamp(indicator, 0, b.height) })
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
      gesture.grabY = gesture.lastY
      gesture.grabListTop = listRect.top
      gesture.scrollHost = scrollHostFor(list)
      gesture.captureTarget = gesture.downTarget
      try { gesture.captureTarget.setPointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      suppressClickRef.current = true
      window.clearTimeout(suppressTimerRef.current)
      vibrate(8)
      engine.drive((base, restOf) => listTargets(gesture, base, restOf))
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
      // Only routines are lifted; a folder header is somewhere to drop one.
      const row = target.closest('[data-routine-row][data-plan-kind="routine"]')
      if (!row || !list.contains(row)) return
      const index = Number(row.dataset.exIndex)
      if (!Number.isInteger(index)) return
      const gesture = {
        pointerId: event.pointerId, index, downTarget: target, intent: null, mode: 'entry', dy: 0,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
        snapshot: JSON.stringify(rowsRef.current), active: false, timer: null,
      }
      gesture.timer = window.setTimeout(() => lift(gesture), ROUTINE_LONG_PRESS_MS)
      gestureRef.current = gesture
    }
    const onPointerMove = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (!gesture.active) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > ROUTINE_DRAG_SLOP) {
          window.clearTimeout(gesture.timer); gestureRef.current = null
        } else { gesture.lastX = event.clientX; gesture.lastY = event.clientY }
        return
      }
      event.preventDefault()
      updateDrag(gesture, event.clientX, event.clientY)
    }
    const onPointerUp = event => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (gesture.active) event.preventDefault()
      finish(gesture, gesture.active, event.clientX)
    }
    const onPointerCancel = event => {
      const gesture = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    // Only losing the capture *this* gesture took ends it (see useRoutineReorder in RoutineEdit:
    // the ScreenSlider and the lift itself each hand the pointer over once on the way).
    const onLostCapture = event => {
      const gesture = gestureRef.current
      if (!gesture?.active || event.pointerId !== gesture.pointerId) return
      if (event.target === gesture.captureTarget) finish(gesture, false)
    }
    const cancelActive = () => finish(gestureRef.current, false)
    const onKeyDown = event => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault(); cancelActive()
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancelActive() }
    const onContextMenu = event => { if (gestureRef.current?.active && event.target.closest?.('[data-routine-row]')) event.preventDefault() }
    const onDragStart = event => { if (event.target.closest?.('[data-routine-row]')) event.preventDefault() }
    // Once a row is lifted the browser must not claim the vertical drag as a pan.
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
      if (gesture) window.clearTimeout(gesture.timer)
      clearFrame(); gestureRef.current = null
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
  }, [hasRows, entries])

  const onClickCapture = event => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    window.clearTimeout(suppressTimerRef.current)
    event.preventDefault(); event.stopPropagation()
  }
  return { listRef, drag, onClickCapture }
}

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const { loose, folders } = groupRoutines(S)
  const rows = useMemo(() => planRows(S), [S.routines, S.folders])
  const rowAt = new Map(rows.map((row, i) => [row.kind + ':' + row.id, i]))
  // Tried on a copy first, so a drop back where it started never persists or syncs.
  const drop = (id, intent) => {
    const dry = { folders: (S.folders || []).map(f => ({ ...f })), routines: S.routines.map(r => ({ ...r })) }
    if (!dropRoutine(dry, id, intent)) return
    update(s => { dropRoutine(s, id, intent) })
  }
  const reorder = usePlanReorder(rows, drop)
  const rowProps = (kind, id) => {
    const i = rowAt.get(kind + ':' + id)
    return [(reorder.drag?.index === i ? ' is-dragging' : '') + (reorder.drag?.join === i ? ' magnet' : ''),
      { 'data-routine-row': '', 'data-plan-kind': kind, 'data-ex-index': i }]
  }
  // Start any routine straight from here. One session at a time: while one is running only its
  // own routine offers a way back into it (the tab bar's Resume does the same from anywhere).
  const startButton = r => {
    const running = S.active?.routineId === r.id
    if (S.active ? !running : !r.ex.length) return null
    const label = running ? t('Resume') : t('Start {0}', r.name)
    return <button className={'iconbtn plan-start' + (running ? ' rec' : '')} aria-label={label} title={label}
      onClick={e => {
        e.stopPropagation()
        if (running) { useUI.getState().resumeWorkout(); nav('/workout') } else startFlow(r.id)
      }}><Icon name="play" /></button>
  }
  const routineRow = r => {
    const [cls, attrs] = rowProps('routine', r.id)
    return <div key={r.id} className={'item' + cls} {...attrs} {...tappable(() => nav('/plan/r/' + r.id))}>
      <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
      <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      {startButton(r)}
      <Icon name="chevronRight" className="chev" /></div>
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <MicrocycleActions />
    <div className="cols"><div>
      <h4 className="sec">{t('Programming')}</h4>
      <div className="list" style={{ marginBottom: 6 }}>
        <div className="item" {...tappable(() => nav('/plan/generar'))}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="grow">
            <div className="tt">{t('Generate plan')}</div>
            <div className="ss">{t('Full body, Upper / Lower or Push / Pull / Legs, by movement pattern')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </div>

      <ProgramSheet />
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="tinted" icon="folder" onClick={() => folderSheet()} aria-label={t('New folder')} title={t('New folder')} />
          <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
        </div>
      </div>
      {S.routines.length || folders.length ? <div ref={reorder.listRef} onClickCapture={reorder.onClickCapture}
        className={'list plan-routines' + (reorder.drag ? ' is-reordering' : '')}>
        {folders.map(({ folder: f, routines }) => {
          const [cls, attrs] = rowProps('folder', f.id)
          return <div key={f.id} className={'folder' + (f.open ? ' open' : '')}>
            <div className={'item folder-hd' + cls} {...attrs} aria-expanded={!!f.open} {...tappable(() => update(s => toggleFolder(s, f.id)))}>
              <span className="lrow-i"><Icon name="folder" /></span>
              <div className="grow"><div className="tt">{f.name}</div>
                <div className="ss">{t(routines.length === 1 ? '{0} routine' : '{0} routines', routines.length)}</div></div>
              <button className="iconbtn" aria-label={t('Edit folder')} title={t('Edit folder')}
                onClick={e => { e.stopPropagation(); folderSheet(f) }}><Icon name="pencil" /></button>
              <Icon name={f.open ? 'chevronUp' : 'chevronDown'} className="chev" />
            </div>
            {f.open && <div className="list folder-body">
              {routines.length ? routines.map(routineRow)
                : <div className="small dim folder-empty">{t('Empty folder — open a routine and pick this folder, or add one from the folder menu.')}</div>}
            </div>}
          </div>
        })}
        {loose.map(routineRow)}
        {/* Where it would land; a folder it would go into lights up instead. */}
        {reorder.drag && reorder.drag.join == null && <div className="routine-drop-indicator" aria-hidden="true"
          style={{ top: `${reorder.drag.indicatorTop}px` }} />}
      </div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={() => nav('/plan/generar')}>{t('Generate plan')}</Button>
        <div style={{ height: 8 }} />
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}

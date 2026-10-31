import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { modeOf } from '../lib/history.js'
import { railItems, exerciseRecords, repMaxFor, sessionRoom, tabDropIntent, unitDropIntent } from '../lib/session-view.js'
import { dockItems, joinHue } from '../lib/workout-dock.js'
import { vibrate } from '../lib/sound.js'
import { REP_CAP } from '../lib/onerm.js'
import Icon from './Icon.jsx'
import { Thumb } from './Media.jsx'

/* The exercise's two records and what its best estimate says it could lift for each rep count.
   Read from history only; nothing here is logged. Shown under the exercise's arrow, beside its
   tools and tags, never on the screen by itself. */
function Records({ exId }) {
  const workouts = useStore(s => s.S.workouts)
  const unit = useStore(s => s.S.unit)
  const { maxWeight, maxReps } = useMemo(() => exerciseRecords({ workouts }, exId), [workouts, exId])
  const rm = useMemo(() => repMaxFor({ workouts }, exId), [workouts, exId])
  // Folded to its title by default; once opened it stays open from one exercise to the next
  // for the rest of the visit (UI state, not saved).
  const rmOpen = useUI(s => !!s.sessionRepMaxOpen)
  const toggleRm = () => useUI.setState(s => ({ sessionRepMaxOpen: !s.sessionRepMaxOpen }))
  const recs = maxWeight || maxReps ? <div className="sf-recs">
    {maxWeight && <div className="sf-rec">
      <div className="k"><span>{t('Max weight')}</span><Icon name="dumbbell" /></div>
      <div className="d">{fmtDate(maxWeight.d, false, true)}</div>
      <div className="v">{fmtNum(maxWeight.w)} {unit} <small>({t('{0} reps', maxWeight.r)})</small></div>
    </div>}
    {maxReps && <div className="sf-rec">
      <div className="k"><span>{t('Max reps')}</span><Icon name="bolt" /></div>
      <div className="d">{fmtDate(maxReps.d, false, true)}</div>
      <div className="v">{t('{0} reps', maxReps.r)}{maxReps.w > 0 && <small> ({fmtNum(maxReps.w)} {unit})</small>}</div>
    </div>}
  </div> : null
  // Without an estimate there is no table to fold, so the two records stand on their own.
  if (!rm.length) return recs
  // The records open with the estimate: its title is the only line until it is tapped.
  return <div className="sf-rm">
    <button type="button" className="k" aria-expanded={rmOpen} onClick={toggleRm}>
      <span>{t('Rep max @ {0}', unit)}</span><Icon name={rmOpen ? 'chevronUp' : 'chevronDown'} />
    </button>
    {rmOpen && <>
      {recs}
      <div className="g">
        {rm.map(row => <span key={row.r} className={row.rough ? 'rough' : ''}
          title={row.rough ? t('Rough estimate past {0} reps', REP_CAP) : undefined}>
          {row.r} @ <b>{fmtNum(row.w)}</b>
        </span>)}
      </div>
    </>}
  </div>
}

// Hold a tab this long and it lifts (the dock's press-and-hold); held on, a superset's whole unit
// lifts with it. Moving further than DRAG_SLOP first is a scroll of the list, not a drag.
const LONG_PRESS_MS = 380
const UNIT_PRESS_MS = 420
const DRAG_SLOP = 8
// How close to the list's top or bottom a drag has to get before the list scrolls itself along.
const EDGE = 44
const SCROLL_STEP = 12
const LIFT_SCALE = 1.06

// Each tab's place in the list's own coordinates. offsetTop ignores the transforms a drag adds and
// does not move with the list's scroll, so the comparison holds wherever the list has been scrolled.
function tabSpans(nav) {
  return [...nav.querySelectorAll('.sf-tab[data-exidx]')].map(el => ({
    index: Number(el.dataset.exidx), top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight,
  }))
}

/* The "Session" view: every exercise of the workout as a tab down the left — its thumbnail, with
   a coloured bar joining the members of each superset (the dock's colours) — and beside them the
   panel of the unit being worked, joined to its tabs. The tabs stay on screen while the panel
   scrolls; a tap on one moves the session there, as tapping it in the dock does, and the panel
   slides in from the side of the session it comes from. Tabs can be reordered the way the dock
   reorders them: press and hold to lift one, let go over another to join its superset, in a gap
   to take that place. The sets are the same ExerciseBlock the other views draw (`renderBlock`),
   so logging works the same in all of them. */
export default function SessionFlow({ entries, cur, renderBlock, onSelect, onReorder, disabled, onToggleHead, headOpen, bindExRef }) {
  const rail = railItems(entries, cur)
  const members = rail.filter(item => item.current).map(item => item.idx)
  const open = rail.find(item => item.current)
  const unit = open?.unit ?? 0
  // Which way the panel comes in: from below moving on through the session, from above going back.
  const lastUnit = useRef(unit)
  const dir = unit === lastUnit.current ? 0 : unit > lastUnit.current ? 1 : -1
  useEffect(() => { lastUnit.current = unit }, [unit])

  // The tabs stick under the session header, whose height changes as it folds; the panel is at
  // least as tall as the tabs, so the open tab always has a panel edge to join.
  // The page is only as long as its content, so the room under the panel (`--sf-room`) is what
  // lets the last card come up under the header as the others do (Workout scrolls the card in
  // front to the top). It is worked out from positions that do not include that room itself.
  const railEl = useRef(null)
  const panelEl = useRef(null)
  const sflowEl = useRef(null)
  const [geom, setGeom] = useState({ top: 0, rail: 0, room: 0 })
  const measure = () => {
    const head = document.querySelector('.wtop')
    const top = head ? head.offsetHeight : 0
    const rail = railEl.current ? railEl.current.scrollHeight : 0
    const sflow = sflowEl.current, panel = panelEl.current, last = panel?.lastElementChild
    let room = 0
    if (sflow && panel && last) {
      const page = window.scrollY || 0
      room = sessionRoom({
        cardTop: last.getBoundingClientRect().top + page,
        panelBottom: panel.getBoundingClientRect().bottom + page,
        belowSession: document.documentElement.scrollHeight - (sflow.getBoundingClientRect().bottom + page),
        viewport: window.innerHeight,
        header: top,
      })
    }
    const next = { top, rail, room: Math.ceil(room) }
    setGeom(g => (g.top === next.top && g.rail === next.rail && g.room === next.room ? g : next))
  }
  // Heights move with the sets (a drop, a folded head, a superset's partner): measured after each render.
  useLayoutEffect(() => { measure() })
  useLayoutEffect(() => {
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const el of [document.querySelector('.wtop'), document.querySelector('.wfoot'), railEl.current, sflowEl.current]) {
      if (el) ro?.observe(el)
    }
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [entries.length])
  // A long session's tabs scroll on their own: keep the one being worked in sight.
  useEffect(() => {
    const box = railEl.current
    const tab = box?.querySelector('.sf-tab.cur')
    if (!box || !tab) return
    if (tab.offsetTop < box.scrollTop) box.scrollTop = tab.offsetTop - 4
    else if (tab.offsetTop + tab.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = tab.offsetTop + tab.offsetHeight - box.clientHeight + 4
  }, [cur])

  // A drag in progress: which tabs are lifted and how far, the tab a drop would join, the gap it
  // would open and how far the neighbours lean toward it. Null whenever nothing is dragged.
  const [drag, setDrag] = useState(null)
  const gestureRef = useRef(null)
  const suppressClick = useRef(false)
  const entriesRef = useRef(entries)
  const onReorderRef = useRef(onReorder)
  const disabledRef = useRef(disabled)
  entriesRef.current = entries
  onReorderRef.current = onReorder
  disabledRef.current = disabled

  // The dock's gestures on this column: press and hold a tab to lift it, drag it up or down the
  // list, and let go over another tab to join its superset or in a gap to take that place.
  // Listeners are attached once and read the latest props through refs.
  useEffect(() => {
    const nav = railEl.current
    if (!nav) return undefined
    let frame = null
    const stopFrame = () => { if (frame != null) window.cancelAnimationFrame(frame); frame = null }

    const finish = (g, commit) => {
      if (!g || gestureRef.current !== g) return
      window.clearTimeout(g.timer)
      window.clearTimeout(g.unitTimer)
      stopFrame()
      gestureRef.current = null
      if (!g.active) return
      setDrag(null)
      // The click that follows the release must not also count as a tap on the tab under the finger.
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 150)
      if (commit && g.intent && g.entries === entriesRef.current && !disabledRef.current) {
        onReorderRef.current?.(g.index, g.intent)
      }
    }
    // Where the held tab (or superset) is now, and what letting go would do there.
    const aim = g => {
      const spans = tabSpans(nav)
      const y = g.lastClientY - nav.getBoundingClientRect().top + nav.scrollTop
      const aimed = g.mode === 'unit'
        ? unitDropIntent(entriesRef.current, g.unitIndices, y, spans)
        : tabDropIntent(entriesRef.current, g.index, y, spans)
      if (aimed.join != null && aimed.join !== g.join) vibrate(8)
      g.join = aimed.join
      g.intent = aimed.intent
      const dy = y - g.grabY
      // Joining shows the superset it would make: a bar in the colour the dock would give it,
      // running from the tab it is held over to the one being dragged.
      let joinSpan = null
      if (aimed.join != null && g.mode !== 'unit') {
        const target = spans.find(span => span.index === aimed.join)
        const own = spans.find(span => span.index === g.index)
        if (target && own) {
          const hue = joinHue(entriesRef.current, g.index, aimed.intent)
          joinSpan = { top: Math.min(target.top, own.top + dy), bottom: Math.max(target.bottom, own.bottom + dy), hue }
        }
      }
      setDrag({
        lifted: g.mode === 'unit' ? g.unitIndices : [g.index], dy,
        join: aimed.join, markerY: aimed.markerY, leans: aimed.leans, joinSpan,
      })
    }
    // Near either end of the list, keep scrolling it while the drag is held there.
    const scrollStep = g => {
      frame = null
      if (!g.active || gestureRef.current !== g) return
      const rect = nav.getBoundingClientRect()
      const max = nav.scrollHeight - nav.clientHeight
      let step = 0
      if (g.lastClientY < rect.top + EDGE && nav.scrollTop > 0) step = -SCROLL_STEP
      else if (g.lastClientY > rect.bottom - EDGE && nav.scrollTop < max) step = SCROLL_STEP
      if (!step) return
      nav.scrollTop += step
      aim(g)
      frame = window.requestAnimationFrame(() => scrollStep(g))
    }
    const liftUnit = g => {
      if (gestureRef.current !== g || !g.active) return
      g.mode = 'unit'
      vibrate(15)
      aim(g)
    }
    const lift = g => {
      if (gestureRef.current !== g) return
      g.active = true
      g.mode = 'entry'
      g.grabClientY = g.lastClientY
      g.grabY = g.lastClientY - nav.getBoundingClientRect().top + nav.scrollTop
      g.unitIndices = dockItems(entriesRef.current).find(item => item.indices.includes(g.index))?.indices ?? [g.index]
      if (g.unitIndices.length > 1) g.unitTimer = window.setTimeout(() => liftUnit(g), UNIT_PRESS_MS)
      suppressClick.current = true
      vibrate(8)
      aim(g)
    }

    const onDown = event => {
      if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
      if (gestureRef.current || disabledRef.current) return
      const el = event.target.closest?.('.sf-tab[data-exidx]')
      if (!el || !nav.contains(el)) return
      const g = {
        pointerId: event.pointerId, index: Number(el.dataset.exidx), startY: event.clientY,
        lastClientY: event.clientY, active: false, mode: 'entry', entries: entriesRef.current,
        intent: null, join: null, grabY: 0, grabClientY: 0, unitIndices: [], timer: null, unitTimer: null,
      }
      g.timer = window.setTimeout(() => lift(g), LONG_PRESS_MS)
      gestureRef.current = g
    }
    const onMove = event => {
      const g = gestureRef.current
      if (!g || event.pointerId !== g.pointerId) return
      g.lastClientY = event.clientY
      if (!g.active) {
        // Moved before the hold completed: that was a scroll of the list, not a drag.
        if (Math.abs(event.clientY - g.startY) > DRAG_SLOP) {
          window.clearTimeout(g.timer)
          gestureRef.current = null
        }
        return
      }
      // Moving off before the longer hold settles it: the one tab travels, not its superset.
      if (g.unitTimer != null && Math.abs(event.clientY - g.grabClientY) > DRAG_SLOP) {
        window.clearTimeout(g.unitTimer)
        g.unitTimer = null
      }
      event.preventDefault()
      if (g.entries !== entriesRef.current) { finish(g, false); return }
      aim(g)
      const rect = nav.getBoundingClientRect()
      if (frame == null && (event.clientY < rect.top + EDGE || event.clientY > rect.bottom - EDGE)) {
        frame = window.requestAnimationFrame(() => scrollStep(g))
      }
    }
    const onUp = event => {
      const g = gestureRef.current
      if (!g || event.pointerId !== g.pointerId) return
      if (g.active) event.preventDefault()
      finish(g, g.active)
    }
    const onCancel = event => {
      const g = gestureRef.current
      if (g && event.pointerId === g.pointerId) finish(g, false)
    }
    const onKeyDown = event => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault()
      finish(gestureRef.current, false)
    }
    // Once a tab is lifted the browser must not also pan the list under the finger. Only a
    // non-passive listener can stop that, and only while a drag is running.
    const onTouchMove = event => { if (gestureRef.current?.active) event.preventDefault() }
    const onDragStart = event => { if (event.target.closest?.('.sf-tab')) event.preventDefault() }

    nav.addEventListener('pointerdown', onDown)
    nav.addEventListener('dragstart', onDragStart)
    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp, { passive: false })
    document.addEventListener('pointercancel', onCancel)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      const g = gestureRef.current
      window.clearTimeout(g?.timer)
      window.clearTimeout(g?.unitTimer)
      stopFrame()
      gestureRef.current = null
      nav.removeEventListener('pointerdown', onDown)
      nav.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  // A tap that ended a drag is not a tap on whatever tab the finger ended over.
  const onClickCapture = event => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return <div className="sflow" data-testid="session-flow" ref={sflowEl} onClickCapture={onClickCapture}
    style={{ '--sf-top': geom.top + 'px', '--sf-rail': geom.rail + 'px', '--sf-room': geom.room + 'px' }}>
    <nav className="sf-tabs" ref={railEl} aria-label={t('Exercises')}>
      {rail.map((item, k) => {
        const ex = exOr(entries[item.idx].id)
        const name = exerciseNameFor(ex)
        // The open tabs are one piece with the panel: the first and the last of them round off
        // and curve into its edge (.sf-cn), the ones between run straight on.
        const top = item.current && !rail[k - 1]?.current
        const bot = item.current && !rail[k + 1]?.current
        const lifted = !!drag?.lifted.includes(item.idx)
        const cls = 'sf-tab ' + item.pos + (item.current ? ' on' : '') + (top ? ' on-top' : '') + (bot ? ' on-bot' : '')
          + (item.idx === cur ? ' cur' : '') + (item.done ? ' done' : '')
          + (lifted ? ' lifted dragging' : '') + (drag?.join === item.idx ? ' magnet' : '')
        // The lifted tab follows the finger; the neighbours of the gap it would open lean toward it.
        const lean = drag?.leans?.[item.idx]
        const move = lifted ? `translateY(${drag.dy}px) scale(${LIFT_SCALE})` : lean ? `translateY(${lean}px)` : null
        const style = { ...(item.hue != null ? { '--ss': `hsl(${item.hue},70%,55%)` } : {}), ...(move ? { transform: move } : {}) }
        return <button key={item.idx} type="button" className={cls} data-exidx={item.idx} aria-label={name} title={name}
          aria-current={item.idx === cur ? 'step' : undefined} style={style}
          onClick={() => onSelect(item.idx)}>
          {top && k > 0 && <i className="sf-cn t" />}
          <span className="sf-th"><Thumb ex={ex} /></span>
          {item.done && <span className="sf-ok"><Icon name="check" /></span>}
          {bot && <i className="sf-cn b" />}
        </button>
      })}
      {drag && drag.join == null && drag.markerY != null && <div className="sf-marker" data-testid="session-marker"
        aria-hidden="true" style={{ top: drag.markerY + 'px' }} />}
      {drag?.joinSpan && <div className="sf-join" data-testid="session-join" aria-hidden="true"
        style={{ top: drag.joinSpan.top + 'px', height: drag.joinSpan.bottom - drag.joinSpan.top + 'px', '--ss': `hsl(${drag.joinSpan.hue},70%,55%)` }} />}
    </nav>
    {/* Square where the open tab meets it at the very top, so the two read as one shape. */}
    <div key={members.join(',')} ref={panelEl} className={'sf-panel' + (rail[0]?.current ? ' flush' : '')} data-dir={dir}
      style={open?.hue != null ? { '--ss': `hsl(${open.hue},70%,55%)` } : undefined}>
      {members.map(idx => {
        const entry = entries[idx]
        const name = exerciseNameFor(exOr(entry.id))
        const reps = modeOf({ ...(entry.target || {}), id: entry.id }) === 'reps'
        return <div key={idx} className={'sf-card' + (idx === cur ? ' cur' : '')} data-exidx={idx} ref={el => bindExRef(entry, el)}>
          <div className="sf-head">
            <button type="button" className="exhead-tg" aria-expanded={headOpen(idx)} onClick={() => onToggleHead(idx)}>
              <span>{name}</span>
              <Icon name={headOpen(idx) ? 'chevronUp' : 'chevronDown'} className="exhead-chev" />
            </button>
          </div>
          {/* The records ride along with the arrow's tools and tags (see ExerciseBlock's `marks`),
              so they show only once that arrow is open, and only for a rep-based exercise. */}
          {renderBlock(idx, reps ? <Records exId={entry.id} /> : null)}
        </div>
      })}
    </div>
  </div>
}

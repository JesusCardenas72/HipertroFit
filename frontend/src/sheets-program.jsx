// The Programming sheet: the microcycle laid out as a sequence of routine and rest days, its
// strategy and start, with the volume it plans per group. Split out of sheets.jsx, which
// re-exports everything public here, so importers keep using './sheets.jsx'.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { todayISO, DAYN, DAYS } from './lib/format.js'
import { programMode, emptyProgram, sessionsPerRound, mondayOf, weekSequence, SEQ_CYCLE, SEQ_WEEK, REST } from './lib/program.js'
import { STRATEGIES, microcycleLen, strategyOf, cyclePosition } from './lib/microcycle.js'
import { plannedVolume } from './lib/volume.js'
import VolumeGroupBars from './components/VolumeGroupBars.jsx'
import { microNumber } from './lib/mesocycle.js'
import { upcomingDays } from './lib/history.js'
import { t } from './lib/i18n.js'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Segmented, SelectRow, Row, DateField } from './components/ui.jsx'
import { glyphOf } from './lib/glyphs.js'
import { groupRoutines, toggleFolderInSequence } from './lib/folders.js'
import { dropActiveWorkoutEntry } from './lib/active-workout-order.js'
import { useRoutineReorder } from './views/RoutineEdit.jsx'
import { calendarSheet, dayOverrideSheet } from './sheets.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()

/* ============================ calendar programming ============================ */
// Build the microcycle as a repeating sequence of training/rest days and project it onto the
// calendar. Every mutation writes straight to S.program so the week strip, the calendar and the
// volume window all update live. See lib/program.js.
export function ProgramSheet({ close = () => {}, layout }) {
  const st = useStore(s => s.S)
  const prog = st.program
  const seq = (prog && prog.seq) || []
  const anchor = (prog && prog.anchor) || todayISO()
  const strategy = strategyOf(st)
  const len = microcycleLen(st)
  const pos = cyclePosition(st)
  const routine = id => st.routines.find(r => r.id === id)
  const planned = plannedVolume(st)

  const mut = fn => update(s => { if (!s.program) s.program = emptyProgram(todayISO()); fn(s.program) })
  // A weekday program keeps seven fixed slots: adding fills the first free day, removing frees it.
  const addStep = v => mut(p => {
    if (programMode(p) !== SEQ_WEEK) { p.seq = [...p.seq, v]; return }
    const free = p.seq.indexOf(REST)
    if (free >= 0) p.seq = p.seq.map((step, j) => j === free ? v : step)
  })
  const removeStep = i => mut(p => {
    if (programMode(p) === SEQ_WEEK) p.seq = p.seq.map((step, j) => j === i ? REST : step)
    else p.seq = p.seq.filter((_, j) => j !== i)
  })
  // One date for both jobs: where the calendar projection starts drawing, and where the
  // session count starts counting. "The start of a microcycle" is exactly that day.
  const setAnchor = v => { if (v) mut(p => { p.anchor = v; p.cycleStart = v }) }
  const setStrategy = v => mut(p => { p.strategy = v })
  const setMicro = n => update(s => { s.microcycleSessions = Math.max(1, Math.round(n) || 1) })
  // Switching keeps each layout's own sequence and anchor, so going back restores the cycle.
  // A weekday program is seven steps taken from the weekly plan, anchored on this week's Monday.
  const setMode = v => mut(p => {
    if (programMode(p) === v) return
    if (v === SEQ_WEEK) {
      p.cycleSeq = p.seq; p.cycleAnchor = p.anchor
      p.seq = weekSequence(st.week); p.mode = SEQ_WEEK
      p.anchor = mondayOf(todayISO()); p.cycleStart = p.anchor
    } else {
      p.seq = p.cycleSeq || []; p.mode = SEQ_CYCLE
      p.anchor = p.cycleAnchor || todayISO(); p.cycleStart = p.anchor
      delete p.cycleSeq; delete p.cycleAnchor
    }
  })
  const mode = programMode(prog)

  const glyphFor = step => step === REST ? 'moon' : glyphOf((routine(step) || {}).emoji)
  const labelFor = step => step === REST ? t('Rest day') : (routine(step) ? routine(step).name : t('Deleted routine'))

  // Next 14 days as the app will actually schedule them — program, per-day overrides and the
  // weekly plan all folded in — so the strip is the real projection.
  const preview = upcomingDays(st, 14)

  const { loose, folders } = groupRoutines(st)
  const folderGroups = folders.filter(g => g.routines.length)
  // Week mode: a routine chip dragged onto a weekday takes that day, replacing its workout. A plain
  // tap still places it on the first free day.
  const chipGestureRef = useRef(null)
  const chipDroppedRef = useRef(false)
  const [chipDrag, setChipDrag] = useState(null)
  const dayIndexAt = (x, y) => {
    const row = document.elementFromPoint(x, y)?.closest('[data-routine-row]')
    return row ? Number(row.dataset.exIndex) : null
  }
  const setDay = (i, v) => mut(p => { p.seq = p.seq.map((step, j) => j === i ? v : step) })
  const chipGesture = r => ({
    onPointerDown: e => {
      chipDroppedRef.current = false
      if (mode !== SEQ_WEEK || e.button > 0) return
      // The grab point inside the chip: the carried chip keeps it under the finger.
      const box = e.currentTarget.getBoundingClientRect()
      chipGestureRef.current = { id: r.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false,
        ox: e.clientX - box.left, oy: e.clientY - box.top }
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer no longer active */ }
    },
    onPointerMove: e => {
      const g = chipGestureRef.current
      if (!g || g.pointerId !== e.pointerId) return
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 8) return
      g.moved = true
      setChipDrag({ id: g.id, x: e.clientX, y: e.clientY, left: e.clientX - g.ox, top: e.clientY - g.oy,
        over: dayIndexAt(e.clientX, e.clientY) })
    },
    onPointerUp: e => {
      const g = chipGestureRef.current
      if (!g || g.pointerId !== e.pointerId) return
      chipGestureRef.current = null
      setChipDrag(null)
      if (!g.moved) return
      chipDroppedRef.current = true
      const day = dayIndexAt(e.clientX, e.clientY)
      if (day != null) setDay(day, g.id)
    },
    onPointerCancel: () => { chipGestureRef.current = null; setChipDrag(null) },
  })
  const addChip = r => <button key={r.id} className={'chip' + (chipDrag?.id === r.id ? ' is-origin' : '')} style={mode === SEQ_WEEK ? { touchAction: 'none' } : null} {...chipGesture(r)}
    onClick={() => { if (chipDroppedRef.current) { chipDroppedRef.current = false; return } addStep(r.id) }}>
    <Icon name={glyphOf(r.emoji)} />{r.name}</button>

  // The sequence is drag-to-reorder like the routine editor's rows. A step can repeat, so each
  // one's id counts its occurrences; the drop itself is a plain move (no supersets here).
  const items = useMemo(() => {
    const seen = new Map()
    return seq.map(step => {
      const n = (seen.get(step) || 0) + 1
      seen.set(step, n)
      return { id: step + '#' + n, step }
    })
  }, [seq])
  const reorder = useRoutineReorder('program-sequence', items, (index, intent) => {
    const copy = items.map(item => ({ ...item }))
    if (!dropActiveWorkoutEntry({ entries: copy, cur: 0 }, index, { slot: intent.slot })) return
    mut(p => { p.seq = copy.map(item => item.step) })
  })
  // While a chip is carried over the week, the day under it leans toward the finger on the same
  // springs the rows use; the rest of the week keeps its places until it lets go.
  useEffect(() => {
    const engine = reorder.engineRef.current
    const list = reorder.listRef.current
    if (!engine || !list) return
    if (!chipDrag) { engine.release(); return }
    // Measure the rows as they are drawn now: the list may have re-rendered since the last measure.
    engine.relayout()
    const pointerY = (chipDrag.y - list.getBoundingClientRect().top) / (engine.base?.zoom || 1)
    engine.drive((base, restOf) => new Map(base.rows.map(row => {
      const target = restOf(row)
      if (row.index !== chipDrag.over) return [row.key, target]
      return [row.key, { ...target, y: Math.max(-14, Math.min(14, (pointerY - row.cy) * 0.3)), s: 1.04 }]
    })))
  }, [chipDrag])
  // The carried chip is placed in the list's own frame, so the sheet's transforms do not move it.
  const listBox = reorder.listRef.current?.getBoundingClientRect() || { left: 0, top: 0 }

  const programming = <>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Lay your microcycle out as a repeating sequence of training and rest days. From the start date it is what Home, the calendar and the reminders show.')}</div>

    {/* Planned sets per muscle group for one microcycle, recounted on every sequence edit —
        the same bars as the Home/Stats volume card, fed by the plan instead of the log. */}
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Planned microcycle volume')}</h2>
        <span className="small muted">{t('{0} sessions / microcycle', planned.sessions)}</span>
      </div>
      {planned.total
        ? <VolumeGroupBars vol={planned} title={false} isPlan />
        : <div className="muted small">{t('Add routines to the sequence to see the sets it plans per muscle group.')}</div>}
    </div>
  </>

  const sequence = <>
    <h4 className="sec">{t('Day sequence')}</h4>
    <Segmented className="seg-mode" value={mode} onChange={setMode}
      options={[{ value: SEQ_CYCLE, label: t('Numeric cycle') }, { value: SEQ_WEEK, label: t('Weekdays') }]} />
    <div className="muted small" style={{ margin: '8px 0 10px' }}>
      {mode === SEQ_WEEK ? t('Drag a routine to another weekday to move it. Each day has a fixed slot and the week starts on Monday.') : t('The sequence repeats from the start date, one step per day.')}
    </div>
    <>
    {seq.length ? <div ref={reorder.listRef} onClickCapture={reorder.onClickCapture}
      className={'prog-seq routine-list' + (reorder.drag ? ' is-reordering' : '')}>
      {items.map(({ id, step }, i) => <div key={id} data-routine-row data-ex-index={i}
        className={'prog-step routine-drag-row' + (step === REST ? ' rest' : '') + (reorder.drag && i >= reorder.drag.first && i <= reorder.drag.last ? ' is-dragging' : '') + (chipDrag?.over === i ? ' is-drop' : '')}>
        <span className="n" style={mode === SEQ_WEEK ? { width: 'auto', minWidth: 16, whiteSpace: 'nowrap' } : null}>{mode === SEQ_WEEK ? t(DAYN[(i + 1) % 7]) : i + 1}</span>
        <span className="lrow-i" style={step === REST ? { background: 'var(--surface-3)' } : null}><Icon name={glyphFor(step)} /></span>
        <span className="grow tt">{labelFor(step)}</span>
        <button className="iconbtn danger" style={{ width: 28, height: 28, fontSize: 12, flex: 'none' }} onClick={() => removeStep(i)} aria-label={t('Remove')}><Icon name="xmark" /></button>
      </div>)}
      {reorder.drag && <div className="routine-drop-indicator" aria-hidden="true" style={{ top: `${reorder.drag.indicatorTop}px` }} />}
      {chipDrag && <div className="prog-ghost" aria-hidden="true"
        style={{ left: `${chipDrag.left - listBox.left}px`, top: `${chipDrag.top - listBox.top}px` }}>
        <span className="chip">
          <Icon name={glyphOf(st.routines.find(r => r.id === chipDrag.id)?.emoji)} />{st.routines.find(r => r.id === chipDrag.id)?.name}
        </span>
      </div>}
    </div> :<div className="empty small" style={{ padding: '10px 0' }}>{t('Add routines and rest days below to build the sequence.')}</div>}

    {/* Routines grouped under their folders when there are any; loose ones follow. */}
    <div className="prog-add">
      {folderGroups.map(({ folder, routines }) => <div key={folder.id} className="prog-group">
        <button type="button" className="prog-group-name" aria-expanded={!folder.seqClosed}
          onClick={() => update(s => toggleFolderInSequence(s, folder.id))}>
          <Icon name="folder" /><span className="grow">{folder.name}</span>
          <Icon name={folder.seqClosed ? 'chevronDown' : 'chevronUp'} />
        </button>
        {!folder.seqClosed && <div className="prog-add">{routines.map(addChip)}</div>}
      </div>)}
      {loose.map(addChip)}
      {mode !== SEQ_WEEK && <button className="chip" onClick={() => addStep(REST)}><Icon name="moon" />{t('Rest')}</button>}
    </div>
    </>

    {mode === SEQ_CYCLE && <>
    <h4 className="sec" style={{ marginTop: 18 }}>{t('Microcycle start')}</h4>
    {/* Typed by hand, or picked on the calendar. */}
    <DateField value={anchor} onChange={setAnchor} />
    <div className="muted small" style={{ marginTop: 6 }}>
      {t('Sessions are counted from this day. A microcycle is complete with its last session and ends once its rest days have passed.')}
    </div>
    </>}

    <div className="list" style={{ marginTop: 14 }}>
      <SelectRow icon="target" title={t('Training strategy')} value={strategy}
        options={STRATEGIES.map(x => ({ value: x.key, label: t(x.name) }))} onChange={setStrategy} />
      <Row title={t('Sessions per microcycle')}
        subtitle={strategy === 'custom' ? t('Counted from your sequence') : t('Set by the strategy')}>
        {strategy === 'custom' && !sessionsPerRound(prog)
          ? <Stepper value={len} step={1} decimal={false} onChange={setMicro} />
          : <span className="v" style={{ fontWeight: 600 }}>{len}</span>}
      </Row>
      <Row title={t('Microcycle')} subtitle={pos.complete ? t('Complete — {0} of {1} sessions', pos.sessions, pos.len) : t('Session {0} of {1}', pos.step + 1, pos.len)}>
        <span className="v" style={{ fontWeight: 600 }}>#{microNumber(st, pos.cycle)}</span>
      </Row>
    </div>

    <h4 className="sec" style={{ marginTop: 18 }}>{t('Next 14 days')}</h4>
    <div className="prog-prev">
      {preview.map(p => <button key={p.iso} className={'prog-day' + (p.iso === todayISO() ? ' today' : '')} onClick={() => { close(); dayOverrideSheet(p.iso) }}>
        <span className="wd">{t(DAYS[p.wd])}</span>
        <span className="dn">{p.dn}</span>
        <span className="lrow-i sm" style={p.r ? null : { background: 'var(--surface-3)' }}><Icon name={p.r ? glyphOf(p.r.emoji) : 'moon'} /></span>
      </button>)}
    </div>
    <div style={{ marginTop: 12 }}>
      <Button icon="calendar" onClick={() => { close(); calendarSheet() }}>{t('Open calendar')}</Button>
    </div>
  </>

  // The Plan screen lays the two parts out in its own sections; as a sheet they go one after the other.
  if (layout) return layout(programming, sequence)
  return <>
    <h3>{t('Programming')}</h3>
    {programming}
    {sequence}
  </>
}
export const programSheet = () => ui().openSheet(close => <ProgramSheet close={close} />)

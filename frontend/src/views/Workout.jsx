import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, buildSets, freestyleConfig, defaultConfig, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, effortOf, cascadeWeight, insertWarmupRow, removeRowAt, pairAdjacent, unpairSuperset, cleanupSg, applyIntensifierPlan } from '../lib/history.js'
import { fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { insertionAfterEntry, insertionIndexAfterCurrentUnit, markResumeAt, nextUnfinishedUnit, resumeEntryIdx, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, restSecAfterSet, unitEntryIdx } from '../lib/supersetFlow.js'
import { exerciseRestChoice, restBetweenExercisesSec } from '../lib/rest-between.js'
import { sessionHasRestPicks } from '../lib/session-rest.js'
import { Thumb } from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, sessionNoteSheet, swapActiveWorkoutExercise, pauseWorkout, resumePausedWorkout, discardPausedWorkout } from '../sheets.jsx'
import { resumableOf } from '../lib/paused-workout.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { nextPrescription, applyPrescription, loadScaleFor } from '../lib/progression.js'
import { ladderOf, snapLoad } from '../lib/load-scale.js'
import { applyProgressionChoice } from '../lib/double-progress.js'
import { progressionSheet } from '../components/DoubleProgress.jsx'
import { playProgressSound } from '../lib/custom-sound.js'
import { glyphOf } from '../lib/glyphs.js'
import { useCoachGate } from '../lib/use-coach-gate.js'
import { hasConsent } from '../lib/coach.js'
import { workoutCoachSheet } from '../components/WorkoutCoachSheet.jsx'
import { isWarmupRow, dropsOf, clustersOf, removeDropAt, removeClusterAt, setDropAt, nextDropWeight } from '../lib/workout-model.js'
import { dropActiveWorkoutEntry, moveActiveWorkoutUnitTo } from '../lib/active-workout-order.js'
import { withSetKind, followDrop, DROP_PCT } from '../lib/set-kind.js'
import WorkoutDock from '../components/WorkoutDock.jsx'
import { DeloadStatus, DeloadSessionBand } from '../components/Deload.jsx'
import { isDeloadWorkout, withRirGoal } from '../lib/mesocycle.js'
import { goalLabel } from '../lib/effort.js'
import { seedTargets } from '../lib/set-reference.js'
import { swipeLock, rowArmed, navDirection, navCommit } from '../lib/swipe.js'
import { edgeOffset } from '../lib/slide.js'
import SlideDeck from '../components/SlideDeck.jsx'
import SessionFlow from '../components/SessionFlow.jsx'
import { estimateSessionSec } from '../lib/session-view.js'
import SetDrum from '../components/SetDrum.jsx'
import { drumChambers } from '../lib/drum.js'
import { DRUM_LETTERS, DrumHero, ExerciseBlock, FIT_STEPS, FOOT_STEPS, SET_VIEWS, SET_VIEW_COPY, SessionRestSheet, SetSheet } from './WorkoutSets.jsx'

/* What a swipe may not start on. Buttons are deliberately *not* here: with one set to a
   screen the card is mostly buttons and the exercise's picture, and excluding those left the
   gesture with almost nothing to grab — a drag that began on the image, on "Add set" or on a
   stepper simply did nothing. A tap still reaches every one of them, because the swipe only
   takes over once the finger has travelled the distance in lib/swipe.js. What stays out is
   where a horizontal drag already means something else: selecting typed text, moving a
   slider, or dragging a link. */
const SWIPE_IGNORED_TARGETS = 'input,textarea,select,a,[role="slider"],.sld,[contenteditable="true"],[data-swipe-ignore]'
// On a set row the same rule applies, minus the targets a row never contains.
const SWIPE_ROW_IGNORED_TARGETS = 'input,textarea,select,[contenteditable="true"],[data-swipe-ignore]'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  // Sessions left paused in this microcycle come first: they are already under way.
  const paused = resumableOf(S)
  const resumeTag = { color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    <DeloadStatus />
    {paused.length > 0 && <><h4 className="sec">{t('Paused')}</h4>
      <div className="list" data-testid="paused-list">{paused.map(p => <div key={p.id} className="item" onClick={() => resumePausedWorkout(p.id)}>
        <span className="lrow-i" style={{ background: 'var(--orange)' }}><Icon name="pause" /></span>
        <div className="grow"><div className="tt">{p.name}</div>
          <div className="ss">{fmtDate(p.d, true)} · {t('{0} sets', setsDoneActive(p) + '/' + p.entries.reduce((n, e) => n + e.sets.length, 0))}</div></div>
        <button className="iconbtn" aria-label={t('Discard')} onClick={e => { e.stopPropagation(); discardPausedWorkout(p) }}><Icon name="trash" /></button>
        <span className="tag" style={resumeTag}>{t('Resume')}</span></div>)}</div></>}
    {todayR && <div className="card halo" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCount(todayR.ex.length)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    {/* No routine: a row like the routines', set apart from them and in its own colour. */}
    <div className="list free-start">
      <div className="item free" onClick={() => startFlow(null)}>
        <span className="lrow-i"><Icon name="freeWorkout" /></span>
        <div className="grow"><div className="tt">{t('Freestyle workout')}</div><div className="ss">{t('Pick exercises as you go')}</div></div>
        <span className="tag">{t('Start')}</span>
      </div>
    </div>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- active workout ---------- */
export function removeActiveExercise(idx) {
  // Clear the work callback before indexes can shift. This also protects a confirmation sheet
  // that was opened first and confirmed after a timed hold started.
  useUI.getState().stopWork()
  // A rest countdown belongs to the exercise whose set started it (timer.forIdx). Removing any
  // exercise — that one included — keeps the countdown: the set behind it was still lifted, so
  // the recovery is still owed. Only its owner is re-pointed, or forgotten when it is the one
  // that goes.
  const rest = useUI.getState().timer
  if (rest && rest.forIdx === idx) useUI.setState({ timer: { ...rest, forIdx: undefined } })
  else useUI.getState().shiftRestOwner(idx + 1, -1)
  useStore.getState().update(s => {
    if (!s.active || !Array.isArray(s.active.entries)) return
    if (idx < 0 || idx >= s.active.entries.length) return
    s.active.entries.splice(idx, 1)
    cleanupSg(s.active.entries)
    if (idx < s.active.cur) s.active.cur--
    if (s.active.cur >= s.active.entries.length) s.active.cur = Math.max(0, s.active.entries.length - 1)
  }, true)
}

function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  // Whether "Ask the Coach" is on each exercise (lib/use-coach-gate.js).
  const coachGate = useCoachGate()
  const update = useStore(s => s.update)
  // Each piece picked on its own: the rest countdown rewrites the UI store every second, and
  // subscribing to all of it redrew the whole session that often.
  const liveRest = useUI(s => s.startRest)
  const liveEndExercise = useUI(s => s.endExercise)
  const stopRest = useUI(s => s.stopRest)
  const stopWork = useUI(s => s.stopWork)
  const work = useUI(s => s.work)
  const A = S.active
  // A past workout has no rest to time — the sets were done days ago. The work timer for
  // timed sets stays, since counting a hold is how its duration gets entered.
  const startRest = A.backfill ? () => {} : liveRest
  // The exercise-end sound, and the rest between exercises that starts with it — neither for a
  // past workout being logged.
  const endExercise = A.backfill ? () => {} : liveEndExercise
  const units = supersetUnits(A.entries)
  const cur = Number.isInteger(A.cur)
    ? Math.min(Math.max(A.cur, 0), Math.max(0, A.entries.length - 1))
    : 0
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1
  /* One screen to an exercise, with every set of it listed down the card — a superset shows its
     linked exercises together, since they are done back to back. Which screen is showing is the
     session's own `cur`, so it survives a reload the way the rest of the log does. */
  // Superset flow: center the actionable row when completing a set moves to the partner or
  // back to the first exercise of the next round. Entry-bound maps keep repeated exercise IDs
  // distinct, while each rendered set index identifies the existing row within that entry.
  const exRefs = useRef(new Map())
  const setRefs = useRef(new Map())
  const bindExRef = (entry, el) => {
    if (el) exRefs.current.set(entry, el)
    else {
      exRefs.current.delete(entry)
      setRefs.current.delete(entry)
    }
  }
  const bindSetRef = (entry, setIdx, el) => {
    let refs = setRefs.current.get(entry)
    if (el) {
      if (!refs) { refs = new Map(); setRefs.current.set(entry, refs) }
      refs.set(setIdx, el)
    } else if (refs) {
      refs.delete(setIdx)
      if (!refs.size) setRefs.current.delete(entry)
    }
  }
  const swipe = useRef(null)
  const swipeSurface = useRef(null)
  // Only if it is still held: releasing a capture the browser already took back throws, and
  // that would swallow the navigation this gesture just earned.
  const releaseSwipeCapture = id => {
    const el = swipeSurface.current
    if (el?.hasPointerCapture?.(id)) { try { el.releasePointerCapture(id) } catch { /* already gone */ } }
  }
  // Drop a gesture and everything it was drawing, without acting on it.
  const endSwipe = id => {
    swipe.current = null
    setRowDrag(null)
    setUnitDrag(null)
    releaseSwipeCapture(id)
  }
  // Which row is currently peeled open, and by how much: state, because the row has to redraw
  // as the finger moves. Null whenever no row is being dragged, which is nearly always.
  const [rowDrag, setRowDrag] = useState(null)
  // Which exercise headers are unfolded (by entry index). Collapsed by default: mid-set the
  // name is all you need; the tools, tags and last session are a tap away.
  const [openHeads, setOpenHeads] = useState({})
  const toggleHead = idx => setOpenHeads(o => ({ ...o, [idx]: !o[idx] }))
  // The drum folds the pinned header down to its title bar; tapping the title unfolds the rest.
  // null follows the view (folded in the drum, open in the list and the table) until the title
  // is tapped; from then on it is what the tap left it.
  const [topOpen, setTopOpen] = useState(null)
  // A change of view keeps your place in the exercise: the set on screen when you switch
  // ({ entry, set }) is the one the next view opens on — the drum turns to it (SetDrum's
  // `start`), the list, the table and the session scroll it to the middle of the screen. The drum
  // reports the set in front as it turns (drumAt); in the others it is the row nearest the middle.
  const [carry, setCarry] = useState(null)
  const drumAt = useRef(null)
  // The exercise being dragged into view, once a swipe has committed to the horizontal axis:
  // { dir, target, dx }, or null whenever nothing is being dragged — which is nearly always.
  const [unitDrag, setUnitDrag] = useState(null)
  // A gesture that started on a stepper button must not leave a click behind when it ends.
  const swipeClick = useRef(false)
  const progressHighWater = useRef(A.entries.map(e => e.sets.filter(s => s.done).length))
  // Drop-sets ticked off with drops still to do ('entry:set'): their rest waits (see toggle).
  const held = useRef(new Set())
  // The marks are index-keyed, and removing an exercise shifts every index above it down
  // (removeActiveExercise splices). Re-baseline whenever the list length changes, otherwise a
  // shifted exercise inherits its predecessor's mark and its real progress reads as a re-check.
  useEffect(() => {
    progressHighWater.current = A.entries.map(e => e.sets.filter(s => s.done).length)
  }, [A.entries.length])
  useEffect(() => {
    const liveEntries = new Set(A.entries)
    for (const entry of exRefs.current.keys()) {
      if (!liveEntries.has(entry)) exRefs.current.delete(entry)
    }
    for (const entry of setRefs.current.keys()) {
      if (!liveEntries.has(entry)) setRefs.current.delete(entry)
    }
  })
  // Re-run when a sheet (e.g. the top-weight one) closes: the move to the partner happens while
  // it is still open, where the scroll is lost, so it has to be redone once the page is back.
  // Closing a sheet also restores the old scroll and rewinds its history entry (Modals.jsx);
  // either can cut a smooth scroll short, so after a close it waits for both to settle.
  // The same applies when the session moves on to the next exercise or superset: land on its
  // first set still to do. A move only marks the scroll as owed; it is paid once no sheet is open.
  // The scroll always waits a beat, and is only marked paid when it actually runs, so a close
  // and a move landing in separate renders cannot cancel it between them.
  // Completing a set owes one too (toggle sets scrollOwed), so the next set to do follows you
  // down an exercise as well. Moving to another unit waits out the deck slide (--slide, 280ms)
  // first: scrolling while the screen is still sliding sideways reads as a jolt, not a glide.
  const sheetsOpen = useUI(s => (s.sheets || []).length)
  const scrollOwed = useRef(isSuperset)
  const scrollMounted = useRef(false)
  const scrolledUnit = useRef(unitIdx)
  const setsDoneNow = setsDoneActive(A)
  const resumeId = useUI(s => s.resumeId)
  useEffect(() => {
    if (scrollMounted.current) scrollOwed.current = true
    scrollMounted.current = true
  }, [cur, A.entries.length])
  // Opening the session (or pressing "Resume" while already on it) lands on the set to do next.
  // After "Resume", wherever you have browsed to, go back to where the work is: the exercise the
  // session last moved to (see markResumeAt), its next set due, else the next unfinished one.
  useEffect(() => {
    scrollOwed.current = true
    if (!useUI.getState().resumePending) return
    useUI.setState({ resumePending: false })
    const entries = useStore.getState().S.active?.entries
    if (!entries?.length) return
    const idx = resumeEntryIdx(entries, supersetUnits(entries))
    if (idx != null && idx !== cur) update(s => { if (s.active?.entries?.[idx]) s.active.cur = idx })
  }, [resumeId])
  // Opening the session view owes the same scroll, to the exercise in front.
  useEffect(() => { if (S.setView === 'session') scrollOwed.current = true }, [S.setView])
  useEffect(() => {
    if (sheetsOpen || !scrollOwed.current) return
    const delay = unitIdx !== scrolledUnit.current ? 320 : 150
    const t = setTimeout(() => {
      scrollOwed.current = false
      scrolledUnit.current = unitIdx
      const active = useStore.getState().S.active
      const entry = active?.entries[cur]
      const firstIncomplete = entry?.sets.findIndex(s => !s.done) ?? -1
      const setIdx = firstIncomplete >= 0 ? firstIncomplete : (entry?.sets.length ?? 0) - 1
      // The session shows the exercise in front whole: its card, from the title to its buttons,
      // goes under the header (see .sf-card's scroll-margin). A superset's partner gets the same
      // when the check moves the session on to it.
      const card = sessionView ? exRefs.current.get(entry) : null
      const el = card || (setIdx >= 0 && setRefs.current.get(entry)?.get(setIdx)) || exRefs.current.get(entry)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: sessionView ? 'start' : 'center' })
    }, delay)
    return () => clearTimeout(t)
  }, [cur, A.entries.length, sheetsOpen, setsDoneNow, resumeId, S.setView])

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    const was = e.sets[i][field]
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Changing a weight cascades to the following sets of the same phase, so a
    // heavier bar carries through the set instead of retyping every row — but only into the
    // rows that carried the same weight, so a prescribed ramp (110/120/130) is not flattened.
    if (field === 'w') {
      e.sets = cascadeWeight(e.sets, i, v, was)
      const pct = e.target?.intensifier?.type === 'dropset' ? e.target.intensifier.pct : DROP_PCT
      e.sets[i] = followDrop(e.sets[i], was, pct)
    }
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const pushSet = e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  }
  const addSet = idx => mutEntry(idx, pushSet)
  // A whole extra round of a superset: one more set of every linked exercise, in one update.
  const addRound = unit => update(s => { unit.forEach(idx => pushSet(s.active.entries[idx])) }, true)
  // The drum's "One more" on a superset asks first: an extra set of this exercise alone, or an
  // extra round of every exercise linked to it.
  const askAddSet = (idx, unit) => {
    if (!unit || unit.length < 2) return addSet(idx)
    useUI.getState().openSheet(close => (
      <div>
        <h3>{t('One more set')}</h3>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Add the set to this exercise only, or to every exercise in the superset?')}</div>
        <div className="list">
          <div className="item" onClick={() => { close(); addSet(idx) }}>
            <div className="grow"><div className="tt">{t('Only this exercise')}</div><div className="ss">{exerciseNameFor(exOr(A.entries[idx]?.id))}</div></div>
            <Icon name="plus" className="chev" />
          </div>
          <div className="item" onClick={() => { close(); addRound(unit) }}>
            <div className="grow"><div className="tt">{t('Every exercise in the superset')}</div>
              <div className="ss">{unit.map(i => exerciseNameFor(exOr(A.entries[i]?.id))).join(' + ')}</div></div>
            <Icon name="link" className="chev" />
          </div>
        </div>
      </div>
    ))
  }
  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })
  // A warm-up goes in ahead of the work sets, which shifts every set after it one along — the
  // rows are all on the card together, so that reads as the insertion it is.
  const addWarmup = idx => mutEntry(idx, e => {
    const m = modeOf({ ...(e.target || {}), id: e.id })
    e.sets = insertWarmupRow(e.sets, m, e.target || {}, loadScaleFor({ ...(e.target || {}), id: e.id }, S.unit))
  })
  const removeSetAt = (idx, i) => mutEntry(idx, e => { e.sets = removeRowAt(e.sets, i) })
  const pairAt = (first, second) => update(s => {
    s.active.entries = pairAdjacent(s.active.entries, first, second)
  })
  const unpairAt = idx => update(s => {
    s.active.entries = unpairSuperset(s.active.entries, idx)
  })
  // Every reorder — a thumbnail dragged along the dock — lands here, because the bookkeeping that
  // follows a move is the same whichever way it comes: the per-exercise
  // progress marks and the rest timer's owner are both stored by index, and `moved.indices`
  // says where every index went.
  const applyReorder = move => {
    const ui = useUI.getState()
    if (ui.work) return
    // Invalidate an old timed callback before indexes shift. A running rest is not cancelled:
    // it belongs to an exercise (timer.forIdx), and that exercise only changes position.
    ui.stopWork()
    update(s => {
      const moved = move(s.active)
      if (!moved) return
      progressHighWater.current = moved.indices.map(index => progressHighWater.current[index])
      const rest = useUI.getState().timer
      if (rest && rest.forIdx != null) {
        const forIdx = moved.indices.indexOf(rest.forIdx)
        if (forIdx >= 0) useUI.setState({ timer: { ...rest, forIdx } })
      }
    }, true)
  }
  // A dropped thumbnail can land anywhere in the session, and where it lands decides its
  // superset too: next to its own capsule it stays in, onto another exercise it pairs with it.
  // Held longer, it carries its whole superset and only the order changes (`intent.unit`).
  const dropEntry = (index, intent) => applyReorder(a => intent.unit != null
    ? moveActiveWorkoutUnitTo(a, index, intent.unit)
    : dropActiveWorkoutEntry(a, index, intent))
  const selectExercise = index => update(s => {
    if (s.active?.entries?.[index]) s.active.cur = index
  })

  /* Move one screen along the session: the exercise next door, or the whole superset when that
     is what sits there. Landing on a superset lands on its first exercise, where its work starts. */
  const navigateUnit = direction => {
    const targetUnit = units[unitIdx + direction]
    if (!targetUnit?.length) return
    update(s => {
      if (s.active?.entries?.[targetUnit[0]]) s.active.cur = targetUnit[0]
    })
  }
  // One pointer gesture, two outcomes (see lib/swipe.js for which is which and why): dragging a
  // removable set row rightwards peels it open over a red delete track, and any other horizontal
  // drag pages between exercises. It is all handled here rather than on each row because the
  // surface takes the pointer capture, so a row would never see the moves itself.
  const onSwipePointerDown = event => {
    if ((event.button ?? 0) !== 0) return
    // A new press supersedes whatever was in flight rather than being turned away as a second
    // finger. A gesture whose pointer never reports again — the browser took it back, the
    // touch was cancelled without telling us — would otherwise leave this surface refusing
    // every later drag for as long as the page stayed open.
    if (swipe.current) endSwipe(swipe.current.id)
    const rowEl = event.target.closest?.('[data-swipe-row][data-swipe-removable]')
    const row = rowEl && !event.target.closest?.(SWIPE_ROW_IGNORED_TARGETS)
      ? { entry: Number(rowEl.dataset.swipeRow), set: Number(rowEl.dataset.swipeSet), drop: rowEl.dataset.swipeDrop != null ? Number(rowEl.dataset.swipeDrop) : null,
        burst: rowEl.dataset.swipeBurst != null ? Number(rowEl.dataset.swipeBurst) : null }
      : null
    // A fresh press makes any pending swallow stale, so it is dropped before this press can be
    // turned away below — otherwise a tap on a stepper's field, right after a swipe that
    // committed and was followed by no click of its own, would be eaten by that old gesture.
    swipeClick.current = false
    if (!row && event.target.closest?.(SWIPE_IGNORED_TARGETS)) return
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, row, mode: null }
  }
  const onSwipePointerMove = event => {
    const start = swipe.current
    if (!start || start.id !== event.pointerId || start.mode === 'none') return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.mode) {
      const mode = swipeLock({ dx, dy, row: start.row })
      if (!mode) return
      start.mode = mode
      // The gesture has taken over: whatever button it started on must not also be clicked.
      if (mode !== 'none') swipeClick.current = true
      // Capture keeps the moves coming when the finger wanders off the card. Only once the drag
      // is the surface's, as the drum does: captured from the press, the browser hands the click
      // of a plain tap to this surface instead of the button under the finger, and a tap on a
      // superset's exercise box or an exercise's name did nothing. It throws for a pointer the
      // browser no longer holds, which must not leave a gesture half-started.
      if (mode !== 'none') try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* the listener below still ends it */ }
      // A mouse would otherwise paint a text selection across the screen as it drags. Cleared
      // on every move rather than once, so nothing is left highlighted behind the gesture.
      if (event.pointerType === 'mouse') window.getSelection?.()?.removeAllRanges()
      if (mode === 'nav') Object.assign(start, startUnitDrag(dx, event))
    }
    if (start.mode === 'row') { setRowDrag({ ...start.row, dx }); return }
    moveUnitDrag(start, dx, dy, event)
  }
  /* Paging between exercises, shared by this surface and the set drum (which owns its own
     pointer, so it hands its horizontal drags over through onSwipe/onSwipeEnd). */
  // Which exercise is being pulled in is settled once, on the axis lock: a neighbour that
  // changed sides halfway through a drag would mean mounting the other one too.
  const startUnitDrag = (dx, event) => {
    const dir = dx < 0 ? 1 : -1
    return { dir, target: units[unitIdx + dir] ? unitIdx + dir : null, lx: event.clientX, lt: event.timeStamp, v: 0, armed: false }
  }
  const moveUnitDrag = (g, dx, dy, event) => {
    // Velocity from the last sample only: a flick is what the finger was doing as it left.
    const dt = event.timeStamp - g.lt
    if (dt > 0) { g.v = (event.clientX - g.lx) / dt; g.lx = event.clientX; g.lt = event.timeStamp }
    // The click under the thumb as the drag passes the point where letting go pages, like the
    // drum's detent between sets — and again if it is pulled back short of it.
    const armed = g.target != null && navDirection(dx, dy) === g.dir
    if (armed !== g.armed) { g.armed = armed; vibrate(8) }
    // Either the next exercise follows the finger, or — at the very start or end of the
    // session — the current one gives a little and stops, so the end is felt rather than silent.
    setUnitDrag({ dir: g.dir, target: g.target, dx: g.target == null ? edgeOffset(dx) : dx })
  }
  const endUnitDrag = (g, dx, dy, event) => {
    setUnitDrag(null)
    // A stale velocity (the finger paused before lifting) is no flick.
    const v = event.timeStamp - g.lt > 90 ? 0 : g.v
    // Let go short of the threshold and it springs back: the deck animates the return.
    if (g.target != null && navCommit({ dx, dy, v, dir: g.dir })) navigateUnit(g.dir)
  }
  const drumSwipe = useRef(null)
  const onDrumSwipe = (dx, event) => {
    if (!drumSwipe.current) drumSwipe.current = startUnitDrag(dx, event)
    moveUnitDrag(drumSwipe.current, dx, 0, event)
  }
  const onDrumSwipeEnd = (dx, event, commit) => {
    const g = drumSwipe.current
    drumSwipe.current = null
    if (!g) return
    if (commit) endUnitDrag(g, dx, 0, event)
    else setUnitDrag(null)
  }
  const finishSwipe = (event, commit) => {
    const start = swipe.current
    if (!start || start.id !== event.pointerId) return
    swipe.current = null
    setRowDrag(null)
    setUnitDrag(null)
    releaseSwipeCapture(start.id)
    if (!commit || start.mode === 'none') return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (start.mode === 'row') {
      // Letting go short of the threshold is a cancel — the row springs back, nothing is lost.
      if (!rowArmed(dx)) return
      vibrate(15)
      // A drop or burst row takes only itself with it; its set stays.
      // A burst's reps were part of the set's total, so they leave it too.
      if (start.row.burst != null) mutEntry(start.row.entry, e => {
        const row = e.sets[start.row.set]
        const gone = clustersOf(row)[start.row.burst]?.r || 0
        e.sets[start.row.set] = { ...removeClusterAt(row, start.row.burst), r: Math.max(0, (row.r || 0) - gone) }
      })
      else if (start.row.drop != null) mutEntry(start.row.entry, e => { e.sets[start.row.set] = removeDropAt(e.sets[start.row.set], start.row.drop) })
      else removeSetAt(start.row.entry, start.row.set)
      return
    }
    endUnitDrag(start, dx, dy, event)
  }

  /* A gesture has to end even when its pointerup never reaches this surface — a finger lifted
     after the browser took the pointer back, a capture that never took, a touch the system
     cancelled. Without this the surface stayed armed for a gesture that was already over, and
     every later drag was turned away as if a second finger were down: one interrupted swipe
     and it stopped answering until the page was reloaded. The listener reads the handler
     through a ref because it outlives the render that made it. */
  const finishSwipeRef = useRef(null)
  useEffect(() => { finishSwipeRef.current = finishSwipe })
  useEffect(() => {
    const end = event => finishSwipeRef.current?.(event, event.type === 'pointerup')
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  const openProgressionSettings = idx => {
    const state = useStore.getState().S
    const entry = state.active?.entries?.[idx]
    if (!entry) return
    const routine = state.routines.find(r => r.id === state.active.routineId)
    exConfigSheet(exOr(entry.id), entry.target, cfg => update(s => {
      const activeEntry = s.active?.entries?.[idx]
      if (!activeEntry) return
      const full = { ...cfg, id: activeEntry.id }
      const activeRoutine = s.routines.find(r => r.id === s.active.routineId)
      const step = loadScaleFor(full, s.unit)
      // A config without a set count keeps the rows the session already has.
      if (!(full.sets > 0)) full.sets = activeEntry.sets.filter(x => !isWarmupRow(x)).length || 1
      const plan = withRirGoal(nextPrescription(s, full, activeRoutine), s.active.rirGoal)
      // The sheet edits sets, reps, weight and warm-ups as well as the rule — so the rows are
      // rebuilt from the new config the way the session was, and only what you already logged
      // is kept in place (done warm-ups first, then done work sets, then the fresh remainder).
      const seeded = seedTargets(applyPrescription(buildSets(s, full, { step }), plan, step),
        lastEntryFor(s, activeEntry.id)?.sets, { mode: modeOf(full), plan, effort: effortOf(s), step })
      const fresh = applyIntensifierPlan(seeded, full)
      const doneWarm = activeEntry.sets.filter(x => x.done && isWarmupRow(x))
      const doneWork = activeEntry.sets.filter(x => x.done && !isWarmupRow(x))
      const freshWarm = fresh.filter(isWarmupRow)
      const freshWork = fresh.filter(x => !isWarmupRow(x))
      activeEntry.target = { ...cfg }
      activeEntry.retuned = true
      activeEntry.plan = plan
      delete activeEntry.decided
      activeEntry.sets = [...doneWarm, ...freshWarm.slice(doneWarm.length), ...doneWork, ...freshWork.slice(doneWork.length)]
    }), null, routine)
  }


  // The athlete's answer to a double progression that reached the top of its range. An added set
  // lives on in the finished session's target, which is where the next session reads its count.
  const chooseProgression = (idx, choice) => {
    let decided = null
    update(s => {
      const e = s.active?.entries?.[idx]
      if (!e) return
      const next = applyProgressionChoice(e, choice, { step: loadScaleFor({ ...(e.target || {}), id: e.id }, s.unit), unit: s.unit })
      s.active.entries[idx] = next
      decided = next.decided
    })
    if (decided === 'weight') useUI.getState().toast(t('Weight up — reps back to the bottom of the range'))
    else if (decided === 'sets') useUI.getState().toast(t('Set added — kept for next sessions'))
  }

  // The "time to progress" window, with its confetti and sound. A past workout being logged gets
  // the question without the party — nothing is happening at the bar right now.
  const openProgression = (idx, { celebrate = true } = {}) => {
    const st = useStore.getState().S
    const e = st.active?.entries?.[idx]
    if (!e || e.plan?.kind !== 'decide' || e.decided) return
    const party = celebrate && !st.active.backfill
    if (party) playProgressSound(st.sound)
    progressionSheet({ plan: e.plan, unit: st.unit, celebrate: party, onChoose: choice => chooseProgression(idx, choice) })
  }
  // It pops up by itself the first time the exercise comes on screen, once the slide into it has
  // settled and nothing else (the weigh-in, a confirmation) is open on top.
  const celebrated = useRef(new Set())
  useEffect(() => {
    if (sheetsOpen) return
    const idx = unit.find(i => {
      const e = A.entries[i]
      return e?.plan?.kind === 'decide' && !e.decided && !celebrated.current.has(A.id + ':' + i + ':' + e.id)
    })
    if (idx == null) return
    const tm = setTimeout(() => {
      celebrated.current.add(A.id + ':' + idx + ':' + A.entries[idx].id)
      openProgression(idx)
    }, 450)
    return () => clearTimeout(tm)
  }, [A.id, unitIdx, sheetsOpen])

  // `after` is the exercise whose own "Add exercise" was tapped (the table's, see SetTable): the
  // new one goes straight after it. Without it (the dock, the header) it follows the whole unit.
  const addExercise = after => exercisePicker(ex => {
    const routine = S.routines.find(r => r.id === A.routineId)
    const freestyle = !A.routineId
    // Freestyle has no routine prescription to apply: show the last target in the config
    // sheet and carry its completed rows forward. A planned session keeps its existing path.
    const seed = freestyle ? freestyleConfig(S, { id: ex.id, ...defaultConfig(ex.id) }) : null
    exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = freestyle ? null : withRirGoal(nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId)), s.active.rirGoal)
      const step = loadScaleFor(full, s.unit)
      const sets = buildSets(s, full, { step, ...(freestyle ? { preferLast: true } : {}) })
      const progressed = freestyle ? sets : seedTargets(applyPrescription(sets, plan, step),
        lastEntryFor(s, ex.id)?.sets, { mode: modeOf(full), plan, effort: effortOf(s), step })
      const { at: insertAt, sg } = Number.isInteger(after)
        ? insertionAfterEntry(s.active.entries, after)
        : { at: insertionIndexAfterCurrentUnit(supersetUnits(s.active.entries), s.active.cur, s.active.entries.length), sg: null }
      s.active.entries.splice(insertAt, 0, { id: ex.id, target: { ...cfg }, plan, sets: applyIntensifierPlan(progressed, full), ...(sg ? { sg } : {}) })
      s.active.cur = insertAt
      useUI.getState().shiftRestOwner(insertAt, 1)
    }), null, routine, seed)
  })

  // Remove a whole exercise from the session. The confirmation always asks first; in a
  // superset it asks WHICH exercise of the group to remove.
  const removeExercise = removeActiveExercise
  const confirmRemoveExercise = idx => {
    const e = A.entries[idx]
    if (!e) return
    const hasDone = (e.sets || []).some(s => s.done)
    confirmSheet({
      title: t('Remove {0}?', exerciseNameFor(exOr(e.id))),
      message: hasDone
        ? t('The sets you logged for this exercise in this session will be lost.')
        : t('This removes the exercise from your current session.'),
      confirmText: t('Remove'), danger: true, onConfirm: () => removeExercise(idx)
    })
  }
  const removeExerciseSheet = () => {
    if (unit.length > 1) {
      useUI.getState().openSheet(close => (
        <div>
          <h3>{t('Remove exercise')}</h3>
          <div className="muted small" style={{ marginBottom: 12 }}>{t('Which exercise in this superset do you want to remove?')}</div>
          <div className="list">
            {unit.map(idx => <div key={idx} className="item" onClick={() => { close(); confirmRemoveExercise(idx) }}>
              <div className="grow"><div className="tt">{exerciseNameFor(exOr(A.entries[idx]?.id))}</div></div>
              <Icon name="chevronRight" />
            </div>)}
          </div>
        </div>
      ))
    } else confirmRemoveExercise(cur)
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exerciseNameFor(exOr(e.id)), elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    // A drop-set is one set taken with no break: its rest comes after the last drop, not after
    // the part before it. Ticking that part off while drops are still to do only marks it; the
    // last drop's tick (toggleDrop) then completes the set through the rest of this path.
    const row = useStore.getState().S.active?.entries[idx]?.sets[i]
    if (row && !row.done && dropsOf(row).some(d => !d.done)) {
      held.current.add(idx + ':' + i)
      mutEntry(idx, e => { e.sets[i].done = true })
      beep(S.sound, 1040, 0.12); vibrate(30)
      return
    }
    held.current.delete(idx + ':' + i)
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    let askTop = false, exJustDone = false, workoutDone = false, checked = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      checked = e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (unitDone) workoutDone = !nextUnfinishedUnit(A.entries, supersetUnits(A.entries), idx)
        // Only loaded reps training has a "working weight" worth confirming — a bodyweight
        // plank has nothing to put in that slider, and neither does a set of push-ups
        // (issue #32: the fewest taps that still record what happened).
        const loaded = m === 'reps' && !(isBw({ ...(e.target || {}), id: e.id }) && !e.sets.some(x => x.w > 0))
        if (e.sets.every(x => x.done)) { exJustDone = true; if (loaded && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    // reps: topWeight first (it chains into the finish/continue prompt on the last unit).
    // cardio/timed or already-confirmed: go straight to the prompt.
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))

    // Only progress beyond this exercise's high-water mark may navigate or change rest. This
    // prevents an uncheck/re-check of finished work from replaying the flow side effects.
    const fresh = useStore.getState().S.active
    if (fresh && checked && fresh.entries[idx]) {
      const progress = setProgressHighWater(fresh.entries[idx], progressHighWater.current[idx] || 0)
      progressHighWater.current[idx] = progress.highWater
      // New progress: bring the next set to do into view (see the centring effect), and this is
      // now where the work is — what "Resume" comes back to. The moves below re-mark it.
      if (progress.isNew) {
        scrollOwed.current = true
        update(s => { if (s.active) markResumeAt(s.active.entries, idx) })
      }

      const freshUnits = supersetUnits(fresh.entries)
      const freshUnit = freshUnits.find(u => u.includes(idx))
      const freshUnitDone = freshUnit?.every(ui => fresh.entries[ui].sets.every(x => x.done))
      const nextUnit = freshUnitDone ? nextUnfinishedUnit(fresh.entries, freshUnits, idx) : null
      const freshWorkoutDone = freshUnitDone && !nextUnit
      // The break after an exercise is taken whatever the next one opens with. It used to be
      // skipped when the next exercise started on a warm-up (and the rest already counting was
      // stopped with it), which is how a rest went missing on almost every change of exercise
      // in a routine with planned warm-ups: the warm-up is the next set, not the recovery.
      // The rest this set has earned: the exercise's own restSec when it set one, the global
      // timer when it did not, and the longest of the group's across a superset (issue #10).
      // Resolved once here so every branch below times the same break.
      const workRestSec = restSecFor(fresh.entries, freshUnit || [idx], S.restSec, fresh.restSec)
      // A warm-up set rests on its own clock (Settings ▸ Warm-up rest, none by default).
      const restSec = restSecAfterSet(fresh.entries[idx].sets[i], workRestSec, S.warmupRestSec)
      // Once the exercise (or superset) is finished, the break before the next one can have its
      // own length — the exercise's own choice, else the workout's, else Settings, else the work
      // sets' rest above (never the warm-up's). See rest-between.js.
      const exRestSec = restBetweenExercisesSec(workRestSec, fresh.restExSec, S.restExSec, exerciseRestChoice(fresh.entries, freshUnit || [idx]))
      const unitRestSec = freshUnitDone ? exRestSec : restSec
      // Which break this is. The closing set never also starts a between-sets rest: the
      // between-exercises one replaces it, so the two times cannot add up.
      const unitRestKind = freshUnitDone ? 'exercise' : 'sets'

      // A re-check of finished work must not navigate or reopen a sheet, but it may still owe
      // you a rest — see restOnRecheck, and the other half of issue #3.
      if (!progress.isNew) {
        const running = useUI.getState().timer
        if (restOnRecheck({
          timerRunning: !!running, runningKind: running?.kind, unitDone: freshUnitDone, lastUnit: freshWorkoutDone,
          exRestDiffers: exRestSec !== restSec,
        })) startRest(unitRestSec, idx, unitRestKind)
        return
      }

      // Singleton units are ordinary exercises: they rest between sets and after the closing
      // one unless the next unit has an unfinished warm-up, and never enter superset navigation.
      // stopRest() first so a rest that belongs after this set replaces the one that was running.
      if (freshUnitDone) stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (freshUnitDone && !askTop && nextUnit?.length) update(s => { if (s.active) markResumeAt(s.active.entries, s.active.cur = unitEntryIdx(fresh.entries, nextUnit)) })
        const rest = restAfterSet({ unitDone: freshUnitDone, lastUnit: freshWorkoutDone })
        // The closing set rings the exercise-end sound — the session's last one too, with no
        // rest after it — and the break before the next exercise starts with the sound.
        if (freshUnitDone) endExercise(rest ? unitRestSec : null, idx)
        else if (rest) startRest(unitRestSec, idx, unitRestKind)
        return
      }

      const step = supersetFlowStep(fresh.entries, freshUnit, idx, i)
      if (!step) return
      if (step.unitDone) {
        if (nextUnit?.length) {
          // The top-weight sheet's explicit "Just close" path owns the choice not to advance.
          if (!askTop) update(s => { if (s.active) markResumeAt(s.active.entries, s.active.cur = unitEntryIdx(fresh.entries, nextUnit)) })
          endExercise(exRestSec, idx)
        } else endExercise(null, idx)
      } else {
        if (step.nextIdx != null) update(s => { if (s.active) markResumeAt(s.active.entries, s.active.cur = step.nextIdx) })
        if (step.roundDone) startRest(restSec, idx, 'sets')
      }
    }
  }

  const toggleDrop = (idx, i, di) => {
    const row = useStore.getState().S.active?.entries[idx]?.sets[i]
    const drops = dropsOf(row)
    if (!drops[di]) return
    const ticking = !drops[di].done
    const closes = ticking && drops.every((d, k) => k === di || d.done)
    // Held: the set was ticked while its drops were still to do, so its rest, next set and
    // finish are still owed — they run now, as if the set were ticked off this moment.
    const owed = row.done && held.current.has(idx + ':' + i)
    if (owed) held.current.delete(idx + ':' + i)
    mutEntry(idx, e => { e.sets[i] = setDropAt(e.sets[i], di, { done: ticking }); if (closes && owed) e.sets[i].done = false })
    if (closes && (owed || !row.done)) return toggle(idx, i)
    if (!ticking) return
    beep(S.sound, 1040, 0.12); vibrate(30)
    // A drop added to a set already ticked off: the rest it started belongs after this drop, so
    // it starts over now, the same length and kind.
    const running = useUI.getState().timer
    if (closes && running && running.forIdx === idx) startRest(running.total, idx, running.kind)
  }
  // The set sheet's top bar: the row becomes a work set, a warm-up, a set to failure or a
  // drop-set, keeping its numbers. A new drop is DROP_PCT lighter (the planned cut on an
  // exercise that has one), on a weight the exercise can load.
  const setKind = (idx, i, kind) => mutEntry(idx, e => {
    const row = e.sets[i]
    const pct = e.target?.intensifier?.type === 'dropset' ? e.target.intensifier.pct : DROP_PCT
    const lad = ladderOf(e.target)
    const w = nextDropWeight(row.w, pct)
    const eff = effortOf(S)
    e.sets[i] = withSetKind(row, kind, {
      dropWeight: lad ? Math.min(row.w || 0, snapLoad(w, lad, 'floor')) : w,
      failure: eff === 'rir' ? { f: 'rir', v: 0 } : eff === 'rpe' ? { f: 'rpe', v: 10 } : null,
    })
  })
  const openSet = (idx, i) => useUI.getState().openSheet(close => (
    <SetSheet entryIdx={idx} i={i} close={close} onField={(si, f, v) => setField(idx, si, f, v)}
      onKind={(si, k) => setKind(idx, si, k)} onRemoveSetAt={si => removeSetAt(idx, si)} />
  ))

  // The session's own rests (between sets for every exercise, between exercises), from the header.
  const openSessionRest = () => useUI.getState().openSheet(close => <SessionRestSheet close={close} />)
  const restPicked = sessionHasRestPicks(A) || A.restExSec === 'sets' || typeof A.restExSec === 'number'

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  /* One screen of the session — an exercise with every one of its sets, or the linked exercises
     of one superset — as a layer of the sliding deck. `preview` marks the neighbour being dragged
     into view: the deck renders it for real so the two screens travel together, but it is inert,
     so it takes no refs (the superset flow's scroll targets belong to the exercise you are
     actually working) and its controls are wired to nothing. */
  // Which way the sets are drawn: the revolver drum (one set at a time, full size), the list, or
  // the table (one bare line per set). A profile saved before the drum existed gets it from the
  // defaults (useStore DEF).
  const drumView = S.setView === 'drum'
  const tableView = S.setView === 'table'
  // The whole session down one column (components/SessionFlow.jsx): its rail stands in for the
  // dock and its rows for paging, so neither is drawn there.
  const sessionView = S.setView === 'session'
  // How long the session should take in all, beside the clock — only where the view asks for
  // it, and never for a past workout, which has no timers.
  const estSec = sessionView && !A.backfill ? estimateSessionSec(A.entries, units, {
    restSec: S.restSec, warmupRestSec: S.warmupRestSec, restExSec: S.restExSec, workoutRestEx: A.restExSec, sessionRestSec: A.restSec,
  }) : 0
  // The toggle walks drum → list → table → session → drum and names the view it leads to.
  const nextView = SET_VIEWS[(SET_VIEWS.indexOf(S.setView) + 1) % SET_VIEWS.length] || 'drum'
  const setOnScreen = () => {
    if (drumView) return drumAt.current && unit.includes(drumAt.current.entry) ? drumAt.current : null
    const mid = window.innerHeight / 2
    let best = null, gap = Infinity
    unit.forEach(idx => setRefs.current.get(A.entries[idx])?.forEach((el, set) => {
      const r = el.getBoundingClientRect()
      const d = Math.abs((r.top + r.bottom) / 2 - mid)
      if (d < gap) { gap = d; best = { entry: idx, set } }
    }))
    return best
  }
  const switchView = () => {
    setCarry(setOnScreen())
    update(s => { s.setView = nextView })
  }
  useEffect(() => {
    if (!carry) return
    // The session brings its card up on its own (the scroll below), not the set on screen.
    if (!drumView && !sessionView) setRefs.current.get(A.entries[carry.entry])?.get(carry.set)?.scrollIntoView?.({ block: 'center' })
    setCarry(null)
  }, [S.setView])
  const slimTop = !(topOpen ?? !drumView)
  const position = isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)
  // The set to do next is marked on the exercise you are on, never on a neighbour's preview.
  const blockFor = (idx, preview, extra) => <ExerciseBlock entryIdx={idx}
    nextSet={!preview && idx === cur ? A.entries[idx].sets.findIndex(s => !s.done) : -1}
    swipeSet={!preview && rowDrag?.entry === idx ? rowDrag.set : null} swipeDrop={rowDrag?.drop ?? null} swipeBurst={rowDrag?.burst ?? null} swipeDx={rowDrag?.dx || 0}
    onToggle={i => toggle(idx, i)} onToggleDrop={(i, di) => toggleDrop(idx, i, di)} onOpenSet={preview ? undefined : i => openSet(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onAddSet={() => addSet(idx)} onRemoveSet={() => removeSet(idx)} onAddWarmup={() => addWarmup(idx)} onRemoveSetAt={i => removeSetAt(idx, i)} onStartTimed={i => startTimed(idx, i)} onProgressionSettings={() => openProgressionSettings(idx)}
    onAddExercise={preview ? undefined : () => addExercise(idx)}
    onOpenProgression={preview ? undefined : () => openProgression(idx, { celebrate: false })}
    onSwap={preview ? undefined : () => swapActiveWorkoutExercise(idx)} onRemove={preview ? undefined : () => confirmRemoveExercise(idx)}
    // Only with the Coach set up and agreed to, live (not a past workout), and something left to do.
    onAskCoach={!preview && coachGate.ok && hasConsent(S) && !A.backfill && (A.entries[idx]?.sets || []).some(x => !isWarmupRow(x) && !x.done)
      ? () => workoutCoachSheet(idx) : undefined}
    open={!!openHeads[idx]} onToggleHead={() => toggleHead(idx)} table={tableView}
    {...extra} />
  // The session view's open exercises: the table's rows under the view's own name line, wired
  // like the list (row refs for the superset flow's scroll, pairing from the tools row).
  const sessionBlock = (idx, marks) => {
    const entry = A.entries[idx]
    const linked = unitOf(units, idx).length > 1
    return blockFor(idx, false, {
      compact: true, table: true, nameless: true, marks,
      onSetRowRef: (setIdx, el) => bindSetRef(entry, setIdx, el),
      ...(linked ? { onUnpair: () => unpairAt(idx) } : {
        onPairPrev: idx > 0 ? () => pairAt(idx - 1, idx) : null,
        onPairNext: idx < A.entries.length - 1 ? () => pairAt(idx, idx + 1) : null,
      }),
    })
  }
  const renderUnit = (index, preview) => {
    const members = units[index]
    if (!members || !members.length) return null
    const block = (idx, extra) => blockFor(idx, preview, extra)
    // The drum: the same sets, one at a time at full size, on a cylinder you turn with a thumb.
    if (drumView) {
      const chambers = drumChambers(A.entries, members)
      const ss = members.length > 1
      const head = idx => block(idx, ss ? { compact: true, drum: true, nameless: true, aims: !preview && idx === cur, onUnpair: preview ? undefined : () => unpairAt(idx) } : {
        drum: true,
        aims: !preview,
        onPairPrev: idx > 0 ? () => pairAt(idx - 1, idx) : null,
        onPairNext: idx < A.entries.length - 1 ? () => pairAt(idx, idx + 1) : null,
      })
      const drum = <SetDrum key={members.join(',')} chambers={chambers} entries={A.entries} members={members.length} inert={preview}
        start={preview ? null : carry} onFocus={preview ? undefined : ch => { drumAt.current = ch }}
        memberLabel={idx => exerciseNameFor(exOr(A.entries[idx].id))}
        renderHead={head}
        headOpen={idx => !!openHeads[idx]} onToggleHead={preview ? undefined : toggleHead}
        renderThumb={idx => <Thumb ex={exOr(A.entries[idx].id)} muscle />}
        renderHero={ch => <DrumHero chamber={ch} members={members.length}
          onToggle={toggle} onToggleDrop={toggleDrop} onOpenSet={preview ? undefined : openSet} onField={setField} onStartTimed={startTimed} onRemoveSetAt={removeSetAt}
          onAddWarmup={addWarmup} onAddSet={idx => askAddSet(idx, members)} />}
        renderStrip={ch => {
          const e = A.entries[ch.entry], row = e.sets[ch.set]
          return <div className={'drum-strip' + (row.done ? ' done' : '') + (ch.warm ? ' warm' : '')}>
            {ss && <span className={'dh-let sm m' + ch.member}>{DRUM_LETTERS[ch.member]}</span>}
            <span className="ds-k">{ch.warm ? <Icon name="flame" /> : null}{ch.warm ? t('Warm-up') : t('Set {0}', ch.num)}</span>
            <span className="ds-v">{setLabel(e.id, row, e.target)}</span>
            {row.done ? <span className="ds-ok"><Icon name="check" /></span> : <Icon name="chevronRight" className="ds-go" />}
          </div>
        }}
        onNav={preview ? undefined : navigateUnit}
        onSwipe={preview ? undefined : onDrumSwipe} onSwipeEnd={preview ? undefined : onDrumSwipeEnd}
        onHeroRef={preview ? undefined : (ch, el) => bindSetRef(A.entries[ch.entry], ch.set, el)} />
      if (!ss) return drum
      return <div className="ss-card drum-ss">
        {drum}
      </div>
    }
    if (members.length > 1) return (
      <div className="ss-card">
        {members.map((idx, k) => {
          const entry = A.entries[idx]
          return <div key={idx} ref={preview ? undefined : el => bindExRef(entry, el)} className="ss-ex" data-exidx={idx}>
            {k > 0 && <div className="ss-amp">+</div>}
            {block(idx, { compact: true, onUnpair: preview ? undefined : () => unpairAt(idx), onSetRowRef: preview ? undefined : (setIdx, el) => bindSetRef(entry, setIdx, el) })}
          </div>
        })}
      </div>
    )
    const idx = members[0]
    const entry = A.entries[idx]
    return block(idx, {
      onSetRowRef: preview ? undefined : (setIdx, el) => bindSetRef(entry, setIdx, el),
      onPairPrev: idx > 0 ? () => pairAt(idx - 1, idx) : null,
      onPairNext: idx < A.entries.length - 1 ? () => pairAt(idx, idx + 1) : null,
    })
  }


  /* With the header folded away and the exercise's own details closed, the drum and the foot under
     it are the whole screen, and they are made to fit it with nothing to scroll to: each step
     (data-fit on the page, see .narrow[data-fit] in index.css) gives up a little more room — the
     foot's two rows of buttons, then one row of icons, then the same row tighter, then the set in
     front tighter, then tighter still. The largest step that fits is taken: every step is tried
     and measured in one go, the drum re-measuring itself in between ('drum:measure'), and it is
     redone whenever the page changes height (a set that grows a drop, a rotated phone), always from
     the roomiest, so it grows back as room returns. With the header or the exercise's details
     open the screen is meant to scroll, but the foot still gives up its room (the first steps,
     FOOT_STEPS) so paging stays on screen whenever that is enough; the set in front keeps its
     size. The list of sets scrolls and keeps the roomiest size. */
  const pageEl = useRef(null)
  const footEl = useRef(null)
  useEffect(() => {
    const page = pageEl.current, foot = footEl.current
    if (!page || !foot) return
    let raf = 0
    const set = step => {
      page.dataset.fit = step
      window.dispatchEvent(new Event('drum:measure'))
    }
    const fit = () => {
      if (!window.innerHeight || !foot.getBoundingClientRect().height) return
      // Only the drum is fitted; the title's fold toggle is in every view now, so it cannot tell.
      const drum = page.dataset.view === 'drum'
      const folded = page.querySelector('.wtop.slim') && !page.querySelector('.drum-head .exmedia, .drum-head .exhead-tg[aria-expanded="true"], .drum-tab[aria-expanded="true"]')
      const last = !drum ? 0 : folded ? FIT_STEPS - 1 : FOOT_STEPS - 1
      // Down to the tab bar — or to the top of its start button, which stands out above it.
      const tabs = document.getElementById('tabbar')
      const tops = tabs ? [tabs, ...tabs.children].map(el => el.getBoundingClientRect().top) : [window.innerHeight]
      const room = Math.min(...tops) - 8
      let step = 0
      if (last) {
        for (; step < last; step++) {
          set(step)
          if (foot.getBoundingClientRect().bottom + (window.scrollY || 0) <= room) break
        }
      }
      set(step)
    }
    const later = () => {
      if (typeof requestAnimationFrame === 'undefined') { fit(); return }
      cancelAnimationFrame(raf); raf = requestAnimationFrame(fit)
    }
    later()
    window.addEventListener('resize', later)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later)
    ro?.observe(page)
    return () => { window.removeEventListener('resize', later); ro?.disconnect(); if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf) }
  }, [])

  return <div className="narrow" ref={pageEl} data-fit="0" data-view={S.setView}>
    {/* Pinned for the whole session. Mid-workout you are scrolled deep into a list of sets,
        and the session name, its progress, the running order and where you are in it are
        exactly the things that have to stay on screen while you scroll. */}
    {/* In the drum the set in front is what the screen is for, so the header folds down to its
        title bar: the name, the clock, the sets done and where you are stay; the session note,
        the rest between exercises and the rest of it are one tap on the title away. */}
    <div className={'wtop' + (isDeloadWorkout(A) ? ' deload' : '') + (slimTop ? ' slim' : '')}>
      <div className="hdr">
        {/* With no tab bar under a running session, this is the way out to the rest of the app;
            the session keeps running and the tab bar's Resume brings you back to it. */}
        <div className="row" style={{ gap: 2, flex: 'none' }}>
        <button className="iconbtn" aria-label={t('Home')} title={t('Home')} onClick={() => nav('/home')}><Icon name="house" /></button>
        <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); stopWork(); nav('/home') } })}><Icon name="xmark" /></button>
        </div>
        {/* Tapping the title folds the session's own line (position, note, rest between
            exercises) away and back, in every view. */}
        <button type="button" className="wtop-tg" data-testid="workout-top" aria-expanded={!slimTop}
          aria-label={slimTop ? t('Show workout details') : t('Hide workout details')} onClick={() => setTopOpen(!slimTop ? false : true)}>
          <div className="wtop-name"><span>{A.name}</span><Icon name={slimTop ? 'chevronDown' : 'chevronUp'} /></div>
          <div className="sub">{A.backfill ? fmtDate(A.d, true) : <Elapsed start={A.start} />}{estSec > 0 && <> / {t('~{0} min', Math.round(estSec / 60))}</>} ·{t('{0} sets', done + '/' + total)}{A.rirGoal != null && <> · <span className="wtop-rir" title={t('Target effort this microcycle')}>{goalLabel(S, A.rirGoal)}</span></>}{slimTop && !!A.entries.length && <> · {position}</>}</div>
        </button>
        {/* Pause sets the session aside unfiled, to be resumed within this microcycle; a past
            workout being logged has no clock to stop. */}
        <div className="row" style={{ gap: 2, flex: 'none' }}>
        {!A.backfill && <button className="iconbtn" style={{ color: 'var(--orange)' }} aria-label={t('Pause')} title={t('Pause')}
          onClick={pauseWorkout}><Icon name="pause" /></button>}
        <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
        </div>
      </div>
      <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
      {/* The running order at a glance: tap a thumbnail to jump, press and hold one to drag its
          exercise (or its whole superset capsule) somewhere else in the session. The buttons
          below do the same two things without a pointer, so nothing here is the only way in.
          It stays when the header folds: it is how you get around the session. */}
      {!sessionView && <WorkoutDock entries={A.entries} cur={cur} disabled={!!work}
        onSelect={selectExercise} onReorder={dropEntry} onAdd={addExercise} />}
      {!slimTop && <>
      <DeloadSessionBand active={A} />
      {A.backfill && <div className="muted small" style={{ marginBottom: 8 }}>{t('Logging a past workout — no rest timers.')}</div>}
      {!!A.entries.length && <div className="row wpos" style={{ gap: 6, marginBottom: 6 }}>
        <span className="muted small" data-testid="workout-position">{position}</span>
        {/* When the animation is hidden (Media's toggle stepped it to 'off'), the only way back
            lives here beside the position label, out of the way of the sets. */}
        {S.gifSize === 'off' && <button className="giftoggle inline" data-testid="show-media"
          onClick={() => update(s => { s.gifSize = 'full' })}>
          <Icon name="expand" />{t('Expand')}
        </button>}
        {/* The note on the whole session, beside the rest of the session's own settings. */}
        <button className={'giftoggle inline' + (A.note ? '' : ' plain')} data-testid="session-note"
          aria-label={A.note ? t('Edit session note') : t('Add session note')} onClick={sessionNoteSheet}>
          <Icon name="pencil" />{t('Note')}
        </button>
        {/* Every rest of this session, adjustable without leaving it: between sets for all its
            exercises, and between exercises. Lit while the session has changed one. Nothing to
            adjust on a past workout (no timers). */}
        {!A.backfill && <button className={'giftoggle inline' + (restPicked ? '' : ' plain')} data-testid="rest-ex"
          style={{ marginLeft: 'auto' }} aria-label={t('Rests (this workout)')} onClick={openSessionRest}>
          <Icon name="timer" /><span>{t('Rests')}</span>
        </button>}
      </div>}
      </>}
    </div>

    {A.entries.length ? <>
      {/* `data-owns-swipe` keeps the app-level ScreenSlider off this subtree. Both take the
          pointer on the same pointerdown, and the outer one runs last, so its capture replaced
          this one and every move went there instead — the gesture below never saw a single
          one. See the same attribute in components/ScreenSlider.jsx. */}
      <div className="workout-swipe-surface" data-owns-swipe data-testid="workout-swipe-surface" ref={swipeSurface}
        onPointerDown={onSwipePointerDown}
        onPointerMove={onSwipePointerMove}
        onPointerUp={event => finishSwipe(event, true)}
        onPointerCancel={event => finishSwipe(event, false)}
        onLostPointerCapture={event => {
          if (swipe.current?.id === event.pointerId) { swipe.current = null; setRowDrag(null) }
        }}
        onClickCapture={event => {
          if (!swipeClick.current) return
          swipeClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }}>
      {sessionView
        ? <SessionFlow entries={A.entries} cur={cur} renderBlock={sessionBlock} onSelect={selectExercise}
          onReorder={dropEntry} disabled={!!work}
          headOpen={idx => !!openHeads[idx]} onToggleHead={toggleHead} bindExRef={bindExRef} />
        : <SlideDeck current={unitIdx} peek={unitDrag?.target ?? null} dir={unitDrag?.dir ?? 0} dx={unitDrag?.dx ?? 0}
          directionOf={(from, to) => (to > from ? 1 : -1)} render={renderUnit} turn />}
      </div>
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    {/* The foot of the session: paging between exercises, then, in its bottom left corner, the
        view of the sets, and one bar for the running order. Finishing (✓), swapping an exercise
        (its header) and the session note (the header's details) are all up top, so none of them
        is repeated down here. The view toggle is here rather than in the header so it is one
        thumb away in every view, the drum's folded header included. */}
    <div className="wfoot" ref={footEl}>
      {!sessionView && <div className="wnav">
        <Button variant="tinted" icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => navigateUnit(-1)}>{t('Prev')}</Button>
        <Button variant="tinted" trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => navigateUnit(1)}>{t('Next')}</Button>
      </div>}
      {!!A.entries.length && <div className="wview">
        <button type="button" className="wtool" data-testid="set-view" aria-label={t(SET_VIEW_COPY[nextView].aria)} onClick={switchView}>
          <Icon name={SET_VIEW_COPY[nextView].icon} /><span>{t(SET_VIEW_COPY[nextView].label)}</span></button>
      </div>}
      {A.entries.length
        ? <div className="wtools" role="toolbar" aria-label={t('Exercises')}>
          <button type="button" className="wtool" aria-label={t('Add exercise')} onClick={addExercise}>
            <Icon name="plus" /><span>{t('Add exercise')}</span></button>
          <button type="button" className="wtool del" aria-label={t('Remove exercise')} disabled={!!work} onClick={removeExerciseSheet}>
            <Icon name="trash" /><span>{t('Remove exercise')}</span></button>
        </div>
        : <Button onClick={addExercise} icon="plus">{t('Add exercise')}</Button>}
    </div>
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}

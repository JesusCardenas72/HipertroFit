import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, freestyleConfig, defaultConfig, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort, cascadeWeight, insertWarmupRow, removeRowAt, pairAdjacent, unpairSuperset, cleanupSg, applyIntensifierPlan, pinnedNoteFor, exNoteFor } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { insertionIndexAfterCurrentUnit, markResumeAt, nextUnfinishedUnit, resumeEntryIdx, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, unitEntryIdx } from '../lib/supersetFlow.js'
import { restBetweenExercisesSec, restExLabel, settingChoice, REST_EX_PRESETS } from '../lib/rest-between.js'
import Media, { Thumb } from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, exerciseNoteSheet, sessionNoteSheet, swapActiveWorkoutExercise } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField, SelectSheet } from '../components/ui.jsx'
import { nextPrescription, applyPrescription, defaultIncrement } from '../lib/progression.js'
import { progressionGuidance } from '../lib/progression-copy.js'
import { doubleProgressStatus, applyProgressionChoice } from '../lib/double-progress.js'
import { DoubleProgressMeter, progressionSheet } from '../components/DoubleProgress.jsx'
import { playProgressSound } from '../lib/custom-sound.js'
import { glyphOf } from '../lib/glyphs.js'
import { isWarmupRow, isDropSet, isRestPauseSet, dropsOf, clustersOf, addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt, nextDropWeight, nextBurstReps } from '../lib/workout-model.js'
import { moveActiveWorkoutUnitTo } from '../lib/active-workout-order.js'
import WorkoutDock from '../components/WorkoutDock.jsx'
import { DeloadStatus, DeloadSessionBand } from '../components/Deload.jsx'
import { isDeloadWorkout } from '../lib/mesocycle.js'
import { workIndexOf, referenceSet, suggestionFor, overloadOf, extraSetsWanted, seedTargets, topWeight } from '../lib/set-reference.js'
import { swipeLock, rowOffset, rowArmed, navDirection, navCommit } from '../lib/swipe.js'
import { edgeOffset } from '../lib/slide.js'
import SlideDeck from '../components/SlideDeck.jsx'
import SetDrum from '../components/SetDrum.jsx'
import { drumChambers } from '../lib/drum.js'

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
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    <DeloadStatus />
    {todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
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
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
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

/* ---------- what a set row of one exercise is made of — shared by the list and the drum ---------- */
function useSetColumns(entryIdx, onField) {
  const S = useStore(s => s.S)
  const entry = S.active.entries[entryIdx]
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // Set-by-set reference: what the same position did last session, and what today's row should
  // carry to actually overload it. The aggregate "Last time" line answers how the session
  // went; this answers what to type into the row in front of you (lib/set-reference.js).
  const prevSets = last ? last.sets : []
  // The prescription speaks about last session's top weight; each row moves from its own set.
  const prevTop = topWeight(prevSets)
  const loadStep = defaultIncrement(entry.id, S.unit)
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  return { entry, mode, cardio, timed, cfg, last, prevSets, prevTop, loadStep, plan, kind, col1, col2, col3, bump }
}

// Drops/bursts mutate the row in place — same card, not a new set with its own long rest.
// A planned exercise (see the exercise's "Intensifier" config) arrives with these already
// filled in by applyIntensifierPlan; these only add/edit/remove entries live from here on.
function useRowEditors(entryIdx) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const entry = S.active.entries[entryIdx]
  const mutSet = (i, fn) => update(s => { const row = s.active.entries[entryIdx].sets[i]; s.active.entries[entryIdx].sets[i] = fn(row) }, true)
  const addDropRow = i => mutSet(i, row => {
    const drops = dropsOf(row)
    const base = drops.length ? drops[drops.length - 1].w : (row.w || 0)
    const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : undefined
    return addDrop(row, { w: nextDropWeight(base, pct), r: row.r })
  })
  // A rest-pause row's own reps are always the total across every burst (see
  // applyIntensifierPlan/history.js) — clusters are the breakdown of that total, not extra on
  // top of it — so adding, removing or editing one keeps `r` in step by the same delta.
  const addBurstRow = i => mutSet(i, row => {
    const clusters = clustersOf(row)
    const base = clusters.length ? clusters[clusters.length - 1].r : (row.r || 0)
    const restSec = entry.target?.intensifier?.type === 'restpause' ? entry.target.intensifier.restSec : (S.restPauseSec || 15)
    const added = nextBurstReps(base)
    return { ...addCluster(row, { r: added, restSec }), r: (row.r || 0) + added }
  })
  const removeDrop = (i, di) => mutSet(i, row => removeDropAt(row, di))
  const removeCluster = (i, ci) => mutSet(i, row => {
    const removed = clustersOf(row)[ci]?.r || 0
    return { ...removeClusterAt(row, ci), r: Math.max(0, (row.r || 0) - removed) }
  })
  const setDropField = (i, di, field, v) => mutSet(i, row => setDropAt(row, di, { [field]: v }))
  const setClusterField = (i, ci, v) => mutSet(i, row => {
    const delta = (Number(v) || 0) - (clustersOf(row)[ci]?.r || 0)
    return { ...setClusterAt(row, ci, { r: v }), r: Math.max(0, (row.r || 0) + delta) }
  })
  return { addDropRow, addBurstRow, removeDrop, removeCluster, setDropField, setClusterField }
}

// A smaller stepper for a drop's weight/reps or a burst's reps — editing what the plan (or a
// live "+ Drop"/"+ Burst" tap) already put on the row, not typing into a fresh field.
const miniStepper = (value, step, dec, onChange) => (
  <div className="stp mini">
    <button aria-label={t('Decrease')} onClick={() => onChange(Math.max(0, Math.round(((value || 0) - step) * 100) / 100))}><Icon name="minus" /></button>
    <span className="val"><NumberField decimal={dec} value={value ?? ''} onChange={onChange} /></span>
    <button aria-label={t('Increase')} onClick={() => onChange(Math.max(0, Math.round(((value || 0) + step) * 100) / 100))}><Icon name="plus" /></button>
  </div>
)

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, drum, nameless, nextSet = -1, onToggle, onField, onAddSet, onRemoveSet, onAddWarmup, onRemoveSetAt, onStartTimed, onPairPrev, onPairNext, onSetRowRef, onProgressionSettings, onOpenProgression, onSwap, onRemove, swipeSet, swipeDx = 0, open = true, onToggleHead }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const { addDropRow, addBurstRow, removeDrop, removeCluster, setDropField, setClusterField } = useRowEditors(entryIdx)
  const ex = exOr(entry.id)
  const { mode, cardio, timed, cfg, last, prevSets, prevTop, loadStep, plan, kind, col1, col2, col3, bump } = useSetColumns(entryIdx, onField)
  const [mediaOpen, setMediaOpen] = useState(false)
  const standingNote = exNoteFor(S, entry.id)
  // Only worth surfacing while there is still work left: once the exercise is finished, a note
  // telling you what to do in it is behind you, and the block is already long.
  const pinnedNote = entry.sets.some(s => !s.done) ? pinnedNoteFor(S, entry.id) : null
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  const guidance = progressionGuidance(plan)
  // Double progression gets its picture — where last session's sets sit in the rep range — and,
  // the session the top of the range was earned, the question of what to add.
  const doubleTrack = plan?.policy === 'double' && mode === 'reps'
  // A policy may decide the next step is another set rather than another plate, and a set
  // dropped by hand leaves the list short of last time. Either way the fix is one tap.
  const extraSets = extraSetsWanted(plan, entry.sets, prevSets)
  const workSetCount = entry.sets.filter(x => !isWarmupRow(x)).length
  // Weight goes first so its cascade to the rows below happens before the reps land.
  const applySuggestion = (i, sug) => { Object.keys(sug).forEach(f => onField(i, f, sug[f])) }
  const dpStatus = doubleTrack && !compact ? doubleProgressStatus(S, cfg, S.routines.find(r => r.id === S.active.routineId)) : null
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label={t('Decrease')} onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label={t('Increase')} onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )
  // In the drum the set in front is the screen: the animation shrinks to a thumbnail beside the
  // name (tap it for the full one), and what the header says folds down to what fits a line.
  const thumb = drum && S.gifSize !== 'off' && !!(ex.gif || ex.img)
  const folded = drum && !open
  const note = (text, extra) => folded
    ? <button type="button" className="exnote fold" onClick={onToggleHead} {...extra}>{text}</button>
    : <div className="exnote" {...extra}>{text}</div>
  return <>
    {!drum && <Media ex={ex} key={entry.id} compact={compact} minimizable />}
    {/* The name is the toggle: collapsed, the screen is the name and the sets; tapping it opens
        the exercise's tools, tags and last session. In a superset's drum the name already sits in
        the exercise's own box above the drum, and that box is the toggle (`nameless`), so this
        row only appears once it is open, for the tools. */}
    {(!nameless || open) && <div className={'row between' + (drum ? ' exhead-drum' : '')} style={{ marginBottom: 6 }}>
      {thumb && <button type="button" className={'exthumb' + (mediaOpen ? ' on' : '')} aria-expanded={mediaOpen}
        aria-label={mediaOpen ? t('Minimize') : t('Expand')} onClick={() => setMediaOpen(o => !o)}>
        <Thumb ex={ex} />{ex.gif && <Icon name={mediaOpen ? 'minimize' : 'play'} />}
      </button>}
      {!nameless && <button type="button" className="exhead-tg" aria-expanded={open} onClick={onToggleHead}
        style={{ fontSize: compact || drum ? 17 : 20 }}>
        <span>{exerciseNameFor(ex)}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="exhead-chev" />
      </button>}
      {open && <div className="row" style={{ gap: 2, flex: 'none', marginLeft: nameless ? 'auto' : undefined }}>
        <button className="iconbtn" aria-label={t('Note')} title={t('Note')}
          style={entry.note ? { color: 'var(--acc)' } : undefined}
          onClick={() => exerciseNoteSheet(entryIdx)}><Icon name="pencil" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
        {onSwap && <button className="iconbtn" aria-label={t('Swap exercise')} title={t('Swap exercise')}
          disabled={!!working} onClick={onSwap}><Icon name="shuffle" /></button>}
        {onRemove && <button className="iconbtn danger" aria-label={t('Remove exercise')} title={t('Remove exercise')}
          disabled={!!working} onClick={onRemove}><Icon name="trash" /></button>}
      </div>}
    </div>}
    {thumb && mediaOpen && (!nameless || open) && <Media ex={ex} key={entry.id} compact={compact} />}
    {open && !compact && (onPairPrev || onPairNext) && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {onPairPrev && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with previous')} onClick={onPairPrev}>{t('Make superset with previous')}</Button>}
      {onPairNext && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with next')} onClick={onPairNext}>{t('Make superset with next')}</Button>}
    </div>}
    {open && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !s.done)?.r ?? entry.sets[0]?.r)))}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>}
    {/* Three notes can apply to one exercise and they are not interchangeable, so each keeps its
        own line and its own icon: the plan's instruction (cfg.note, from the routine), the
        standing fact about the movement (exNotes), and the message you pinned to yourself last
        session. Today's own note is edited through the button in the header and shown last. */}
    {/* Folded in the drum, each is one line that opens the header to read it in full. */}
    {cfg.note && note(cfg.note)}
    {standingNote && note(<><Icon name="info" style={{ fontSize: 13, marginRight: 5, verticalAlign: '-2px' }} />{standingNote}</>)}
    {pinnedNote && note(<>
      <Icon name="flag" style={{ fontSize: 13, marginRight: 5, verticalAlign: '-2px' }} />
      {t('From {0}:', fmtDate(pinnedNote.d, true))} {pinnedNote.note}
    </>, { style: { color: 'var(--yellow)' } })}
    {entry.note && note(entry.note)}
    {open && last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {/* The drum's hero already reads last time against today's target, lever by lever; the
        reasoning behind it and the double-progression meter wait in the opened header. */}
    {guidance && !folded && <button type="button" className={'progline' + ((plan.kind === 'deload' || plan.fatigue) ? ' warn' : '')}
      aria-label={t('Open progression settings')} onClick={onProgressionSettings}>
      <Icon name={plan.kind === 'up' || plan.kind === 'decide' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : plan.fatigue ? 'bolt' : 'lightbulb'} />
      <span><strong>{t(guidance.policyLabel)}</strong> · {t(...guidance.why)}</span>
    </button>}
    {/* The question itself is a window that pops up on its own (see openProgression); this is
        the way back to it once it was put off with the sheet closed some other way. */}
    {doubleTrack && plan.kind === 'decide' && !entry.decided && onOpenProgression &&
      <button type="button" className="dpask" onClick={onOpenProgression}>
        <Icon name="sparkles" /><span>{t('Time to progress')}</span><Icon name="chevronRight" />
      </button>}
    {dpStatus && !folded && dpStatus.state !== 'first' && !entry.decided && <DoubleProgressMeter status={dpStatus} unit={S.unit} compact live />}
    {/* In the drum the sets are the drum's (see SetDrum) — this block is only the exercise's header. */}
    {!drum && <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* Warm-up sets seed the ramp to the work sets, so the button to add one sits at the top
          of the list, above the column legends — not down in the footer with Add/Remove set. */}
      <div className="row" style={{ marginBottom: 8 }}>
        <Button size="sm" icon="flame" onClick={onAddWarmup}>{t('Add warm-up set')}</Button>
      </div>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      {entry.sets.map((s, i) => {
        const warm = isWarmupRow(s)
        const warmBefore = i > 0 && isWarmupRow(entry.sets[i - 1])
        const isFirstWarmup = warm && !warmBefore
        // Numbering restarts per phase: with two warm-ups the first work set reads 1, not 3.
        const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
        // The last remaining set is not removable (removeRowAt refuses it), so it never peels
        // open — a swipe there pages between exercises like the space around it.
        const removable = entry.sets.length > 1
        const dragging = swipeSet === i
        const offset = dragging ? rowOffset(swipeDx) : 0
        const armed = dragging && rowArmed(swipeDx)
        // What this same set position did last time, and — when the row has drifted from what
        // the progression asks of it — a chip that writes the target back in. Warm-ups are prep,
        // so they get neither; a logged set keeps the reference and loses the chip.
        const ref = warm ? null : referenceSet(prevSets, workIndexOf(entry.sets, i))
        const sug = warm ? null : suggestionFor({ mode, plan, row: s, reference: ref, effort: col3 ? kind : null, base: prevTop, step: loadStep })
        // Last time's number for one column, printed straight above the stepper it belongs to.
        const prevVal = col => {
          const v = ref ? ref[col.f] : null
          return <span className={'pv ' + col.cls}>{v == null || v === '' ? '—' : fmtNum(v)}</span>
        }
        return <div key={i}>
          {isFirstWarmup && <div className="setph">{t('Warm-up')}</div>}
          {/* Mirror of the warm-up header: where the warm-ups give way to the work sets, the
              divider carries its own label instead of being a bare line. */}
          {!warm && warmBefore && <div className="setph">{t('Working sets')}</div>}
          {ref && <div className={'setprev' + (col3 ? ' eff3' : '')} aria-label={t('Last') + ': ' + setLabel(entry.id, ref, last.target)}>
            <span className="subn" title={t('Last')}><Icon name="history" />Anterior:</span>
            {prevVal({ ...col1, cls: 'w' })}
            {col2 && prevVal({ ...col2, cls: 'r' })}
            {col3 && prevVal({ ...col3, cls: 'eff' })}
            {timed && <span className="ck-sp" />}
            <span className="ck-sp" />
          </div>}
          {/* Swipe a row right and it slides off its own red delete track (the same removal the
              warm-up rows' × button does). The track is only mounted while that row is being
              dragged, so a resting list stays exactly the markup it always was. */}
          <div className={'setswipe' + (dragging ? ' dragging' : '')}>
            {dragging && <div className={'setswipe-track' + (armed ? ' armed' : '')} aria-hidden="true"><Icon name="trash" /></div>}
            <div ref={el => onSetRowRef?.(i, el)} className={'setrow' + (s.done ? ' done' : '') + (i === nextSet ? ' next' : '') + (col3 ? ' eff3' : '')}
              data-swipe-row={entryIdx} data-swipe-set={i} data-swipe-removable={removable ? '1' : undefined}
              style={dragging ? { transform: 'translateX(' + offset + 'px)' } : undefined}>
              <div className="n">{phaseNum}</div>
              {cell(s, i, col1, 'w')}
              {col2 && cell(s, i, col2, 'r')}
              {/* A warm-up is prep, not a set taken near failure, so it logs no effort — the
                  empty slot keeps its weight and reps under their column headers. */}
              {col3 && (warm ? <span className="eff-sp" /> : cell(s, i, col3, 'eff'))}
              {/* A timed set is started, not typed: the timer counts the hold down and checks the
                  set off itself. The checkbox stays for anyone who timed it on their own watch. */}
              {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
                onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
              {warm && <button className="iconbtn" style={{ fontSize: 13 }} aria-label={t('Remove set')}
                disabled={entry.sets.length <= 1} onClick={() => onRemoveSetAt(i)}><Icon name="xmark" /></button>}
              <Check checked={s.done} onChange={() => onToggle(i)} />
            </div>
          </div>
          {sug && <div className="setsug">
            <button type="button" className="chip add" onClick={() => applySuggestion(i, sug)}
              aria-label={t('Use the suggested weight and reps')} title={t('Use the suggested weight and reps')}>
              <Icon name="chevronRight" />{setLabel(entry.id, { ...s, ...sug }, cfg)}</button>
          </div>}
          {/* Drop-sets and rest-pause bursts extend this same row — no long rest, no new set.
              A planned exercise arrives with these already filled in (applyIntensifierPlan);
              every value here is just as editable as the main row's own weight/reps. */}
          {!warm && mode === 'reps' && <>
            {dropsOf(s).map((d, di) => (
              <div className="subrow" key={'d' + di}>
                <span className="subn">{t('Drop {0}', di + 1)}</span>
                {miniStepper(d.w, 2.5, true, v => setDropField(i, di, 'w', v))}
                {miniStepper(d.r, 1, false, v => setDropField(i, di, 'r', v))}
                <button className="iconbtn" aria-label={t('Remove drop')} onClick={() => removeDrop(i, di)}><Icon name="xmark" /></button>
              </div>
            ))}
            {clustersOf(s).map((c, ci) => (
              <div className="subrow" key={'c' + ci}>
                <span className="subn">{t('Burst {0}', ci + 1)}</span>
                {miniStepper(c.r, 1, false, v => setClusterField(i, ci, v))}
                <span className="dim small">{c.restSec}s</span>
                <button className="iconbtn" aria-label={t('Remove burst')} onClick={() => removeCluster(i, ci)}><Icon name="xmark" /></button>
              </div>
            ))}
            <div className="setextra">
              {!isRestPauseSet(s) && <button className="chip add" onClick={() => addDropRow(i)}><Icon name="arrowDown" />{t('+ Drop')}</button>}
              {!isDropSet(s) && <button className="chip add" onClick={() => addBurstRow(i)}><Icon name="bolt" />{t('+ Burst')}</button>}
            </div>
          </>}
        </div>
      })}
      {extraSets > 0 && <div className="setextra">
        <button type="button" className="chip add nocap" onClick={onAddSet}>
          <Icon name="plus" />{t('Add set — {0} to do', workSetCount + extraSets)}</button>
      </div>}
      <div style={{ height: 8 }} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>}
  </>
}

/* ---------- the drum's front chamber: one set, drawn as large as the screen allows ---------- */
const DRUM_LETTERS = 'ABCDEFGH'
const FIT_STEPS = 5    // how many sizes the drum screen comes in (.narrow[data-fit] in index.css)
const FOOT_STEPS = 3   // the first of them, which only shrink the foot (prev / next and its tools)
// "+2,5 kg", "+1 rep", "−1 RIR" — one lever of overloadOf, signed the way it reads on the bar.
function deltaLabel({ f, d }) {
  const n = (d > 0 ? '+' : '−') + fmtNum(Math.abs(d))
  if (f === 'w') return `${n} ${useStore.getState().S.unit}`
  if (f === 'r') return `${n} ${Math.abs(d) === 1 ? t('rep') : t('reps')}`
  if (f === 'sec') return `${n} s`
  return `${n} ${f.toUpperCase()}`
}
function DrumHero({ chamber, members, onToggle, onField, onStartTimed, onRemoveSetAt, onAddWarmup, onAddSet }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const { entry: entryIdx, set: i } = chamber
  const { entry, mode, timed, cfg, last, prevSets, prevTop, loadStep, plan, kind, col1, col2, col3, bump } = useSetColumns(entryIdx, (row, f, v) => onField(entryIdx, row, f, v))
  const { addDropRow, addBurstRow, removeDrop, removeCluster, setDropField, setClusterField } = useRowEditors(entryIdx)
  const s = entry.sets[i]
  if (!s) return null
  const warm = chamber.warm
  const lastSet = !warm && chamber.num === chamber.of
  const ref = warm ? null : referenceSet(prevSets, workIndexOf(entry.sets, i))
  const want = { mode, plan, reference: ref, effort: col3 ? kind : null, base: prevTop, step: loadStep }
  const sug = warm ? null : suggestionFor({ ...want, row: s })
  // Measured from the numbers in the steppers, not the plan's: they start as the plan's target
  // (seedTargets) and the capsules follow every +/- from there.
  const moved = overloadOf(s, ref)
  // A warm-up logs no effort (see ExerciseBlock), so its chamber has no effort column.
  const cols = [col1, col2, warm ? null : col3].filter(Boolean)
  const set = (f, v) => onField(entryIdx, i, f, v)
  // A warm-up is prep and a hold or a cardio block has no plate to strip, so only a loaded work
  // set takes a drop or a burst.
  const intensify = !warm && mode === 'reps'
  const drops = dropsOf(s), bursts = clustersOf(s)
  return <div className={'dh' + (s.done ? ' done' : '') + (warm ? ' warm' : '') + ' n' + cols.length}>
    <span className="dh-wm" aria-hidden="true">{chamber.num}</span>
    {s.done && <span className="dh-stamp" aria-hidden="true">{t('Set done')}</span>}
    <div className="dh-top">
      {members > 1 && <span className={'dh-let m' + chamber.member}>{DRUM_LETTERS[chamber.member]}</span>}
      <div className="dh-kind">
        {warm ? <><Icon name="flame" />{t('Warm-up')}</> : t('Set {0}', chamber.num)}
        <small> / {chamber.of}</small>
      </div>
      {members > 1 && <div className="dh-ex">{exerciseNameFor(exOr(entry.id))}</div>}
    </div>
    {/* Today's numbers are the steppers' own, so they are not spelled out again: one line says
        what this set did last time and, beside it, the lever that moved since — so "the same
        numbers again" still can't pass for a prescription. Only when the steppers have drifted
        from the plan does its target show, on the chip that writes it back in. */}
    {(ref || sug) && <div className="dh-ref">
      <div className="dh-line prev">
        {ref && <>
          <span className="dh-tag"><Icon name="history" />{t('Last')}</span>
          <b>{setLabel(entry.id, ref, last.target)}</b>
        </>}
        {ref && (moved.length
          ? moved.map(m => <span className="dh-delta" key={m.f}>{deltaLabel(m)}</span>)
          : <span className="dh-delta none">{t(plan?.fatigue ? 'No overload — accumulated fatigue' : 'No overload')}</span>)}
        {sug && <button type="button" className="chip add nocap dh-apply" onClick={() => Object.keys(sug).forEach(f => set(f, sug[f]))}
          aria-label={t('Use the suggested weight and reps')} title={t('Use the suggested weight and reps')}>
          <Icon name="sparkles" />{setLabel(entry.id, { ...s, ...sug }, cfg)}</button>}
      </div>
    </div>}
    <div className="dh-cols">
      {cols.map(col => <div className={'dh-col' + (col.eff ? ' eff' : '')} key={col.f}>
        <div className="dh-l">{col.hd}</div>
        <button className="dh-b" aria-label={t('Increase')} onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
        <div className="dh-v" style={{ '--chars': Math.max(2, String(s[col.f] ?? '').length) }}><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
          onChange={v => set(col.f, col.eff ? capEffort(col.eff, v) : v)} /></div>
        <button className="dh-b" aria-label={t('Decrease')} onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      </div>)}
    </div>
    {/* The drop-set and rest-pause rows this set has grown, edited where they were added. */}
    {intensify && (drops.length > 0 || bursts.length > 0) && <div className="dh-int">
      {drops.map((d, di) => (
        <div className="subrow" key={'d' + di}>
          <span className="subn">{t('Drop {0}', di + 1)}</span>
          {miniStepper(d.w, 2.5, true, v => setDropField(i, di, 'w', v))}
          {miniStepper(d.r, 1, false, v => setDropField(i, di, 'r', v))}
          <button className="iconbtn" aria-label={t('Remove drop')} onClick={() => removeDrop(i, di)}><Icon name="xmark" /></button>
        </div>
      ))}
      {bursts.map((c, ci) => (
        <div className="subrow" key={'c' + ci}>
          <span className="subn">{t('Burst {0}', ci + 1)}</span>
          {miniStepper(c.r, 1, false, v => setClusterField(i, ci, v))}
          <span className="dim small">{c.restSec}s</span>
          <button className="iconbtn" aria-label={t('Remove burst')} onClick={() => removeCluster(i, ci)}><Icon name="xmark" /></button>
        </div>
      ))}
    </div>}
    {/* Everything else you can do to the set list, in one bar: what extends this set (a drop, a
        burst), then what changes the list around it (a warm-up before, a set after, this one
        gone). A slot that does not apply stays put, greyed, so nothing jumps under the thumb —
        except "One more", which only the last set carries. */}
    <div className="dh-bar" role="toolbar" aria-label={t('Set tools')}>
      {intensify && <>
        <button type="button" className="dh-tool" disabled={isRestPauseSet(s)} onClick={() => addDropRow(i)}>
          <Icon name="arrowDown" /><span>{t('Drop')}</span></button>
        <button type="button" className="dh-tool" disabled={isDropSet(s)} onClick={() => addBurstRow(i)}>
          <Icon name="bolt" /><span>{t('Burst')}</span></button>
        <span className="dh-bar-sep" aria-hidden="true" />
      </>}
      <button type="button" className="dh-tool" aria-label={t('Add warm-up set')} onClick={() => onAddWarmup(entryIdx)}>
        <Icon name="flame" /><span>{t('Warm up')}</span></button>
      {/* Only the exercise's last set grows the list: "one more" means one after the last. */}
      {lastSet && <button type="button" className="dh-tool" aria-label={t('Add set')} onClick={() => onAddSet(entryIdx)}>
        <Icon name="plus" /><span>{t('One more')}</span></button>}
      <button type="button" className="dh-tool del" aria-label={t('Remove set')} disabled={entry.sets.length <= 1 || !!working}
        onClick={() => onRemoveSetAt(entryIdx, i)}>
        <Icon name="trash" /><span>{t('Remove')}</span></button>
    </div>
    <div className="dh-act">
      {timed && <button className="dh-play" aria-label={t('Start set')} disabled={s.done || !!working}
        onClick={() => onStartTimed(entryIdx, i)}><Icon name="play" /></button>}
      <button type="button" role="checkbox" aria-checked={!!s.done} className={'dh-go' + (s.done ? ' on' : '')}
        onClick={() => onToggle(entryIdx, i)}>
        <span className="dh-go-ic"><Icon name="check" /></span>
        <span>{s.done ? t('Done · tap to undo') : t('Complete set')}</span>
      </button>
    </div>
  </div>
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
  const update = useStore(s => s.update)
  const { startRest: liveRest, endExercise: liveEndExercise, stopRest, stopWork, work } = useUI()
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
  const [topOpen, setTopOpen] = useState(false)
  // The exercise being dragged into view, once a swipe has committed to the horizontal axis:
  // { dir, target, dx }, or null whenever nothing is being dragged — which is nearly always.
  const [unitDrag, setUnitDrag] = useState(null)
  // A gesture that started on a stepper button must not leave a click behind when it ends.
  const swipeClick = useRef(false)
  const progressHighWater = useRef(A.entries.map(e => e.sets.filter(s => s.done).length))
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
      const el = (setIdx >= 0 && setRefs.current.get(entry)?.get(setIdx)) || exRefs.current.get(entry)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, delay)
    return () => clearTimeout(t)
  }, [cur, A.entries.length, sheetsOpen, setsDoneNow, resumeId])

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
    e.sets = insertWarmupRow(e.sets, m, e.target || {}, defaultIncrement(e.id, S.unit))
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
  // A dropped thumbnail can land anywhere in the session, not just one place over — and it
  // carries its whole superset with it, so an order that splits a pair is not expressible.
  const reorderUnitTo = (index, slot) => applyReorder(a => moveActiveWorkoutUnitTo(a, index, slot))
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
      ? { entry: Number(rowEl.dataset.swipeRow), set: Number(rowEl.dataset.swipeSet) }
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
      removeSetAt(start.row.entry, start.row.set)
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
      const step = defaultIncrement(activeEntry.id, s.unit)
      // A config without a set count keeps the rows the session already has.
      if (!(full.sets > 0)) full.sets = activeEntry.sets.filter(x => !isWarmupRow(x)).length || 1
      const plan = nextPrescription(s, full, activeRoutine)
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
      const next = applyProgressionChoice(e, choice, { step: defaultIncrement(e.id, s.unit), unit: s.unit })
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

  const addExercise = () => exercisePicker(ex => {
    const routine = S.routines.find(r => r.id === A.routineId)
    const freestyle = !A.routineId
    // Freestyle has no routine prescription to apply: show the last target in the config
    // sheet and carry its completed rows forward. A planned session keeps its existing path.
    const seed = freestyle ? freestyleConfig(S, { id: ex.id, ...defaultConfig(ex.id) }) : null
    exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = freestyle ? null : nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      const sets = buildSets(s, full, { step: defaultIncrement(ex.id, s.unit), ...(freestyle ? { preferLast: true } : {}) })
      const progressed = freestyle ? sets : seedTargets(applyPrescription(sets, plan, defaultIncrement(ex.id, s.unit)),
        lastEntryFor(s, ex.id)?.sets, { mode: modeOf(full), plan, effort: effortOf(s), step: defaultIncrement(ex.id, s.unit) })
      const insertAt = insertionIndexAfterCurrentUnit(supersetUnits(s.active.entries), s.active.cur, s.active.entries.length)
      s.active.entries.splice(insertAt, 0, { id: ex.id, target: { ...cfg }, plan, sets: applyIntensifierPlan(progressed, full) })
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
      const restSec = restSecFor(fresh.entries, freshUnit || [idx], S.restSec)
      // Once the exercise (or superset) is finished, the break before the next one can have its
      // own length — the workout's choice, else Settings, else the rest above. See rest-between.js.
      const exRestSec = restBetweenExercisesSec(restSec, fresh.restExSec, S.restExSec)
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

  // This session's rest between exercises: 'app' follows Settings, anything else overrides it
  // for this workout only (S.active.restExSec).
  const workoutRestEx = A.restExSec === 'sets' || typeof A.restExSec === 'number' ? A.restExSec : null
  const restExChoice = workoutRestEx ?? settingChoice(S.restExSec)
  const openRestExPicker = () => useUI.getState().openSheet(close => <SelectSheet
    title={t('Rest between exercises (this workout)')}
    value={workoutRestEx ?? 'app'}
    options={[
      { value: 'app', label: t('App setting'), subtitle: restExLabel(settingChoice(S.restExSec), t) },
      { value: 'sets', label: restExLabel('sets', t) },
      { value: 0, label: restExLabel(0, t) },
      ...REST_EX_PRESETS.map(v => ({ value: v, label: restExLabel(v, t) })),
    ]}
    onChange={v => update(s => {
      if (!s.active) return
      if (v === 'app') delete s.active.restExSec
      else s.active.restExSec = v
    })}
    close={close} />)

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
  // Which way the sets are drawn: the revolver drum (one set at a time, full size) or the list.
  // A profile saved before the drum existed gets it from the defaults (useStore DEF).
  const drumView = S.setView === 'drum'
  const slimTop = drumView && !topOpen
  const position = isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)
  const renderUnit = (index, preview) => {
    const members = units[index]
    if (!members || !members.length) return null
    // The set to do next is marked on the exercise you are on, never on a neighbour's preview.
    const block = (idx, extra) => <ExerciseBlock entryIdx={idx}
      nextSet={!preview && idx === cur ? A.entries[idx].sets.findIndex(s => !s.done) : -1}
      swipeSet={!preview && rowDrag?.entry === idx ? rowDrag.set : null} swipeDx={rowDrag?.dx || 0}
      onToggle={i => toggle(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onAddSet={() => addSet(idx)} onRemoveSet={() => removeSet(idx)} onAddWarmup={() => addWarmup(idx)} onRemoveSetAt={i => removeSetAt(idx, i)} onStartTimed={i => startTimed(idx, i)} onProgressionSettings={() => openProgressionSettings(idx)}
      onOpenProgression={preview ? undefined : () => openProgression(idx, { celebrate: false })}
      onSwap={preview ? undefined : () => swapActiveWorkoutExercise(idx)} onRemove={preview ? undefined : () => confirmRemoveExercise(idx)}
      open={!!openHeads[idx]} onToggleHead={() => toggleHead(idx)}
      {...extra} />
    // The superset banner (hint + Unpair) belongs to the same folded-away detail.
    const ssOpen = members.some(i => openHeads[i])
    // The drum: the same sets, one at a time at full size, on a cylinder you turn with a thumb.
    if (drumView) {
      const chambers = drumChambers(A.entries, members)
      const ss = members.length > 1
      const head = idx => block(idx, ss ? { compact: true, drum: true, nameless: true } : {
        drum: true,
        onPairPrev: idx > 0 ? () => pairAt(idx - 1, idx) : null,
        onPairNext: idx < A.entries.length - 1 ? () => pairAt(idx, idx + 1) : null,
      })
      const drum = <SetDrum key={members.join(',')} chambers={chambers} entries={A.entries} members={members.length} inert={preview}
        memberLabel={idx => exerciseNameFor(exOr(A.entries[idx].id))}
        renderHead={head}
        headOpen={idx => !!openHeads[idx]} onToggleHead={preview ? undefined : toggleHead}
        renderThumb={idx => <Thumb ex={exOr(A.entries[idx].id)} />}
        renderHero={ch => <DrumHero chamber={ch} members={members.length}
          onToggle={toggle} onField={setField} onStartTimed={startTimed} onRemoveSetAt={removeSetAt}
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
        {ssOpen && <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 5 }}><Icon name="link" />{t('Superset · do these back-to-back, rest when done')}</span>
          <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(members[0])}>{t('Unpair')}</Button>
        </div>}
        {drum}
      </div>
    }
    if (members.length > 1) return (
      <div className="ss-card">
        {ssOpen && <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 5 }}><Icon name="link" />{t('Superset · do these back-to-back, rest when done')}</span>
          <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(members[0])}>{t('Unpair')}</Button>
        </div>}
        {members.map((idx, k) => {
          const entry = A.entries[idx]
          return <div key={idx} ref={preview ? undefined : el => bindExRef(entry, el)} className="ss-ex" data-exidx={idx}>
            {k > 0 && <div className="ss-amp">+</div>}
            {block(idx, { compact: true, onSetRowRef: preview ? undefined : (setIdx, el) => bindSetRef(entry, setIdx, el) })}
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
      const drum = page.querySelector('[data-testid="workout-top"]')
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

  return <div className="narrow" ref={pageEl} data-fit="0">
    {/* Pinned for the whole session. Mid-workout you are scrolled deep into a list of sets,
        and the session name, its progress, the running order and where you are in it are
        exactly the things that have to stay on screen while you scroll. */}
    {/* In the drum the set in front is what the screen is for, so the header folds down to its
        title bar: the name, the clock, the sets done and where you are stay; the running order,
        the view toggle and the rest of it are one tap on the title away. */}
    <div className={'wtop' + (isDeloadWorkout(A) ? ' deload' : '') + (slimTop ? ' slim' : '')}>
      <div className="hdr">
        {/* With no tab bar under a running session, this is the way out to the rest of the app;
            the session keeps running and the tab bar's Resume brings you back to it. */}
        <div className="row" style={{ gap: 2, flex: 'none' }}>
        <button className="iconbtn" aria-label={t('Home')} title={t('Home')} onClick={() => nav('/home')}><Icon name="house" /></button>
        <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); stopWork(); nav('/home') } })}><Icon name="xmark" /></button>
        </div>
        {drumView
          ? <button type="button" className="wtop-tg" data-testid="workout-top" aria-expanded={!slimTop}
            aria-label={slimTop ? t('Show workout details') : t('Hide workout details')} onClick={() => setTopOpen(o => !o)}>
            <div className="wtop-name"><span>{A.name}</span><Icon name={slimTop ? 'chevronDown' : 'chevronUp'} /></div>
            <div className="sub">{A.backfill ? fmtDate(A.d, true) : <Elapsed start={A.start} />} · {t('{0} sets', done + '/' + total)}{slimTop && !!A.entries.length && <> · {position}</>}</div>
          </button>
          : <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub">{A.backfill ? fmtDate(A.d, true) : <Elapsed start={A.start} />} · {t('{0} sets', done + '/' + total)}</div></div>}
        <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
      </div>
      <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
      {/* The running order at a glance: tap a thumbnail to jump, press and hold one to drag its
          exercise (or its whole superset capsule) somewhere else in the session. The buttons
          below do the same two things without a pointer, so nothing here is the only way in.
          It stays when the header folds: it is how you get around the session. */}
      <WorkoutDock entries={A.entries} cur={cur} disabled={!!work}
        onSelect={selectExercise} onReorder={reorderUnitTo} onAdd={addExercise} />
      {!slimTop && <>
      <DeloadSessionBand active={A} />
      {A.backfill && <div className="muted small" style={{ marginBottom: 8 }}>{t('Logging a past workout — no rest timers.')}</div>}
      {!!A.entries.length && <div className="row wpos" style={{ gap: 6, marginBottom: 6 }}>
        <span className="muted small" data-testid="workout-position">{position}</span>
        <button className="giftoggle inline" data-testid="set-view"
          aria-label={drumView ? t('Show sets as a list') : t('Show sets as a drum')}
          onClick={() => update(s => { s.setView = drumView ? 'list' : 'drum' })}>
          <Icon name={drumView ? 'list' : 'target'} />{drumView ? t('List') : t('Drum')}
        </button>
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
        {/* The break before the next exercise, adjustable for this session without leaving it.
            Nothing to adjust on a past workout (no timers) or with a single exercise. */}
        {!A.backfill && units.length > 1 && <button className="giftoggle inline" data-testid="rest-ex"
          style={{ marginLeft: 'auto' }} onClick={openRestExPicker}>
          <Icon name="timer" /><span>{t('Between exercises · {0}', restExChoice === 'sets' ? t('like sets') : restExLabel(restExChoice, t))}</span>
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
      <SlideDeck current={unitIdx} peek={unitDrag?.target ?? null} dir={unitDrag?.dir ?? 0} dx={unitDrag?.dx ?? 0}
        directionOf={(from, to) => (to > from ? 1 : -1)} render={renderUnit} turn />
      </div>
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    {/* The foot of the session: paging between exercises, then one bar for the running order.
        Finishing (✓), swapping an exercise (its header) and the session note (the header's
        details) are all up top, so none of them is repeated down here. */}
    <div className="wfoot" ref={footEl}>
      <div className="wnav">
        <Button variant="tinted" icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => navigateUnit(-1)}>{t('Prev')}</Button>
        <Button variant="tinted" trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => navigateUnit(1)}>{t('Next')}</Button>
      </div>
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

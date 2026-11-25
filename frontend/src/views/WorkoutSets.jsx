// The sets of the running workout, every way they are drawn: the set columns and row editors
// shared by all views, an exercise's block (list), the table, the set sheet, the aim cards and
// the drum's front chamber, plus the rest sheets. Split out of Workout.jsx, which keeps the
// session screen itself (ActiveWorkout) and re-exports what was public here.

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr, muscleTagsOf } from '../lib/exercises.js'
import { muscleLabel } from '../lib/muscles.js'
import { lastEntryFor, bestWeightFor, supersetUnits, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort, pinnedNoteFor, exNoteFor } from '../lib/history.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { restSecFor } from '../lib/supersetFlow.js'
import { restExLabel, settingChoice, REST_EX_PRESETS } from '../lib/rest-between.js'
import { REST_SET_PRESETS, isRestSec, sessionRestFor, withoutUnitPicks, pickUnitRest, pickSessionRest } from '../lib/session-rest.js'
import Media, { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, exerciseNoteSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField, Segmented, SelectRow, SelectSheet } from '../components/ui.jsx'
import { loadScaleFor } from '../lib/progression.js'
import { ladderOf, stepLoad, snapLoad, stepOf } from '../lib/load-scale.js'
import { progressionGuidance } from '../lib/progression-copy.js'
import { doubleProgressStatus } from '../lib/double-progress.js'
import { DoubleProgressMeter } from '../components/DoubleProgress.jsx'
import { isWarmupRow, isDropSet, isRestPauseSet, dropsOf, clustersOf, addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt, nextDropWeight, nextBurstReps } from '../lib/workout-model.js'
import { setKindOf, dropCutPct, wheelValues, DROP_PCT } from '../lib/set-kind.js'
import Wheel from '../components/Wheel.jsx'
import { exerciseProgressSheet } from '../components/ExerciseProgress.jsx'
import { PlatesLine } from '../components/Plates.jsx'
import { workIndexOf, referenceSet, suggestionFor, targetFor, overloadOf, overloadTargetFor, extraSetsWanted, topWeight } from '../lib/set-reference.js'
import { repRangeFor } from '../lib/exercise-class.js'
import { rowOffset, rowArmed } from '../lib/swipe.js'


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
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  // The weights this exercise can carry: on adjustable dumbbells the weight stepper walks the
  // ladder (4, 5.5, 7…) instead of adding 2.5 — see lib/load-scale.js.
  const loadStep = loadScaleFor(cfg, S.unit)
  const ladder = ladderOf(cfg)
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadCol = { f: 'w', step: 2.5, ladder, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
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
    onField(i, col.f, stepLoad(s[col.f], dir, col.ladder || col.step))
  }
  return { entry, mode, cardio, timed, cfg, last, prevSets, prevTop, loadStep, ladder, plan, kind, col1, col2, col3, bump }
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
    const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : DROP_PCT
    // On adjustable dumbbells the drop lands on a rung at or below the cut — never a weight
    // the set does not have.
    const lad = ladderOf(entry.target)
    const w = nextDropWeight(base, pct)
    return addDrop(row, { w: lad ? Math.min(base, snapLoad(w, lad, 'floor')) : w, r: row.r })
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
  // An emptied effort drops the key, as on the set itself (see setField).
  const setDropField = (i, di, field, v) => mutSet(i, row => {
    const next = setDropAt(row, di, { [field]: v })
    if (v == null && next.drops?.[di]) delete next.drops[di][field]
    return next
  })
  const setClusterField = (i, ci, v) => mutSet(i, row => {
    const delta = (Number(v) || 0) - (clustersOf(row)[ci]?.r || 0)
    return { ...setClusterAt(row, ci, { r: v }), r: Math.max(0, (row.r || 0) + delta) }
  })
  return { addDropRow, addBurstRow, removeDrop, removeCluster, setDropField, setClusterField }
}

// A smaller stepper for a drop's weight/reps or a burst's reps — editing what the plan (or a
// live "+ Drop"/"+ Burst" tap) already put on the row, not typing into a fresh field.
// `step` may be a ladder (adjustable dumbbells), which the taps then walk rung by rung.
const miniStepper = (value, step, dec, onChange) => (
  <div className="stp mini">
    <button aria-label={t('Decrease')} onClick={() => onChange(stepLoad(value, -1, step))}><Icon name="minus" /></button>
    <span className="val"><NumberField decimal={dec} value={value ?? ''} onChange={onChange} /></span>
    <button aria-label={t('Increase')} onClick={() => onChange(stepLoad(value, 1, step))}><Icon name="plus" /></button>
  </div>
)

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
export function ExerciseBlock({ entryIdx, compact, drum, table, aims = false, nameless, nextSet = -1, onToggle, onToggleDrop, onOpenSet, onField, onAddSet, onRemoveSet, onAddWarmup, onRemoveSetAt, onStartTimed, onPairPrev, onPairNext, onUnpair, onSetRowRef, onProgressionSettings, onAddExercise, onOpenProgression, onSwap, onRemove, swipeSet, swipeDrop = null, swipeBurst = null, swipeDx = 0, open = true, onToggleHead, marks = null }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const { addDropRow, addBurstRow, removeDrop, removeCluster, setDropField, setClusterField } = useRowEditors(entryIdx)
  const ex = exOr(entry.id)
  const muscles = muscleTagsOf(ex)
  const { mode, cardio, timed, cfg, last, prevSets, prevTop, loadStep, ladder, plan, kind, col1, col2, col3, bump } = useSetColumns(entryIdx, onField)
  const [mediaOpen, setMediaOpen] = useState(false)
  const dbl = useDoubleTap()
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
  // The table keeps the same folded header: the sets are the screen there too.
  const slim = drum || table
  const thumb = slim && S.gifSize !== 'off' && !!(ex.gif || ex.img)
  const folded = slim && !open
  // Pairing from the tools row: straight away when there is one neighbour to pair with, a
  // choice between the two when there are both.
  const pair = () => {
    if (!onPairNext) return onPairPrev()
    if (!onPairPrev) return onPairNext()
    useUI.getState().openSheet(close => (
      <div>
        <h3>{t('Make superset')}</h3>
        <div className="list">
          <div className="item" onClick={() => { close(); onPairPrev() }}>
            <div className="grow"><div className="tt">{t('Make superset with previous')}</div></div><Icon name="link" className="chev" />
          </div>
          <div className="item" onClick={() => { close(); onPairNext() }}>
            <div className="grow"><div className="tt">{t('Make superset with next')}</div></div><Icon name="link" className="chev" />
          </div>
        </div>
      </div>
    ))
  }
  const note = (text, extra) => folded
    ? <button type="button" className="exnote fold" onClick={onToggleHead} {...extra}>{text}</button>
    : <div className="exnote" {...extra}>{text}</div>
  return <>
    {!slim && <Media ex={ex} key={entry.id} compact={compact} minimizable />}
    {/* The name is the toggle: collapsed, the screen is the name and the sets; tapping it opens
        the exercise's tools, tags and last session. In a superset's drum the name already sits in
        the exercise's own box above the drum, and that box is the toggle (`nameless`), so this
        row only appears once it is open, for the tools. */}
    {/* First line: the name and its fold arrow (with the drum's thumbnail before them). Opened,
        the exercise's tools follow on a line of their own under it. */}
    {!nameless && <div className={'row' + (slim ? ' exhead-drum' : '')} style={{ marginBottom: 6 }}>
      {thumb && <button type="button" className={'exthumb' + (mediaOpen ? ' on' : '')} aria-expanded={mediaOpen}
        aria-label={mediaOpen ? t('Minimize') : t('Expand')} onClick={() => setMediaOpen(o => !o)}>
        <Thumb ex={ex} muscle />{ex.gif && <Icon name={mediaOpen ? 'minimize' : 'play'} />}
      </button>}
      <button type="button" className="exhead-tg" aria-expanded={open} onClick={onToggleHead}
        style={{ fontSize: compact || slim ? 17 : 20 }}>
        <span>{exerciseNameFor(ex)}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="exhead-chev" />
      </button>
    </div>}
    {open && <div className="row extools" data-testid="ex-tools">
      <button className="iconbtn" aria-label={t('Note')} title={t('Note')}
        style={entry.note ? { color: 'var(--acc)' } : undefined}
        onClick={() => exerciseNoteSheet(entryIdx)}><Icon name="pencil" /></button>
      <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      {/* The rest between this exercise's sets (a superset's: between its rounds) — for this
          workout only. Lit while it has a rest of its own. See lib/session-rest.js. */}
      {!S.active.backfill && <button type="button" className="iconbtn" data-testid="ex-rest"
        aria-label={t('Rest between sets')} title={t('Rest between sets')}
        style={isRestSec(entry.restSec) ? { color: 'var(--acc)' } : undefined}
        onClick={() => exerciseRestSheet(entryIdx)}><Icon name="timer" /></button>}
      {/* How this exercise has gone so far: its progress curve, as on Stats. */}
      <button type="button" className="iconbtn" aria-label={t('Exercise progress')} title={t('Exercise progress')}
        onClick={() => exerciseProgressSheet(entry.id)}><Icon name="chartLine" /></button>
      {onSwap && <button className="iconbtn" aria-label={t('Swap exercise')} title={t('Swap exercise')}
        disabled={!!working} onClick={onSwap}><Icon name="shuffle" /></button>}
      {onUnpair
        ? <button className="iconbtn" aria-label={t('Unpair')} title={t('Unpair')} onClick={onUnpair}><Icon name="linkSlash" /></button>
        : (onPairPrev || onPairNext) && <button className="iconbtn" aria-label={t('Make superset')} title={t('Make superset')} onClick={pair}><Icon name="link" /></button>}
      {onRemove && <button className="iconbtn danger" aria-label={t('Remove exercise')} title={t('Remove exercise')}
        disabled={!!working} onClick={onRemove}><Icon name="trash" /></button>}
    </div>}
    {thumb && mediaOpen && (!nameless || open) && <Media ex={ex} key={entry.id} compact={compact} />}
    {open && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !s.done)?.r ?? entry.sets[0]?.r)))}</span>}
      {/* The muscles it is for, then the ones that help — told apart by colour. */}
      {!cardio && muscles.primary.map(m => <span key={'p' + m} className="tag mus-p" title={t('Primary')}>{t(muscleLabel(m))}</span>)}
      {!cardio && muscles.secondary.map(m => <span key={'s' + m} className="tag mus-s" title={t('Secondary')}>{t(muscleLabel(m))}</span>)}
      {(cardio || !muscles.primary.length) && (ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>}
    {/* The session view's records (SessionFlow), under the tags they sit with. */}
    {open && marks}
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
    {/* The question itself is a window that pops up on its own (see openProgression); this is
        the way back to it once it was put off with the sheet closed some other way. */}
    {doubleTrack && plan.kind === 'decide' && !entry.decided && onOpenProgression &&
      <button type="button" className="dpask" onClick={onOpenProgression}>
        <Icon name="sparkles" /><span>{t('Time to progress')}</span><Icon name="chevronRight" />
      </button>}
    {dpStatus && !folded && dpStatus.state !== 'first' && !entry.decided && <DoubleProgressMeter status={dpStatus} unit={S.unit} compact live />}
    {/* In the drum the sets are the drum's (see SetDrum) — this block is only the exercise's header. */}
    {/* The list draws its cards here; the drum draws them for the exercise in front (`aims`). */}
    {(!slim && !table || drum && aims) && <AimCards entryIdx={entryIdx} best={best} onProgressionSettings={onProgressionSettings} onField={onField} />}
    {table && <SetTable entryIdx={entryIdx} best={best} nextSet={nextSet} onToggle={onToggle} onToggleDrop={onToggleDrop} onOpenSet={onOpenSet} onField={onField}
      onAddSet={onAddSet} onAddWarmup={onAddWarmup} onRemoveSetAt={onRemoveSetAt} onStartTimed={onStartTimed}
      onSetRowRef={onSetRowRef} onProgressionSettings={onProgressionSettings} onAddExercise={onAddExercise} swipeSet={swipeSet} swipeDrop={swipeDrop} swipeBurst={swipeBurst} swipeDx={swipeDx} />}
    {!slim && <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
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
        const dragging = swipeSet === i && swipeDrop == null && swipeBurst == null
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
              {/* A double tap on the number opens the set's sheet, as in the table. */}
              <button type="button" className={'n st-badge' + (s.fail === true && !warm ? ' fail' : '')} aria-label={t('Set {0}', phaseNum)}
                onClick={() => { if (dbl('n' + i)) onOpenSet?.(i) }}>{phaseNum}</button>
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
            <IntensifierRows entryIdx={entryIdx} i={i} cols={[col1, col2, col3].filter(Boolean)} onToggleDrop={onToggleDrop}
              onBadge={key => { if (dbl(key)) onOpenSet?.(i) }} swipe={{ set: swipeSet, drop: swipeDrop, burst: swipeBurst, dx: swipeDx }} />
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

const DOUBLE_TAP_MS = 350

// The rest between the sets of one exercise of the running workout — in a superset, between its
// rounds, for every member of it — for this workout only. 'session' drops it, back to what the
// session gives the exercise without it: the header's pick, else the routine's rest, else
// Settings. Kept in the routine only if you say so once the session is filed (session-rest.js).
function exerciseRestSheet(entryIdx) {
  const { S, update } = useStore.getState()
  const A = S.active
  const entry = A?.entries[entryIdx]
  if (!entry) return
  const unit = supersetUnits(A.entries).find(u => u.includes(entryIdx)) || [entryIdx]
  const own = sessionRestFor(A.entries, unit, null)
  const without = restSecFor(withoutUnitPicks(A.entries, unit), unit, S.restSec, A.restSec)
  useUI.getState().openSheet(close => <SelectSheet
    title={unit.length > 1 ? t('Rest between rounds of the superset (this workout)')
      : t('Rest between sets of {0} (this workout)', exerciseNameFor(exOr(entry.id)))}
    value={own ?? 'session'}
    options={[
      { value: 'session', label: isRestSec(A.restSec) ? t('This workout setting') : t('As planned'), subtitle: restExLabel(without, t) },
      ...REST_SET_PRESETS.map(v => ({ value: v, label: restExLabel(v, t) })),
    ]}
    onChange={v => update(s => { if (s.active) pickUnitRest(s.active, unit, v === 'session' ? null : v) })}
    close={close} />)
}

// The rests of the whole running workout, from its header: between sets for every exercise at
// once (it replaces the ones picked on an exercise — the last choice holds), and between
// exercises. This workout only: the routine and Settings stay as they are, and when the session
// is filed the rests between sets it changed can be kept for the routine (session-rest.js).
export function SessionRestSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = S.active
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null
  const own = A.entries.filter(e => isRestSec(e.restSec)).length
  const restEx = A.restExSec === 'sets' || typeof A.restExSec === 'number' ? A.restExSec : null
  return <>
    <h3>{t('Rests (this workout)')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Only for this session. When you finish it you can keep the rests between sets for the next sessions of this routine.')}
    </div>
    <div className="sect-b">
      <SelectRow icon="timer" title={t('Between sets')} sheetTitle={t('Rest between sets (this workout)')}
        value={isRestSec(A.restSec) ? A.restSec : 'plan'}
        options={[
          { value: 'plan', label: t('As planned'), subtitle: t('Each exercise’s rest from the routine, else Settings ({0})', restExLabel(S.restSec > 0 ? S.restSec : 0, t)) },
          ...REST_SET_PRESETS.map(v => ({ value: v, label: restExLabel(v, t) })),
        ]}
        onChange={v => update(s => { if (s.active) pickSessionRest(s.active, v === 'plan' ? null : v) })} />
      {supersetUnits(A.entries).length > 1 && <SelectRow icon="cornerDownRight" title={t('Between exercises')}
        sheetTitle={t('Rest between exercises (this workout)')}
        value={restEx ?? 'app'}
        options={[
          { value: 'app', label: t('App setting'), subtitle: restExLabel(settingChoice(S.restExSec), t) },
          { value: 'sets', label: restExLabel('sets', t) },
          { value: 0, label: restExLabel(0, t) },
          ...REST_EX_PRESETS.map(v => ({ value: v, label: restExLabel(v, t) })),
        ]}
        onChange={v => update(s => {
          if (!s.active) return
          // As between sets, the session's choice is for every exercise: one an exercise of a
          // session from before this sheet kept for itself goes with it.
          s.active.entries.forEach(e => { delete e.restExSec })
          if (v === 'app') delete s.active.restExSec
          else s.active.restExSec = v
        })} />}
    </div>
    {own > 0 && <div className="muted small" style={{ marginTop: 8 }}>
      {t(own === 1 ? '1 exercise has a rest of its own; choosing one here replaces it.' : '{0} exercises have a rest of their own; choosing one here replaces it.', own)}
    </div>}
    <div style={{ height: 8 }} />
  </>
}

// Two taps on the same thing (`key`) within DOUBLE_TAP_MS: true on the second.

function useDoubleTap() {
  const last = useRef({ key: null, at: 0 })
  return key => {
    const now = Date.now(), l = last.current
    if (l.key === key && now - l.at < DOUBLE_TAP_MS) { last.current = { key: null, at: 0 }; return true }
    last.current = { key, at: now }
    return false
  }
}

/* ---------- a set's drops and rest-pause bursts, hanging off it in every view ---------- */
// The same columns as a table row (number · weight · reps · effort · check), so a drop reads as the
// part of its set it is: its own D badge in purple, a burst's R-P in blue, a double tap on either
// opening the set's sheet (onBadge), a bin at the end of the line. `swipe` ({ set, drop, burst,
// dx }) makes the lines swipe away like a set where the surface handles row swipes; the drum,
// which owns its own pointer, leaves it out.
function IntensifierRows({ entryIdx, i, cols, onBadge, onToggleDrop, swipe = null }) {
  const s = useStore(st => st.S.active?.entries[entryIdx]?.sets[i])
  const { removeDrop, removeCluster, setDropField, setClusterField } = useRowEditors(entryIdx)
  if (!s) return null
  const grid = 'st-row c' + cols.length
  return <div className="introws">
    {/* A drop hangs off its set: same columns, its own tick — and the rest waits for it, since
        a drop is taken with no break (see toggle). Above its weight, how much was stripped. */}
    {dropsOf(s).map((d, di, all) => {
      const before = di ? all[di - 1].w : s.w
      // Swiped right like a set, it takes only this drop with it.
      const pulled = swipe && swipe.set === i && swipe.drop === di
      return <div className={'setswipe st-dropswipe' + (pulled ? ' dragging' : '')} key={'d' + di}>
      {pulled && <div className={'setswipe-track' + (rowArmed(swipe.dx) ? ' armed' : '')} aria-hidden="true"><Icon name="trash" /></div>}
      <div className={grid + ' st-drop st-sub' + (d.done ? ' done' : '')}
        {...(swipe ? { 'data-swipe-row': entryIdx, 'data-swipe-set': i, 'data-swipe-drop': di, 'data-swipe-removable': '1' } : {})}
        style={pulled ? { transform: 'translateX(' + rowOffset(swipe.dx) + 'px)' } : undefined}>
        <button type="button" className="st-n st-badge drop" aria-label={t('Drop {0}', di + 1)}
          onClick={() => onBadge('d' + i + '.' + di)}><Icon name="cornerDownRight" />D</button>
        {cols.map(col => <div className={'st-cell' + (col.f === 'w' ? ' cut' : '')} key={col.f}>
          {col.f === 'w' && <span className="st-prev">−{dropCutPct(before, d.w)} %</span>}
          <NumberField decimal={col.dec} nullable={col.opt} value={d[col.f] ?? ''} placeholder={col.eff ? col.hd : '–'} aria-label={col.hd}
            onChange={v => setDropField(i, di, col.f, col.eff ? capEffort(col.eff, v) : v)} />
        </div>)}
        <Check checked={!!d.done} onChange={() => onToggleDrop?.(i, di)} className="st-ck" />
        <button type="button" className="st-del drop" aria-label={t('Remove drop')} onClick={() => removeDrop(i, di)}><Icon name="trash" /></button>
      </div>
      </div>
    })}
    {/* A rest-pause burst hangs off its set the way a drop does, in blue: the same weight
        (only to read), the pause before it riding on top, its reps to type. */}
    {clustersOf(s).map((c, ci) => {
      const pulled = swipe && swipe.set === i && swipe.burst === ci
      return <div className={'setswipe st-dropswipe' + (pulled ? ' dragging' : '')} key={'c' + ci}>
        {pulled && <div className={'setswipe-track' + (rowArmed(swipe.dx) ? ' armed' : '')} aria-hidden="true"><Icon name="trash" /></div>}
        <div className={grid + ' st-drop st-sub st-burst' + (s.done ? ' done' : '')}
          {...(swipe ? { 'data-swipe-row': entryIdx, 'data-swipe-set': i, 'data-swipe-burst': ci, 'data-swipe-removable': '1' } : {})}
          style={pulled ? { transform: 'translateX(' + rowOffset(swipe.dx) + 'px)' } : undefined}>
          <button type="button" className="st-n st-badge burst" aria-label={t('Burst {0}', ci + 1)}
            onClick={() => onBadge('c' + i + '.' + ci)}><Icon name="cornerDownRight" />R-P</button>
          {cols.map(col => col.f === 'r'
            ? <div className="st-cell cut" key={col.f}>
              <NumberField decimal={false} value={c.r ?? ''} placeholder="–" aria-label={col.hd} onChange={v => setClusterField(i, ci, v)} />
            </div>
            : col.f === 'w'
              ? <div className="st-cell rest" key={col.f}>
                <span className="st-prev">{c.restSec} s</span>
                <span className="st-ro">{fmtNum(s.w || 0)}</span>
              </div>
              : <span key={col.f} />)}
            <span />
          <button type="button" className="st-del burst" aria-label={t('Remove burst')} onClick={() => removeCluster(i, ci)}><Icon name="trash" /></button>
        </div>
      </div>
    })}
  </div>
}


/* The record of the exercise and the overload the next work set aims at — the same two cards above
   the sets in the table and the session view, and above the list and the drum. The overload is what
   the progression plans when it moves the set, else the next lever past last session's set
   (overloadTargetFor); a plan that deloads or is mid-decision is followed as it stands. */
function AimCards({ entryIdx, best, onProgressionSettings, onField }) {
  const S = useStore(s => s.S)
  const { entry, mode, cfg, plan, prevSets, prevTop, loadStep, kind, col3 } = useSetColumns(entryIdx, onField)
  const ni = entry.sets.findIndex(x => !x.done && !isWarmupRow(x))
  const aimAt = i => {
    if (isWarmupRow(entry.sets[i])) return null
    const reference = referenceSet(prevSets, workIndexOf(entry.sets, i))
    const effortCol = col3 ? kind : null
    const planned = targetFor({ mode, plan, reference, effort: effortCol, base: prevTop, step: loadStep })
    const holds = !plan || ['off', 'first', 'hold', 'decide'].includes(plan.kind)
    if (!holds || !reference || (planned && overloadOf(planned, reference).length)) return planned
    return overloadTargetFor({ mode, reference, top: repRangeFor(exOr(entry.id)).reps, effort: effortCol, step: loadStep, goal: plan?.rirGoal }) || planned
  }
  const nextAim = ni >= 0 ? { ...entry.sets[ni], ...(aimAt(ni) || {}) } : null
  const guidance = progressionGuidance(plan)
  const dir = plan?.kind === 'up' ? 'arrowUp' : plan?.kind === 'deload' ? 'arrowDown' : null
  return <div className="st-cards">
    <div className="st-card rec">
      <div className="st-k">{t('Record')}</div>
      <div className="st-v">{best > 0 ? <>{fmtNum(best)} <small>{S.unit}</small></> : '—'}</div>
    </div>
    <button type="button" className="st-card aim" onClick={onProgressionSettings} aria-label={t('Open progression settings')}>
      <div className="st-k">{dir && <Icon name={dir} />}{t('Overload target')}{guidance && <span> · {t(guidance.policyLabel)}</span>}</div>
      <div className="st-v">{nextAim ? setLabel(entry.id, nextAim, cfg) : t('Done')}</div>
    </button>
  </div>
}

/* ---------- the table: every set on one line, no steppers, today's target in the cells ---------- */
// The quiet way to draw the sets: number · weight · reps · (effort) · check, each value a field
// you tap and type into. What the row asks for is the progression's target, not last session —
// seedTargets already wrote it into the rows, and a cell that has drifted from it carries the
// target underneath, one tap to put back. Everything that changes the list (a drop, a burst, a
// warm-up, removing the set) waits behind the set's number so the resting table stays bare.
export function SetTable({ entryIdx, best, nextSet = -1, onToggle, onToggleDrop, onOpenSet, onField, onAddSet, onAddWarmup, onRemoveSetAt, onStartTimed, onSetRowRef, onProgressionSettings, onAddExercise, swipeSet, swipeDrop = null, swipeBurst = null, swipeDx = 0 }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const { entry, mode, cfg, plan, prevSets, prevTop, loadStep, ladder, kind, col1, col2, col3 } = useSetColumns(entryIdx, onField)
  const { addDropRow, addBurstRow, removeDrop, removeCluster, setDropField, setClusterField } = useRowEditors(entryIdx)
  const [tools, setTools] = useState(-1)
  // A second tap on the same badge within DOUBLE_TAP_MS opens the set's sheet. The first tap
  // has already done its own thing (the number opens the tools), so the second puts that back
  // the way it was before the pair began.
  const lastTap = useRef({ key: null, at: 0, tools: -1 })
  const tap = (key, i, single) => {
    const now = Date.now(), l = lastTap.current
    if (onOpenSet && l.key === key && now - l.at < DOUBLE_TAP_MS) {
      lastTap.current = { key: null, at: 0, tools: -1 }
      setTools(l.tools)
      onOpenSet(i)
      return
    }
    lastTap.current = { key, at: now, tools }
    single?.()
  }
  const timed = mode === 'time'
  const cols = [col1, col2, col3].filter(Boolean)
  const target = i => isWarmupRow(entry.sets[i]) ? null : targetFor({ mode, plan, reference: referenceSet(prevSets, workIndexOf(entry.sets, i)),
    effort: col3 ? kind : null, base: prevTop, step: loadStep })
  const works = entry.sets.filter(x => !isWarmupRow(x)).length
  const ni = entry.sets.findIndex(x => !x.done && !isWarmupRow(x))
  // The foot's "+ Drop" strips the set just done — the last work set ticked off — or, before any,
  // the next one to do. A rest-pause set takes bursts, not drops, so it has none to give.
  const lastDone = entry.sets.findLastIndex(x => x.done && !isWarmupRow(x))
  const dropFor = lastDone >= 0 ? lastDone : ni
  const dropAt = dropFor >= 0 && !isRestPauseSet(entry.sets[dropFor]) ? dropFor : -1
  const grid = 'st-row c' + cols.length + (timed ? ' timed' : '')
  const cell = (s, i, col, sug, ref) => {
    const aim = sug && sug[col.f] != null ? sug[col.f] : null
    const was = ref && ref[col.f] != null && ref[col.f] !== '' ? ref[col.f] : null
    return <div className={'st-cell' + (aim != null ? ' off' : '')} key={col.f}>
      {/* What this set did last time, on top of the field it belongs to — only to read, so it is
          a quiet label rather than a button like the target under it. */}
      {was != null && <span className="st-prev" aria-label={t('Last') + ': ' + fmtNum(was)} title={t('Last')}>{fmtNum(was)}</span>}
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''} placeholder="–" aria-label={col.hd}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} />
      {aim != null && <button type="button" className="st-aim" aria-label={t('Use the target')} title={t('Use the target')}
        onClick={() => onField(i, col.f, aim)}>{fmtNum(aim)}</button>}
    </div>
  }
  return <div className="settable">
    <AimCards entryIdx={entryIdx} best={best} onProgressionSettings={onProgressionSettings} onField={onField} />
    <div className={grid + ' st-hd'}>
      <span>{t('Set')}</span>
      {cols.map(col => <span key={col.f}>{col.hd}</span>)}
      {timed && <span />}
      <span />
    </div>
    {entry.sets.map((s, i) => {
      const warm = isWarmupRow(s)
      const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
      const ref = warm ? null : referenceSet(prevSets, workIndexOf(entry.sets, i))
      const sug = warm ? null : suggestionFor({ mode, plan, row: s, reference: ref, effort: col3 ? kind : null, base: prevTop, step: loadStep })
      const removable = entry.sets.length > 1
      const dragging = swipeSet === i && swipeDrop == null && swipeBurst == null
      const intensify = !warm && mode === 'reps'
      const open = tools === i
      return <div key={i}>
        <div className={'setswipe' + (dragging ? ' dragging' : '')}>
          {dragging && <div className={'setswipe-track' + (rowArmed(swipeDx) ? ' armed' : '')} aria-hidden="true"><Icon name="trash" /></div>}
          <div ref={el => onSetRowRef?.(i, el)} className={grid + (s.done ? ' done' : '') + (i === nextSet ? ' next' : '') + (warm ? ' warm' : '')}
            data-swipe-row={entryIdx} data-swipe-set={i} data-swipe-removable={removable ? '1' : undefined}
            style={dragging ? { transform: 'translateX(' + rowOffset(swipeDx) + 'px)' } : undefined}>
            <button type="button" className={'st-n' + (s.fail === true && !warm ? ' fail' : '')} aria-expanded={open} aria-label={t('Set tools')}
              onClick={() => tap('n' + i, i, () => setTools(open ? -1 : i))}>
              {warm ? <Icon name="flame" /> : phaseNum}
            </button>
            {/* A warm-up is prep, not a set taken near failure, so it logs no effort. */}
            {cols.map(col => col.eff && warm ? <span key={col.f} /> : cell(s, i, col, sug, ref))}
            {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
              onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
            <Check checked={s.done} onChange={() => onToggle(i)} className="st-ck" />
          </div>
        </div>
        {intensify && <IntensifierRows entryIdx={entryIdx} i={i} cols={cols} onBadge={key => tap(key, i)} onToggleDrop={onToggleDrop}
          swipe={{ set: swipeSet, drop: swipeDrop, burst: swipeBurst, dx: swipeDx }} />}
        {open && <div className="st-tools" role="toolbar" aria-label={t('Set tools')}>
          {intensify && !isRestPauseSet(s) && <button className="st-add sm drop" onClick={() => addDropRow(i)}><Icon name="arrowDown" />{t('+ Drop')}</button>}
          {intensify && !isDropSet(s) && <button className="st-add sm burst" onClick={() => addBurstRow(i)}><Icon name="bolt" />{t('+ Burst')}</button>}
          <button className="st-add sm danger" disabled={!removable || !!working}
            onClick={() => { setTools(-1); onRemoveSetAt(i) }}><Icon name="trash" />{t('Remove set')}</button>
        </div>}
      </div>
    })}
    <div className="st-count">{t('{0} of {1} sets', entry.sets.filter(x => x.done && !isWarmupRow(x)).length, works)}</div>
    <div className="st-foot">
      <button type="button" className="st-add" onClick={onAddSet}><Icon name="plus" />{t('Set')}</button>
      {mode === 'reps' && <button type="button" className="st-add drop" disabled={dropAt < 0} onClick={() => addDropRow(dropAt)}><Icon name="plus" />{t('Drop')}</button>}
      <button type="button" className="st-add warm" onClick={onAddWarmup}><Icon name="plus" />{t('Warmup')}</button>
    </div>
    {onAddExercise && <button type="button" className="st-addex" onClick={onAddExercise}><Icon name="plus" />{t('Add exercise')}</button>}
  </div>
}

/* ---------- one set in a sheet: what kind it is, and its numbers on wheels ---------- */
// Opened by a double tap on a set's badge in the table. Every turn of a wheel is written to the
// row as it settles — the set is logged when it is ticked off, as from the table itself.
const SET_KIND_TABS = [
  { value: 'normal', label: 'Normal' },
  { value: 'warmup', label: 'Warmup' },
  { value: 'failure', label: 'Failure' },
  { value: 'drop', label: 'Drop' },
]
// Where each wheel stops, in the unit it is logged in — far enough that nobody runs out.
const WHEEL_TOP = { w: 300, r: 50, min: 180, speed: 30, sec: 600 }

export function SetSheet({ entryIdx, i, close, ...rest }) {
  const row = useStore(s => s.S.active?.entries[entryIdx]?.sets[i])
  // The workout ended, or the row went (removed from the table behind the sheet).
  useEffect(() => { if (!row) close() }, [row])
  return row ? <SetSheetBody entryIdx={entryIdx} i={i} close={close} {...rest} /> : null
}

function SetSheetBody({ entryIdx, i, close, onField, onKind, onRemoveSetAt }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const { entry, mode, cfg, prevSets, ladder, loadStep, col1, col2, col3 } = useSetColumns(entryIdx, onField)
  const s = entry.sets[i]
  const warm = isWarmupRow(s)
  const kind = setKindOf(s)
  const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
  const ref = warm ? null : referenceSet(prevSets, workIndexOf(entry.sets, i))
  // A warm-up logs no effort, so it has no effort wheel.
  const cols = [col1, col2, warm ? null : col3].filter(Boolean)
  const spec = col => col.eff ? { step: col.step, min: col.min, max: col.max, empty: true }
    // Weight turns in the finest plate the exercise can load: its ladder, or half a step (1,25 kg).
    : col.f === 'w' ? { step: ladder || Math.min(stepOf(loadStep) || 2.5, S.unit === 'lb' ? 2.5 : 1.25), max: S.unit === 'lb' ? 2 * WHEEL_TOP.w : WHEEL_TOP.w }
      : { step: col.step, max: WHEEL_TOP[col.f] || 100 }
  // The list each wheel turns through is fixed when the sheet opens — a value slotted in off the
  // grid would otherwise vanish as soon as the wheel left it and shift every row under the band.
  const [lists] = useState(() => Object.fromEntries([col1, col2, col3].filter(Boolean).map(col => [col.f, wheelValues(s[col.f], spec(col))])))
  const tabs = SET_KIND_TABS.filter(k => mode === 'reps' || k.value === 'normal' || k.value === 'warmup')
    .map(k => ({ ...k, label: t(k.label) }))
  return <div className="setsheet">
    <div className="ss-head">
      <div className="ss-title">
        <h3>{warm ? t('Warm-up') + ' ' + phaseNum : t('Set {0}', phaseNum)}</h3>
        <div className="ss-sub">{exerciseNameFor(exOr(entry.id))}{ref && <> · {t('last {0}', setLabel(entry.id, ref, cfg))}</>}</div>
      </div>
      <button type="button" className="ss-done" onClick={close}>{t('Done')}</button>
    </div>
    <Segmented className="ss-kind" options={tabs} value={kind} onChange={k => onKind(i, k)} />
    <div className={'ss-wheels n' + cols.length}>
      {cols.map(col => <div className="ss-col" key={col.f}>
        <div className="ss-hd">{col.hd}</div>
        <Wheel values={lists[col.f]} value={s[col.f] ?? null} label={col.hd}
          format={v => v == null ? '–' : v.toLocaleString(dateLocale(), { maximumFractionDigits: 2 })} onChange={v => onField(i, col.f, v)} />
      </div>)}
    </div>
    {mode === 'reps' && <PlatesLine S={S} exId={entry.id} w={s.w} />}
    <div className="ss-foot">
      <span>{t('Saved when you tick the set')}</span>
      <button type="button" className="ss-del" disabled={entry.sets.length <= 1 || !!working}
        onClick={() => { close(); onRemoveSetAt(i) }}>{t('Delete set')}</button>
    </div>
  </div>
}

/* ---------- the drum's front chamber: one set, drawn as large as the screen allows ---------- */
export const DRUM_LETTERS = 'ABCDEFGH'
export const SET_VIEWS = ['drum', 'list', 'table', 'session']
export const SET_VIEW_COPY = {
  drum: { label: 'Drum', aria: 'Show sets as a drum', icon: 'target' },
  list: { label: 'List', aria: 'Show sets as a list', icon: 'list' },
  table: { label: 'Table', aria: 'Show sets as a table', icon: 'table' },
  session: { label: 'Session', aria: 'Show the whole session', icon: 'clipboard' },
}
export const FIT_STEPS = 5    // how many sizes the drum screen comes in (.narrow[data-fit] in index.css)
export const FOOT_STEPS = 3   // the first of them, which only shrink the foot (prev / next and its tools)
// "+2,5 kg", "+1 rep", "−1 RIR" — one lever of overloadOf, signed the way it reads on the bar.
function deltaLabel({ f, d }) {
  const n = (d > 0 ? '+' : '−') + fmtNum(Math.abs(d))
  if (f === 'w') return `${n} ${useStore.getState().S.unit}`
  if (f === 'r') return `${n} ${Math.abs(d) === 1 ? t('rep') : t('reps')}`
  if (f === 'sec') return `${n} s`
  return `${n} ${f.toUpperCase()}`
}
export function DrumHero({ chamber, members, onToggle, onToggleDrop, onOpenSet, onField, onStartTimed, onRemoveSetAt, onAddWarmup, onAddSet }) {
  const S = useStore(s => s.S)
  const dbl = useDoubleTap()
  const working = useUI(s => s.work)
  const { entry: entryIdx, set: i } = chamber
  const { entry, mode, timed, cfg, last, prevSets, prevTop, loadStep, ladder, plan, kind, col1, col2, col3, bump } = useSetColumns(entryIdx, (row, f, v) => onField(entryIdx, row, f, v))
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
      {/* A double tap here opens the set's sheet, as on the table's number. */}
      <button type="button" className={'dh-kind st-badge' + (s.fail === true && !warm ? ' fail' : '')}
        onClick={() => { if (dbl('k')) onOpenSet?.(entryIdx, i) }}>
        {warm ? <><Icon name="flame" />{t('Warm-up')}</> : t('Set {0}', chamber.num)}
        <small> / {chamber.of}</small>
      </button>
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
    {/* What goes on each side of the bar for the weight in the stepper (lib/plates.js). */}
    {mode === 'reps' && <PlatesLine S={S} exId={entry.id} w={s.w} className="dh-plates" />}
    {/* The drop-set and rest-pause rows this set has grown, edited where they were added. */}
    {intensify && (drops.length > 0 || bursts.length > 0) && <div className="dh-int">
      <IntensifierRows entryIdx={entryIdx} i={i} cols={cols} onToggleDrop={(si, di) => onToggleDrop?.(entryIdx, si, di)}
        onBadge={key => { if (dbl(key)) onOpenSet?.(entryIdx, i) }} />
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

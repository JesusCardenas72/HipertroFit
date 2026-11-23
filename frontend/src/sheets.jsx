import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX, BODYPARTS, isCardio, isBodyweightEq, allExercises, matchExercise, exOr, muscleTagsOf, catalogueRow } from './lib/exercises.js'
import { activeProfile, exAvailable, ALL_EQUIPMENT, ADJUSTABLE, newProfile, adjustableOf, adjustableFor } from './lib/equipment.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, isoOf, uid, exCount, DAYN, MONTHS_LONG } from './lib/format.js'
import { cyclePosition, cycleEndOf, opensNextCycle } from './lib/microcycle.js'
import { closeCycle, keepCycle, closableToday } from './lib/cycle-history.js'
import { resumableOf, pausedFor, pauseActive, resumePaused, discardPaused } from './lib/paused-workout.js'
import FreePlanVolume from './components/FreePlanVolume.jsx'
import PickerGaps from './components/PickerGaps.jsx'
import { usePersistedToggle } from './lib/use-persisted-toggle.js'
import { freePlanItem, freePlanVolume, stepFreeSets, freePlanProjection, freePlanEntries, freePlanDraft, toggleFreeLink, linkedToNext, removeFreeItem, lastFreePlan } from './lib/free-plan.js'
import { mesoState, setDeloadPct, isDeloadWorkout, DELOAD_PCT, carriedBase, rirGoalOf, withRirGoal } from './lib/mesocycle.js'
import { DeloadBadge } from './components/Deload.jsx'
import { lastEntryFor, bestWeightFor, buildSets, effectiveRoutineId, setsDone, setsDoneActive, lastBW, supersetUnits, unitOf, setLabel, defaultConfig, modeOf, effortOf, EFFORT, stepEffort, capEffort, isBw, isPerSide, sideReps, applyIntensifierPlan, MAX_PLANNED_WARMUPS, NOTE_MAX } from './lib/history.js'
import { seedTargets } from './lib/set-reference.js'
import { t, instrFor, exerciseNameFor, getLang, INSTR_LANGS } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { starterRoutines } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, Row, TextField, NumberField } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import { exerciseMuscleSnapshot, muscleLabel } from './lib/muscles.js'
import { addFolder, renameFolder, moveFolder, deleteFolder, FOLDER_NAME_MAX } from './lib/folders.js'
import { useRoutineReorder, dropRoutineEntry } from './views/RoutineEdit.jsx'
import { rowHsl } from './components/routineMagnets.js'
import { dockItems } from './lib/workout-dock.js'
import { buildPlanBundle, parsePlan, mergePlan, printPlan } from './lib/plan-share.js'
import { estimate1RM, best1RM, REP_CAP } from './lib/onerm.js'
import { nextPrescription, applyPrescription, policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS } from './lib/progression.js'
import { normalizeRepRange } from './lib/rep-range.js'
import { ladderOf, snapLoad, topOf, withAdjustable } from './lib/load-scale.js'
import { routineExerciseConfig, classifyExercise, CLASS_NAME, CLASS_REP_RANGE } from './lib/exercise-class.js'
import { pictureFromUrl } from './lib/image-file.js'
import { SUPPLEMENT_SOURCES, loadSource, normName, importedFrom, importedExercise } from './lib/supplement-catalogue.js'
import { facetSearch, ALL_DB, APP_DB } from './lib/exercise-search.js'
import { previousRoutineConfig, seedConfig, changedGlobals, applyGlobals, isGlobalField, GLOBAL_LABEL } from './lib/exercise-defaults.js'
import { MOBILE, shareExport } from './lib/mobile.js'
import { isWarmupRow } from './lib/workout-model.js'
import { isFavorite, canFavorite, toggleFavorite, favoritesFirst, favoriteMap } from './lib/favorites.js'
import { PATTERNS, patternOf } from './lib/movement-patterns.js'
import { nextUnfinishedUnit, unitEntryIdx } from './lib/supersetFlow.js'
import { swapActiveExercise } from './lib/active-exercise-swap.js'
import { useSheetKeyboard, useRevealActiveChip, tappable } from './lib/use-sheet-keyboard.js'
import { buildSessionEntries } from './lib/session-start.js'
import { workoutsOn, backfillStart } from './lib/backfill.js'
import { buildExtraEntry, fileExtraEntry } from './lib/extra-log.js'
import { finishWorkout, workoutCompleteSheet } from './sheets-finish.jsx'
import { ProgramSheet, programSheet } from './sheets-program.jsx'
import { copyExSheet, customExSheet, deleteCustomEx, importExercisesSheet, muscleEditSheet, renameExSheet } from './sheets-custom-exercise.jsx'
import { importFromApp, importFromHevy } from './sheets-import.jsx'
export { importFromApp, importFromHevy }
export { copyExSheet, customExSheet, deleteCustomEx, importExercisesSheet, muscleEditSheet, renameExSheet }
export { ProgramSheet, programSheet }
export { finishWorkout, workoutCompleteSheet }

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cancelText || t('Cancel')}</Button>
  </div>
}
// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center' })
}

/* ============================ starter plan ============================ */
export function loadStarterPlan() {
  const [push, pull, legs] = starterRoutines()
  update(st => {
    st.routines.push(push, pull, legs)
    st.week[1] = push.id; st.week[3] = pull.id; st.week[5] = legs.id
  })
  toast(t('Starter plan loaded — Mon Push · Wed Pull · Fri Legs'))
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label={t('minus 0.1')}><Icon name="minus" /></button>
      <div className="bw-read">{fmtNum(value)}<span className="u"> {unit}</span></div>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label={t('plus 0.1')}><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, onFree, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  // `then` lets the freestyle button reuse the same weigh-in and start a session without routine.
  const save = (then = onDone) => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (then) then(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    {/* This sheet opens `locked` — swipe/backdrop/Escape/Android-back all no-op on it (see
        Modals.jsx) so an accidental tap on "Start" can't be walked back by reflex the way
        every other sheet in the app can. The two buttons below already cover leaving it
        deliberately; this is the same close a normal sheet gets everywhere else, just
        opted back in explicitly instead of by omission. Plain close() — no onDone, no
        nav — so it's a true no-op: the screen underneath is exactly where you left it. */}
    {required
      ? <div className="row between" style={{ marginBottom: 14 }}>
          <h3 style={{ marginBottom: 0 }}>{t('Quick check-in')}</h3>
          <button className="iconbtn" aria-label={t('Cancel')} onClick={() => close()}><Icon name="xmark" /></button>
        </div>
      : <h3>{t('Log body weight')}</h3>}
    <div className="muted small">{required ? t('Slide or tap to set your weight — tracked before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => save()}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && onFree && <>
      <div style={{ height: 8 }} /><Button className="free" icon="freeWorkout" onClick={() => save(onFree)}>{t('Freestyle workout')}</Button>
    </>}
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="reset" onClick={() => { close(); nav('/workout') }}>{t('Choose a different workout')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(b.d)} aria-label="delete"><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps — beyond that an estimate is guesswork.', REP_CAP)
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

function ExerciseDetail({ ex: shown, close }) {
  const st = useStore(s => s.S)
  // Re-read from the index so a muscle correction saved from this sheet shows at once.
  const ex = (!shown.custom && EXIDX[shown.id]) || shown
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  const muscles = muscleTagsOf(ex)
  return <>
    <div className="row between" style={{ flexWrap: 'nowrap', gap: 10, alignItems: 'flex-start' }}>
      <h3 className="capitalize" style={{ minWidth: 0 }}>{exerciseNameFor(ex)}</h3>
      <FavoriteStar st={st} id={ex.id} />
    </div>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{t(ex.bp)}</span>
      {!isCardio(ex) && muscles.primary.map(m => <span key={'p' + m} className="tag mus-p" title={t('Primary')}><Icon name="target" />{t(muscleLabel(m))}</span>)}
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
      {!isCardio(ex) && muscles.secondary.map(m => <span key={'s' + m} className="tag mus-s" title={t('Secondary')}>{t(muscleLabel(m))}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    {ex.custom ? <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div> : <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); renameExSheet(ex) }}>{t('Rename this exercise')}</Button>
      {!isCardio(ex) && <Button icon="target" style={{ flex: 1 }} onClick={() => muscleEditSheet(ex)}>{t('Edit muscle groups')}</Button>}
    </div>}
    <Button icon="copy" style={{ marginTop: 8 }} onClick={() => { close(); copyExSheet(ex, copy => exerciseDetailSheet(copy)) }}>{t('Create a copy')}</Button>
    {!isCardio(ex) && <Button icon="gear" style={{ marginTop: 8 }} onClick={() => { close(); exDefaultsSheet(ex) }}>{t('Exercise settings')}</Button>}
    {!isCardio(ex) && <PatternRow ex={ex} />}
    {!isCardio(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
/* The routine slot an exercise fills (lib/movement-patterns.js), changeable from its detail sheet.
   A custom exercise stores it on its own record; a built-in one keeps the catalogue row as shipped
   and records the correction in S.exPatterns ('' = none), which lib/exercises.js overlays onto
   every lookup. Picking the catalogue's own pattern again drops the correction. */
function PatternRow({ ex }) {
  const original = ex.custom ? null : patternOf(catalogueRow(ex.id))
  const set = key => update(s => {
    if (ex.custom) {
      const row = (s.customEx || []).find(x => x.id === ex.id)
      if (!row) return
      if (key) row.pattern = key
      else delete row.pattern
      return
    }
    s.exPatterns = { ...(s.exPatterns || {}) }
    if (key === (original || '')) delete s.exPatterns[ex.id]
    else s.exPatterns[ex.id] = key
  })
  const mark = key => !ex.custom && key === (original || '') ? t('Original') : undefined
  return <SelectRow icon="figureStrength" title={t('Movement pattern')} value={patternOf(ex) || ''} onChange={set}
    options={[{ value: '', label: t('None'), subtitle: mark('') }, ...PATTERNS.map(p => ({ value: p.key, label: t(p.name), subtitle: mark(p.key) }))]} />
}
export const exerciseDetailSheet = ex => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} />)

/* ============================ add to routine ============================ */
// `opts.adj`: add it set up for those adjustable dumbbells (the Library's adjustable-dumbbell filter).
function AddToRoutine({ ex, opts, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    addExerciseToRoutine(ex, isNew ? null : st.routines.find(x => x.id === rid), cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', exerciseNameFor(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, opts)
  }
  return <>
    <h3 className="capitalize">{t('Add “{0}”', exerciseNameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => pick(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" {...tappable(() => pick('_new'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = (ex, opts) => ui().openSheet(close => <AddToRoutine ex={ex} opts={opts} close={close} />)

/* ============================ exercise picker ============================ */
/** The ★ that takes an exercise out of the favourites or puts it back. Only what you have used can be one. */
export function FavoriteStar({ st, id }) {
  if (!canFavorite(st, id)) return null
  const fav = isFavorite(st, id)
  return <button className="iconbtn" style={{ flex: 'none', color: fav ? 'var(--acc)' : undefined }}
    aria-pressed={fav} aria-label={fav ? t('Remove from favourites') : t('Add to favourites')} title={fav ? t('Remove from favourites') : t('Add to favourites')}
    onClick={ev => {
      ev.stopPropagation()
      const name = exerciseNameFor(EXIDX[id] || { id, n: id })
      confirmSheet({
        title: fav ? t('Remove “{0}” from favourites?', name) : t('Add “{0}” to favourites?', name),
        confirmText: fav ? t('Remove') : t('Add'),
        onConfirm: () => { update(s => { toggleFavorite(s, id) }) },
      })
    }}><Icon name={fav ? 'starFill' : 'star'} /></button>
}

// One list over every exercise database, with filters that narrow each other
// (lib/exercise-search.js): database (one, or all of them), muscle group and equipment — plus
// favourites and the equipment profile. Picking an exercise from another database imports it
// as a custom exercise in one step (picture downloaded, credit kept) and hands that to the
// caller, so adding and swapping work exactly as with a built-in; picking it again reuses it.
function ExercisePicker({ onPick, close, ctx }) {
  const st = useStore(s => s.S)
  const favs = favoriteMap(st)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('')    // '' = all, 'in' = favourites, 'out' = the rest
  const [db, setDb] = useState(APP_DB)      // APP_DB, ALL_DB or a SUPPLEMENT_SOURCES id
  const [bp, setBp] = useState('')          // '' = all body parts
  const [eq, setEq] = useState('')          // '' = any equipment
  const [showAll, setShowAll] = useState(false)
  const [filtersOpen, toggleFilters] = usePersistedToggle('picker_filters_open', true)
  const [shown, setShown] = useState(50)
  const [sources, setSources] = useState({}) // source id → candidates, 'loading' or 'failed'
  const [busy, setBusy] = useState('')
  const searchRef = useRef(null)
  const dbStrip = useRef(null), bpStrip = useRef(null), eqStrip = useRef(null)
  const onSearchFocus = useSheetKeyboard(searchRef)
  const wanted = db === ALL_DB ? SUPPLEMENT_SOURCES.map(s => s.id) : db === APP_DB ? [] : [db]
  // A source is read over the network the first time it is shown (a failed one is retried).
  useEffect(() => {
    wanted.filter(id => !Array.isArray(sources[id]) && sources[id] !== 'loading').forEach(id => {
      setSources(m => ({ ...m, [id]: 'loading' }))
      loadSource(id).then(l => setSources(m => ({ ...m, [id]: l })), () => setSources(m => ({ ...m, [id]: 'failed' })))
    })
  }, [db]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = allExercises(st)
  const profile = activeProfile(st)
  const owned = e => !profile || showAll || exAvailable(st, e)
  let appEx = all.filter(e =>
    (scope === 'in' ? favs[e.id] : scope === 'out' ? !favs[e.id] : true) &&
    matchExercise(e, q) && owned(e))
  if (scope === 'in') appEx = [...appEx].sort((a, b) => (favs[b.id] - favs[a.id]) || exerciseNameFor(a).localeCompare(exerciseNameFor(b)))
  appEx = favoritesFirst(st, appEx)
  const entries = appEx.map(e => ({ db: APP_DB, bp: e.bp, eq: e.eq, key: e.id, ex: e }))
  // Another database's exercises are never favourites; one already imported shows as yours.
  const imported = new Set((st.customEx || []).map(x => x && x.src).filter(Boolean))
  const needle = normName(q)
  if (scope !== 'in') SUPPLEMENT_SOURCES.forEach(s => {
    const l = sources[s.id]
    if (Array.isArray(l)) l.forEach(c => {
      if (!imported.has(c.key) && (!needle || normName(c.names.join(' ')).includes(needle)) && owned(c))
        entries.push({ db: s.id, bp: c.bp, eq: c.eq, key: c.key, c })
    })
  })
  // The database's choice is kept; a muscle group or equipment it lacks is set aside, not cleared.
  const { list: f, bpOn, eqOn, bpOpts, eqOpts, dbCounts } = facetSearch(entries, { db, bp, eq }, BODYPARTS)
  const total = (db === APP_DB || db === ALL_DB ? all.length : 0) +
    wanted.reduce((a, id) => a + (Array.isArray(sources[id]) ? sources[id].length : 0), 0)
  const loading = SUPPLEMENT_SOURCES.filter(s => wanted.includes(s.id) && sources[s.id] === 'loading')
  const failed = SUPPLEMENT_SOURCES.filter(s => wanted.includes(s.id) && sources[s.id] === 'failed')
  const shownSources = SUPPLEMENT_SOURCES.filter(s => wanted.includes(s.id) && Array.isArray(sources[s.id]))
  const favCount = Object.keys(favs).length
  const pickScope = v => { setScope(s => s === v ? '' : v); setShown(50) }
  const pickDb = v => { setDb(v); setShown(50) }
  const star = { fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }
  const count = id => {
    const l = id === APP_DB || id === ALL_DB ? null : sources[id]
    if (l === 'loading') return '…'
    if (l === 'failed' || (id !== APP_DB && id !== ALL_DB && !l)) return ''
    if (id === ALL_DB && SUPPLEMENT_SOURCES.some(s => !Array.isArray(sources[s.id]))) return ''
    return String(dbCounts[id] || 0)
  }
  const dbChip = (id, name) => <button key={id} className={'chip nocap' + (db === id ? ' on' : '')} aria-pressed={db === id} onClick={() => pickDb(id)}>
    {name}{count(id) && <span className="dim" style={{ marginLeft: 5 }}>{count(id)}</span>}
  </button>
  const sourceName = id => (SUPPLEMENT_SOURCES.find(s => s.id === id) || {}).name || id
  const pickOther = async c => {
    if (busy) return
    const prev = importedFrom(S().customEx, c)
    if (prev) { onPick(EXIDX[prev.id] || prev); return }
    setBusy(c.key)
    let picture = {}
    if (c.imageUrl) try { picture = await pictureFromUrl(c.imageUrl) } catch { /* imported without a picture */ }
    const id = 'c' + uid()
    const record = importedExercise(c, { id, picture, taken: allExercises(S()).flatMap(e => [e.n, exerciseNameFor(e)]) })
    update(s => { s.customEx = [...(s.customEx || []), record] })
    setBusy('')
    toast(t('“{0}” imported from {1}', record.n, sourceName(c.source)))
    onPick(EXIDX[id] || record)
  }
  useRevealActiveChip(dbStrip, db + filtersOpen)
  useRevealActiveChip(bpStrip, bpOn + filtersOpen)
  useRevealActiveChip(eqStrip, eqOn + filtersOpen)
  // What the folded filters still narrow the list by, so a filter in force is never hidden.
  const filterSummary = [
    scope === 'in' ? t('Favourites') : scope === 'out' ? t('Not favourites') : '',
    db === ALL_DB ? t('All databases') : db === APP_DB ? '' : sourceName(db),
    bpOn ? t(bpOn) : '', eqOn ? t(eqOn) : '',
  ].filter(Boolean).join(' · ')
  return <>
    <h3>{t('Add exercise')}</h3>
    {/* .picker-search is what index.css keys the keyboard-aware sheet layout on: the sheet
        lifts above the keys. The whole head — volume gaps, search and filters — stays put while
        the list scrolls under it; the gaps and the filters each fold away to make room. */}
    <div className="picker-search picker-head">
    <PickerGaps S={st} ctx={ctx} />
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input ref={searchRef} className="input" placeholder={total ? t('Search {0} exercises…', total) : t('Search…')} value={q} onFocus={onSearchFocus} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <button type="button" className="pg-fold pf-fold" aria-expanded={filtersOpen} onClick={toggleFilters}>
      <span className="small dim">{t('Filters')}</span>
      {!filtersOpen && filterSummary && <span className="small pf-sum">{filterSummary}</span>}
      <Icon name={filtersOpen ? 'chevronUp' : 'chevronDown'} className="pg-chev" />
    </button>
    {filtersOpen && <>
    {profile && <div className="small dim row" style={{ margin: '8px 0 2px', gap: 6, alignItems: 'center' }}>
      <Icon name="dumbbell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll(v => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    {(favCount > 0 || scope) && <div className="chips" style={{ margin: '10px 0 6px' }}>
      <button className={'chip' + (scope === 'in' ? ' on' : '')} aria-pressed={scope === 'in'} onClick={() => pickScope('in')}><Icon name="starFill" style={star} />{t('Favourites')} ({favCount})</button>
      <button className={'chip nocap' + (scope === 'out' ? ' on' : '')} aria-pressed={scope === 'out'} onClick={() => pickScope('out')}><Icon name="star" style={star} />{t('Not favourites')}</button>
    </div>}
    <div className="small dim" style={{ margin: '10px 2px 4px' }}>{t('Exercise database')}</div>
    <div className="chips" ref={dbStrip} style={{ marginBottom: 6 }}>
      {dbChip(ALL_DB, t('All databases'))}
      {dbChip(APP_DB, 'HipertroFit')}
      {SUPPLEMENT_SOURCES.map(s => dbChip(s.id, s.name))}
    </div>
    <div className="small dim" style={{ margin: '4px 2px 4px' }}>{t('Muscle group')}</div>
    <div className="chips" ref={bpStrip} style={{ marginBottom: 6 }}>
      <button className={'chip nocap' + (!bpOn ? ' on' : '')} onClick={() => { setBp(''); setShown(50) }}>{t('All')}</button>
      {bpOpts.map(b => <button key={b} className={'chip' + (bpOn === b ? ' on' : '')} onClick={() => { setBp(b); setShown(50) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 0 && <>
      <div className="small dim" style={{ margin: '4px 2px 4px' }}>{t('Equipment')}</div>
      <div className="chips" ref={eqStrip} style={{ marginBottom: 10 }}>
        <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
        {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
      </div>
    </>}
    </>}
    </div>
    {loading.length > 0 && <div className="small dim" style={{ margin: '0 2px 8px' }}>{t('Loading…')} {loading.map(s => s.name).join(', ')}</div>}
    {failed.length > 0 && <div className="small dim" style={{ margin: '0 2px 8px' }}>{t('Could not reach {0}. Try again later.', failed.map(s => s.name).join(', '))}</div>}
    <div className="list">
      {scope !== 'in' && (db === APP_DB || db === ALL_DB) && <div className="item" {...tappable(() => customExSheet(null, ex => onPick(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name, muscles, equipment, instructions and image')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(({ key, ex: e, c }) => e
        ? <div key={key} className="item" {...tappable(() => onPick(e))}>
          <Thumb ex={e} muscle /><div className="grow"><div className="tt capitalize">{exerciseNameFor(e)}</div><div className="ss capitalize">{t(muscleLabel(e.tg || e.bp))} · {t(e.eq)}</div></div>
          <FavoriteStar st={st} id={e.id} /><Icon name="plus" className="chev" />
        </div>
        : <div key={key} className="item" {...tappable(() => pickOther(c))}>
          <Thumb ex={{ id: c.key, n: c.n, img: c.imageUrl, tg: c.primaries[0], bp: c.bp }} muscle />
          <div className="grow"><div className="tt capitalize">{c.n}</div><div className="ss capitalize">{[c.primaries[0] ? t(muscleLabel(c.primaries[0])) : c.bp && t(c.bp), c.eq && t(c.eq)].filter(Boolean).join(' · ')}</div></div>
          {db === ALL_DB && <span className="tag">{sourceName(c.source)}</span>}
          {busy === c.key ? <span className="small dim">{t('Loading…')}</span> : <Icon name="plus" className="chev" />}
        </div>)}
      {f.length === 0 && scope === 'in' && <div className="empty">{t('No favourites yet — exercises you add to a routine or a workout show up here.')}</div>}
      {f.length === 0 && scope !== 'in' && !loading.length && <div className="empty">{t('No match')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
    {shownSources.length > 0 && <div className="small dim" style={{ marginTop: 10 }}>{shownSources.map(s => <div key={s.id}>{s.credit}</div>)}</div>}
  </>
}
// `ctx` tells the volume gaps above the list where the picker was opened from (lib/picker-gaps.js):
// { routineId } for a routine being programmed, { adds } for a freestyle plan not started yet.
export const exercisePicker = (onPick, ctx) => ui().openSheet(close => <ExercisePicker onPick={onPick} close={close} ctx={ctx} />)

/** Start a safe swap for one exact active-workout occurrence. */
export function swapActiveWorkoutExercise(index) {
  const active = S().active
  if (!active?.entries?.[index]) return

  const picker = exercisePicker(ex => exConfigSheet(ex, null, cfg => {
    // The picker is a chooser here, not a stack you keep adding from: one swap, then back to
    // the workout. (The add flow deliberately leaves it open.)
    picker.close()
    const full = { ...cfg, id: ex.id }
    const st = S()
    // Same rows the add flow builds: last time's loads and, in a planned session, the
    // prescription — swapping barbell for dumbbell bench must not start you at an empty bar.
    const freestyle = !st.active?.routineId
    const step = defaultIncrement(ex.id, st.unit)
    const plan = freestyle ? null : withRirGoal(nextPrescription(st, full, st.routines.find(r => r.id === st.active.routineId)), st.active.rirGoal)
    const built = buildSets(st, full, { step, ...(freestyle ? { preferLast: true } : {}) })
    const replacement = {
      id: ex.id,
      target: { ...cfg },
      plan,
      sets: applyIntensifierPlan(freestyle ? built : seedTargets(applyPrescription(built, plan, step),
        lastEntryFor(st, ex.id)?.sets, { mode: modeOf(full), plan, effort: effortOf(st), step }), full)
    }
    const current = S().active?.entries?.[index]
    if (!current) return

    const apply = options => {
      // A timed callback closes over entry/set indexes: invalidate it before the selected
      // occurrence can be replaced or a new entry shifts those indexes. The rest keeps counting —
      // swapping the next machine because it is taken is something you do *during* a rest — and
      // only its owner index follows an inserted entry.
      ui().stopWork()
      let result = null
      update(state => { result = swapActiveExercise(state.active, index, replacement, options) }, true)
      if (result?.inserted) ui().shiftRestOwner(result.index, 1)
    }
    const logged = (current.sets || []).some(set => set.done === true)
    if (!logged) { apply(); return }

    if (current.sg) {
      ui().openSheet(close => <>
        <h3>{t('Swap exercise?')}</h3>
        <div className="muted small" style={{ marginBottom: 12 }}>
          {t('Logged sets stay with the original exercise. Choose where the replacement belongs.')}
        </div>
        <Button variant="primary" onClick={() => { close(); apply({ loggedConfirmed: true, groupDisposition: 'keep' }) }}>
          {t('Keep replacement in this group')}
        </Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" onClick={() => { close(); apply({ loggedConfirmed: true, groupDisposition: 'detach' }) }}>
          {t('Insert after this group')}
        </Button>
      </>)
      return
    }

    confirmSheet({
      title: t('Swap exercise?'),
      message: t('Logged sets stay with the original exercise. The replacement will be inserted afterward.'),
      confirmText: t('Continue'),
      onConfirm: () => apply({ loggedConfirmed: true })
    })
  }))
}

/* ============================ equipment profiles ============================ */
// Create or edit one profile ("Home", "Gym", ...): a name plus a checklist of what you have.
function EquipmentProfileSheet({ profile, close }) {
  const update = useStore(s => s.update)
  const nameRef = useRef(null)
  const unit = useStore(s => s.S.unit)
  const [checked, setChecked] = useState(new Set(profile?.equipment || []))
  const [adj, setAdj] = useState(() => adjustableOf(profile))
  const toggle = k => setChecked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const hasAdj = checked.has(ADJUSTABLE)
  const adjTop = topOf(adj)
  const adjInvalid = hasAdj && !(adj.from > 0 && adj.step > 0 && adj.to >= adj.from)
  const save = () => {
    const name = (nameRef.current.value || '').trim()
    if (!name || adjInvalid) { return }
    update(s => {
      s.equipProfiles = s.equipProfiles || []
      const equipment = [...checked]
      // The range is kept with the profile only while it has the dumbbells.
      const withAdj = p => { if (hasAdj) p.adj = { from: adj.from, to: adj.to, step: adj.step }; else delete p.adj }
      if (profile) {
        const p = s.equipProfiles.find(x => x.id === profile.id)
        if (p) { p.name = name; p.equipment = equipment; withAdj(p) }
      } else {
        const p = newProfile(name); p.equipment = equipment; withAdj(p)
        s.equipProfiles.push(p)
        if (!s.activeEquipId) s.activeEquipId = p.id
      }
    })
    close()
  }
  return <>
    <h3>{profile ? t('Edit profile') : t('New equipment profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Name it after where you train — e.g. "Home" or "Gym" — then check what you have there.')}
    </div>
    <TextField ref={nameRef} defaultValue={profile?.name || ''} placeholder={t('Profile name')} maxLength={40} />
    <div style={{ height: 12 }} />
    <div className="chips">
      {ALL_EQUIPMENT.map(k => (
        <button key={k} className={'chip' + (checked.has(k) ? ' on' : '')} onClick={() => toggle(k)}>{t(k)}</button>
      ))}
    </div>
    {hasAdj && <>
      <div className="row cfgrow" style={{ marginTop: 14, marginBottom: 8 }}>
        <Stepper label={t('Starting weight ({0})', unit)} value={adj.from} step={0.5}
          invalid={!(adj.from > 0) || !(adj.to >= adj.from)} onChange={v => setAdj(a => ({ ...a, from: v }))} />
        <Stepper label={t('Final weight ({0})', unit)} value={adj.to} step={0.5}
          invalid={!(adj.to >= adj.from)} onChange={v => setAdj(a => ({ ...a, to: v }))} />
        <Stepper label={t('Per click ({0})', unit)} value={adj.step} step={0.25}
          invalid={!(adj.step > 0)} onChange={v => setAdj(a => ({ ...a, step: v }))} />
      </div>
      <div className="dim small">
        {adjInvalid ? t('The final weight has to be at least the starting one, and a click has to add something.')
          : adjTop < adj.to - 1e-9 ? t('From {0} to {1} {2}, {3} {2} a click — the clicks stop at {4} {2}.', fmtNum(adj.from), fmtNum(adj.to), unit, fmtNum(adj.step), fmtNum(adjTop))
            : t('From {0} to {1} {2}, {3} {2} a click.', fmtNum(adj.from), fmtNum(adj.to), unit, fmtNum(adj.step))}
        {' '}{t('Dumbbell exercises set to adjustable dumbbells start from this range.')}
      </div>
    </>}
    <div className="dim small" style={{ marginTop: 10 }}>
      {t('Body-weight exercises are always available, in every profile.')}
    </div>
    <div style={{ height: 14 }} /><Button variant="primary" disabled={adjInvalid} onClick={save}>{t('Save')}</Button>
  </>
}
export const equipmentProfileSheet = profile => ui().openSheet(close => <EquipmentProfileSheet profile={profile} close={close} />)

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
const progressionStepOf = (c, mode, ex, unit) =>
  c.inc >= 0 ? c.inc : (mode === 'time' ? 5 : (ladderOf(c)?.step || defaultIncrement(ex.id, unit)))
// One remembered value, as it reads in the "changes every routine" dialog.
function fmtGlobalValue(field, value, unit) {
  if (field === 'bodyweight' || field === 'side') return value ? t('On') : t('Off')
  if (value === undefined || value === null || value === '') return t('None')
  if (field === 'intensifier') return t(value.type === 'dropset' ? 'Drop-set' : 'Rest-pause')
  if (field === 'prog') return t(POLICY_NAME[value] || value)
  if (field === 'restSec') return t('{0}s', fmtNum(value))
  if (field === 'inc' || field === 'weight') return fmtNum(value) + ' ' + unit
  if (field === 'adj') return value.to >= value.from
    ? t('{0}–{1} {3}, +{2} {3}', fmtNum(value.from), fmtNum(value.to), fmtNum(value.step), unit)
    : t('From {0} {2}, +{1} {2}', fmtNum(value.from), fmtNum(value.step), unit)
  return fmtNum(value)
}
const progressionStepIsValid = (step, policy) =>
  policy === 'off' || (Number.isFinite(step) && step > 0)

function ProgressionFields({ ex, mode, c, setC, routine, unit, perSide, gcls }) {
  const options = POLICIES_FOR[mode] || ['off']
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = progressionStepOf(c, mode, ex, unit)
  const invalid = !progressionStepIsValid(inc, active)
  // On adjustable dumbbells a step that is not a whole number of clicks lands between rungs.
  const ladder = mode === 'time' ? null : ladderOf(c)
  const stride = mode === 'reps' && perSide ? 2 : 1
  const range = active === 'double' ? normalizeRepRange(c.reps, c.repsMin, stride) : null
  const setRule = v => setC(x => {
    const next = { ...x, prog: v || undefined }
    return policyFor({ ...next, id: ex.id }, routine, mode) === 'double'
      ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, stride) }
      : next
  })
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow className={gcls('prog')} title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={setRule}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {active !== 'off' && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : ladder ? ladder.step : 1.25} decimal={mode !== 'time'} invalid={invalid}
        className={(invalid ? 'invalid' : '') + gcls('inc')}
        onChange={v => setC(x => ({ ...x, inc: v }))} />
      {active === 'double' && <>
        {/* The draft stays as typed: normalising on every keystroke turned "12" into 92 (the
            "1" was pulled above the lower bound first). Save and the engine normalise anyway. */}
        <Stepper label={t('Reps from')} value={c.repsMin ?? range.repsMin} step={stride} decimal={false}
          className={gcls('repsMin')} onChange={v => setC(x => ({ ...x, repsMin: v }))} />
        <Stepper label={t('Reps up to')} value={c.reps ?? range.reps} step={stride} decimal={false}
          className={gcls('reps')} onChange={v => setC(x => ({ ...x, reps: v }))} />
      </>}
    </div>}
    {invalid && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: -10, marginBottom: 18 }}>
      {t('Enter a positive step to use this progression rule.')}
    </div>}
  </>
}

// `defaults`: opened from the Exercises tab, not from a routine. Only what the exercise carries
// (exDefaults) is edited there — sets, warm-ups and notes belong to each routine and are left out.
function ExConfig({ ex, existing, onSave, onDelete, close, routine, initial, defaults }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  // What this exercise was given the first time it was configured, anywhere. A new instance
  // starts from it (that is the point of a global field); one being edited already carries it.
  const globals = st.exDefaults?.[ex.id]
  const base = existing || initial || defaultConfig(ex.id)
  const seed = existing ? base : seedConfig(base, globals, cardio ? 'cardio' : modeOf({ ...base, id: ex.id }))
  const [c, setC] = useState(() => {
    const cfg = { ...seed }
    return policyFor({ ...cfg, id: ex.id }, routine, modeOf({ ...cfg, id: ex.id })) === 'double'
      ? { ...cfg, ...normalizeRepRange(cfg.reps, cfg.repsMin, isPerSide(cfg) ? 2 : 1) }
      : cfg
  })
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id })
  const perSide = isPerSide(c)
  // Adjustable dumbbells (see lib/load-scale.js): the weight steppers walk the rungs the set
  // actually has. Offered on dumbbell work and on custom exercises, whose equipment may be
  // anything; bodyweight work has no weight to step.
  const ladder = !cardio && !bw ? ladderOf(c) : null
  const offerAdj = !cardio && !bw && (ex.eq === 'dumbbell' || ex.eq === ADJUSTABLE || !ex.eq || ex.eq === 'custom' || !!c.adj)
  // Switched on, it starts from the adjustable dumbbells of your equipment profile (Settings).
  const setAdj = v => setC(x => {
    if (!v) return { ...x, adj: undefined }
    const adj = x.adj && ladderOf(x) ? x.adj : adjustableFor(st)
    return { ...x, adj, weight: snapLoad(x.weight || 0, adj) }
  })
  const setAdjField = (field, v) => setC(x => {
    const adj = { ...(x.adj || adjustableFor(st)), [field]: v }
    return { ...x, adj, weight: ladderOf({ adj }) ? snapLoad(x.weight || 0, adj) : x.weight }
  })
  const progressionPolicy = policyFor({ ...c, id: ex.id }, routine, mode)
  const progressionStepInvalid = !progressionStepIsValid(progressionStepOf(c, mode, ex, st.unit), progressionPolicy)
  // Colour says where a value lives. A global field belongs to the exercise: what you type
  // here is what every other routine using it starts from. See lib/exercise-defaults.js.
  const gcls = field => (isGlobalField(field, { ...c, bodyweight: bw }, mode) ? ' gfield' : '')
  const activePolicy = policyFor({ ...c, id: ex.id }, routine, mode)
  const double = mode === 'reps' && activePolicy === 'double'
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => {
    const next = { ...defaultConfig(ex.id, m), ...x, mode: m }
    return m === 'reps' && policyFor({ ...next, id: ex.id }, routine, 'reps') === 'double'
      ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, isPerSide(next) ? 2 : 1) }
      : next
  })
  // Writing a global field rewrites it for every routine that uses this exercise, so it is
  // spelled out and confirmed rather than happening quietly behind the sheet. Cancel leaves
  // the sheet open on the typed value, so a change can be corrected instead of retyped.
  const commit = out => {
    const resolved = { ...out, bodyweight: bw }
    const finish = () => {
      close()
      update(s => { s.exDefaults = applyGlobals(s.exDefaults, ex.id, resolved, mode) })
      onSave(out)
    }
    // Editing the exercise itself is the change the confirmation asks about, so it is not asked again.
    if (defaults) return finish()
    const changes = changedGlobals(resolved, globals, mode)
    if (!changes.length) return finish()
    confirmSheet({
      title: t('Change this for every routine?'),
      message: <>
        <div style={{ marginBottom: 12 }}>
          {t('These belong to the exercise, not to this routine — every routine that uses {0} will start from the new value.', exerciseNameFor(ex))}
        </div>
        <ul className="gfield-diff">
          {changes.map(ch => <li key={ch.field}>
            <span>{t(GLOBAL_LABEL[ch.field])}</span>
            <b>{fmtGlobalValue(ch.field, ch.from, st.unit)} → {fmtGlobalValue(ch.field, ch.to, st.unit)}</b>
          </li>)}
        </ul>
      </>,
      confirmText: t('Accept'),
      onConfirm: finish,
    })
  }
  const save = () => {
    if (progressionStepInvalid) return
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps; `side` is not — it counts
    // reps, and a timed hold has none. Switching an exercise to Time therefore drops it
    // rather than carrying a flag nothing downstream can read.
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    // Free text, e.g. a pyramid's per-set loading ("bar only, +1 plate/side each set") — the
    // sets/reps/weight fields are one flat target and have no room for that on their own.
    // Mode-independent, so it is spread in below rather than folded into `flags`.
    const note = (c.note || '').trim().slice(0, 500)
    const withNote = note ? { note } : {}
    // Only written when there are any, so a plan that never asked for warm-ups keeps the exact
    // shape it had — and reads back as 0 either way (buildSets).
    const warmupSets = Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(c.warmupSets) || 0))
    const withWarmups = warmupSets ? { warmupSets } : {}
    // Per-exercise rest (issue #10): written only when a positive value was set, so 0 keeps
    // inheriting the global rest timer and a config that never touched it stays the shape it
    // was. Mode-independent — a heavy triple, a plank and a cardio interval all rest.
    const restSec = Math.max(0, Math.round(c.restSec) || 0)
    const withRest = restSec ? { restSec } : {}
    // Only on loaded work, and only when it is a ladder that can load something — so a barbell
    // config keeps exactly the shape it had. The planned weight lands on one of its rungs.
    const withAdj = ladder ? { adj: { from: ladder.from, ...(ladder.to != null ? { to: ladder.to } : {}), step: ladder.step } } : {}
    const loadOf = w => (ladder ? snapLoad(Math.max(0, w || 0), ladder) : Math.max(0, w || 0))
    if (cardio) commit({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8), ...withNote, ...withRest })
    else if (mode === 'time') commit({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: loadOf(c.weight), ...flags, ...prog, ...withNote, ...withWarmups, ...withRest, ...withAdj })
    else {
      // A unilateral target is stored even: the split has to divide, and a typed 15 would
      // otherwise plan seven reps on one side and eight on the other, every session.
      const typed = Math.max(1, Math.round(c.reps) || 10)
      const stride = perSide ? 2 : 1
      let reps = perSide ? Math.ceil(typed / stride) * stride : typed
      let range = null
      if (double) {
        range = normalizeRepRange(reps, c.repsMin, stride)
        reps = range.reps
      }
      const out = { sets, mode: 'reps', reps, weight: loadOf(c.weight), ...flags, ...(perSide ? { side: true } : {}), ...prog, ...withNote, ...withWarmups, ...withRest, ...withAdj }
      if (double) out.repsMin = range.repsMin
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      // Every set in this exercise becomes a drop-set/rest-pause (buildSets stamps the rows) —
      // decided here, in the plan, not re-decided live each time you train it.
      if (c.intensifier && c.intensifier.type) out.intensifier = c.intensifier
      commit(out)
    }
  }
  return <>
    <h3 className="capitalize">{exerciseNameFor(ex)}</h3>
    <Media ex={ex} />
    {/* The same tags the exercise detail sheet shows, secondaries included: choosing what goes
        into a plan is exactly when "what else does this hit" matters, and until now that was
        only visible from the Exercises tab, after the fact. */}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* The class decides the default rep range for double progression — shown so a 10–20
          on a curl, or 5–12 on a squat, is explained rather than arbitrary. */}
      {!cardio && (() => {
        const kind = classifyExercise(ex)
        const range = CLASS_REP_RANGE[kind]
        return <span className="tag acc">{t(CLASS_NAME[kind])} · {range.repsMin}–{range.reps}</span>
      })()}
      {cardio || !muscleTagsOf(ex).primary.length
        ? <span className="tag">{t(ex.tg || ex.bp)}</span>
        : muscleTagsOf(ex).primary.map(m => <span key={'p' + m} className="tag mus-p">{t(muscleLabel(m))}</span>)}
      <span className="tag">{t(ex.eq)}</span>
      {!cardio && muscleTagsOf(ex).secondary
        .map(m => <span key={'s' + m} className="tag mus-s">{t(muscleLabel(m))}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {/* A colour with no key is a riddle: say once, up front, what the marked fields mean. */}
    <div className="small gfield-key" style={{ marginBottom: 14 }}>
      {defaults
        ? t('Everything here belongs to the exercise: every routine that uses it starts from these values. Sets, warm-ups and notes are set per routine, in the routine.')
        : t('Fields in this colour belong to the exercise: every routine that uses it starts from them, and changing one here changes it everywhere. The rest are this routine’s own.')}
    </div>
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label={t('Speed (km/h)')} value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : mode === 'time' ? <>
        {!defaults && <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />}
        {!defaults && <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />}
        {!defaults && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} ladder={ladder} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </> : <>
        {/* Rest-pause always trains as exactly two rows — a warm-up at this rep count, then one
            rest-pause work set — so "Sets" has nothing left to mean and only invites a mismatch. */}
        {!defaults && c.intensifier?.type !== 'restpause' &&
          <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />}
        {!double && <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false}
          className={gcls('reps')} onChange={v => setC(x => ({ ...x, reps: v }))} />}
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && !defaults && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} ladder={ladder} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {c.intensifier?.type === 'restpause' && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {t('Rest-pause always trains as one warm-up set at this rep count, then one rest-pause work set — "Sets" is not used.')}
    </div>}
    {/* Planned warm-ups: the session used to start at the work weight and you added every
        warm-up by hand, every time. Rest-pause is excluded because it builds its own warm-up
        row, and cardio because an interval plan has no load to ramp. */}
    {!cardio && !defaults && c.intensifier?.type !== 'restpause' && <>
      <div className="row cfgrow" style={{ marginBottom: 6 }}>
        <Stepper label={t('Warm-up sets')} value={c.warmupSets || 0} step={1} decimal={false}
          onChange={v => setC(x => ({ ...x, warmupSets: Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(v) || 0)) }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {(c.warmupSets || 0) > 0
          ? t('Added before your work sets and left out of volume, records and progression. Each one closes half the gap to the work weight — you can still change any of them mid-session.')
          : t('Ramp-up sets added before the work sets, so you do not have to add them by hand each session.')}
      </div>
    </>}
    {mode === 'time' && !bw && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    {/* Per-exercise rest (issue #10). Its own full-width row, like the other steppers with an
        explanation under them, and outside every mode branch because a heavy triple, a plank
        and a cardio interval all rest — they just do not all want the same break. */}
    <div className="row cfgrow" style={{ marginBottom: 6 }}>
      <Stepper label={t('Rest (s)')} value={c.restSec || 0} step={15} decimal={false}
        className={gcls('restSec')} onChange={v => setC(x => ({ ...x, restSec: v }))} />
    </div>
    <div className="small dim" style={{ marginBottom: 18 }}>
      {t('Rest after each set of this exercise. Leave at 0 to use your default rest timer.')}
    </div>
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row className={gcls('bodyweight')} icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? t('No weight to enter — just log the reps.') : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={v => setC(x => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode === 'reps' && <Row className={gcls('side')} icon="shuffle" iconTint="var(--blue)" title={t('Reps per side')}
        subtitle={perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.')}>
        {/* Turning it on rounds the target up to an even number, since half of an odd
            total is a rep one side does not get. */}
        <Switch checked={perSide} onChange={v => setC(x => {
          const next = { ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }
          return policyFor({ ...next, id: ex.id }, routine, 'reps') === 'double'
            ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, v ? 2 : 1) }
            : next
        })} />
      </Row>}
      {offerAdj && <Row className={gcls('adj')} icon="dumbbell" iconTint="var(--acc)" title={t('Adjustable dumbbells')}
        subtitle={ladder
          ? ladder.to != null
            ? t('Weights go {0}, {1}, {2}… up to {3} {4}', fmtNum(ladder.from), fmtNum(ladder.from + ladder.step), fmtNum(ladder.from + 2 * ladder.step), fmtNum(topOf(ladder)), st.unit)
            : t('Weights go {0}, {1}, {2}… {3}', fmtNum(ladder.from), fmtNum(ladder.from + ladder.step), fmtNum(ladder.from + 2 * ladder.step), st.unit)
          : t('Weights in fixed clicks from a starting weight, e.g. from 4 kg in 1.5 kg steps.')}>
        <Switch checked={!!c.adj} onChange={setAdj} />
      </Row>}
    </div>}
    {offerAdj && c.adj && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Starting weight ({0})', st.unit)} value={c.adj.from} step={0.5} className={gcls('adj')}
          invalid={!(c.adj.from > 0)} onChange={v => setAdjField('from', v)} />
        {/* A ladder set up before it had a last rung shows none; the first tap starts it at
            the profile's, not at 0,5 kg. */}
        <Stepper label={t('Final weight ({0})', st.unit)} value={c.adj.to ?? ''} step={0.5} className={gcls('adj')}
          invalid={c.adj.to != null && c.adj.to !== '' && !(c.adj.to >= c.adj.from)}
          onChange={v => setAdjField('to', c.adj.to == null && v < c.adj.from ? Math.max(c.adj.from, adjustableFor(st).to) : v)} />
        <Stepper label={t('Per click ({0})', st.unit)} value={c.adj.step} step={0.25} className={gcls('adj')}
          invalid={!(c.adj.step > 0)} onChange={v => setAdjField('step', v)} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('The weight steppers, progression, warm-ups and deloads only land on these weights.')}
      </div>
    </>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          className={gcls('weight')} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        className={gcls('repsMax')} onChange={v => setC(x => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    {mode === 'reps' && <>
      <h4 className="sec">{t('Drop-set / rest-pause')}</h4>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <SelectRow className={gcls('intensifier')} title={t('Intensifier')} sheetTitle={t('Intensifier')} value={c.intensifier?.type || ''}
          onChange={v => setC(x => ({
            ...x,
            intensifier: !v ? undefined : v === 'dropset'
              ? { type: 'dropset', count: x.intensifier?.count || 1, pct: x.intensifier?.pct || 20 }
              // The activation set's own reps are whatever "Reps" above already says — a
              // rest-pause plan only adds two new numbers: the total extra reps wanted past
              // it, and the rest between the bursts that total gets split into.
              : { type: 'restpause', totalReps: x.intensifier?.totalReps || x.reps || 8, restSec: x.intensifier?.restSec || st.restPauseSec || 15 },
          }))}
          options={[
            { value: '', label: t('None') },
            { value: 'dropset', label: t('Drop-set') },
            { value: 'restpause', label: t('Rest-pause') },
          ]} />
      </div>
      {c.intensifier?.type === 'dropset' && <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Drops')} value={c.intensifier.count} step={1} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, count: Math.max(1, v) } }))} />
        <Stepper label={t('Weight drop (%)')} value={c.intensifier.pct} step={5} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, pct: Math.max(5, v) } }))} />
      </div>}
      {c.intensifier?.type === 'restpause' && <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Rest-pause reps')} value={c.intensifier.totalReps} step={1} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, totalReps: Math.max(1, v) } }))} />
        <Stepper label={t('Rest (s)')} value={c.intensifier.restSec} step={5} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, restSec: Math.max(5, v) } }))} />
      </div>}
      {c.intensifier?.type && <div className="small dim" style={{ marginTop: -2, marginBottom: 18 }}>
        {c.intensifier.type === 'dropset'
          ? t('Every set becomes a drop-set: after the main set, {0} drop(s) with no rest, each about {1}% lighter.', c.intensifier.count, c.intensifier.pct)
          : t('Every set becomes rest-pause: {0} reps to start, then {1} more split into short bursts, {2}s rest before each, roughly halving each time.', c.reps || 0, c.intensifier.totalReps, c.intensifier.restSec)}
      </div>}
    </>}
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} perSide={perSide} gcls={gcls} />
    {!defaults && <textarea className="input" rows={3} maxLength={500} style={{ marginBottom: 18 }}
      placeholder={t('Note (optional) — loading cues, "bar only then +1 plate/side each set", anything worth remembering here')}
      value={c.note || ''} onChange={e => setC(x => ({ ...x, note: e.target.value }))} />}
    <Button variant="primary" disabled={progressionStepInvalid} onClick={save}>{existing || defaults ? t('Save') : t('Add to routine')}</Button>
    {!defaults && (ex.custom
      ? <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>
      : !ex.missing && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => renameExSheet(ex)}>{t('Rename this exercise')}</Button></>)}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine, initial) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} initial={initial} onSave={onSave} onDelete={onDelete} routine={routine} close={close} />)
// The exercise's own settings, from the Exercises tab: increments, rep range, rest, progression… —
// everything every routine that uses it starts from (see lib/exercise-defaults.js).
export const exDefaultsSheet = ex => ui().openSheet(close => <ExConfig ex={ex} onSave={() => {}} close={close} defaults />)

/* ============================ add an exercise to a routine ============================ */
// The parameters of a planned exercise, one row each, for the "already set up" notice.
function plannedRows(ex, cfg, routine, unit) {
  const mode = isCardio(ex.id) ? 'cardio' : modeOf({ ...cfg, id: ex.id })
  const rows = []
  if (mode === 'cardio') {
    rows.push([t('Intervals'), fmtNum(cfg.sets || 1)], [t('Minutes'), fmtNum(cfg.min || 20)], [t('Speed (km/h)'), fmtNum(cfg.speed || 8)])
  } else {
    rows.push([t('Sets'), fmtNum(cfg.sets || 1)])
    if (mode === 'time') rows.push([t('Seconds'), fmtNum(cfg.sec || 45)])
    else rows.push([t('Reps'), cfg.prog === 'double' && cfg.repsMin ? `${cfg.repsMin}–${cfg.reps}` : fmtNum(cfg.reps || 0)])
    const bw = isBw({ ...cfg, id: ex.id })
    if (!bw || cfg.weight > 0) rows.push([bw ? t('Added ({0})', unit) : t('Weight ({0})', unit), fmtNum(cfg.weight || 0)])
    if (ladderOf(cfg)) rows.push([t('Adjustable dumbbells'), fmtGlobalValue('adj', ladderOf(cfg), unit)])
    const policy = policyFor({ ...cfg, id: ex.id }, routine, mode)
    rows.push([t('Progression'), cfg.prog ? t(POLICY_NAME[policy]) : t('Follow the routine ({0})', t(POLICY_NAME[policy]))])
    if (cfg.warmupSets) rows.push([t('Warm-up sets'), fmtNum(cfg.warmupSets)])
    if (cfg.intensifier?.type) rows.push([t('Intensifier'), t(cfg.intensifier.type === 'dropset' ? 'Drop-set' : 'Rest-pause')])
  }
  if (cfg.restSec) rows.push([t('Rest (s)'), fmtNum(cfg.restSec)])
  if (cfg.note) rows.push([t('Note'), cfg.note])
  return rows
}

function ReusedExercise({ ex, found, routine, onAccept, onEdit, close }) {
  const unit = useStore(s => s.S.unit)
  return <>
    <h3 className="capitalize">{exerciseNameFor(ex)}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('You already set this exercise up in “{0}”. It keeps those parameters — accept them, or review and change them for this routine.', found.routine.name)}
    </div>
    <div className="list" style={{ marginBottom: 18 }}>
      {plannedRows(ex, found.cfg, routine || found.routine, unit).map(([label, value]) =>
        <div key={label} className="item"><div className="grow"><div className="ss">{label}</div></div><b>{value}</b></div>)}
    </div>
    <Button variant="primary" onClick={() => { close(); onAccept() }}>{t('Accept')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="pencil" onClick={() => { close(); onEdit() }}>{t('Review and change')}</Button>
  </>
}

// Adding an exercise while designing a routine. Set up before in another routine, it keeps what
// it was given there — the user is told so and can accept it as it is or open the config sheet on
// it. Never set up, the config sheet opens on the class defaults (routineExerciseConfig).
// With `adj` (adjustable dumbbells { from, to, step }) either one is set up for them, unless it
// already has dumbbells of its own (withAdjustable).
export function addExerciseToRoutine(ex, routine, onAdd, { adj } = {}) {
  const st = S()
  const seed = cfg => (adj ? withAdjustable(cfg, adj) : cfg)
  const found = previousRoutineConfig(st.routines, ex.id, routine?.id)
  if (!found) return exConfigSheet(ex, null, onAdd, null, routine, seed(routineExerciseConfig(st, ex)))
  const cfg = seed({ ...found.cfg })
  ui().openSheet(close => <ReusedExercise ex={ex} found={{ ...found, cfg }} routine={routine} close={close}
    onAccept={() => onAdd({ ...cfg })}
    onEdit={() => exConfigSheet(ex, null, onAdd, null, routine, { ...cfg })} />)
}

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const exportFile = async () => {
    const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '')
    const json = JSON.stringify(bundle, null, 2)
    const name = 'hipertrofit-plan-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } close(); return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    close(); toast(t('Plan file saved — send it to a friend'))
  }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try { const bundle = parsePlan(rd.result); close(); planImportSheet(bundle) }
      catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="upload" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend imports into their own HipertroFit — routines only, none of your workouts or weigh-ins.')}</div>
    {!MOBILE && <>
      <div style={{ height: 12 }} />
      <Button variant="tinted" icon="download" onClick={() => { close(); printPlan(st, user?.name || '') }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
    </>}
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    update(s => mergePlan(s, bundle, { schedule }))
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + t(bundle.scheduledDays === 1 ? 'scheduled on {0} day' : 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === st.week[wd])
  const hasOvr = st.dayPlan[iso] !== undefined
  const effId = effectiveRoutineId(st, iso)
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso)) : t('{0} planned for {1}', (st.routines.find(r => r.id === v) || {}).name, fmtDate(iso)))
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{hasOvr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => set(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {effId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" {...tappable(() => set('rest'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effId === null && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" {...tappable(() => set(''))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

function DayAssign({ day, close }) {
  const st = useStore(s => s.S)
  const set = v => { update(s => { if (v) s.week[day] = v; else delete s.week[day] }); close() }
  return <>
    <h3>{t(DAYN[day])}</h3>
    <div className="list">
      <div className="item" {...tappable(() => set(''))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div>{!st.week[day] && <Icon name="check" className="accent" />}</div>
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => set(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {st.week[day] === r.id && <Icon name="check" className="accent" />}</div>)}
    </div>
  </>
}
export const dayAssignSheet = day => ui().openSheet(close => <DayAssign day={day} close={close} />)

/* ============================ routine folders ============================ */
// New folder (no `folder`) or manage an existing one: rename, reorder, add a routine inside,
// delete. Deleting only removes the folder — its routines drop back to the loose list.
function FolderSheet({ folder, close }) {
  const st = useStore(s => s.S)
  const nameRef = useRef(null)
  const live = folder && (st.folders || []).find(f => f.id === folder.id)
  const idx = live ? st.folders.indexOf(live) : -1
  const count = live ? st.routines.filter(r => r.folder === live.id).length : 0
  const save = () => {
    const name = nameRef.current.value
    if (!name.trim()) { nameRef.current.focus(); return }
    update(s => { if (live) renameFolder(s, live.id, name); else addFolder(s, name) })
    close()
  }
  const newRoutineHere = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [], folder: live.id }
    update(s => { s.routines.push(r); const f = s.folders.find(x => x.id === live.id); if (f) f.open = true })
    close(); nav('/plan/r/' + r.id)
  }
  const remove = () => confirmSheet({
    title: t('Delete folder?'),
    message: count
      ? t('“{0}” will be removed. Its {1} routines stay in your plan, outside any folder.', live.name, count)
      : t('“{0}” will be removed.', live.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => deleteFolder(s, live.id)),
  })
  if (folder && !live) return null
  return <>
    <h3>{live ? t('Edit folder') : t('New folder')}</h3>
    <TextField ref={nameRef} defaultValue={live?.name || ''} placeholder={t('Folder name')} maxLength={FOLDER_NAME_MAX}
      autoFocus={!live} onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {live && <>
      <div style={{ height: 8 }} />
      <Button variant="tinted" icon="plus" onClick={newRoutineHere}>{t('New routine in this folder')}</Button>
      {st.folders.length > 1 && <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <Button variant="ghost" icon="arrowUp" disabled={idx <= 0} onClick={() => update(s => moveFolder(s, live.id, -1))}>{t('Move up')}</Button>
        <Button variant="ghost" icon="arrowDown" disabled={idx >= st.folders.length - 1} onClick={() => update(s => moveFolder(s, live.id, 1))}>{t('Move down')}</Button>
      </div>}
      <div style={{ height: 8 }} />
      <Button variant="danger" icon="trash" onClick={() => { close(); remove() }}>{t('Delete folder')}</Button>
    </>}
  </>
}
export const folderSheet = folder => ui().openSheet(close => <FolderSheet folder={folder} close={close} />)

/* ============================ workout detail ============================ */
function WorkoutDetail({ w, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  // The session note is editable here rather than only at the finish sheet: what you want to
  // record about a session is often clearer once you have looked at what you actually did.
  const [note, setNote] = useState(w.note || '')
  const saveNote = () => update(s => {
    const rec = s.workouts.find(x => x.id === w.id)
    if (!rec) return
    const text = note.trim().slice(0, NOTE_MAX)
    if (text) rec.note = text; else delete rec.note
  })
  // onBlur alone loses the note: Escape, the Android back gesture and swipe-to-dismiss all
  // close the sheet without ever moving focus out of the textarea. Flush on unmount too. The
  // ref is what makes that work — a cleanup closes over the note from its own render, which
  // is the empty string this started with.
  const latest = useRef(note)
  latest.current = note
  const initial = useRef(w.note || '')
  useEffect(() => () => {
    const text = latest.current.trim().slice(0, NOTE_MAX)
    if (text === initial.current) return
    update(s => {
      const rec = s.workouts.find(x => x.id === w.id)
      if (!rec) return                       // deleted from this very sheet
      if (text) rec.note = text; else delete rec.note
    })
  }, [])
  return <>
    <h3>{w.name}</h3>
    {isDeloadWorkout(w) && <div style={{ marginBottom: 8 }}><DeloadBadge pct={w.deload}>{t('Deload session')}</DeloadBadge></div>}
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} muscle />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? exerciseNameFor(ex) : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join('  ·  ') || t('no sets')}</div>
          {e.note && <div className="small dim" style={{ marginTop: 3 }}>
            {e.notePin && <Icon name="flag" style={{ fontSize: 12, marginRight: 4, verticalAlign: '-1px', color: 'var(--yellow)' }} />}{e.note}
          </div>}</div>
      </div>
    })}
    <div className="small muted" style={{ margin: '4px 0 6px' }}>{t('Session note')}</div>
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} onBlur={saveNote} />
    <div style={{ height: 14 }} />
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
// Also embedded in Home (MicrocycleCard), where there is no sheet to close: `close` defaults to a no-op.
export function Calendar({ start, close = () => {} }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  // A workout without its date (a damaged record) belongs to no day: it is left off the grid, not a crash.
  const dated = st.workouts.filter(w => typeof w.d === 'string')
  dated.forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = dated.filter(w => w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], effId = effectiveRoutineId(st, iso), ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && effId ? 'ovr' : effId ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      close(); dayDetailSheet(iso)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label={t('Previous month')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label={t('Next month')}><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

// Everything trained on one day, set by set: each exercise with its weights, reps and the RIR the
// set was logged with. Opened from the calendar; a workout's name opens its own sheet, where the
// session note is edited and the workout deleted.
export const dayDetailSheet = iso => ui().openSheet(close => <DayDetail iso={iso} close={close} />)
function DayDetail({ iso, close }) {
  const st = useStore(s => s.S)
  const ws = st.workouts.filter(w => w.d === iso)
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    {!ws.length && <div className="muted small">{t('Rest day')}</div>}
    {ws.map(w => <div key={w.id} style={{ marginBottom: 18 }}>
      <button className="btn plain" style={{ padding: 0, marginBottom: 2, fontWeight: 600 }} onClick={() => { close(); workoutDetailSheet(w) }}>{w.name || t('Workout done')}</button>
      <div className="muted small" style={{ marginBottom: 10 }}>{[...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
      {w.entries.map((e, i) => {
        const ex = EXIDX[e.id]
        const done = e.sets.filter(s => s.done)
        return <div key={i} className="row" style={{ marginBottom: 10, alignItems: 'flex-start' }}>
          {ex && <Thumb ex={ex} muscle />}
          <div className="grow">
            <div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? exerciseNameFor(ex) : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
            {done.length ? done.map((s, k) => <div key={k} className="small">{k + 1}. {setLabel(e.id, s, e.target)}</div>) : <div className="small dim">{t('no sets')}</div>}
            {e.note && <div className="small dim" style={{ marginTop: 3 }}>{e.note}</div>}
          </div>
        </div>
      })}
    </div>)}
  </>
}

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  const dl = isDeloadWorkout(w)
  return <div className={'item' + (dl ? ' deload' : '')} {...tappable(onClick)}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19, ...(dl ? { background: 'var(--deload)', color: '#fff' } : {}) }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}{dl && <> <DeloadBadge pct={w.deload} /></>}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ deload session ============================ */
// The cut a deload session applies. Proposed, not imposed: 25–50%, remembered as the default
// for the next session of the block. Applies to weight, reps and the number of sets alike.
function DeloadSheet({ onStart, close }) {
  const st = useStore(s => s.S)
  const [pct, setPct] = useState(Math.round(mesoState(st).pct * 100))
  const clamp = v => Math.min(DELOAD_PCT.max * 100, Math.max(DELOAD_PCT.min * 100, Math.round(v / 5) * 5))
  const go = () => {
    update(s => { s.meso = setDeloadPct(s, pct / 100) })
    close()
    onStart(pct / 100)
  }
  return <>
    <h3>{t('Deload microcycle')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('This session comes down: less weight, fewer reps and fewer sets. Set how much — the app proposes, you decide.')}
    </div>
    <Stepper label={t('Reduction')} unit="%" value={pct} step={5} decimal={false} onChange={v => setPct(clamp(v))} />
    <div className="muted small" style={{ marginTop: 10 }}>
      {t('It will not count toward progression, so nothing reads as a stall.')}
    </div>
    <div style={{ height: 18 }} />
    <Button variant="primary" icon="play" onClick={go}>{t('Start workout')}</Button>
  </>
}
const deloadSheet = onStart => ui().openSheet(close => <DeloadSheet onStart={onStart} close={close} />)

/* ---------- a session that would open the next microcycle: asked first ---------- */
// The running block is complete but stays open until the user says so (lib/microcycle.js):
// start the next one with this session, or train it inside the one that is ending.
function ChangeCycle({ onGo, close }) {
  const st = useStore(s => s.S)
  const pos = cyclePosition(st)
  const meso = mesoState(st)
  const due = cycleEndOf(st)
  const go = patch => { close(); update(s => { const p = patch(s); if (p) Object.assign(s, p) }); onGo() }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="flag" />{t('Start microcycle #{0}?', carriedBase(st) + 1)}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Microcycle #{0} is complete: {1} of {2} sessions, since {3}.', meso.number, pos.sessions, pos.len, fmtDate(pos.start))}
      {' '}{due && due >= todayISO() ? t('Its days run until {0}, rest days included.', fmtDate(due, true)) : t('All its days have passed.')}
    </div>
    {resumableOf(st).length > 0 && <div className="small row" style={{ gap: 6, color: 'var(--orange)', marginBottom: 14 }}>
      <Icon name="pause" />{t('Starting the next one ends this one: its paused workouts can no longer be resumed.')}
    </div>}
    <Button variant="primary" icon="flag" onClick={() => go(s => closeCycle(s))}>{t('Start microcycle #{0}', carriedBase(st) + 1)}</Button>
    <div style={{ height: 8 }} />
    <Button icon="plus" onClick={() => go(s => keepCycle(s))}>{t('Train it in microcycle #{0}', meso.number)}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ workout lifecycle ============================ */
export function startFlow(routineId) {
  const st = S()
  // This routine was left paused in the running microcycle: pick it up again, or start over.
  const paused = !st.active && pausedFor(st, routineId)
  if (paused) return ui().openSheet(close => <PausedChoice p={paused} close={close}
    onStartOver={() => { update(s => { Object.assign(s, discardPaused(s, paused.id)) }); startFlow(routineId) }} />, { kind: 'center' })
  if (opensNextCycle(st, routineId)) {
    // A session already logged today keeps the block open today: dates cannot split a day, so
    // this one goes in it too.
    if (!closableToday(st)) update(s => { const p = keepCycle(s); if (p) Object.assign(s, p) })
    else return ui().openSheet(close => <ChangeCycle close={close} onGo={() => sessionFlow(routineId)} />)
  }
  sessionFlow(routineId)
}
function sessionFlow(routineId) {
  // On a deload microcycle the app proposes the cut and the user sets it, per session — so
  // the sheet sits between weighing in and walking up to the bar. See lib/mesocycle.js.
  const go = (rid, items) => bw => {
    const begin = pct => beginWorkout(rid, bw, pct, items)
    if (mesoState(S()).deload) deloadSheet(begin)
    else begin(0)
  }
  // A freestyle session is planned first, before the check-in: the planner shows what it does to
  // the microcycle's volume (freePlanSheet), then the weigh-in starts it with those exercises.
  if (!routineId) return freePlanSheet(items => bwSheet({ required: true, onDone: go(null, items) }))
  // Starting a routine, the check-in also offers a freestyle session instead: the weight is
  // already in, so its planner comes after it.
  bwSheet({ required: true, onDone: go(routineId), onFree: bw => freePlanSheet(items => go(null, items)(bw)) })
}
export function beginWorkout(routineId, bw, deload = 0, freeItems = null) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  // The mesocycle's target RIR for this microcycle (lib/mesocycle.js), a deload's when it is one.
  const rirGoal = rirGoalOf(st)
  const built = buildSessionEntries(st, r, { deload, rirGoal })
  const excluded = built.excluded
  // A freestyle session planned in freePlanSheet starts with its exercises already in.
  const entries = !r && freeItems && freeItems.length ? freePlanEntries(st, freeItems, { deload }) : built.entries
  update(s => {
    s.active = {
      id: uid(), d: todayISO(), start: Date.now(), routineId,
      name: r ? r.name : t('Freestyle'), bw: bw || null, cur: 0, entries,
      ...(excluded ? { excludeFromProgression: true } : {}),
      ...(deload > 0 ? { deload } : {}),
      ...(rirGoal != null ? { rirGoal } : {}),
    }
    // The saved freestyle plan has become this session: the next one is planned afresh.
    if (!r && freeItems && freeItems.length) s.freePlan = null
  })
  useUI.getState().stopRest()
  nav('/workout')
}

/* ============================ freestyle planner ============================ */
// Before a freestyle session: pick its exercises and work sets and see, group by group, how they
// move the running microcycle's volume against its optimal range (lib/free-plan.js). "Start
// workout" then opens the session with them; with nothing picked it starts empty, as before.
function FreePlanSheet({ onStart, close }) {
  const st = useStore(s => s.S)
  // The plan lives in the profile (S.freePlan) from the first exercise on, so closing the sheet
  // and opening it again finds it as it was; it goes once the session it plans starts.
  const items = useMemo(() => freePlanDraft(st.freePlan), [st.freePlan])
  const setItems = fn => update(s => { s.freePlan = freePlanDraft(fn(freePlanDraft(s.freePlan))) })
  const rows = useMemo(() => freePlanProjection(st, items.map(it => ({ ...it, ex: exOr(it.id) }))), [st, items])
  const total = items.reduce((n, it) => n + it.sets, 0)
  // The last freestyle session done, offered as the base of this one while the plan is empty.
  const last = useMemo(() => items.length ? null : lastFreePlan(st), [st, items.length])
  const add = () => {
    const p = exercisePicker(ex => { p.close(); setItems(xs => [...xs, freePlanItem(S(), ex)]) },
      { adds: freePlanVolume(items.map(it => ({ ...it, ex: exOr(it.id) }))) })
  }
  // The same magnets as the routine editor: hold a line to lift it, let go on another to make a
  // superset, move it inside its capsule to only reorder, pull it clear to leave the superset.
  const reorder = useRoutineReorder('free-plan', items, (index, intent) => setItems(xs => {
    const copy = xs.map(x => ({ ...x }))
    return dropRoutineEntry(copy, index, intent) ? copy : xs
  }))
  // Each superset in the colour its capsule has on the dock.
  const hueOf = new Map(dockItems(items).flatMap(item => item.hue == null ? [] : item.indices.map(i => [i, item.hue])))
  const linkedPrev = i => i > 0 && linkedToNext(items, i - 1)
  // A capsule's first and last lines stand further off their neighbours (.ss-start / .ss-end).
  const startsSs = i => i > 0 && linkedToNext(items, i) && !linkedPrev(i)
  const endsSs = i => i < items.length - 1 && linkedPrev(i) && !linkedToNext(items, i)
  // The gap under line `i` (.list's 8px plus those margins): its link chip sits in the middle.
  const gapBelow = i => 8 + (endsSs(i) ? 12 : 0) + (startsSs(i + 1) ? 12 : 0)
  return <>
    <h3 style={{ marginBottom: 4 }}>{t('Plan your freestyle workout')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Pick the exercises and their sets: you will see how they change this microcycle’s volume before you start.')}</div>
    {items.length ? <div ref={reorder.listRef} onClickCapture={reorder.onClickCapture}
      className={'list routine-list free-plan-list' + (reorder.drag ? ' is-reordering' : '')}>
      {/* The superset capsules, drawn as liquid behind the lines (as in the routine editor). */}
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
      {items.map((it, i) => {
        const ex = exOr(it.id)
        const isDragging = reorder.drag && i >= reorder.drag.first && i <= reorder.drag.last
        const hue = hueOf.get(i)
        const linked = linkedToNext(items, i)
        return <div key={i} data-routine-row data-ex-index={i}
          className={'routine-drag-row' + (isDragging ? ' is-dragging' : '') + (reorder.drag?.join === i ? ' magnet' : '')
            + (startsSs(i) ? ' ss-start' : '') + (endsSs(i) ? ' ss-end' : '')}
          style={hue == null ? undefined : { '--ss': rowHsl(hue) }}>
          <div className="free-plan-ex">
            <Thumb ex={ex} muscle />
            <div className="grow">
              <div className="tt capitalize">{exerciseNameFor(ex)}</div>
              <div className="ss small muted capitalize">{t(muscleLabel(ex.tg || ex.bp))}</div>
            </div>
            <div className="sets">
              <button className="iconbtn" aria-label={t('Remove set')} onClick={() => setItems(xs => stepFreeSets(xs, i, -1))}><Icon name="minus" /></button>
              <b>{it.sets}</b>
              <button className="iconbtn" aria-label={t('Add set')} onClick={() => setItems(xs => stepFreeSets(xs, i, 1))}><Icon name="plus" /></button>
              <button className="iconbtn" aria-label={t('Remove')} onClick={() => setItems(xs => removeFreeItem(xs, i))}><Icon name="trash" /></button>
            </div>
          </div>
          {/* Between this line and the next: join them in a superset, or split it there. Pinned
              to the line rather than laid out between them, so the magnets measure only lines. */}
          {i < items.length - 1 && <div className="free-plan-link" style={{ bottom: `${-gapBelow(i) / 2}px` }}>
            <button className={'chip nocap' + (linked ? ' on' : '')} aria-pressed={linked}
              onClick={ev => { ev.stopPropagation(); setItems(xs => toggleFreeLink(xs, i)) }}>
              <Icon name={linked ? 'link' : 'linkSlash'} />
              {linked ? t('Superset') : t('Make a superset')}
            </button>
          </div>}
        </div>
      })}
      {reorder.drag && <div className={'routine-drop-indicator' + (reorder.drag.join != null ? ' join' : '')} aria-hidden="true"
        style={{ top: `${reorder.drag.indicatorTop}px` }} />}
    </div> : null}
    {items.length > 1 && <div className="muted small" style={{ marginTop: 8 }}>
      {t('Hold a slot and drag it to change the order; let go on another one to make a superset. Hold longer to carry a whole superset.')}
    </div>}
    {last && <button className="free-plan-last" onClick={() => setItems(() => last.items)}>
      <Icon name="history" />
      <span className="grow">
        <span className="tt">{t('Start from your last freestyle workout')}</span>
        <span className="small muted">{fmtDate(last.d, true)} · {t('{0} work sets in {1}', last.items.reduce((n, it) => n + it.sets, 0), exCount(last.items.length))}</span>
        <span className="small muted capitalize free-plan-last-names">{last.items.map(it => exerciseNameFor(exOr(it.id))).join(' · ')}</span>
      </span>
    </button>}
    <div style={{ height: 8 }} />
    <Button icon="plus" onClick={add}>{t('Add exercise')}</Button>
    {items.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>{t('{0} work sets in {1}', total, exCount(items.length))}</div>}
    {items.length > 0 && <button className="chip nocap free-plan-clear" style={{ marginTop: 8 }} onClick={() => setItems(() => [])}>
      <Icon name="trash" />{t('Clear the plan')}
    </button>}
    <FreePlanVolume rows={rows} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="play" onClick={() => { close(); onStart(items) }}>
      {items.length ? t('Start workout') : t('Start without a plan')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export function freePlanSheet(onStart) {
  return ui().openSheet(close => <FreePlanSheet onStart={onStart} close={close} />)
}

/* ============================ pause and resume ============================ */
// A session set aside instead of finished: its clock stops and it waits, unfiled, to be taken
// up again while its microcycle runs. See lib/paused-workout.js.
export function pauseWorkout() {
  const patch = pauseActive(S())
  if (!patch) return
  update(s => { Object.assign(s, patch) })
  ui().stopRest()
  ui().stopWork()
  toast(t('Workout paused — resume it any time in this microcycle'))
  nav('/home')
}
export function resumePausedWorkout(id) {
  const st = S()
  if (st.active) { toast(t('Pause or finish the current workout first.')); return }
  const patch = resumePaused(st, id)
  if (!patch) { toast(t('This workout can no longer be resumed.')); return }
  update(s => { Object.assign(s, patch) })
  ui().stopRest()
  // The workout screen re-centres the set to do next, as with any resumed session.
  ui().resumeWorkout()
  nav('/workout')
}
export function discardPausedWorkout(p) {
  confirmSheet({
    title: t('Discard paused workout?'), message: t('The sets you logged in this session will be lost.'),
    confirmText: t('Discard'), danger: true,
    onConfirm: () => update(s => { Object.assign(s, discardPaused(s, p.id)) }),
  })
}
const setsTotalActive = A => A.entries.reduce((n, e) => n + e.sets.length, 0)
// Starting a routine that has a session paused: resume it where it was left, or drop it and
// start the routine over.
function PausedChoice({ p, close, onStartOver }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--orange)' }}><Icon name="pause" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('{0} is paused', p.name)}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {t('Paused {0} with {1} of {2} sets done. Resume it where you left off, or start over — the sets logged in it will be lost.', fmtDate(p.d, true), setsDoneActive(p), setsTotalActive(p))}
    </div>
    <Button variant="primary" icon="play" onClick={() => { close(); resumePausedWorkout(p.id) }}>{t('Resume workout')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="reset" onClick={() => { close(); onStartOver() }}>{t('Start over')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

/* ============================ log a past workout ============================ */
// The same screen as a live session, pointed at another day. `backfill` on the active
// session is what tells the workout screen to drop the clock and the rest timers, and tells
// the finish path to file the workout where its date belongs instead of at the end.
function LogPastWorkout({ close }) {
  const st = useStore(s => s.S)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const [date, setDate] = useState(isoOf(yesterday))
  const [time, setTime] = useState('18:00')
  const [dur, setDur] = useState(60)
  const [routineId, setRoutineId] = useState('')
  const today = todayISO()
  const options = [{ value: '', label: t('Freestyle') }, ...st.routines.map(r => ({ value: r.id, label: r.name }))]

  const go = replaceId => {
    close()
    beginBackfill({ iso: date, time, durationMin: dur, routineId: routineId || null, replaceId })
  }
  const submit = () => {
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    const existing = workoutsOn(st, date)
    if (!existing.length) { go(null); return }
    ui().openSheet(c => <SameDayChoice iso={date} existing={existing} close={c}
      onReplace={id => { c(); go(id) }} onAdd={() => { c(); go(null) }} />, { kind: 'center' })
  }

  return <>
    <h3>{t('Log a past workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Logged on the usual workout screen, without timers.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} /></Row>
    <Stepper label={t('Duration')} unit="min" value={dur} step={5} decimal={false} onChange={v => setDur(Math.max(1, Math.round(v)))} />
    <div style={{ height: 8 }} />
    <SelectRow icon="dumbbell" title={t('Routine')} value={routineId} options={options} onChange={setRoutineId} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={submit}>{t('Continue')}</Button>
  </>
}
// Three ways out when the day already has a workout. Replacing with several on that day means
// picking which one; the rest of the day is left alone.
function SameDayChoice({ iso, existing, onReplace, onAdd, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{fmtDate(iso, true)}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{t('There is already a workout on that day.')}</div>
    {existing.map(w => <div key={w.id} style={{ marginBottom: 8 }}>
      <button className="btn danger" onClick={() => onReplace(w.id)}>{existing.length > 1 ? t('Replace') + ' · ' + w.name : t('Replace')}</button>
    </div>)}
    <button className="btn primary" onClick={onAdd}>{t('Add as second workout')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}
export function logPastWorkoutSheet() {
  if (S().active) { toast(t('Finish the current workout first.')); return }
  ui().openSheet(close => <LogPastWorkout close={close} />)
}
function beginBackfill({ iso, time, durationMin, routineId, replaceId }) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  const { entries, excluded } = buildSessionEntries(st, r)
  update(s => {
    s.active = {
      id: uid(), d: iso, start: backfillStart(iso, time), routineId,
      name: r ? r.name : t('Freestyle'), bw: null, cur: 0, entries,
      backfill: { durationMin, replaceId: replaceId || null },
      ...(excluded ? { excludeFromProgression: true } : {})
    }
  })
  useUI.getState().stopRest()
  nav('/workout')
}
/* ============================ log extra work ============================ */
// Sets done outside any session, written straight into history: pick the exercise, say how
// many sets, then each set's weight, reps and effort — the effort is what decides whether a
// set counts as an effective one toward the microcycle (lib/volume.js). No workout screen, no
// timers, and it works with a session running. See lib/extra-log.js for what an `extra` workout does and does not
// count toward.
function ExtraLog({ ex, close }) {
  const st = useStore(s => s.S)
  const today = todayISO()
  const cfg = useMemo(() => previousRoutineConfig(st.routines, ex.id)?.cfg || defaultConfig(ex.id), [ex.id])
  const mode = modeOf({ ...cfg, id: ex.id })
  const last = useMemo(() => lastEntryFor(st, ex.id)?.sets.at(-1) || null, [ex.id])
  const [date, setDate] = useState(today)
  const [v, setV] = useState({
    sets: 1,
    reps: (last && last.r > 0 ? last.r : cfg.reps) || 10,
    sec: (last && last.sec > 0 ? last.sec : cfg.sec) || 45,
    weight: mode === 'cardio' ? 0 : (last ? last.w : cfg.weight) || 0,
    min: (last && last.min > 0 ? last.min : cfg.min) || 20,
    speed: (last && last.speed > 0 ? last.speed : cfg.speed) || 8,
  })
  const set = (k, min = 0) => x => setV(o => ({ ...o, [k]: Math.max(min, x) }))
  const whole = (k, min = 1) => x => setV(o => ({ ...o, [k]: Math.max(min, Math.round(x)) }))
  const weightLabel = isBw({ ...cfg, id: ex.id }) ? t('Added weight') : t('Weight ({0})', st.unit)
  // One row per set. The effort column is the profile's scale, RIR unless it logs RPE.
  const kind = effortOf(st) === 'rpe' ? 'rpe' : 'rir'
  const timed = mode === 'time'
  const [rows, setRows] = useState(() => [{ w: v.weight, r: v.reps, sec: v.sec, [kind]: last?.[kind] ?? null }])
  // More sets copy the last row — the usual case is the same again — fewer drop from the end.
  const setCount = x => {
    const n = Math.max(1, Math.round(x))
    setV(o => ({ ...o, sets: n }))
    setRows(rs => rs.length >= n ? rs.slice(0, n) : [...rs, ...Array.from({ length: n - rs.length }, () => ({ ...rs.at(-1) }))])
  }
  const field = (i, f, x) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [f]: x } : r)))
  const cols = [
    { f: 'w', hd: isBw({ ...cfg, id: ex.id }) ? '+' + st.unit : st.unit, step: defaultIncrement(ex.id, st.unit), dec: true, cls: 'w' },
    timed ? { f: 'sec', hd: t('Seconds'), step: 5, dec: false, cls: 'r', min: 1 } : { f: 'r', hd: t('Reps'), step: 1, dec: false, cls: 'r', min: 1 },
    { f: kind, hd: EFFORT[kind].hd, dec: true, cls: 'eff', eff: kind },
  ]
  const bump = (i, col, dir) => {
    const cur = rows[i][col.f]
    if (col.eff) return field(i, col.f, stepEffort(col.eff, cur ?? null, dir))
    field(i, col.f, Math.max(col.min || 0, Math.round(((+cur || 0) + dir * col.step) * 100) / 100))
  }
  const cell = (i, col) => <div className={'stp ' + col.cls} key={col.f}>
    <button aria-label={t('Decrease')} onClick={() => bump(i, col, -1)}><Icon name="minus" /></button>
    <span className="val"><NumberField decimal={col.dec} nullable={!!col.eff} value={rows[i][col.f] ?? ''} aria-label={col.hd}
      onChange={x => field(i, col.f, col.eff ? capEffort(col.eff, x) : x)} /></span>
    <button aria-label={t('Increase')} onClick={() => bump(i, col, 1)}><Icon name="plus" /></button>
  </div>

  const save = () => {
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    const entry = buildExtraEntry(ex.id, cfg, mode === 'cardio' ? v : { ...v, rows }, ex.custom ? exerciseMuscleSnapshot(ex) : null)
    update(s => {
      s.workouts = fileExtraEntry(s.workouts, entry, { iso: date, today, id: uid(), name: t('Extra work') })
    })
    useStore.getState().autoBackupNow()
    close()
    toast(t('Logged — it counts toward this microcycle’s volume'))
  }

  return <>
    <h3>{t('Log extra work')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Sets done outside a session. They go into your history and count as volume, without changing your progression.')}</div>
    <div className="row" style={{ marginBottom: 12, gap: 10 }}>
      <Thumb ex={ex} />
      <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{exerciseNameFor(ex)}</div>
        <div className="ss capitalize">{t(muscleLabel(ex.tg || ex.bp))} · {t(ex.eq)}</div></div>
      <button className="chip nocap" onClick={() => { close(); logExtraSheet() }}>{t('Change')}</button>
    </div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} /></Row>
    <div style={{ height: 10 }} />
    <div className="row cfgrow">
      {mode === 'cardio' ? <>
        <Stepper label={t('Intervals')} value={v.sets} step={1} decimal={false} onChange={whole('sets')} />
        <Stepper label={t('Minutes')} value={v.min} step={1} decimal={false} onChange={whole('min')} />
        <Stepper label={t('Speed (km/h)')} value={v.speed} step={0.5} onChange={set('speed')} />
      </> : <Stepper label={t('Sets')} value={v.sets} step={1} decimal={false} onChange={setCount} />}
    </div>
    {mode !== 'cardio' && <div className="extra-sets" aria-label={weightLabel}>
      <div className="sethead eff3"><span className="n-sp" />{cols.map(c => <span key={c.f} className={c.cls + '-sp'}>{c.hd}</span>)}</div>
      {rows.map((_, i) => <div key={i} className="setrow eff3">
        <span className="n st-badge" aria-label={t('Set {0}', i + 1)}>{i + 1}</span>
        {cols.map(c => cell(i, c))}
      </div>)}
    </div>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export function logExtraSheet() {
  const picker = exercisePicker(ex => {
    picker.close()
    ui().openSheet(close => <ExtraLog ex={ex} close={close} />)
  })
}
function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  const maxSet = entry ? Math.max(0, ...entry.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w || 0)) : 0
  const prevBest = entry ? Math.max((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id)) : 0
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry) close() }, [!entry])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const nextUnit = unitDone ? nextUnfinishedUnit(A.entries, units, entryIdx) : null
  const workoutDone = unitDone && !nextUnit
  if (!entry || !ex) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (workoutDone) workoutCompleteSheet()               // no unfinished unit → finish/continue prompt
      else update(s => { s.active.cur = unitEntryIdx(s.active.entries, nextUnit) })
    } else {
      toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
      // Superset with partners still to do: land on the next member with sets left, wrapping.
      if (!unitDone && unit.length > 1) {
        const pos = unit.indexOf(entryIdx)
        const next = [...unit.slice(pos + 1), ...unit.slice(0, pos)]
          .find(i => A.entries[i].sets.some(s => !s.done))
        if (next != null) update(s => { if (s.active) s.active.cur = next })
      }
    }
  }
  return <>
    <h3 className="capitalize row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', exerciseNameFor(ex))}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={workoutDone ? null : 'chevronRight'} onClick={() => commit(true)}>{workoutDone ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

/* ============================ exercise notes ============================
   Two notes, one sheet, because from the user's side it is one question — "what do I want to
   remember about this exercise?" — with two different lifetimes:

     · today's note belongs to this session and is stored on the workout entry. It is history:
       what happened, how it felt. The PIN is the user saying "this one is for next time", which
       only they can know at the moment of writing — see pinnedNoteFor.
     · the standing note belongs to the exercise itself and lives in S.exNotes. Seat height, pin
       position, a form cue. True every session, so it is shown every session and never expires.

   A routine's own `note` (a plan's instruction for this exercise) is edited in the config sheet
   and is deliberately not here: it belongs to the plan, not to the day or to the movement. */
function ExerciseNote({ entryIdx, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = st.active
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry ? exOr(entry.id) : null
  const [note, setNote] = useState(entry?.note || '')
  const [pin, setPin] = useState(!!entry?.notePin)
  const [standing, setStanding] = useState(entry ? (st.exNotes?.[entry.id] || '') : '')
  useEffect(() => { if (!entry) close() }, [!entry])
  if (!entry) return null

  const save = () => {
    const today = note.trim().slice(0, NOTE_MAX)
    const always = standing.trim().slice(0, NOTE_MAX)
    update(s => {
      const e = s.active?.entries?.[entryIdx]
      if (e) {
        if (today) { e.note = today; if (pin) e.notePin = true; else delete e.notePin }
        else { delete e.note; delete e.notePin }
      }
      s.exNotes = s.exNotes || {}
      if (always) s.exNotes[entry.id] = always
      else delete s.exNotes[entry.id]
    })
    close()
  }

  return <>
    <h3 className="capitalize">{exerciseNameFor(ex)}</h3>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('This session')}</div>
    <textarea ref={noteRef} className="input" rows={3} maxLength={NOTE_MAX} value={note}
      placeholder={t('How it went, what to change — kept with today’s workout.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="sect-b">
      <Row icon="flag" iconTint="var(--yellow)" title={t('Show this next time')}
        subtitle={t('Brings it up again the next time you train this exercise.')}>
        <Switch checked={pin} onChange={setPin} disabled={!note.trim()} />
      </Row>
    </div>
    <div style={{ height: 18 }} />
    <div className="small muted" style={{ marginBottom: 6 }}>{t('Always for this exercise')}</div>
    <textarea className="input" rows={2} maxLength={NOTE_MAX} value={standing}
      placeholder={t('Seat height, pin position, a form cue — shown every session.')}
      onChange={e => setStanding(e.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const exerciseNoteSheet = entryIdx => ui().openSheet(close => <ExerciseNote entryIdx={entryIdx} close={close} />)

/* The session note: how the whole workout went, as opposed to how one exercise went. It lives
   on the active session, so buildCompletedWorkout carries it onto the finished workout and it
   shows up again in history — where it stays editable. Written here rather than only after the
   fact because "notes you can write during a workout" is the point; a note you can only add
   once the session is filed is a different, smaller feature. */
function SessionNote({ close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = st.active
  const [note, setNote] = useState(A?.note || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const save = () => {
    const text = note.trim().slice(0, NOTE_MAX)
    update(s => { if (!s.active) return; if (text) s.active.note = text; else delete s.active.note })
    close()
  }

  return <>
    <h3>{t('Session note')}</h3>
    <textarea ref={noteRef} className="input" rows={4} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const sessionNoteSheet = () => ui().openSheet(close => <SessionNote close={close} />)


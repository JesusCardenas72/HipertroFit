// Finishing a workout: the "whole workout done" prompt, the finish itself (records, the confirmed
// weights, filing the session) and what is asked right after it — replace the routine, keep the
// rests, the per-group feedback — before the summary. Split out of sheets.jsx, which re-exports
// everything public here, so importers keep using './sheets.jsx'.

import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX, exOr } from './lib/exercises.js'
import { fmtNum, fmtVol, fmtDur } from './lib/format.js'
import { bestWeightFor, workoutVolume, setsDone, setsDoneActive, supersetUnits, workSetsDone } from './lib/history.js'
import { beep } from './lib/sound.js'
import { t, exerciseNameFor } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import Icon from './components/Icon.jsx'
import { Button } from './components/ui.jsx'
import BodyMap from './components/BodyMap.jsx'
import { exerciseMuscleSnapshot, loadOfWorkouts } from './lib/muscles.js'
import { is1RMRecord } from './lib/onerm.js'
import { buildCompletedWorkout } from './lib/finish-workout.js'
import { routineFromSession, sessionChangedRoutine } from './lib/routine-from-session.js'
import { sessionRestChanges, withSessionRests } from './lib/session-rest.js'
import { restExLabel } from './lib/rest-between.js'
import { isWarmupRow } from './lib/workout-model.js'
import { backfillEnd, completeBackfill } from './lib/backfill.js'
import { maybeMuscleFeedback } from './components/MuscleFeedback.jsx'
import { confirmSheet } from './sheets.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* Drop-set drops and rest-pause bursts are edited inline on the set row itself (Workout.jsx) —
   no sheet, no timer. A planned exercise (see the "Intensifier" config below) arrives with them
   already computed via applyIntensifierPlan; an unplanned straight set can still grow one live
   by tapping "+ Drop"/"+ Burst", which appends with the same suggested-next-value math. */

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

function FinishSummary({ w, prs, e1prs = [], close }) {
  const st = useStore(s => s.S)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{t('{0} sets · {1} work', setsDone(w), workSetsDone(w))}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} {EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id}</div>)}
      {e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {EXIDX[p.id] ? exerciseNameFor(EXIDX[p.id]) : p.id} · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
  </div>
}
export function finishWorkout() {
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: forceFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: forceFinishWorkout }); return }
  doFinishWorkout()
}
// Cutting a session short ends it the way its last set would have: with the exercise-end sound.
// A session finished by its last set has rung it already, and a past one being logged never does.
function forceFinishWorkout() {
  if (S().active && !S().active.backfill) ui().endExercise(null)
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const past = !!A.backfill
  const prs = []
  const e1prs = []
  // A workout logged into the past cannot claim records against the history that came after
  // it, so a backfilled session reports none and leaves the confirmed weights alone.
  if (!past) A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w))
    if (mx > 0 && mx > bestWeightFor(st, e.id)) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = buildCompletedWorkout(A, {
    end: past ? backfillEnd(A) : Date.now(),
    prs,
    snapshotFor: e => EXIDX[e.id]?.custom ? exerciseMuscleSnapshot(EXIDX[e.id]) : null,
  })
  w.vol = workoutVolume(w)
  // Exercises added, removed, swapped, reordered, paired or re-set during the session: the
  // routine they came from is only rewritten if you say so, once the session is filed.
  const routine = A.routineId ? st.routines.find(r => r.id === A.routineId) : null
  const nextEx = routine && sessionChangedRoutine(A, routine) ? routineFromSession(A, routine) : null
  update(s => {
    if (past) {
      s.workouts = completeBackfill(s.workouts, A, w)
    } else {
      w.entries.forEach(e => {
        const mx = Math.max(0, ...e.sets.filter(x => x.done && !isWarmupRow(x)).map(x => x.w || 0), e.topW || 0)
        if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
      })
      s.workouts.push(w)
    }
    s.active = null
  })
  useStore.getState().autoBackupNow()
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  const showSummary = () => ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
  // How each muscle group answered the session (components/MuscleFeedback.jsx), asked right
  // before the summary. A past workout is logged from memory: its pump is not worth guessing.
  const summary = () => (past ? showSummary() : maybeMuscleFeedback(S(), w, ui().openSheet, showSummary))
  // Rests changed during the session, asked about after the routine itself: if it was just
  // replaced with this session's plan, the rests are kept in that one. A past workout has no
  // timers to have changed.
  const rests = () => {
    const now = S()
    const r = !past && routine ? now.routines.find(x => x.id === routine.id) : null
    if (r && sessionRestChanges(A, r.ex, supersetUnits(A.entries), now.restSec).length) {
      ui().openSheet(close => <SaveRestsPrompt routineId={r.id} name={r.name} session={A} close={close} then={summary} />, { kind: 'center', locked: true })
    } else summary()
  }
  if (nextEx) ui().openSheet(close => <UpdateRoutinePrompt routineId={routine.id} name={routine.name} ex={nextEx} close={close} then={rests} />, { kind: 'center', locked: true })
  else rests()
}

// Asked once, right after a session whose rests between sets differ from its routine's: keep
// them for the routine's next sessions, or leave the routine as it was. Only that routine and
// only the exercises whose rest changed take the new one; Settings and other routines never do.
// See lib/session-rest.js.
function SaveRestsPrompt({ routineId, name, session, close, then }) {
  const st = useStore(s => s.S)
  const r = st.routines.find(x => x.id === routineId)
  const units = supersetUnits(session.entries)
  const changes = r ? sessionRestChanges(session, r.ex, units, st.restSec) : []
  const keep = () => {
    update(s => {
      const rt = s.routines.find(x => x.id === routineId)
      if (rt) rt.ex = withSessionRests(rt.ex, sessionRestChanges(session, rt.ex, units, s.restSec))
    })
    toast(t('Rests saved in the routine'))
    close(); then()
  }
  const label = sec => restExLabel(sec, t)
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <div style={{ fontSize: 40, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="timer" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Keep these rests?')}</h3>
    <div className="muted" style={{ marginBottom: 14, lineHeight: 1.5 }}>{t('You changed rests during this workout. Use them from now on in the sessions of “{0}”? Other routines and Settings stay as they are.', name)}</div>
    <div className="sect-b" style={{ textAlign: 'left', marginBottom: 16 }} data-testid="rest-changes">
      {changes.map(c => <div key={c.idx} className="lrow">
        <span className="lrow-m"><span className="lrow-t capitalize">{exerciseNameFor(exOr(c.id))}</span></span>
        <span className="lrow-v">{label(c.from)} → {label(c.to)}</span>
      </div>)}
    </div>
    <Button variant="primary" icon="check" onClick={keep}>{t('Save in the routine')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); then() }}>{t('Only this time')}</Button>
  </div>
}

// Asked once, right after a session that changed its routine's plan. Either answer goes on to
// the summary; "Keep" leaves the saved routine exactly as it was.
function UpdateRoutinePrompt({ routineId, name, ex, close, then }) {
  const replace = () => {
    update(s => { const r = s.routines.find(x => x.id === routineId); if (r) r.ex = ex })
    toast(t('Routine updated'))
    close(); then()
  }
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{t('Update the routine?')}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{t('You changed “{0}” during this workout. Replace the saved routine with the workout you just did?', name)}</div>
    <Button variant="primary" onClick={replace}>{t('Replace routine')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); then() }}>{t('Keep saved routine')}</Button>
  </div>
}

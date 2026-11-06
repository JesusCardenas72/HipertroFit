import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { todayISO, mondayOf, DAYS, fmtDate } from '../lib/format.js'
import { effectiveRoutine, nextSessionRoutine } from '../lib/history.js'
import { sequenceDays } from '../lib/sequence-days.js'
import { cyclePosition, strategyOf, isExtra, STRATEGIES, cycleEndOf } from '../lib/microcycle.js'
import { mesoState, acceptDeload, postponeDeload, isDeloadWorkout, carriedBase, DELOAD_AFTER, DELOAD_MAX } from '../lib/mesocycle.js'
import { openNextCycle, closeMicrocycleSheet } from './MicrocycleActions.jsx'
import { DeloadBadge, DeloadStatus } from './Deload.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { dayOverrideSheet, startFlow, loadStarterPlan } from '../sheets.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const STRATEGY_NAME = Object.fromEntries(STRATEGIES.map(s => [s.key, s.name]))

// The microcycle as the home screen's unit of time, in place of the calendar week.
//
// The strip is the current week, Monday to Sunday: weekday, date and what each day holds. Days
// trained show the routine trained, in green with a check; days gone by without a session show
// faded. The days ahead are the Plan tab's sequence carried on from the last session — a session
// that was due and not trained moves on, with the rest of the sequence behind it
// (lib/sequence-days.js). Where the block stands in sessions is the "Session n of m" line under it, since
// sessions are what complete a microcycle; complete, it runs on through its rest days and, once
// they are over, asks to open the next one (lib/microcycle.js). Tapping a day opens its
// reschedule sheet.
export default function MicrocycleCard() {
  const S = useStore(s => s.S)
  const nav = useNavigate()
  const today = todayISO()
  const pos = cyclePosition(S)
  // History up to today, the sequence carried on from there (lib/sequence-days.js).
  const days = sequenceDays(S, 7, mondayOf(today), today)
  const meso = mesoState(S)
  // Complete, the block runs on through its rest days; past its last day it is over and waits
  // for the user to open the next one (lib/microcycle.js).
  const end = cycleEndOf(S)
  const over = !!end && end < today
  const routineOf = id => S.routines.find(r => r.id === id) || null
  // What today offers: the day's own plan as the strip lays it out (an override, or a session
  // the sequence — moved on past any missed day — puts here), else the next step of the
  // sequence: training a "rest" day just brings the next session forward.
  const todayDay = days.find(d => d.iso === today)
  const planned = todayDay ? (todayDay.state === 'planned' ? routineOf(todayDay.routineId) : null) : effectiveRoutine(S, today)
  const next = planned || nextSessionRoutine(S)
  // Loose extra work logged today is not today's session — the row keeps offering it.
  const doneToday = S.workouts.filter(w => w.d === today && !isExtra(w)).at(-1) || null
  const onToday = () => {
    if (S.active) { useUI.getState().resumeWorkout(); nav('/workout') }
    else if (next) startFlow(next.id)
    else dayOverrideSheet(today)
  }

  if (!S.routines.length && !S.active) return <div className="card">
    <div className="row" style={{ gap: 10, marginBottom: 6 }}>
      <span className="lrow-i"><Icon name="sparkles" /></span>
      <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
    <Button variant="primary" icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
    <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
  </div>

  return <div className={'card' + (meso.deload ? ' deload' : '')}>
    <DeloadStatus />
    {/* The deload / close / programming buttons live in the row under this card (MicrocycleActions). */}
    <div className="row between" style={{ marginBottom: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
      <div className="row" style={{ gap: 7, minWidth: 0, flex: '1 1 auto', flexWrap: 'nowrap' }}>
        <div className="small muted" style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(meso.deload ? { color: 'var(--deload)' } : {}) }}>
          {t('Microcycle')} #{meso.number} · {t(STRATEGY_NAME[strategyOf(S)] || 'Custom')}
        </div>
      </div>
    </div>

    <div className="prog-prev week7">
      {days.map(d => {
        const r = routineOf(d.routineId)
        const done = d.state === 'done'
        // A day reads as a deload when it was trained as one, or — not trained yet — when this
        // microcycle is the deload.
        const dl = done ? isDeloadWorkout(d.done) : meso.deload && d.state === 'planned'
        const label = done ? (d.done.name || r?.name || t('Workout done'))
          : d.state === 'missed' ? t('Not trained — {0} moved on', r ? r.name : '—')
            : d.state === 'planned' && r ? r.name : t('Rest day')
        // A day gone by without a session is history, not a plan: shown faded.
        const past = d.state === 'missed' || d.state === 'past'
        const glyph = done ? (r ? glyphOf(r.emoji) : 'dumbbell') : (d.state === 'planned' || d.state === 'missed') && r ? glyphOf(r.emoji) : 'moon'
        return <button key={d.iso} className={'prog-day' + (d.iso === today ? ' today' : '') + (past ? ' past' : '') + (done ? ' done' : '') + (dl ? ' deload' : '')}
          title={dl ? label + ' · ' + t('Deload') : label} onClick={() => dayOverrideSheet(d.iso)}>
          <span className="wd">{t(DAYS[d.wd])}</span>
          <span className="dn">{d.dn}</span>
          <span className="lrow-i sm" style={glyph === 'moon' ? { background: 'var(--surface-3)' } : null}>
            <Icon name={glyph} />
            {done && <span className="prog-check" aria-hidden="true"><Icon name="check" /></span>}
          </span>
        </button>
      })}
    </div>
    {meso.deload && <div className="small row" style={{ justifyContent: 'center', gap: 4, color: 'var(--deload)', fontWeight: 600, marginTop: 4 }}>
      <Icon name="arrowDown" />{t('Deload session')}
    </div>}
    <div className="muted small" style={{ textAlign: 'center', marginTop: 2 }}>
      {pos.complete
        ? <>{t('Complete — {0} of {1} sessions', pos.sessions, pos.len)}{!over && <> · {t('until {0}', fmtDate(end, true))}</>}</>
        : t('Session {0} of {1}', pos.step + 1, pos.len)}
      {meso.deload ? <b style={{ color: 'var(--deload)' }}> · {t('Deload')}</b> : ''}
    </div>

    {/* Once today's session is logged the row stops asking for it — the strip already knows. */}
    <div className="today-row" {...tappable(onToday)}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : next ? 'var(--acc)' : 'var(--surface-3)' }}>
          <Icon name={S.active ? 'timer' : doneToday ? 'checkCircle' : next ? glyphOf(next.emoji) : 'moon'}
            style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Today')}</div>
          <div className="ttl">{S.active ? t('{0} — in progress', S.active.name)
            : doneToday ? (doneToday.name ? t('{0} — done', doneToday.name) : t('Workout done'))
            : next ? next.name : t('Rest day')}{!planned && next && !doneToday && !S.active ? ' · ' + t('next in sequence') : ''}</div>
        </div>
      </div>
      {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
        : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
        : next && meso.deload ? <DeloadBadge>{t('Start deload')}</DeloadBadge>
        : next ? <span className="tag acc">{t('Start')}</span>
        : <Icon name="plus" className="chev" />}
    </div>

    {over && <CycleOverBanner S={S} number={meso.number} />}
    {meso.suggest && <DeloadBanner meso={meso} />}
  </div>
}

// All the days of the microcycle have gone by: the next one opens when the user says so.
function CycleOverBanner({ S, number }) {
  const next = carriedBase(S) + 1
  return <div style={{ marginTop: 12, borderTop: 'var(--hair) solid var(--sep)', paddingTop: 12 }}>
    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
      <Icon name="flag" style={{ color: 'var(--orange)' }} />
      <b>{t('Microcycle #{0} is over', number)}</b>
    </div>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t('All its days, rest days included, have passed. Start microcycle #{0}?', next)}
    </div>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" icon="flag" onClick={() => openNextCycle(strategyOf(S))}>{t('Start microcycle #{0}', next)}</Button>
      <Button icon="target" onClick={closeMicrocycleSheet}>{t('Change strategy')}</Button>
    </div>
  </div>
}

// Three loading microcycles in, the deload is offered; five in, it stops being a suggestion.
// Postponing pushes it exactly one microcycle, where it is raised again.
function DeloadBanner({ meso }) {
  const accept = () => useStore.getState().update(s => { s.meso = acceptDeload(s) })
  const postpone = () => useStore.getState().update(s => { s.meso = postponeDeload(s) })
  const color = meso.mandatory ? 'var(--red)' : 'var(--yellow)'
  return <div style={{ marginTop: 12, borderTop: 'var(--hair) solid var(--sep)', paddingTop: 12 }}>
    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
      <Icon name="flame" style={{ color }} />
      <b>{meso.mandatory ? t('Time to deload') : t('Deload suggested')}</b>
    </div>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {meso.mandatory
        ? t('{0} loading microcycles in a row — {1} is the most before a deload.', meso.streak, DELOAD_MAX)
        : t('{0} loading microcycles done. Make the next one a deload?', meso.streak)}
    </div>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" icon="check" onClick={accept}>{t('Deload next')}</Button>
      {!meso.mandatory && <Button onClick={postpone}>{t('Not yet')}</Button>}
    </div>
    {meso.streak >= DELOAD_AFTER && !meso.mandatory && <div className="dim small" style={{ marginTop: 8 }}>
      {t('Asked again next microcycle.')}
    </div>}
  </div>
}

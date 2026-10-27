import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { todayISO, DAYS } from '../lib/format.js'
import { effectiveRoutine, nextSessionRoutine, upcomingDays } from '../lib/history.js'
import { cyclePosition, strategyOf, isExtra, STRATEGIES } from '../lib/microcycle.js'
import { mesoState, acceptDeload, postponeDeload, isDeloadWorkout, DELOAD_AFTER, DELOAD_MAX } from '../lib/mesocycle.js'
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
// The strip is the coming week as the calendar will schedule it — the same projection as the
// Programming sheet's "Next 14 days", cut to seven: weekday, date and the routine (or rest) of
// each day. Where the block stands in sessions is the "Session n of m" line under it, since
// sessions, not days, are what close a microcycle (lib/microcycle.js). Tapping a day opens its
// reschedule sheet.
export default function MicrocycleCard() {
  const S = useStore(s => s.S)
  const nav = useNavigate()
  const today = todayISO()
  const pos = cyclePosition(S)
  const days = upcomingDays(S, 7, today)
  const meso = mesoState(S)
  const routineOf = id => S.routines.find(r => r.id === id) || null
  // What today offers: the day's own plan when there is one (an override, or a training day
  // of the program), else the next step of the sequence — training a "rest" day just brings
  // the next session forward.
  const planned = effectiveRoutine(S, today)
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
        // A day reads as a deload when it was trained as one, or — not trained yet — when this
        // microcycle is the deload.
        const dl = d.done ? isDeloadWorkout(d.done) : meso.deload && !!d.r
        const label = d.done ? (d.done.name || t('Workout done')) : d.r ? d.r.name : t('Rest day')
        return <button key={d.iso} className={'prog-day' + (d.iso === today ? ' today' : '') + (dl ? ' deload' : '')}
          title={dl ? label + ' · ' + t('Deload') : label} onClick={() => dayOverrideSheet(d.iso)}>
          <span className="wd">{t(DAYS[d.wd])}</span>
          <span className="dn">{d.dn}</span>
          <span className="lrow-i sm" style={d.done ? { background: 'var(--surface-3)', color: 'var(--green)' } : d.r ? null : { background: 'var(--surface-3)' }}>
            <Icon name={d.done ? 'checkCircle' : d.r ? glyphOf(d.r.emoji) : 'moon'} />
          </span>
        </button>
      })}
    </div>
    {meso.deload && <div className="small row" style={{ justifyContent: 'center', gap: 4, color: 'var(--deload)', fontWeight: 600, marginTop: 4 }}>
      <Icon name="arrowDown" />{t('Deload session')}
    </div>}
    <div className="muted small" style={{ textAlign: 'center', marginTop: 2 }}>
      {t('Session {0} of {1}', Math.min(pos.step + 1, pos.len), pos.len)}
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

    {meso.suggest && <DeloadBanner meso={meso} />}
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

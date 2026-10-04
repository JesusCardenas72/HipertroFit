import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { effectiveRoutine, nextSessionRoutine } from '../lib/history.js'
import { cyclePosition, cycleStrip, strategyOf, STRATEGIES } from '../lib/microcycle.js'
import { mesoState, acceptDeload, postponeDeload, isDeloadWorkout, DELOAD_AFTER, DELOAD_MAX } from '../lib/mesocycle.js'
import { DeloadBadge, DeloadStatus } from './Deload.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { dayOverrideSheet, startFlow, loadStarterPlan, programSheet } from '../sheets.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const STRATEGY_NAME = Object.fromEntries(STRATEGIES.map(s => [s.key, s.name]))

// The microcycle as the home screen's unit of time, in place of the calendar week.
//
// The strip is one slot per session of the block, not one per weekday: sessions are what
// close a microcycle (lib/microcycle.js), and rest days float. A done slot shows what was
// actually trained; the slot marked "next" is what the sequence pointer proposes, whatever
// day you get to it.
export default function MicrocycleCard() {
  const S = useStore(s => s.S)
  const nav = useNavigate()
  const today = todayISO()
  const pos = cyclePosition(S)
  const strip = cycleStrip(S)
  const meso = mesoState(S)
  const routineOf = id => S.routines.find(r => r.id === id) || null
  // What today offers: the day's own plan when there is one (an override, or a training day
  // of the program), else the next step of the sequence — training a "rest" day just brings
  // the next session forward.
  const planned = effectiveRoutine(S, today)
  const next = planned || nextSessionRoutine(S)
  const doneToday = S.workouts.filter(w => w.d === today).at(-1) || null
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
          {t('Microcycle')} #{pos.cycle + 1} · {t(STRATEGY_NAME[strategyOf(S)] || 'Custom')}
        </div>
      </div>
    </div>

    <div className="week">
      {strip.map(slot => {
        const r = routineOf(slot.routineId)
        const label = slot.state === 'done' && slot.workout ? (slot.workout.name || t('Workout done')) : (r ? r.name : t('Rest day'))
        // A slot is a deload when it was trained as one, or — not trained yet — when this
        // microcycle is the deload.
        const dl = slot.workout ? isDeloadWorkout(slot.workout) : meso.deload
        return <div key={slot.i} className={'wday' + (slot.state === 'next' ? ' today' : '') + (dl ? ' deload' : '')}
          title={dl ? label + ' · ' + t('Deload') : label} {...tappable(slot.state === 'todo' || slot.state === 'next' ? programSheet : undefined)}>
          <div className="lbl">{slot.i + 1}</div>
          <div className="num"><Icon name={r ? glyphOf(r.emoji) : slot.state === 'done' ? 'checkCircle' : 'moon'} /></div>
          {/* A deload slot says so with the deload arrow under it, not with a colour alone. */}
          {dl ? <div className="wday-dl" aria-label={t('Deload')}><Icon name="arrowDown" /></div>
            : <div className={'dot' + (slot.state === 'done' ? ' done' : slot.state === 'next' ? ' plan' : '')} />}
        </div>
      })}
    </div>
    {strip.some(slot => (slot.workout ? isDeloadWorkout(slot.workout) : meso.deload)) &&
      <div className="small row" style={{ justifyContent: 'center', gap: 4, color: 'var(--deload)', fontWeight: 600 }}>
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

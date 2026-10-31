import { useMemo, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { daysBetween } from '../lib/program.js'
import { isExtra } from '../lib/microcycle.js'
import { cycleHistory } from '../lib/cycle-history.js'
import { groupVolume } from '../lib/volume.js'
import { useUI } from '../store/useUI.js'
import { DeloadBadge } from './Deload.jsx'
import Icon from './Icon.jsx'

// Which microcycle a volume card reads: the running one by default, or one already behind,
// picked from a sheet that lists them all with their dates (lib/cycle-history.js). Home and
// Stats each keep their own choice, so looking back on one screen does not move the other.

/** [the microcycle shown, choose(id | null for the running one), every microcycle newest first]. */
export function useCycleChoice(S) {
  const [id, setId] = useState(null)
  const list = useMemo(() => cycleHistory(S), [S])
  const cycle = (id != null && list.find(c => c.id === id && !c.current)) || list[0]
  return [cycle, setId, list]
}

/** "2 Mar – 9 Mar", the running one ending today. */
export const cycleDates = c => fmtDate(c.start) + ' – ' + (c.current ? t('today') : fmtDate(c.end))

/** The figures that sum a microcycle up: sessions, effective sets and days. */
export function cycleStats(c) {
  const vol = groupVolume(c.workouts)
  const days = daysBetween(c.start, c.current ? todayISO() : c.end) + 1
  return { sessions: c.workouts.filter(w => !isExtra(w)).length, planned: c.sessions, len: c.len, effective: vol.effective, days: Math.max(1, days) }
}

/** One line of those figures, for under the picker and the rows of the list. */
export function CycleStatsLine({ cycle, style }) {
  const st = cycleStats(cycle)
  return <div className="muted small" style={style}>
    {t('{0} of {1} sessions', st.planned, st.len)} · {t('{0} effective sets', st.effective)} · {t('{0} days', st.days)}
  </div>
}

function CycleList({ list, value, onPick, close }) {
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="calendar" />{t('Microcycles')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a microcycle to see its volume. Each one runs from its first day to the day before the next one opened.')}</div>
    <div className="list" role="radiogroup" aria-label={t('Microcycles')} style={{ display: 'flex', flexDirection: 'column' }}>
      {list.map(c => <div key={c.id} className="item" role="radio" aria-checked={c.id === value.id}
        onClick={() => { onPick(c.current ? null : c.id); close() }}>
        <span className="lrow-i" style={c.deload ? { background: 'var(--deload)' } : c.current ? null : { background: 'var(--surface-3)' }}>
          <Icon name={c.deload ? 'arrowDown' : 'flag'} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tt row" style={{ gap: 6 }}>
            {t('Microcycle')}{c.n != null && ' #' + c.n}
            {c.current && <span className="tag acc">{t('Current')}</span>}
            {c.deload && <DeloadBadge />}
          </div>
          <div className="ss">{cycleDates(c)}</div>
          <CycleStatsLine cycle={c} />
        </div>
        {c.id === value.id && <Icon name="check" style={{ color: 'var(--acc)' }} />}
      </div>)}
    </div>
  </>
}

/** The chip that names the microcycle shown — "#3 · 2 Mar – 9 Mar" — and opens the list. */
export default function CyclePicker({ value, list, onPick }) {
  const open = () => useUI.getState().openSheet(close => <CycleList list={list} value={value} onPick={onPick} close={close} />)
  return <button type="button" className={'cycle-pick' + (value.current ? '' : ' past')} onClick={open}
    aria-label={t('Choose microcycle')} title={t('Choose microcycle')}>
    <b>{value.n != null ? '#' + value.n : t('Microcycle')}</b><span className="d">{cycleDates(value)}</span><Icon name="chevronDown" />
  </button>
}

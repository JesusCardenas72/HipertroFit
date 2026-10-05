import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { mesoState } from '../lib/mesocycle.js'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  // A session in progress takes the whole screen: the exercise gets the room the bar would take,
  // and the session's own header carries the way back out (views/Workout.jsx).
  if (cur === 'workout' && S.active) return null
  // During a deload microcycle Home and Stats carry a mark on their tab, so the deload is in
  // view from every screen, not only once you are on one of them.
  const deload = mesoState(S).deload
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    } else useUI.getState().resumeWorkout()
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label, mark }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)} aria-label={mark ? label + ' · ' + t('Deload') : undefined}>
      <span className="tabicn"><Icon name={icon} />{mark && <i className="tab-deload" aria-hidden="true"><Icon name="arrowDown" /></i>}</span>
      <span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} mark={deload} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} mark={deload} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}

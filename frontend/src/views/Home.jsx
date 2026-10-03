import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import MicrocycleCard from '../components/MicrocycleCard.jsx'
import MuscleVolumeCard from '../components/MuscleVolumeCard.jsx'
import Icon from '../components/Icon.jsx'
import { DeloadTitleTag } from '../components/Deload.jsx'

// Home = what to do now, and how the block is filling up. Two cards and nothing else: the
// microcycle (which session is next, and the deload when one is due) and the volume that
// microcycle has accumulated per muscle group. Body weight, streak, activity and the deep
// charts all live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const today = new Date()

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'HipertroFit'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}<DeloadTitleTag /></div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <MicrocycleCard />
    <MuscleVolumeCard S={S} />
  </div>
}

import { useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import MicrocycleCard from '../components/MicrocycleCard.jsx'
import MuscleVolumeCard from '../components/MuscleVolumeCard.jsx'
import MicrocycleActions from '../components/MicrocycleActions.jsx'
import Icon from '../components/Icon.jsx'
import BrandMark from '../components/BrandMark.jsx'
import { DeloadTitleTag } from '../components/Deload.jsx'

// Home = what to do now, and how the block is filling up. Two cards and nothing else: the
// microcycle (which session is next, and the deload when one is due) and the volume that
// microcycle has accumulated per muscle group — with the row of microcycle actions (deload,
// close, programming) between them. Body weight, streak, activity and the deep
// charts all live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const today = new Date()
  const hdrRef = useRef(null), titleRef = useRef(null)

  // The mark is exactly as tall as the title + date beside it, whatever sets that height (UI size,
  // font, a deload tag…): the title block is measured and the mark follows it before paint.
  useLayoutEffect(() => {
    const hdr = hdrRef.current, title = titleRef.current
    if (!hdr || !title || typeof ResizeObserver === 'undefined') return
    // the computed height, not getBoundingClientRect: <html> carries a zoom (UI size) and the rect
    // comes back zoomed, while --brand-h is set in the same unzoomed CSS px the title is laid out in
    const sync = () => hdr.style.setProperty('--brand-h', getComputedStyle(title).height)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(title)
    return () => ro.disconnect()
  }, [])

  return <div className="narrow">
    <div className="hdr hdr-home" ref={hdrRef}>
      <BrandMark className="hdr-brand" />
      <div className="hdr-title" ref={titleRef}><h1>{user ? t('Hi {0}', user.name) : 'HipertroFit'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}<DeloadTitleTag /></div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <MicrocycleCard />
    <MicrocycleActions />
    <MuscleVolumeCard S={S} />
  </div>
}

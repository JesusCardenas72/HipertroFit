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
    const brandH = () => hdr.style.setProperty('--brand-h', getComputedStyle(title).height)
    // The settings button keeps its place at every UI size: the mark and the title grow with it
    // only while they fit in the room the button leaves, then stay frozen at that size (--hdr-k
    // scales both). Widths are layout px (offsetWidth/scrollWidth), unaffected by <html>'s zoom.
    let k = 1
    const MIN_K = 0.55 // a very long name truncates rather than shrinking to nothing
    const fit = () => {
      const brand = hdr.querySelector('.hdr-brand'), btn = hdr.querySelector('.iconbtn')
      const h1 = title.querySelector('h1'), sub = title.querySelector('.sub')
      if (!brand || !btn || !h1 || !sub) return
      const gap = parseFloat(getComputedStyle(hdr).columnGap) || 0
      const room = hdr.clientWidth - btn.offsetWidth - gap * 2
      // what the mark and the title take now, brought back to their unscaled (k = 1) width
      const natural = (brand.offsetWidth + Math.max(h1.scrollWidth, sub.scrollWidth)) / k
      if (!(natural > 0) || !(room > 0)) return
      const next = Math.max(MIN_K, Math.min(1, room / natural))
      if (Math.abs(next - k) < 0.004) return
      k = next
      hdr.style.setProperty('--hdr-k', String(Math.floor(k * 1000) / 1000))
    }
    const sync = () => { brandH(); fit() }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(title)
    ro.observe(hdr)
    const mark = hdr.querySelector('.hdr-brand')
    if (mark) ro.observe(mark)
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

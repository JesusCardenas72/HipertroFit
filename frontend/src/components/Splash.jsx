import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'

// Launch screen: logo with the app name under it, zooming until the logo spans the full
// viewport width, over everything until boot() is done. The markup and styles are in index.html,
// outside #root, so they are on screen before the bundle loads and React mounting doesn't restart
// the animation — this only decides when it goes.
// Timings count from navigation start, which is also when the zoom began.
const MIN_MS = 3000    // the whole zoom plays, even when boot is instant
const MAX_MS = 4000    // a slow server never keeps the app behind the splash past this
const FADE_MS = 350

export default function Splash() {
  const ready = useStore(s => s.ready)
  useEffect(() => {
    const el = document.getElementById('splash')
    if (!el) return
    const t = setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => el.remove(), FADE_MS)
    }, Math.max(0, (ready ? MIN_MS : MAX_MS) - performance.now()))
    return () => clearTimeout(t)
  }, [ready])
  return null
}

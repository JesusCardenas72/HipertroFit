import { useEffect, useLayoutEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, setExerciseNameOptions, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { initBackButton } from './lib/back.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import VersionBadge from './components/VersionBadge.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ScreenSlider from './components/ScreenSlider.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import { DeloadNotifier } from './components/Deload.jsx'
import { UpdateNotifier } from './components/AppUpdate.jsx'
import { MOBILE } from './lib/mobile.js'
import RestTimer from './components/RestTimer.jsx'
import TimerFlash from './components/TimerFlash.jsx'
import Splash from './components/Splash.jsx'
import Login from './views/Login.jsx'
import MobileOnboarding from './views/MobileOnboarding.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import PlanGenerate from './views/PlanGenerate.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'

// last known scrollY per route, so back-navigation can put the page where it was
const scrollPositions = new Map()

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  // Only the fields the shell reads: subscribing to the whole store redrew the shell and every
  // overlay under it (tab bar, timer, sheets) on each logged set. Screens subscribe themselves.
  const user = useStore(s => s.user)
  const ready = useStore(s => s.ready)
  const theme = useStore(s => s.S.theme)
  const accent = useStore(s => s.S.accent)
  const lang = useStore(s => s.S.lang)
  const activeId = useStore(s => s.S.active?.id)
  const active = useStore(s => !!s.S.active)
  const keepAwake = useStore(s => s.S.keepAwake)
  const exNameStyle = useStore(s => s.S.exNameStyle)
  const exNames = useStore(s => s.S.exNames)
  const isGuest = useStore(s => s.isGuest())
  const needsMobileOnboarding = useStore(s => s.needsMobileOnboarding)
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(theme, accent) }, [theme, accent])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(theme, accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme, accent])
  useEffect(() => { setLang(lang || 'en') }, [lang])
  // A reload in the middle of a rest (the phone reclaiming the app in the background) picks the
  // countdown back up once the workout it belongs to is loaded — see resumeRest in useUI.
  useEffect(() => { if (activeId) useUI.getState().resumeRest() }, [activeId])
  // Naming preferences are plain state, so unlike the language they need no pack load — but they
  // change what every screen calls an exercise, so they go through the same notify/useLang path.
  useEffect(() => { setExerciseNameOptions(exNameStyle, exNames) }, [exNameStyle, exNames])
  useEffect(() => { document.documentElement.lang = lang || 'en' }, [langV, lang])
  // Forward navigation starts at the top; going back lands where you left off.
  // The position is recorded from scroll events rather than read at route
  // change, because by then a shorter page may already have clamped it.
  const pathRef = useRef(loc.pathname)
  useEffect(() => {
    const onScroll = () => {
      // Modals pins the body while a sheet is open; scrollY is 0 then, not a position.
      if (document.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    pathRef.current = loc.pathname
    if (navType !== 'POP') { window.scrollTo(0, 0); return }
    const y = scrollPositions.get(loc.pathname) || 0
    // the restored view needs a layout pass before it is tall enough to scroll to y
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
    return () => window.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(active && keepAwake !== false)

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div className="app">
      <div style={{ paddingTop: 'calc(44 * var(--vh))', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  /* One layer of the sliding deck. `pathname` is the layer's own route, not necessarily the
     current one — mid-transition the screen being left is still drawn, at the route it was.
     The boundary is keyed with the layer, so a view that throws is contained and switching
     tabs re-mounts it: the tab bar is always a way out. */
  const screen = pathname => (
    <ErrorBoundary>
      <Routes location={pathname}>
        <Route path="/home" element={<Home />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/plan/r/:id" element={<RoutineEdit />} />
        <Route path="/plan/generar" element={<PlanGenerate />} />
        <Route path="/workout" element={<Workout />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/history" element={<History />} />
        <Route path="/library" element={<Library />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </ErrorBoundary>
  )

  return (
    <>
      {!authed || needsMobileOnboarding ? (
        <div className="app vfade">
          <ErrorBoundary>{!authed ? <Login /> : <MobileOnboarding />}</ErrorBoundary>
        </div>
      ) : <ScreenSlider render={screen} />}
      <VersionBadge />
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
      {authed && !needsMobileOnboarding && <DeloadNotifier />}
      {MOBILE && <UpdateNotifier />}
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  // Android system back — sheet, then page, then press-again-to-exit (see lib/back.js)
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  return <HashRouter><Shell /><Splash /></HashRouter>
}

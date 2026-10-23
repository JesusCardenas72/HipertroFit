import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { checkForUpdate, downloadUpdate, installUpdate } from '../lib/app-update.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button, Row } from './ui.jsx'

// Back in the foreground after this long, the app looks for a newer APK again.
const RECHECK_MS = 30 * 60 * 1000

function UpdateReady({ update, close }) {
  const [busy, setBusy] = useState(false)
  const install = async () => {
    setBusy(true)
    const ok = await installUpdate()
    setBusy(false)
    if (ok) close()
    else useUI.getState().toast(t('Could not open the installer. Try again later.'))
  }
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <div className="deload-hero" style={{ background: 'var(--acc)', color: 'var(--on-acc)' }}><Icon name="arrowDown" /></div>
    <h3 style={{ marginBottom: 8 }}>{t('New version {0}', update.versionName)}</h3>
    <div className="muted" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {t('It is downloaded and ready. Android will ask you to confirm the update; your data stays as it is.')}
    </div>
    <Button variant="primary" icon="arrowDown" onClick={install} disabled={busy}>{t('Update now')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={close}>{t('Later')}</Button>
  </div>
}

const offerUpdate = update =>
  useUI.getState().openSheet(close => <UpdateReady update={update} close={close} />, { kind: 'center' })

/* ---------- one check at a time, shared by the launch check and the Settings row ---------- */

// The phase the Settings row shows: idle | checking | downloading | current | error.
// `version` / `percent` ride along while downloading.
let phase = { phase: 'idle' }
const watchers = new Set()
const setPhase = next => { phase = next; watchers.forEach(fn => fn(phase)) }

let running = null
let lastCheck = 0
let ready = null              // downloaded update not yet offered by the automatic check
const offered = new Set()     // versionCodes the automatic check already showed: "Later" means later
const readyWatchers = new Set()

/**
 * Checks, and downloads a newer APK. Resolves to the downloaded update or null. `manual` (the
 * Settings row) skips the 30-minute throttle and offers the update even if it was put off.
 */
function runCheck(manual) {
  if (running) return running
  if (!manual && Date.now() - lastCheck < RECHECK_MS) return Promise.resolve(null)
  lastCheck = Date.now()
  running = (async () => {
    setPhase({ phase: 'checking' })
    const r = await checkForUpdate()
    if (r.status !== 'update') {
      setPhase({ phase: r.status === 'error' ? 'error' : r.status === 'current' ? 'current' : 'idle' })
      return null
    }
    const update = r.update
    setPhase({ phase: 'downloading', version: update.versionName, percent: -1 })
    const ok = await downloadUpdate(update, percent => setPhase({ phase: 'downloading', version: update.versionName, percent }))
    if (!ok) { setPhase({ phase: 'error', download: true }); return null }
    setPhase({ phase: 'idle' })
    return update
  })().finally(() => { running = null })
  return running
}

/**
 * Mounted once by the app shell (mobile build only): on launch and on every return to the
 * foreground, looks for a newer published APK, downloads it in the background and then offers
 * to install it — never over the splash and never in the middle of a workout.
 */
export function UpdateNotifier() {
  const active = useStore(s => !!s.S.active)
  const [pending, setPending] = useState(null)

  useEffect(() => {
    if (!MOBILE) return
    let gone = false
    const look = () => runCheck(false).then(update => {
      if (gone || !update || offered.has(update.versionCode)) return
      ready = update
      readyWatchers.forEach(fn => fn(update))
    })
    readyWatchers.add(setPending)
    look()
    let sub = null
    import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (isActive) look() }))
      .then(h => { if (gone) h.remove(); else sub = h })
      .catch(() => {})
    return () => { gone = true; readyWatchers.delete(setPending); sub?.remove() }
  }, [])

  useEffect(() => {
    if (!pending || active) return
    const iv = setInterval(() => {
      if (document.getElementById('splash')) return
      clearInterval(iv)
      if (ready !== pending) return   // already offered from Settings meanwhile
      ready = null
      offered.add(pending.versionCode)
      setPending(null)
      offerUpdate(pending)
    }, 300)
    return () => clearInterval(iv)
  }, [pending, active])

  return null
}

/** Settings → "Check for updates": checks right away and says what came of it. */
export function UpdateRow() {
  const [st, setSt] = useState(phase)
  useEffect(() => { watchers.add(setSt); return () => watchers.delete(setSt) }, [])

  const check = async () => {
    if (running) return
    const update = await runCheck(true)
    if (!update) return
    ready = null
    offered.add(update.versionCode)
    offerUpdate(update)
  }

  const subtitle =
    st.phase === 'checking' ? t('Checking…') :
    st.phase === 'downloading' ? (st.percent >= 0
      ? t('Downloading version {0}… {1}%', st.version, st.percent)
      : t('Downloading version {0}…', st.version)) :
    st.phase === 'current' ? t('Up to date — version {0} is the latest.', __APP_VERSION__) :
    st.phase === 'error' ? (st.download
      ? t('Could not download the update. Try again later.')
      : t('Could not check for updates. Are you online?')) :
    t('Installed version {0}', __APP_VERSION__)

  return <Row icon="arrowDown" iconTint="var(--acc)" title={t('Check for updates')} subtitle={subtitle}
    accessory="chevron" onClick={check} />
}

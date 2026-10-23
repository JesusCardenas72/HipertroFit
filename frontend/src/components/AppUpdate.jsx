import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { checkForUpdate, downloadUpdate, installUpdate } from '../lib/app-update.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

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

/**
 * Mounted once by the app shell (mobile build only): on launch and on every return to the
 * foreground, looks for a newer published APK, downloads it in the background and then offers
 * to install it — never over the splash and never in the middle of a workout.
 */
export function UpdateNotifier() {
  const active = useStore(s => !!s.S.active)
  const [ready, setReady] = useState(null)

  useEffect(() => {
    if (!MOBILE) return
    let gone = false, last = 0, running = false
    const offered = new Set()   // versionCodes already shown this run: "Later" means later
    const look = async () => {
      if (running || Date.now() - last < RECHECK_MS) return
      running = true
      last = Date.now()
      try {
        const update = await checkForUpdate()
        if (!update || offered.has(update.versionCode)) return
        if (await downloadUpdate(update) && !gone) {
          offered.add(update.versionCode)
          setReady(update)
        }
      } finally { running = false }
    }
    look()
    let sub = null
    import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (isActive) look() }))
      .then(h => { if (gone) h.remove(); else sub = h })
      .catch(() => {})
    return () => { gone = true; sub?.remove() }
  }, [])

  useEffect(() => {
    if (!ready || active) return
    const iv = setInterval(() => {
      if (document.getElementById('splash')) return
      clearInterval(iv)
      const update = ready
      setReady(null)
      useUI.getState().openSheet(close => <UpdateReady update={update} close={close} />, { kind: 'center' })
    }, 300)
    return () => clearInterval(iv)
  }, [ready, active])

  return null
}

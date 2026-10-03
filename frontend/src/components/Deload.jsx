import { useEffect } from 'react'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { mesoState, forceDeloadNow, forceDeloadNext, cancelDeload, exitDeload, deloadNotice, markDeloadNotified, isDeloadWorkout } from '../lib/mesocycle.js'
import { deloadActiveSession, undeloadActiveSession } from '../lib/session-start.js'
import { notifyNow } from '../lib/mobile.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Everything the app shows about a deload, in one place, so a deload reads the same on every
// screen: one colour (--deload, never an accent the user can pick), one icon and the word
// itself. Colour alone is not enough — the text is always there too.

const pctLabel = pct => '−' + Math.round(pct * 100) + ' %'

/** "Deload" next to a screen's title while a deload microcycle is running; nothing otherwise. */
export function DeloadTitleTag() {
  const S = useStore(s => s.S)
  const meso = mesoState(S)
  return meso.deload ? <> <DeloadBadge pct={meso.pct} /></> : null
}

/** The small pill that labels a deload microcycle or session. `pct` adds the cut. */
export function DeloadBadge({ pct, children }) {
  return <span className="tag deload nocap"><Icon name="arrowDown" />{children || t('Deload')}{pct > 0 ? ' · ' + pctLabel(pct) : ''}</span>
}

/**
 * The deload state of the block, as a band at the top of a screen: the deload being trained
 * right now (strong), or the one coming next (soft). Nothing at all on a regular microcycle.
 * `manage` adds the button to the control sheet.
 */
export function DeloadStatus({ manage = true, style }) {
  const S = useStore(s => s.S)
  const meso = mesoState(S)
  if (!meso.deload && !meso.next) return null
  if (meso.deload) return <div className="deload-band" style={style} role="status">
    <div className="deload-band-hd">
      <Icon name="arrowDown" />
      <b>{t('Deload microcycle')}</b>
      <span className="deload-pct">{pctLabel(meso.pct)}</span>
    </div>
    <div className="small">
      {t('Microcycle #{0}: same sessions with less weight, reps and sets. They do not count toward progression.', meso.cycle + 1)}
    </div>
    {manage && <div className="deload-actions">
      <button type="button" className="deload-link" onClick={deloadControlSheet}>{t('Manage deload')}</button>
      <button type="button" className="deload-exit" onClick={exitDeloadFlow}><Icon name="xmark" />{t('Exit deload')}</button>
    </div>}
  </div>
  return <div className="deload-band soft" style={style} role="status">
    <div className="deload-band-hd">
      <Icon name="arrowDown" />
      <b>{t('Next microcycle is a deload')}</b>
    </div>
    <div className="small">{t('Microcycle #{0} will come down {1}. This one stays at full load.', meso.cycle + 2, pctLabel(meso.pct))}</div>
    {manage && <button type="button" className="deload-link" onClick={deloadControlSheet}>{t('Manage deload')}</button>}
  </div>
}

/** Band for the running session: says, on the workout screen itself, that this one is a deload. */
export function DeloadSessionBand({ active }) {
  if (!isDeloadWorkout(active)) return null
  return <div className="deload-band" role="status" data-testid="deload-session">
    <div className="deload-band-hd">
      <Icon name="arrowDown" />
      <b>{t('Deload session')}</b>
      {Number(active.deload) > 0 && <span className="deload-pct">{pctLabel(active.deload)}</span>}
      <button type="button" className="deload-exit" onClick={exitDeloadFlow}><Icon name="xmark" />{t('Exit')}</button>
    </div>
  </div>
}

/* ---------- control sheet: force it now, on the next microcycle, or take it back ---------- */
function DeloadControl({ close }) {
  const S = useStore(s => s.S)
  const meso = mesoState(S)
  const update = useStore.getState().update
  const toast = msg => useUI.getState().toast(msg)
  const activeRunning = !!S.active && !isDeloadWorkout(S.active)
  const now = (withActive = false) => {
    update(s => {
      s.meso = forceDeloadNow(s)
      // Already announced by tapping it: no need for the "it has started" window as well.
      s.meso = markDeloadNotified(s)
      if (withActive && s.active) s.active = deloadActiveSession(s.active, s.meso.pct, s.unit)
    })
    close()
    toast(withActive ? t('Deload started — the rest of this session comes down') : t('Deload started — from the next session'))
  }
  const next = () => { update(s => { s.meso = forceDeloadNext(s) }); close(); toast(t('Next microcycle marked as a deload')) }
  const cancel = () => { update(s => { s.meso = cancelDeload(s) }); close(); toast(t('Deload cancelled')) }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="arrowDown" style={{ color: 'var(--deload)' }} />{t('Deload')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('A deload is the same sessions with about {0}% less weight, reps and sets, to recover before loading again. You set the cut when each session starts.', Math.round(meso.pct * 100))}
    </div>
    <div className="small" style={{ marginBottom: 14 }}>
      {meso.deload ? <DeloadBadge pct={meso.pct}>{t('Microcycle #{0} is a deload', meso.cycle + 1)}</DeloadBadge>
        : meso.next ? <DeloadBadge>{t('Microcycle #{0} will be a deload', meso.cycle + 2)}</DeloadBadge>
          : t('Microcycle #{0}, session {1} of {2} — loading.', meso.cycle + 1, Math.min(meso.step + 1, meso.len), meso.len)}
    </div>
    {!meso.deload && <>
      <Button variant="primary" icon="arrowDown" className="deload-btn" onClick={() => now(false)}>
        {meso.step === 0 ? t('Deload this microcycle') : t('Deload now — rest of this microcycle')}</Button>
      {activeRunning && <><div style={{ height: 8 }} />
        <Button icon="arrowDown" onClick={() => now(true)}>{t('Deload now, including the session in progress')}</Button></>}
      {!meso.next && <><div style={{ height: 8 }} />
        <Button icon="calendar" onClick={next}>{t('Deload the next microcycle')}</Button></>}
    </>}
    {meso.deload && <><div style={{ height: 8 }} />
      <Button className="danger" icon="xmark" onClick={() => { close(); exitDeloadFlow() }}>{t('Exit deload')}</Button></>}
    {!meso.deload && meso.next && <><div style={{ height: 8 }} />
      <Button variant="ghost" className="danger" icon="xmark" onClick={cancel}>{t('Cancel deload')}</Button></>}
  </>
}
/* ---------- leaving the deload, at any point of it ---------- */
function ExitDeload({ close }) {
  const S = useStore(s => s.S)
  const meso = mesoState(S)
  const sessionDeload = isDeloadWorkout(S.active)
  const go = withActive => {
    useStore.getState().update(s => {
      if (mesoState(s).deload) s.meso = exitDeload(s)
      if (withActive && s.active) s.active = undeloadActiveSession(s.active, s)
    })
    close()
    useUI.getState().toast(withActive ? t('Deload over — back to full load, this session included') : t('Deload over — full load from the next session'))
  }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="xmark" style={{ color: 'var(--deload)' }} />{t('Exit deload')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {meso.deload
        ? t('The rest of microcycle #{0} goes back to full load and the progression picks up again. Sessions already trained as a deload stay as they were.', meso.cycle + 1)
        : t('This session goes back to full load from the next set on.')}
    </div>
    {sessionDeload && <><Button variant="primary" icon="play" onClick={() => go(true)}>{t('Exit, including the session in progress')}</Button><div style={{ height: 8 }} /></>}
    {meso.deload && <Button variant={sessionDeload ? 'plain' : 'primary'} icon="check" onClick={() => go(false)}>
      {sessionDeload ? t('Exit from the next session') : t('Exit deload')}</Button>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const exitDeloadFlow = () => useUI.getState().openSheet(close => <ExitDeload close={close} />)

export const deloadControlSheet = () => useUI.getState().openSheet(close => <DeloadControl close={close} />)

/* ---------- the announcement: shown once, the first time a deload microcycle is running ---------- */
function DeloadStarted({ cycle, pct, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <div className="deload-hero"><Icon name="arrowDown" /></div>
    <h3 style={{ marginBottom: 8 }}>{t('Your deload starts')}</h3>
    <div className="muted" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {t('Microcycle #{0} is a deload: the same sessions with about {1}% less weight, reps and sets. You will see it marked in this colour on Home, Stats and every session.', cycle + 1, Math.round(pct * 100))}
    </div>
    <Button variant="primary" className="deload-btn" onClick={close}>{t('Got it')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={() => { close(); deloadControlSheet() }}>{t('Manage deload')}</Button>
  </div>
}

/** Mounted once by the app shell: announces a deload microcycle the first time it is running. */
export function DeloadNotifier() {
  const S = useStore(s => s.S)
  const cycle = deloadNotice(S)
  useEffect(() => {
    if (cycle == null) return
    // Not while the launch splash still covers the screen — announced behind it, it is missed.
    const iv = setInterval(() => {
      if (document.getElementById('splash')) return
      clearInterval(iv)
      const { pct } = mesoState(useStore.getState().S)
      // Marked as soon as it is shown: closing it by a swipe must not bring it back every launch.
      useStore.getState().update(s => { s.meso = markDeloadNotified(s) })
      useUI.getState().openSheet(close => <DeloadStarted cycle={cycle} pct={pct} close={close} />, { kind: 'center' })
      // The same news as a system notification, so it is still there in the tray after the
      // window is closed (and on the lock screen of the phone).
      notifyNow({ id: 3000 + cycle, title: t('Your deload starts'),
        body: t('Microcycle #{0}: same sessions with about {1}% less weight, reps and sets.', cycle + 1, Math.round(pct * 100)) })
    }, 300)
    return () => clearInterval(iv)
  }, [cycle])
  return null
}

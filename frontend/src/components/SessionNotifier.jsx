import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE, showSessionNotice, clearSessionNotice } from '../lib/mobile.js'
import { sessionNotice, noticeKey, SESSION_NOTICE_ID } from '../lib/session-notice.js'

/** Whether the ongoing notification is shown (Settings, Android app). On unless switched off. */
export const sessionNoticeOn = S => MOBILE && !!S && S.sessionNotice !== false

/**
 * Mounted once by the app shell: keeps the ongoing notification of the running session in step
 * with it — rewritten when what it shows changes (a set ticked, a rest started), removed when the
 * session ends, is paused or the setting goes off. Nothing at all outside the Android app.
 */
export default function SessionNotifier() {
  const S = useStore(s => s.S)
  const timer = useUI(s => s.timer)
  const shown = useRef('')
  const on = sessionNoticeOn(S)
  const rest = timer && timer.endsAt ? { endsAt: timer.endsAt } : null
  const key = on ? noticeKey(S, rest) : ''
  useEffect(() => {
    if (!MOBILE || key === shown.current) return
    shown.current = key
    if (!key) { clearSessionNotice(SESSION_NOTICE_ID); return }
    showSessionNotice(SESSION_NOTICE_ID, sessionNotice(S, rest))
  }, [key])
  return null
}

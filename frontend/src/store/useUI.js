import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, vibrate, playClips, stopClips, clipsDuration, setAudioFocusHooks } from '../lib/sound.js'
// The rest alert: a single boxing-bell ring, or the audio file picked in Settings. It is
// scheduled to *land* on zero rather than start there — the end of the sound and the end of the
// rest are the same instant — so it begins its own length before the timer runs out.
// (playClips takes a list because the alert used to be two separate files; a single-entry one
// is the same call, and keeping the list means adding a second clip needs no new plumbing.)
import { restAlertClips, loadCustomSound, progressSound, exerciseEndSound } from '../lib/custom-sound.js'
import { MOBILE, pauseOtherAudio, releaseOtherAudio } from '../lib/mobile.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useStore } from './useStore.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline.
const pushRestTimer = sec => { if (useStore.getState().user) api('/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ seconds: sec }) }).catch(() => {}) }
const cancelPushRestTimer = () => { if (useStore.getState().user) api('/api/push/rest-timer/cancel', { method: 'POST', body: '{}' }).catch(() => {}) }

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window
let requestRestNotificationPermissionP = null

const requestRestNotificationPermission = async () => {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  if (!requestRestNotificationPermissionP) {
    requestRestNotificationPermissionP = Notification.requestPermission()
      .then(perm => perm === 'granted')
      .catch(() => false)
      .finally(() => {
        requestRestNotificationPermissionP = null
      })
  }
  return requestRestNotificationPermissionP
}

const maybeRestNotification = async () => {
  if (!notificationsSupported()) return
  if (!document.hidden && document.visibilityState !== 'hidden') return
  if (Notification.permission !== 'granted' && !(await requestRestNotificationPermission())) return
  try {
    // Android Chrome forbids the Notification constructor (Illegal constructor) - the
    // service-worker registration path is the one that actually pops there.
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg?.showNotification) {
      reg.showNotification(t('Rest over — next set!'), { body: t('Rest over — next set!') })
      return
    }
    new Notification(t('Rest over — next set!'), { body: t('Rest over — next set!') })
  } catch {
    // Intentionally ignore: notification APIs vary by browser and policy in edge cases.
  }
}

// Read the saved custom sound up front so the first rest already knows which clip to measure.
loadCustomSound()
progressSound.load()
// Measuring it also decodes it, so the first exercise of a session does not wait on the network.
exerciseEndSound.load().then(() => clipsDuration(exerciseEndSound.clips())).catch(() => {})
// Native Android: pause the user's music while the alert plays and give it back afterwards.
if (MOBILE) setAudioFocusHooks({ acquire: pauseOtherAudio, release: releaseOtherAudio })

// Silence held on each side of the alert: the music is paused this long before the bell starts,
// and handed back this long after it ends (see playClips' focusGap).
export const REST_ALERT_FOCUS_GAP_MS = 1500

/* The rest that is counting is written down beside the workout, so it outlives the page: a phone
   reclaims a backgrounded PWA or WebView by reloading it, and the break you were in the middle
   of has to still be there when you come back to the app. Only the finish line is kept — what
   is left is worked out from it — and the workout it belongs to, so a rest never carries into
   a different session. */
const REST_KEY = 'gym_rest_v1'
const saveRest = tm => {
  try {
    if (!tm) { localStorage.removeItem(REST_KEY); return }
    const wid = useStore.getState().S.active?.id ?? null
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: tm.endsAt, total: tm.total, forIdx: tm.forIdx, kind: tm.kind, wid }))
  } catch { /* private mode / storage full: the rest still runs, it just won't survive a reload */ }
}
const loadRest = () => {
  try { return JSON.parse(localStorage.getItem(REST_KEY)) || null } catch { return null }
}

let toastTm = null
let clipTm = null
// The rest between exercises waiting for the exercise-end sound to start (see endExercise).
let exEndPending = null
let timerInt = null
let timerTick = null
let workInt = null
let workTick = null
let workDone = null

/* The rest alert is scheduled to *end* on zero, not to start there: it begins however long the
   two clips run before the rest is up, so the bell's last moment and the end of the rest are
   the same instant. The clip lengths are measured at runtime, so replacing either file moves
   the start on its own.

   The music is paused REST_ALERT_FOCUS_GAP_MS before the bell, so the sequence is started that
   much earlier again — it is the bell, not the pause, that has to land on zero.

   Scheduled with its own timeout rather than off the once-a-second tick, because a tick can
   only place the start to the nearest second and the whole point here is that it lands. */
const scheduleRestAlert = endsAt => {
  cancelRestAlert()
  // Resolved once per rest, so the clip measured is the clip played even if Settings swaps it.
  const clips = restAlertClips()
  clipsDuration(clips).then(total => {
    // Reading the metadata is asynchronous; by the time it lands this rest may have been
    // skipped, restarted or re-timed, and that newer rest owns the schedule now.
    const tm = useUI.getState().timer
    if (!tm || tm.endsAt !== endsAt) return
    // Clips that would not load (total 0) have nothing to pause the music for.
    const focusGap = total > 0 ? REST_ALERT_FOCUS_GAP_MS : 0
    const fire = () => {
      clipTm = null
      // The setting is read now, not when the rest started, so muting mid-rest is respected.
      playClips(useStore.getState().S.sound, clips, { focusGap })
    }
    // A rest shorter than the alert — or one trimmed under it with "−" — starts it at once:
    // finishing late is the only option left, and silence would be the worse one. A total of
    // 0 (clips that would not load) lands here too and degrades to firing on zero.
    const delay = endsAt - Date.now() - total * 1000 - focusGap
    if (delay <= 0) fire()
    else clipTm = setTimeout(fire, delay)
  })
}

function cancelRestAlert() {
  clearTimeout(clipTm)
  clipTm = null
}

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  toastMsg: '',
  timer: null,         // rest countdown between sets — { left, total, endsAt, forIdx, kind }
                       // forIdx: index of the active entry whose set started the rest (undefined when unknown)
                       // kind: 'sets' (between two sets) | 'exercise' (after an exercise is finished)
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label }
  timerFlashId: 0,     // changing the id remounts the four-pulse visual alert
  resumeId: 0,         // bumped by "Resume": the workout screen re-centres the set to do next
  resumePending: false, // set with it, consumed by the workout screen once it has acted on it

  resumeWorkout() { set(s => ({ resumeId: s.resumeId + 1, resumePending: true })) },
  flashTimer() {
    if (!useStore.getState().S.timerFlash) return
    set(s => ({ timerFlashId: s.timerFlashId + 1 }))
  },

  openSheet(render, { kind = 'sheet', locked = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },

  toast(msg) {
    set({ toastMsg: msg })
    clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },

  /* The last set of an exercise — or the last round of a superset — is done: the exercise-end
     sound plays with the same 1.5 s of silence around it as the rest alert (the music is paused
     first, handed back after), and the rest between exercises (`sec`, when there is one) starts
     counting the moment the sound itself starts, not when the set was ticked. Without sound, or
     with a sound that will not play, the rest starts at once. `sec` null: no rest follows — the
     last exercise of the session, or a session finished early. */
  endExercise(sec = null, forIdx) {
    get().stopRest()
    const token = {}
    exEndPending = token
    const wid = useStore.getState().S.active?.id ?? null
    playClips(useStore.getState().S.sound, exerciseEndSound.clips(), {
      focusGap: REST_ALERT_FOCUS_GAP_MS,
      onStart: () => {
        // A newer rest, a skipped one or a session that ended during the leading gap owns it now.
        if (exEndPending !== token) return
        exEndPending = null
        if (sec == null || (useStore.getState().S.active?.id ?? null) !== wid) return
        get().startRest(sec, forIdx, 'exercise', { keepClips: true })
      }
    })
  },

  startRest(sec, forIdx, kind = 'sets', { keepClips = false } = {}) {
    get().stopRest()
    // The previous rest's alert may still be ringing — a new set has started, so cut it.
    // This is the only place that stops it: stopRest() runs immediately after the alert
    // begins, so cancelling from there would silence it before it was heard. The rest that
    // endExercise() starts is the exception: the sound playing then is its own.
    if (!keepClips) stopClips()
    // Rest timer set to Off. Stopping and returning rather than starting a zero-length timer
    // keeps every caller honest: the four places that start a rest do not each need to know.
    if (!(sec > 0)) return
    const endsAt = Date.now() + sec * 1000
    get().runRest({ left: sec, total: sec, endsAt, forIdx, kind })
    requestRestNotificationPermission()
    pushRestTimer(sec)
  },
  // Picks up a rest the page was reloaded in the middle of (see saveRest): same finish line,
  // same alert, no second server push — the one scheduled when it started still stands. A rest
  // that ran out while the app was away is simply over.
  resumeRest() {
    if (get().timer) return
    const saved = loadRest()
    if (!saved) return
    const wid = useStore.getState().S.active?.id
    const left = Math.round((saved.endsAt - Date.now()) / 1000)
    if (!wid || saved.wid !== wid || !(left > 0)) { saveRest(null); return }
    get().runRest({ left, total: Math.max(left, saved.total || left), endsAt: saved.endsAt, forIdx: saved.forIdx, kind: saved.kind || 'sets' })
  },
  runRest(tm) {
    if (timerInt) clearInterval(timerInt)
    if (timerTick) document.removeEventListener('visibilitychange', timerTick)
    set({ timer: tm })
    saveRest(tm)
    scheduleRestAlert(tm.endsAt)
    timerTick = () => {
      const tm = get().timer
      if (!tm) return
      const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
      if (left === tm.left) return
      if (left <= 0) {
        // The alert has been playing for the last few seconds and is finishing right about
        // now — nothing to start here, and stopRest() below deliberately does not cut it.
        vibrate([200, 100, 200]); get().flashTimer(); maybeRestNotification(); get().toast(t('Rest over — next set!')); get().stopRest(); return
      }
      set({ timer: { ...tm, left } })
    }
    timerInt = setInterval(timerTick, 1000)
    document.addEventListener('visibilitychange', timerTick)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    const endsAt = tm.endsAt + sec * 1000
    set({ timer: { ...tm, left, total: tm.total + sec, endsAt } })
    saveRest(get().timer)
    pushRestTimer(left)
    // The finish line moved, so the alert has to move with it. If it had already started, it
    // would now end well before the rest does — cut it and let the new schedule play it again.
    stopClips()
    scheduleRestAlert(endsAt)
  },
  // The active list changed shape (an exercise removed or inserted at `at`): keep the rest
  // pointing at the same exercise. Returns nothing; the caller decides whether to stop instead.
  shiftRestOwner(at, delta) {
    const tm = get().timer
    if (!tm || !(tm.forIdx >= at)) return
    set({ timer: { ...tm, forIdx: tm.forIdx + delta } })
    saveRest(get().timer)
  },
  stopRest() {
    if (timerInt) clearInterval(timerInt); timerInt = null
    if (timerTick) document.removeEventListener('visibilitychange', timerTick); timerTick = null
    if (get().timer) cancelPushRestTimer()
    // A rest still waiting on the exercise-end sound is dropped with it.
    exEndPending = null
    // Drop a pending alert (a rest skipped before it began owes you no bell), but never stop
    // one already playing: this runs the moment the countdown hits zero, which is exactly when
    // the alert is finishing. Cutting it here would clip the last note off every rest.
    cancelRestAlert()
    set({ timer: null })
    saveRest(null)
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec)` is called both when the countdown reaches zero and on an early
     finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a 0:45
     hold records 0:38 rather than crediting the full target. */
  startWork(sec, label, onDone) {
    get().stopWork()
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    set({ work: { left: total, total, endsAt, label } })
    workTick = () => {
      const wk = get().work
      if (!wk) return
      const left = Math.max(0, Math.round((wk.endsAt - Date.now()) / 1000))
      if (left === wk.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        vibrate([200, 100, 200]); get().flashTimer()
        const done = workDone
        get().stopWork()
        if (done) done(wk.total)
        return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ work: { ...wk, left } })
    }
    workInt = setInterval(workTick, 1000)
    document.addEventListener('visibilitychange', workTick)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const elapsed = Math.max(1, wk.total - wk.left)
    const done = workDone
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
  },
  // Abandon without logging anything.
  stopWork() {
    if (workInt) clearInterval(workInt); workInt = null
    if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
    workDone = null
    set({ work: null })
  }
}))

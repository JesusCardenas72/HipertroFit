// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per future
// calendar date — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n-core.js'
import { isoOf, todayISO } from './format.js'
import { effectiveRoutineId } from './history.js'
import { mesoState } from './mesocycle.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

// "Connect to my server" mode (lib/remote.js): which of local-only / a paired remote account this
// device chose, kept in its own file — never inside opengym-state.json, since that file's content
// is exactly what pushState() PUTs to a server, and a device's own connection secret must never
// travel as if it were training data.
const REMOTE_FILE = 'opengym-remote.json'

export async function loadRemoteFile() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: REMOTE_FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // never decided yet
}

export async function saveRemoteFile(data) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: REMOTE_FILE, directory: Directory.Data, data: JSON.stringify(data), encoding: Encoding.UTF8 })
  } catch (e) { /* worst case: onboarding asks again next launch */ }
}

// The sounds picked in Settings (lib/custom-sound.js) get a file each beside the state mirror, for
// the same reason: they live in the WebView's IndexedDB, and that does not reliably survive an
// app update. Kept out of opengym-state.json — that file is what gets synced and exported.
// Base64 inside JSON: Filesystem only moves strings across the bridge.
const soundFile = key => `sounds/${key}.json`

export function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  // In slices: String.fromCharCode.apply over a whole 5 MB clip overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function base64ToBytes(b64) {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes.buffer
}

/** The custom-sound mirror for setSoundMirror(): records are { name, type, data: ArrayBuffer }. */
export const nativeSounds = {
  async read(key) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      const r = await Filesystem.readFile({ path: soundFile(key), directory: Directory.Data, encoding: Encoding.UTF8 })
      const rec = JSON.parse(r.data)
      return rec && rec.data ? { name: rec.name || '', type: rec.type || '', data: base64ToBytes(rec.data) } : null
    } catch (e) { return null }   // never saved, or unreadable — the default sound plays
  },
  async has(key) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      await Filesystem.stat({ path: soundFile(key), directory: Directory.Data })
      return true
    } catch (e) { return false }
  },
  async write(key, record) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      const data = JSON.stringify({ name: record.name || '', type: record.type || '', data: bytesToBase64(record.data) })
      await Filesystem.writeFile({ path: soundFile(key), directory: Directory.Data, data, encoding: Encoding.UTF8, recursive: true })
    } catch (e) { /* keep the IndexedDB copy */ }
  },
  async remove(key) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      await Filesystem.deleteFile({ path: soundFile(key), directory: Directory.Data })
    } catch (e) { /* nothing there */ }
  },
}

// Keep enough dates queued to cover normal app use between foregrounds without creating an
// unbounded notification list. The next sync cancels and replaces this whole window.
export const REMINDER_WINDOW_DAYS = 60
const REMINDER_ID_BASE = 1000
const LEGACY_REMINDER_IDS = Array.from({ length: 7 }, (_, d) => ({ id: 100 + d }))

// Pure date expansion for the native reminder. `now` is injectable so the calendar boundary,
// completed-day suppression, and today's past-time rule stay deterministic in tests.
export function buildReminderNotifications(S, now = new Date()) {
  const r = S?.reminder
  if (!r?.on) return []
  const routines = Array.isArray(S.routines) ? S.routines : []
  const completed = new Set((S.workouts || []).map(w => w.d))
  const state = { ...S, routines, week: S.week || {}, dayPlan: S.dayPlan || {} }
  const [hour, minute] = (r.time || '08:00').split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return []
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const notifications = []
  // In a deload microcycle the sessions still to train in it are announced as the deload they
  // are; once those are used up the reminders read as usual (the plan resyncs on every change).
  const meso = Array.isArray(S.workouts) ? mesoState(S) : null
  let deloadLeft = meso && meso.deload ? meso.remaining : 0
  for (let offset = 0; offset < REMINDER_WINDOW_DAYS; offset++) {
    const day = new Date(date)
    day.setDate(date.getDate() + offset)
    const iso = isoOf(day)
    if (completed.has(iso)) continue
    const rid = effectiveRoutineId(state, iso)
    const routine = routines.find(x => x.id === rid)
    if (!routine) continue
    const at = new Date(day)
    at.setHours(hour, minute, 0, 0)
    if (at <= now) continue
    const deload = deloadLeft-- > 0
    notifications.push({
      id: REMINDER_ID_BASE + offset,
      title: deload ? t('Workout day · Deload') : t('Workout day'),
      body: deload
        ? t('{0} today, as a deload: about {1}% less weight, reps and sets.', routine.name, Math.round(meso.pct * 100))
        : t('{0} is on the plan today — let’s go!', routine.name),
      schedule: { at, allowWhileIdle: true },
    })
  }
  return notifications
}

// (Re)schedule the workout-day reminder: one one-off notification per future calendar date in
// the bounded window. Cheap enough to run after any state change — the plan or the reminder time
// may just have been edited. `interactive` gates the OS permission prompt to the Settings toggle;
// a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [
      ...LEGACY_REMINDER_IDS,
      ...Array.from({ length: REMINDER_WINDOW_DAYS }, (_, d) => ({ id: REMINDER_ID_BASE + d })),
    ] }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const notifications = buildReminderNotifications(S)
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

// Capacitor emits appStateChange when the native shell returns to the foreground. The visibility
// listener also covers WebView/browser transitions, and both are harmless on a non-mobile build.
let reminderSyncStarted = false
export function initReminderSync(getState) {
  if (!MOBILE || reminderSyncStarted) return
  reminderSyncStarted = true
  const resync = () => {
    if (document.visibilityState === 'hidden') return
    syncReminder(getState()).catch(() => {})
  }
  document.addEventListener('visibilitychange', resync)
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) resync() })
  }).catch(() => {})
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}

// "Auto-backup on changes" (Settings): a dated snapshot written somewhere the user can actually
// get at, unlike the private mirror nativeSave keeps. One file per day; later triggers the same
// day overwrite it, so the folder stays readable and a sync app has little to re-upload.
export function backupFileName(today = todayISO()) {
  return `hipertrofit-backup-${today}.json`
}

// The destination folder (Android only — see BackupFolderPlugin.java). The user picks it once
// through the system folder picker; pointing it at a folder that a mirroring app keeps in sync
// with Google Drive is what makes these backups leave the phone. Drive cannot be picked
// directly: it exposes no writable folder to other apps.
//
// The chosen folder is remembered natively, not in S — it is a per-device permission grant, and
// S is what gets exported and synced. Settings therefore reads it back through backupFolder().
// registerPlugin is resolved once, lazily: importing @capacitor/core at module scope would pull
// it into every bundle, including the web build where MOBILE folds this file away.
//
// The plugin comes back in a box, never bare. A Capacitor plugin proxy answers *every* property
// with a native-method stub — `then` included — so a promise resolved with one takes it for a
// thenable, calls a native `then()` that does not exist and never settles on the plugin: every
// call made through it silently went nowhere. `core` is the @capacitor/core module.
export function androidPluginBox(core, name) {
  return core.Capacitor.getPlatform() === 'android' ? { plugin: core.registerPlugin(name) } : null
}

// Resolves to the box (or null); unwrap it with `(await get())?.plugin` at the point of use —
// returning the bare plugin from an async function would hit the same thenable trap again.
function lazyAndroidPlugin(name) {
  if (!MOBILE) return () => Promise.resolve(null)
  let once = null
  return () => {
    if (!once) once = import('@capacitor/core').then(core => androidPluginBox(core, name)).catch(() => null)
    return once
  }
}

const backupPlugin = lazyAndroidPlugin('BackupFolder')

/**
 * { supported, folder } — `supported` is false where there is no folder picker at all (iOS, and
 * the web build), which is what Settings uses to decide whether to offer the row; `folder` is
 * the chosen folder's name, null when none is set or the grant has been revoked.
 */
export async function backupFolderStatus() {
  const p = (await backupPlugin())?.plugin
  if (!p) return { supported: false, folder: null }
  try { return { supported: true, folder: (await p.status()).folder || null } } catch (e) {
    return { supported: true, folder: null }
  }
}

/** Opens the system folder picker. Resolves to the same shape as backupFolderStatus(). */
export async function pickBackupFolder() {
  const p = (await backupPlugin())?.plugin
  if (!p) return { supported: false, folder: null }
  try { return { supported: true, folder: (await p.pick()).folder || null } } catch (e) {
    return { supported: true, folder: null }
  }
}

/** Forget the folder and hand the permission back; backups fall back to Documents. */
export async function clearBackupFolder() {
  const p = (await backupPlugin())?.plugin
  if (p) { try { await p.clear() } catch (e) { /* nothing to release */ } }
  return { supported: !!p, folder: null }
}

// Audio focus around every sound the app plays (android/…/AudioFocusPlugin.java): pause whatever
// else is playing while it sounds, then hand the focus back so that app resumes by itself.
// pauseOtherAudio resolves to { granted, active } — `active`: something else was playing, so
// lib/sound.js waits out the gap — or null where nothing can be paused.
// Android only — iOS and the web build get navigator.audioSession from lib/sound.js instead.
const audioFocusPlugin = lazyAndroidPlugin('AudioFocus')

export async function pauseOtherAudio() {
  const p = (await audioFocusPlugin())?.plugin
  if (!p) return null
  try { return await p.pause() } catch (e) { return null /* older APK without the plugin */ }
}

export async function releaseOtherAudio() {
  const p = (await audioFocusPlugin())?.plugin
  if (p) { try { await p.release() } catch (e) { /* older APK without the plugin */ } }
}

// Falls back to Documents when no folder is set, or when writing to the chosen one fails (card
// pulled out, permission revoked, sync app uninstalled and took its folder with it) — a backup
// landing somewhere beats no backup at all.
export async function writeAutoBackup(state) {
  const name = backupFileName()
  const data = JSON.stringify(state)
  const p = (await backupPlugin())?.plugin
  if (p) {
    try {
      await p.write({ name, data })
      return
    } catch (e) { /* no folder chosen, or it went away — fall through to Documents */ }
  }
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({
      path: name,
      directory: Directory.Documents,
      data,
      encoding: Encoding.UTF8,
      recursive: true,
    })
  } catch (e) { /* best effort — the private mirror in Directory.Data still has the data */ }
}
// A one-off system notification, shown right away: a native local notification on the mobile
// build, the service worker's (or the plain Notification API's) on the web/PWA. Asks for the
// permission once if it was never answered; a refusal is respected silently. Never throws —
// the in-app message is shown either way, this is the copy that stays in the tray.
export async function notifyNow({ id, title, body }) {
  try {
    if (MOBILE) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      let perm = await LocalNotifications.checkPermissions()
      if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') perm = await LocalNotifications.requestPermissions()
      if (perm.display !== 'granted') return false
      await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true } }] })
      return true
    }
    if (typeof window === 'undefined' || !('Notification' in window)) return false
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm !== 'granted') return false
    // Android Chrome forbids the Notification constructor — the service worker shows it there.
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null
    if (reg?.showNotification) await reg.showNotification(title, { body, tag: 'opengym-' + id })
    else new Notification(title, { body, tag: 'opengym-' + id })
    return true
  } catch (e) { return false }
}

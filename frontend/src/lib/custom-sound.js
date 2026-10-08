/* ---- the rest-end and exercise-end sounds ----
   A bundled clip (the boxing bell, the bells), or an audio file the user picked from their own
   device.

   The picked file lives in IndexedDB on this device, not in S: S is localStorage-backed (a few
   MB for everything), exported as a JSON backup and PUT to the server on every change, and a
   song clip has no business in any of those. The price is that the choice is per device, which
   is also true of the file itself — it came from this phone's storage.

   Stored as an ArrayBuffer plus its type rather than as a File/Blob: older WebKit could not keep
   Blobs in IndexedDB, and bytes round-trip everywhere. */
import { clipsDuration, forgetClip, playClips, fanfare } from './sound.js'
import defaultRestClip from '../assets/boxing-bell-single_CORTO.mp3'
import defaultExerciseEndClip from '../assets/3a1-campanas.mp3'

const DB_NAME = 'hipertrofit-media'
const STORE = 'sounds'
const KEY = 'rest-end'

export const MAX_SOUND_BYTES = 5 * 1024 * 1024
// The alert is scheduled to *finish* on zero, so it starts its own length before the end of the
// rest. A whole song would start ringing the moment the rest began — cap it at something that
// still reads as an alert.
export const MAX_SOUND_SECONDS = 30
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|caf|amr)$/i

/** Cheap checks on the file itself: 'not-audio' | 'empty' | 'too-big' | null. */
export function soundFileProblem({ name, type, size } = {}) {
  if (!(typeof type === 'string' && type.startsWith('audio/')) && !AUDIO_EXT.test(name || '')) return 'not-audio'
  if (!(size > 0)) return 'empty'
  if (size > MAX_SOUND_BYTES) return 'too-big'
  return null
}

/** Checks on the decoded length: 'unreadable' | 'too-long' | null. */
export function soundDurationProblem(seconds) {
  if (!(seconds > 0)) return 'unreadable'
  if (seconds > MAX_SOUND_SECONDS) return 'too-long'
  return null
}

/** Everything that would stop `file` from working as the alert, or null when it is fine. */
export async function customSoundProblem(file) {
  const early = soundFileProblem(file)
  if (early) return early
  let url = null
  try {
    url = URL.createObjectURL(file)
    return soundDurationProblem(await clipsDuration([url]))
  } catch (e) {
    return 'unreadable'
  } finally {
    if (url) { forgetClip(url); try { URL.revokeObjectURL(url) } catch (e) { /* */ } }
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function withStore(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

/* A second copy of every picked sound, outside the WebView (the native build points it at files,
   see nativeSounds in lib/mobile.js): IndexedDB can come back empty after an app update, as
   localStorage can — the reason S has nativeSave. `{ read, has, write, remove }`, all keyed by
   the slot key, none of them throwing. Read only when IndexedDB has nothing, and what it returns
   is put back there. */
let mirror = null
export function setSoundMirror(m) { mirror = m || null }

/* One stored sound per slot: `key` is its IndexedDB key, `fallback` the bundled clip it replaces
   (null when the default is synthesised instead, as the progression fanfare is). */
function soundSlot(key, fallback) {
  let current = null   // { name, url } while a custom sound is in use
  let loaded = null    // Promise of the first read from IndexedDB (or the mirror)
  const fromMirror = async () => {
    const record = mirror ? await mirror.read(key) : null
    if (!record || !record.data) return null
    withStore('readwrite', st => st.put(record, key)).catch(() => {})
    return record
  }
  // A sound saved before the mirror existed gets its copy on the first launch that has one.
  const seedMirror = record => {
    if (mirror) mirror.has(key).then(has => { if (!has) return mirror.write(key, record) }).catch(() => {})
  }
  const adopt = record => {
    if (current) {
      forgetClip(current.url)
      try { URL.revokeObjectURL(current.url) } catch (e) { /* */ }
    }
    current = record && record.data
      ? { name: record.name || '', url: URL.createObjectURL(new Blob([record.data], { type: record.type || '' })) }
      : null
  }
  const name = () => (current ? current.name : null)
  return {
    /** Name of the custom sound in use, or null for the default. Synchronous: null until loaded. */
    name,
    /** The clips this sound plays right now — empty when the default is not a clip. */
    clips: () => (current ? [current.url] : fallback ? [fallback] : []),
    /** Read the saved choice once. Resolves to its name (null for the default); never rejects. */
    load() {
      if (!loaded) {
        loaded = withStore('readonly', st => st.get(key))
          .catch(() => null)
          .then(record => {
            if (!record) return fromMirror()
            seedMirror(record)
            return record
          })
          .then(adopt)
          .catch(() => {})
          .then(name)
      }
      return loaded
    },
    /** Save `file` in this slot. Run customSoundProblem first; this only stores it. */
    async save(file) {
      const record = { name: file.name || '', type: file.type || '', data: await file.arrayBuffer() }
      await withStore('readwrite', st => st.put(record, key))
      if (mirror) await mirror.write(key, record).catch(() => {})
      adopt(record)
      loaded = Promise.resolve(name())
      return name()
    },
    /** Back to the default. */
    async clear() {
      await withStore('readwrite', st => st.delete(key))
      // Or the next launch with an emptied IndexedDB would bring the old sound back.
      if (mirror) await mirror.remove(key).catch(() => {})
      adopt(null)
      loaded = Promise.resolve(null)
      return null
    }
  }
}

/** The rest-end alert: the boxing bell or a file of the user's. */
export const restSound = soundSlot(KEY, defaultRestClip)
/** The end of an exercise (its last set, or a superset's last round) and of the session: bells or
    a file of the user's. The rest between exercises starts counting as it starts. */
export const exerciseEndSound = soundSlot('exercise-end', defaultExerciseEndClip)
/** The "time to progress" celebration: a synthesised fanfare or a file of the user's. */
export const progressSound = soundSlot('progress', null)

/** Play the progression celebration: the user's file when there is one, else the fanfare. */
export function playProgressSound(enabled) {
  const clips = progressSound.clips()
  if (clips.length) playClips(enabled, clips)
  else fanfare(enabled)
}

export const customSoundName = () => restSound.name()
export const restAlertClips = () => restSound.clips()
export const loadCustomSound = () => restSound.load()
export const saveCustomSound = file => restSound.save(file)
export const clearCustomSound = () => restSound.clear()

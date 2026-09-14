// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
let audioCtx = null
function context() {
  if (!audioCtx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
    if (!AC) return null
    audioCtx = new AC()
  }
  return audioCtx
}
// A context made outside a tap (the rest alert's preload) starts suspended; the next beep, which
// always comes from a tap on a set, is what unlocks it for the alert later.
function wake(ac) {
  try { if (ac.state === 'suspended') { const p = ac.resume(); if (p && p.catch) p.catch(() => {}) } } catch (e) { /* */ }
}
export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try {
    const ac = context()
    if (!ac) return
    wake(ac)
    const o = ac.createOscillator(), g = ac.createGain()
    o.connect(g); g.connect(ac.destination)
    o.frequency.value = freq || 880; o.type = 'sine'
    const t0 = ac.currentTime + (when || 0)
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18))
    o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05)
  } catch (e) { /* */ }
}
// A short rising arpeggio with a held top note — the built-in "time to progress" sound.
export function fanfare(enabled) {
  const notes = [[523.25, 0, 0.14], [659.25, 0.12, 0.14], [783.99, 0.24, 0.14], [1046.5, 0.36, 0.5]]
  notes.forEach(([f, when, dur]) => beep(enabled, f, dur, when))
}
export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }

/* ---- sample playback (rest-over alert) ----
   Recorded clips rather than the oscillator above, played one after another.

   Decoded into WebAudio buffers where the browser has WebAudio, and played through the same
   context as the beeps. That is about the music you are training to, not about timing: an
   <audio> element is "media" to the OS, and on phones it can take the audio focus outright —
   Spotify pauses for the bell and never comes back. WebAudio output mixes with other apps
   instead. The <audio> element stays as the fallback for a clip that will not decode or a
   context that has not been unlocked by a tap yet.

   Around the whole sequence the audio-focus hooks run (see setAudioFocusHooks): they ask the
   OS to *duck* other audio for the length of the alert and hand it back the moment it ends.

   Both caches are per source and live for the session, which doubles as the preload: the second
   rest of a session starts its alert instantly instead of waiting on the network. */
const clipCache = new Map()     // src -> HTMLAudioElement
const bufferCache = new Map()   // src -> AudioBuffer | null (null: tried, will not decode)
const bufferLoading = new Map() // src -> Promise<AudioBuffer|null>
let playing = null

function clipFor(src) {
  let el = clipCache.get(src)
  if (!el) {
    el = new Audio(src)
    el.preload = 'auto'
    clipCache.set(src, el)
  }
  return el
}

function loadBuffer(src) {
  if (bufferCache.has(src)) return Promise.resolve(bufferCache.get(src))
  const pending = bufferLoading.get(src)
  if (pending) return pending
  const ac = context()
  if (!ac || typeof fetch !== 'function') return Promise.resolve(null)
  const p = fetch(src)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer() })
    // Older Safari only has the callback form of decodeAudioData; newer browsers return a
    // promise as well. Listening to both settles once either way.
    .then(data => new Promise((resolve, reject) => {
      const ret = ac.decodeAudioData(data, resolve, reject)
      if (ret && typeof ret.then === 'function') ret.then(resolve, reject)
    }))
    .then(buf => buf, () => null)
    .then(buf => {
      // forgetClip() may have dropped this source while it was loading.
      if (bufferLoading.get(src) === p) { bufferLoading.delete(src); bufferCache.set(src, buf) }
      return buf
    })
  bufferLoading.set(src, p)
  return p
}

/* How long a clip runs, in seconds, once the browser has read its metadata. Measured rather
   than hardcoded: the alert is scheduled to *finish* as the rest hits zero, so swapping either
   file for a longer or shorter one has to move the start automatically. Resolves 0 for a clip
   that will not load, and gives up after METADATA_TIMEOUT_MS so a stalled request can never
   leave a rest with no alert at all — a 0 makes the caller fall back to firing at zero. */
const METADATA_TIMEOUT_MS = 3000

const withTimeout = (promise, fallback) => new Promise(resolve => {
  let settled = false
  const finish = v => { if (!settled) { settled = true; resolve(v) } }
  promise.then(finish, () => finish(fallback))
  setTimeout(() => finish(fallback), METADATA_TIMEOUT_MS)
})

function durationOf(el) {
  return new Promise(resolve => {
    if (el.readyState >= 1 && el.duration > 0) { resolve(el.duration); return }
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('error', onError)
      resolve(value)
    }
    const onLoaded = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0)
    const onError = () => finish(0)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('error', onError)
    setTimeout(() => finish(0), METADATA_TIMEOUT_MS)
  })
}

async function clipDuration(src) {
  const buf = await withTimeout(loadBuffer(src), null)
  if (buf && buf.duration > 0) return buf.duration
  let el
  try { el = clipFor(src) } catch (e) { return 0 }
  return durationOf(el)
}

/** Total seconds `playClips(sources)` will run for. 0 when nothing is playable. */
export async function clipsDuration(sources) {
  const queue = (sources || []).filter(Boolean)
  if (!queue.length) return 0
  let total = 0
  for (const src of queue) total += await clipDuration(src)
  return total
}

/** Drop everything cached for `src` — for a blob: URL that is about to be revoked. */
export function forgetClip(src) {
  if (playing && playing.src === src) stopClips()
  const el = clipCache.get(src)
  if (el) { try { el.pause(); el.removeAttribute?.('src') } catch (e) { /* */ } }
  clipCache.delete(src)
  bufferCache.delete(src)
  bufferLoading.delete(src)
}

/* ---- audio focus ----
   `acquire` runs as an alert starts and `release` once it has finished or been cut off — the
   native build points them at the AudioFocus plugin, which ducks other apps' audio and gives it
   back. Browsers get the Audio Session API where they have it (Safari): 'transient' is the type
   meant for a short sound over someone else's playback. Both are best-effort and never throw. */
let focusHooks = null
let focusHeld = false

export function setAudioFocusHooks(hooks) { focusHooks = hooks || null }

function focus(on) {
  if (on === focusHeld) return
  focusHeld = on
  try {
    const session = typeof navigator !== 'undefined' ? navigator.audioSession : null
    if (session) session.type = on ? 'transient' : 'auto'
  } catch (e) { /* */ }
  try {
    const fn = focusHooks && (on ? focusHooks.acquire : focusHooks.release)
    const p = fn && fn()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (e) { /* */ }
}

/** Stop whatever sequence is mid-flight. A rest that ends must not ring into the next set. */
export function stopClips() {
  const cur = playing
  playing = null
  if (!cur) return
  if (cur.node) { try { cur.node.onended = null; cur.node.stop() } catch (e) { /* */ } }
  if (cur.el) { try { cur.el.pause(); cur.el.currentTime = 0 } catch (e) { /* */ } }
  focus(false)
}

/**
 * Play `sources` in order, each starting when the previous one ends. `enabled` gates it the
 * same way it gates `beep`. Returns immediately — playback is asynchronous.
 *
 * A clip the browser refuses to play (autoplay policy, decode failure, missing file) advances
 * to the next one rather than stranding the rest of the sequence in silence.
 */
export function playClips(enabled, sources) {
  stopClips()
  if (!enabled) return
  const queue = (sources || []).filter(Boolean)
  if (!queue.length) return
  // Identity token: a sequence started later must be able to tell that this one is stale,
  // since an 'ended' handler can outlive the stopClips() that cancelled it.
  const token = { el: null, node: null, src: null }
  playing = token
  focus(true)
  const step = i => {
    if (playing !== token) return
    if (i >= queue.length) {
      // Finished on its own: give the other app its audio back right away.
      playing = null
      focus(false)
      return
    }
    const src = queue[i]
    token.src = src
    const buf = bufferCache.get(src)
    const ac = audioCtx
    if (buf && ac && ac.state === 'running') {
      try {
        const node = ac.createBufferSource()
        node.buffer = buf
        node.connect(ac.destination)
        node.onended = () => { if (playing === token && token.node === node) step(i + 1) }
        token.node = node; token.el = null
        node.start()
        return
      } catch (e) { token.node = null /* fall back to the element below */ }
    }
    let el
    try { el = clipFor(src) } catch (e) { step(i + 1); return }
    token.el = el; token.node = null
    el.onended = () => { if (playing === token && token.el === el) step(i + 1) }
    try {
      el.currentTime = 0
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => { if (playing === token && token.el === el) step(i + 1) })
    } catch (e) { step(i + 1) }
  }
  step(0)
}

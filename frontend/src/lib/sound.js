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
function tone(ac, freq, dur, when) {
  try {
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
/* Like every sound here it plays inside the audio-focus hold (see claim below): with music
   playing, the music is paused first and the beep sounds FOCUS_GAP_MS later; with nothing
   playing it sounds at once. Calls made together — a three-note chime — share one pause. */
export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  let ac
  try { ac = context() } catch (e) { return }
  if (!ac) return
  // Unlocked now, inside the tap that made the beep: a timer later would not count as one.
  wake(ac)
  const owner = {}
  const len = ((when || 0) + (dur || 0.18) + 0.05) * 1000
  claim(owner, h => {
    const wait = Math.max(0, h.at - Date.now())
    tone(ac, freq, dur, wait / 1000 + (when || 0))
    setTimeout(() => unclaim(owner), wait + len + (h.paused ? FOCUS_GAP_MS : 0))
  })
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

   Around the whole sequence the audio focus is held (see claim): other audio is *paused* for
   the length of the alert and handed back once it ends, so the music stops, the bell rings on
   its own and the music picks up again where it was.

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
   Every sound the app makes — beeps, the fanfare, the recorded clips — plays inside a focus
   hold: other apps' audio (music, a podcast) is paused first, the sound starts FOCUS_GAP_MS
   later, and the audio is handed back FOCUS_GAP_MS after the sound ends. Sounds that overlap
   share one hold, so the music pauses once and comes back once, after whichever ends last.

   The hooks do the pausing (setAudioFocusHooks): the native build points them at the AudioFocus
   plugin. `acquire` resolves to { active } — whether something else was actually playing. When
   nothing was there is nothing to wait for, and the sound starts at once: a tap's beep is never
   held back 1.5 s for a pause that did not happen. Without hooks (the web build) nothing can be
   paused or known, so no gap is waited either, beyond one a caller asks for outright (playClips'
   focusGap). Safari also gets the Audio Session API: 'transient-solo' silences other playback
   while the hold lasts. All of it best-effort; none of it throws. */
export const FOCUS_GAP_MS = 1500

let focusHooks = null
const holders = new Set()
let hold = null   // { at, paused, known, waiting } while anything holds the focus

export function setAudioFocusHooks(hooks) { focusHooks = hooks || null }

function setSession(on) {
  try {
    const session = typeof navigator !== 'undefined' ? navigator.audioSession : null
    if (session) session.type = on ? 'transient-solo' : 'auto'
  } catch (e) { /* */ }
}

/* Add `owner` to the hold, taking the focus if it is the first. `run(hold)` is called once it is
   known when the other audio is quiet — `hold.at`, a Date.now() time — and whether anything was
   paused at all (`hold.paused`, which also decides the tail). Synchronously when that is already
   known; never for an owner that has let go in the meantime. */
function claim(owner, run) {
  holders.add(owner)
  if (!hold) {
    const h = hold = { at: Date.now(), paused: false, known: false, waiting: [] }
    setSession(true)
    const settle = r => {
      if (h.known) return
      h.known = true
      if (r && r.active) { h.paused = true; h.at += FOCUS_GAP_MS }
      h.waiting.splice(0).forEach(([o, fn]) => { if (hold === h && holders.has(o)) fn(h) })
    }
    let r = null
    try { const fn = focusHooks && focusHooks.acquire; r = fn ? fn() : null } catch (e) { r = null }
    if (r && typeof r.then === 'function') r.then(settle, () => settle(null))
    else settle(r)
  }
  if (hold.known) run(hold)
  else hold.waiting.push([owner, run])
}

function unclaim(owner) {
  if (!holders.delete(owner) || holders.size) return
  hold = null
  setSession(false)
  try {
    const fn = focusHooks && focusHooks.release
    const p = fn && fn()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (e) { /* */ }
}

/** Take the focus now, ahead of sounds known to be coming (a countdown's beeps): they then start
    on time instead of waiting out the pause. Returns the function that lets go. */
export function holdFocus() {
  const owner = {}
  claim(owner, () => {})
  return () => unclaim(owner)
}

/** Stop whatever sequence is mid-flight. A rest that ends must not ring into the next set. */
export function stopClips() {
  const cur = playing
  playing = null
  if (!cur) return
  clearTimeout(cur.gapTm)
  // Cut off before the first clip: whatever was waiting on the sound starts now instead.
  if (cur.begin) cur.begin()
  if (cur.node) { try { cur.node.onended = null; cur.node.stop() } catch (e) { /* */ } }
  if (cur.el) { try { cur.el.pause(); cur.el.currentTime = 0 } catch (e) { /* */ } }
  unclaim(cur)
}

/**
 * Play `sources` in order, each starting when the previous one ends. `enabled` gates it the
 * same way it gates `beep`. Returns immediately — playback is asynchronous.
 *
 * The focus is held around it (see claim): with other audio playing, that audio is paused
 * FOCUS_GAP_MS before the first clip and given back FOCUS_GAP_MS after the last — so the bell
 * never plays over the tail of a fading song, and the song does not jump back in on the bell's
 * last note. `focusGap` (ms) makes that silence unconditional: the rest alert is started that
 * much early so as to land on zero, and must not ring early because nothing was playing. A
 * stopClips() during either gap ends it at once.
 *
 * `onStart` runs once, the moment the first clip starts — after the leading gap. Something that
 * is timed from the sound (the rest between exercises) hangs off it. It also runs, at once, when
 * the sequence never gets that far: sound off, nothing playable, or cut off during the leading
 * gap — what is timed from the sound must not go missing because the sound did.
 *
 * A clip the browser refuses to play (autoplay policy, decode failure, missing file) advances
 * to the next one rather than stranding the rest of the sequence in silence.
 */
export function playClips(enabled, sources, { focusGap = 0, onStart = null } = {}) {
  stopClips()
  let started = false
  const begin = () => {
    if (started) return
    started = true
    if (onStart) { try { onStart() } catch (e) { /* */ } }
  }
  const queue = (sources || []).filter(Boolean)
  if (!enabled || !queue.length) { begin(); return }
  // Identity token: a sequence started later must be able to tell that this one is stale,
  // since an 'ended' handler can outlive the stopClips() that cancelled it.
  const token = { el: null, node: null, src: null, gapTm: null, begin }
  playing = token
  const t0 = Date.now()
  let tail = focusGap
  const done = () => {
    if (playing !== token) return
    playing = null
    unclaim(token)
  }
  const step = i => {
    if (playing !== token) return
    if (i >= queue.length) {
      // Finished on its own: give the other app its audio back after the gap. The token stays
      // current until then, so a stopClips() in between still releases the focus right away.
      token.el = null; token.node = null; token.src = null
      if (tail > 0) token.gapTm = setTimeout(done, tail)
      else done()
      return
    }
    if (i === 0) begin()
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
  claim(token, h => {
    if (playing !== token) return
    if (h.paused) tail = Math.max(tail, FOCUS_GAP_MS)
    const wait = Math.max(t0 + focusGap, h.at) - Date.now()
    if (wait > 0) token.gapTm = setTimeout(() => { token.gapTm = null; step(0) }, wait)
    else step(0)
  })
}

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { beep, clipsDuration, forgetClip, playClips, setAudioFocusHooks, stopClips } from './sound.js'

// A stand-in for HTMLAudioElement: records what was asked of it and lets a test decide when a
// clip "ends", how long it claims to be, or whether play() is refused (the autoplay case).
class FakeAudio {
  constructor(src) {
    this.src = src
    this.paused = true
    this.currentTime = 0
    this.onended = null
    this.playCalls = 0
    this.refuse = FakeAudio.refuse.has(src)
    this.listeners = {}
    // readyState 1 (HAVE_METADATA) means clipsDuration can read the length without waiting.
    this.duration = FakeAudio.durations.get(src) ?? 0
    this.readyState = this.duration > 0 ? 1 : 0
    FakeAudio.made.push(this)
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn)
  }
  emit(type) { (this.listeners[type] || []).slice().forEach(fn => fn()) }
  play() {
    this.playCalls++
    if (this.refuse) return Promise.reject(new Error('blocked'))
    this.paused = false
    return Promise.resolve()
  }
  pause() { this.paused = true }
  end() { this.onended?.() }
}
FakeAudio.made = []
FakeAudio.refuse = new Set()
FakeAudio.durations = new Map()

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const madeFor = src => FakeAudio.made.filter(a => a.src === src)

// sound.js caches one element per source for the lifetime of the module — that reuse is the
// point (it preloads the alert), but it means a source name used in one test would not create
// a new element in the next. Every test therefore works on its own source names.
let n = 0
const srcs = (...names) => names.map(name => `t${n}-${name}.mp3`)

describe('playClips', () => {
  beforeEach(() => {
    n++
    FakeAudio.made = []
    FakeAudio.refuse = new Set()
    FakeAudio.durations = new Map()
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => {
    stopClips()
    vi.unstubAllGlobals()
  })

  test('plays the sequence one clip at a time, each starting when the last ends', async () => {
    const [a, b] = srcs('a', 'b')
    playClips(true, [a, b])
    expect(FakeAudio.made).toHaveLength(1)
    expect(FakeAudio.made[0].src).toBe(a)

    FakeAudio.made[0].end()
    await settle()
    expect(FakeAudio.made).toHaveLength(2)
    expect(FakeAudio.made[1].src).toBe(b)
  })

  test('plays nothing when sound is off', () => {
    playClips(false, srcs('a', 'b'))
    expect(FakeAudio.made).toHaveLength(0)
  })

  test('tolerates an empty or missing source list', () => {
    playClips(true, [])
    playClips(true, undefined)
    playClips(true, [null, ''])
    expect(FakeAudio.made).toHaveLength(0)
  })

  test('advances past a clip the browser refuses to play', async () => {
    // The autoplay policy rejects play() on the first clip; the bell must still ring.
    const [a, b] = srcs('a', 'b')
    FakeAudio.refuse.add(a)
    playClips(true, [a, b])
    await settle()
    expect(madeFor(b)).toHaveLength(1)
  })

  test('stopClips silences the sequence and prevents the next clip', async () => {
    const [a, b] = srcs('a', 'b')
    playClips(true, [a, b])
    const first = FakeAudio.made[0]
    stopClips()
    expect(first.paused).toBe(true)
    expect(first.currentTime).toBe(0)

    // An 'ended' event that arrives after the cancel must not start the second clip.
    first.end()
    await settle()
    expect(madeFor(b)).toHaveLength(0)
  })

  test('a new sequence cancels the one still playing', async () => {
    const [a, b, c] = srcs('a', 'b', 'c')
    playClips(true, [a, b])
    const first = FakeAudio.made[0]
    playClips(true, [c])
    expect(first.paused).toBe(true)

    first.end()
    await settle()
    expect(madeFor(b)).toHaveLength(0)
    expect(madeFor(c)).toHaveLength(1)
  })

  test('reuses one element per source instead of refetching it every rest', async () => {
    const [a] = srcs('a')
    playClips(true, [a])
    const first = FakeAudio.made[0]
    first.end()
    await settle()

    playClips(true, [a])
    expect(madeFor(a)).toHaveLength(1)   // same element, played a second time
    expect(first.playCalls).toBe(2)
  })
})

// The rest alert is scheduled to *finish* as the rest hits zero, so its total length is what
// decides when it starts. Getting this wrong is silent — the sound just lands in the wrong
// place — so the arithmetic is pinned here rather than left to the caller.
describe('clipsDuration', () => {
  beforeEach(() => {
    n++
    FakeAudio.made = []
    FakeAudio.refuse = new Set()
    FakeAudio.durations = new Map()
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => {
    stopClips()
    vi.unstubAllGlobals()
  })

  test('adds up every clip in the sequence', async () => {
    const [a, b] = srcs('a', 'b')
    FakeAudio.durations.set(a, 5.71)
    FakeAudio.durations.set(b, 8.25)
    await expect(clipsDuration([a, b])).resolves.toBeCloseTo(13.96, 5)
  })

  test('is zero for an empty or missing sequence', async () => {
    await expect(clipsDuration([])).resolves.toBe(0)
    await expect(clipsDuration(undefined)).resolves.toBe(0)
    await expect(clipsDuration([null, ''])).resolves.toBe(0)
  })

  test('waits for metadata that has not arrived yet', async () => {
    const [a] = srcs('a')
    const pending = clipsDuration([a])
    await settle()
    const el = FakeAudio.made[0]
    expect(el.readyState).toBe(0)          // nothing to read at the time of the call
    el.duration = 4.5
    el.emit('loadedmetadata')
    await expect(pending).resolves.toBe(4.5)
  })

  // A clip that fails contributes 0, which makes the caller fall back to firing on zero rather
  // than leaving the rest with no alert at all.
  test('counts a clip that fails to load as zero', async () => {
    const [a, b] = srcs('a', 'b')
    FakeAudio.durations.set(b, 3)
    const pending = clipsDuration([a, b])
    await settle()
    FakeAudio.made[0].emit('error')
    await expect(pending).resolves.toBe(3)
  })
})

// "The music should come back after the bell": the focus is taken as the alert starts and handed
// back the moment it ends — however it ends. A release that never comes leaves Spotify ducked.
describe('audio focus around the alert', () => {
  let hooks
  beforeEach(() => {
    n++
    FakeAudio.made = []
    FakeAudio.refuse = new Set()
    FakeAudio.durations = new Map()
    vi.stubGlobal('Audio', FakeAudio)
    hooks = { acquire: vi.fn(), release: vi.fn() }
    setAudioFocusHooks(hooks)
  })
  afterEach(() => {
    stopClips()
    setAudioFocusHooks(null)
    vi.unstubAllGlobals()
  })

  test('takes the focus when the sequence starts and releases it when the last clip ends', async () => {
    const [a, b] = srcs('a', 'b')
    playClips(true, [a, b])
    expect(hooks.acquire).toHaveBeenCalledTimes(1)
    FakeAudio.made[0].end()
    await settle()
    expect(hooks.release).not.toHaveBeenCalled()   // still one clip to go
    madeFor(b)[0].end()
    await settle()
    expect(hooks.release).toHaveBeenCalledTimes(1)
  })

  test('releases it when the alert is cut off', () => {
    playClips(true, srcs('a'))
    stopClips()
    expect(hooks.release).toHaveBeenCalledTimes(1)
  })

  test('releases it when every clip is refused', async () => {
    const [a] = srcs('a')
    FakeAudio.refuse.add(a)
    playClips(true, [a])
    await settle()
    expect(hooks.release).toHaveBeenCalledTimes(1)
  })

  test('a new alert over a playing one does not leave the focus held twice', async () => {
    const [a, b] = srcs('a', 'b')
    playClips(true, [a])
    playClips(true, [b])
    madeFor(b)[0].end()
    await settle()
    expect(hooks.acquire.mock.calls.length).toBe(hooks.release.mock.calls.length)
  })

  test('touches nothing when sound is off', () => {
    playClips(false, srcs('a'))
    expect(hooks.acquire).not.toHaveBeenCalled()
  })

  // "Pause the music, wait 1.5 s, ring, wait 1.5 s, give the music back."
  describe('with a focus gap', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    test('pauses first and only starts the clip once the gap has passed', async () => {
      const [a] = srcs('a')
      playClips(true, [a], { focusGap: 1500 })
      expect(hooks.acquire).toHaveBeenCalledTimes(1)
      expect(madeFor(a).some(el => el.playCalls > 0)).toBe(false)
      await vi.advanceTimersByTimeAsync(1499)
      expect(madeFor(a).some(el => el.playCalls > 0)).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(madeFor(a)[0].paused).toBe(false)
    })

    test('hands the focus back only once the gap after the last clip has passed', async () => {
      const [a] = srcs('a')
      playClips(true, [a], { focusGap: 1500 })
      await vi.advanceTimersByTimeAsync(1500)
      madeFor(a)[0].end()
      await vi.advanceTimersByTimeAsync(1499)
      expect(hooks.release).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(hooks.release).toHaveBeenCalledTimes(1)
    })

    test('cut off during the leading gap: releases at once and never plays', async () => {
      const [a] = srcs('a')
      playClips(true, [a], { focusGap: 1500 })
      stopClips()
      expect(hooks.release).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(madeFor(a).some(el => el.playCalls > 0)).toBe(false)
      expect(hooks.release).toHaveBeenCalledTimes(1)
    })

    test('cut off during the trailing gap: releases at once, and only once', async () => {
      const [a] = srcs('a')
      playClips(true, [a], { focusGap: 1500 })
      await vi.advanceTimersByTimeAsync(1500)
      madeFor(a)[0].end()
      stopClips()
      expect(hooks.release).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(hooks.release).toHaveBeenCalledTimes(1)
    })
 
    // The rest between exercises is timed from the exercise-end sound: it starts when the
    // sound does, after the pause — and never goes missing because the sound did.
    test('onStart runs as the first clip starts, after the gap, and only once', async () => {
      const [a, b] = srcs('a', 'b')
      const onStart = vi.fn()
      playClips(true, [a, b], { focusGap: 1500, onStart })
      await vi.advanceTimersByTimeAsync(1499)
      expect(onStart).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onStart).toHaveBeenCalledTimes(1)
      madeFor(a)[0].end()
      madeFor(b)[0].end()
      await vi.advanceTimersByTimeAsync(5000)
      expect(onStart).toHaveBeenCalledTimes(1)
    })

    test('onStart runs at once when the sound is off or there is nothing to play', () => {
      const off = vi.fn(), empty = vi.fn()
      playClips(false, srcs('a'), { focusGap: 1500, onStart: off })
      playClips(true, [], { focusGap: 1500, onStart: empty })
      expect(off).toHaveBeenCalledTimes(1)
      expect(empty).toHaveBeenCalledTimes(1)
      expect(hooks.acquire).not.toHaveBeenCalled()
    })

    test('onStart still runs when the sequence is cut off during the leading gap', async () => {
      const onStart = vi.fn()
      playClips(true, srcs('a'), { focusGap: 1500, onStart })
      stopClips()
      expect(onStart).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(onStart).toHaveBeenCalledTimes(1)
    })
  })

  test('a hook that throws or rejects never breaks playback', async () => {
    setAudioFocusHooks({ acquire: () => { throw new Error('no plugin') }, release: () => Promise.reject(new Error('x')) })
    const [a] = srcs('a')
    playClips(true, [a])
    expect(madeFor(a)[0].paused).toBe(false)
    madeFor(a)[0].end()
    await settle()
  })
})

// WebAudio is the preferred path: its output mixes with other apps instead of taking the audio
// focus the way an <audio> element can. A minimal fake context records what gets played.
describe('WebAudio playback', () => {
  class FakeContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sources = []; FakeContext.last = this }
    resume() { this.state = 'running'; return Promise.resolve() }
    decodeAudioData(data) { return Promise.resolve({ duration: FakeContext.durations.get(data.src) ?? 1 }) }
    createBufferSource() {
      const node = { buffer: null, onended: null, started: false, stopped: false,
        connect() {}, start() { node.started = true }, stop() { node.stopped = true } }
      this.sources.push(node)
      return node
    }
    createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {} } }
    createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } } }
    get destination() { return {} }
  }
  FakeContext.durations = new Map()

  let ctx
  beforeEach(() => {
    n++
    FakeAudio.made = []
    FakeAudio.refuse = new Set()
    FakeAudio.durations = new Map()
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('fetch', vi.fn(src => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve({ src }) })))
    // sound.js keeps one context for the module; the first test creates it through a beep.
    beep(true, 440, 0.01)
    ctx = FakeContext.last
    ctx.sources = []
    ctx.state = 'running'
  })
  afterEach(() => {
    stopClips()
    vi.unstubAllGlobals()
  })

  test('measures a clip from its decoded buffer', async () => {
    const [a] = srcs('a')
    FakeContext.durations.set(a, 2.5)
    await expect(clipsDuration([a])).resolves.toBe(2.5)
    expect(FakeAudio.made).toHaveLength(0)   // no <audio> element needed
  })

  test('plays a decoded clip through the context, then the next one', async () => {
    const [a, b] = srcs('a', 'b')
    await clipsDuration([a, b])
    playClips(true, [a, b])
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].started).toBe(true)
    ctx.sources[0].onended()
    expect(ctx.sources).toHaveLength(2)
    expect(FakeAudio.made).toHaveLength(0)
  })

  test('stopClips stops the buffer source', async () => {
    const [a] = srcs('a')
    await clipsDuration([a])
    playClips(true, [a])
    stopClips()
    expect(ctx.sources[0].stopped).toBe(true)
  })

  // A context nobody has tapped to unlock would play silence; the element is the better bet.
  test('falls back to an <audio> element while the context is suspended', async () => {
    const [a] = srcs('a')
    await clipsDuration([a])
    ctx.state = 'suspended'
    playClips(true, [a])
    expect(ctx.sources).toHaveLength(0)
    expect(madeFor(a)).toHaveLength(1)
  })

  test('falls back to the element when a clip will not decode', async () => {
    const [a] = srcs('a')
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404 }))
    FakeAudio.durations.set(a, 4)
    await expect(clipsDuration([a])).resolves.toBe(4)
    playClips(true, [a])
    expect(madeFor(a)).toHaveLength(1)
  })

  test('forgetClip drops the decoded buffer so a replaced file is fetched again', async () => {
    const [a] = srcs('a')
    await clipsDuration([a])
    forgetClip(a)
    await clipsDuration([a])
    expect(vi.mocked(fetch).mock.calls.filter(c => c[0] === a)).toHaveLength(2)
  })
})

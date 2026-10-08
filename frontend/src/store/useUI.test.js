// @vitest-environment happy-dom
// useUI pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI, REST_ALERT_FOCUS_GAP_MS } from './useUI.js'
import { useStore } from './useStore.js'
import { beep, clipsDuration, holdFocus, playClips, stopClips } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), vibrate: vi.fn(), playClips: vi.fn(), stopClips: vi.fn(), holdFocus: vi.fn(() => () => {}),
  clipsDuration: vi.fn(() => Promise.resolve(0)), setAudioFocusHooks: vi.fn(), forgetClip: vi.fn(),
}))

// "Off" has to hold at the timer itself, not at the four places that start one — the same
// reason the rest-after-a-set rule is a shared condition rather than four copies.
describe('rest timer set to Off', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null }) })
  afterEach(() => { useUI.getState().stopRest(); vi.useRealTimers() })

  it('starts nothing', () => {
    useUI.getState().startRest(0)
    expect(useUI.getState().timer).toBe(null)
  })

  it('stops a rest that is already running', () => {
    useUI.getState().startRest(90)
    expect(useUI.getState().timer).not.toBe(null)
    useUI.getState().startRest(0)
    expect(useUI.getState().timer).toBe(null)
  })

  it('still runs for a real duration', () => {
    useUI.getState().startRest(90)
    expect(useUI.getState().timer.total).toBe(90)
  })
})

// A phone reclaims a backgrounded PWA or WebView by reloading it. The rest you were in the
// middle of has to come back with the page, still aimed at the same finish line.
describe('a rest survives a reload', () => {
  let originalS
  const reload = () => { useUI.setState({ timer: null }) }   // the page's memory, gone; storage stays
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    originalS = useStore.getState().S
    useStore.setState({ S: { ...originalS, active: { id: 'w1', entries: [] } } })
    useUI.getState().stopRest()
  })
  afterEach(() => { useUI.getState().stopRest(); useStore.setState({ S: originalS }); vi.useRealTimers() })

  it('picks the countdown back up where it is now, not where it was', () => {
    useUI.getState().startRest(90, 2, 'exercise')
    vi.advanceTimersByTime(30_000)
    reload()
    useUI.getState().resumeRest()
    expect(useUI.getState().timer).toMatchObject({ left: 60, total: 90, forIdx: 2, kind: 'exercise' })
    vi.advanceTimersByTime(60_000)
    expect(useUI.getState().timer).toBeNull()
  })

  it('keeps time added with +15s', () => {
    useUI.getState().startRest(60)
    useUI.getState().addRest(15)
    reload()
    useUI.getState().resumeRest()
    expect(useUI.getState().timer.left).toBe(75)
  })

  it('does not bring back a rest that was skipped, ran out, or belongs to another workout', () => {
    useUI.getState().startRest(60)
    useUI.getState().stopRest()
    useUI.getState().resumeRest()
    expect(useUI.getState().timer).toBeNull()

    useUI.getState().startRest(60)
    reload()
    vi.advanceTimersByTime(61_000)
    useUI.getState().resumeRest()
    expect(useUI.getState().timer).toBeNull()

    useUI.getState().startRest(60)
    reload()
    useStore.setState({ S: { ...originalS, active: { id: 'w2', entries: [] } } })
    useUI.getState().resumeRest()
    expect(useUI.getState().timer).toBeNull()
  })
})

// The alert has to LAND on zero, not start there: it is the end of the bell that marks the end
// of the rest. That makes its start time a function of how long the clips run, which is the one
// thing here that can be silently wrong — the sound still plays, just in the wrong place.
describe('rest alert lands on the end of the rest', () => {
  const CLIP_SECONDS = 14
  let originalSettings

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(clipsDuration).mockResolvedValue(CLIP_SECONDS)
    vi.mocked(playClips).mockClear()
    vi.mocked(stopClips).mockClear()
    vi.mocked(beep).mockClear()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: true } })
    useUI.setState({ timer: null })
  })
  afterEach(() => {
    useUI.getState().stopRest()
    useStore.setState({ S: originalSettings })
    vi.useRealTimers()
  })

  // The music is paused GAP before the bell, so the sequence starts that much earlier again:
  // the bell itself still ends on zero.
  const GAP = REST_ALERT_FOCUS_GAP_MS

  it('starts the clips their own length plus the pause gap before the rest ends', async () => {
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(0)          // let the duration lookup resolve

    await vi.advanceTimersByTimeAsync((90 - CLIP_SECONDS) * 1000 - GAP - 1)
    expect(playClips).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(playClips).toHaveBeenCalledTimes(1)
    expect(playClips.mock.calls[0][0]).toBe(true)  // gated on the sound setting
    expect(playClips.mock.calls[0][1]).toHaveLength(1)
    expect(playClips.mock.calls[0][2]).toEqual({ focusGap: 1500 })
  })

  it('does not start it again when the countdown reaches zero', async () => {
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(playClips).toHaveBeenCalledTimes(1)
    expect(useUI.getState().timer).toBe(null)
  })

  it('no longer beeps through the last seconds of a rest', async () => {
    useUI.getState().startRest(20)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(beep).not.toHaveBeenCalled()
  })

  it('fires immediately when the rest is shorter than the clips', async () => {
    useUI.getState().startRest(5)
    await vi.advanceTimersByTimeAsync(0)
    expect(playClips).toHaveBeenCalledTimes(1)
  })

  it('respects a mute that happened after the rest started', async () => {
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(0)
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    await vi.advanceTimersByTimeAsync((90 - CLIP_SECONDS) * 1000 - GAP)
    expect(playClips.mock.calls[0][0]).toBe(false)
  })

  it('skipping a rest before the alert begins cancels it', async () => {
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(0)
    useUI.getState().stopRest()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(playClips).not.toHaveBeenCalled()
  })

  it('re-times the alert when the rest is extended', async () => {
    useUI.getState().startRest(90)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)     // 30s left, alert not due yet
    expect(playClips).not.toHaveBeenCalled()

    useUI.getState().addRest(30)                  // 60s left now
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync((60 - CLIP_SECONDS) * 1000 - GAP - 1)
    expect(playClips).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(playClips).toHaveBeenCalledTimes(1)
  })
})

// The last set of an exercise rings the exercise-end sound with the same pause around it as the
// rest alert, and the rest between exercises starts counting when the sound starts.
describe('exercise-end sound', () => {
  let originalS
  // Stand-in for playClips: run onStart the way the real one does — after the gap, or at once.
  const playLikeReal = (enabled, clips, { focusGap, onStart } = {}) => {
    if (!enabled || !clips.length) onStart?.()
    else setTimeout(() => onStart?.(), focusGap)
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(playClips).mockReset().mockImplementation(playLikeReal)
    vi.mocked(stopClips).mockClear()
    originalS = useStore.getState().S
    useStore.setState({ S: { ...originalS, sound: true, active: { id: 'w1', entries: [] } } })
    useUI.getState().stopRest()
  })
  afterEach(() => {
    useUI.getState().stopRest()
    useStore.setState({ S: originalS })
    vi.mocked(playClips).mockReset()
    vi.useRealTimers()
  })

  it('plays its clip with the 1.5 s pause on both sides', () => {
    useUI.getState().endExercise(120, 3)
    expect(playClips).toHaveBeenCalledTimes(1)
    const [enabled, clips, opts] = playClips.mock.calls[0]
    expect(enabled).toBe(true)
    expect(clips).toHaveLength(1)
    expect(opts.focusGap).toBe(REST_ALERT_FOCUS_GAP_MS)
  })

  it('starts the rest between exercises when the sound starts, not when the set was ticked', async () => {
    useUI.getState().endExercise(120, 3)
    expect(useUI.getState().timer).toBe(null)
    await vi.advanceTimersByTimeAsync(REST_ALERT_FOCUS_GAP_MS)
    expect(useUI.getState().timer).toMatchObject({ left: 120, total: 120, forIdx: 3, kind: 'exercise' })
  })

  it('does not cut its own sound when that rest starts', async () => {
    useUI.getState().endExercise(120, 3)
    vi.mocked(stopClips).mockClear()
    await vi.advanceTimersByTimeAsync(REST_ALERT_FOCUS_GAP_MS)
    expect(stopClips).not.toHaveBeenCalled()
  })

  it('with sound off the rest starts at once', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().endExercise(90, 1)
    expect(useUI.getState().timer).toMatchObject({ total: 90, kind: 'exercise' })
  })

  it('rings with no rest after it for the last exercise or a session finished early', async () => {
    useUI.getState().endExercise(null)
    expect(playClips).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(useUI.getState().timer).toBe(null)
  })

  it('a rest skipped, replaced or a session ended during the pause owns the schedule', async () => {
    useUI.getState().endExercise(120, 3)
    useUI.getState().stopRest()
    await vi.advanceTimersByTimeAsync(REST_ALERT_FOCUS_GAP_MS)
    expect(useUI.getState().timer).toBe(null)

    useUI.getState().endExercise(120, 3)
    useUI.getState().startRest(60, 4, 'sets')
    await vi.advanceTimersByTimeAsync(REST_ALERT_FOCUS_GAP_MS)
    expect(useUI.getState().timer).toMatchObject({ total: 60, forIdx: 4, kind: 'sets' })
    useUI.getState().stopRest()

    useUI.getState().endExercise(120, 3)
    useStore.setState({ S: { ...useStore.getState().S, active: null } })
    await vi.advanceTimersByTimeAsync(REST_ALERT_FOCUS_GAP_MS)
    expect(useUI.getState().timer).toBe(null)
  })
})

describe('opt-in timer screen flash', () => {
  let originalSettings

  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: false } })
    useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  })

  afterEach(() => {
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    useStore.setState({ S: originalSettings })
    vi.useRealTimers()
  })

  it('stays off unless enabled in Settings', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(0)
  })

  it('flashes when the rest timer finishes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })

  it('flashes when a timed exercise finishes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })
})

// The work countdown's beeps are known in advance: the music is paused 1.5 s before the "3", so
// the beeps land on time, and the hold goes as soon as the set is over — or abandoned.
describe('work countdown audio focus', () => {
  let off
  beforeEach(() => {
    vi.useFakeTimers()
    off = vi.fn()
    vi.mocked(holdFocus).mockReset().mockImplementation(() => off)
    useStore.setState({ S: { ...useStore.getState().S, sound: true } })
  })
  afterEach(() => {
    useUI.getState().stopWork()
    vi.useRealTimers()
  })

  it('pauses the music 1.5 s before the countdown reaches 3, and lets go when the set ends', () => {
    useUI.getState().startWork(30, 'Plank', vi.fn())
    vi.advanceTimersByTime(30000 - 3500 - REST_ALERT_FOCUS_GAP_MS - 1)
    expect(holdFocus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(holdFocus).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('a set shorter than the lead pauses at once; abandoning it lets go', () => {
    useUI.getState().startWork(3, 'Plank', vi.fn())
    vi.advanceTimersByTime(0)
    expect(holdFocus).toHaveBeenCalledTimes(1)
    useUI.getState().stopWork()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('takes nothing with sound off, and nothing after an early stop', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startWork(3, 'Plank', vi.fn())
    vi.advanceTimersByTime(0)
    useStore.setState({ S: { ...useStore.getState().S, sound: true } })
    useUI.getState().startWork(30, 'Plank', vi.fn())
    useUI.getState().stopWork()
    vi.advanceTimersByTime(60000)
    expect(holdFocus).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { soundFileProblem, soundDurationProblem, MAX_SOUND_BYTES, MAX_SOUND_SECONDS } from './custom-sound.js'

describe('soundFileProblem', () => {
  it('accepts an ordinary audio file', () => {
    expect(soundFileProblem({ name: 'bell.mp3', type: 'audio/mpeg', size: 40_000 })).toBe(null)
  })

  // Android file pickers often hand over an empty MIME type; the extension has to be enough.
  it('accepts a known audio extension when the type is missing', () => {
    expect(soundFileProblem({ name: 'Grabación 12.m4a', type: '', size: 40_000 })).toBe(null)
  })

  it('refuses something that is not audio', () => {
    expect(soundFileProblem({ name: 'photo.jpg', type: 'image/jpeg', size: 40_000 })).toBe('not-audio')
    expect(soundFileProblem({})).toBe('not-audio')
  })

  it('refuses an empty or oversized file', () => {
    expect(soundFileProblem({ name: 'a.mp3', type: 'audio/mpeg', size: 0 })).toBe('empty')
    expect(soundFileProblem({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_SOUND_BYTES + 1 })).toBe('too-big')
  })
})

// The alert is scheduled to END on zero, so its length decides when it starts. A clip that
// cannot be measured (0) would silently fire late; one that is too long would fire at once.
describe('soundDurationProblem', () => {
  it('accepts a short clip, up to the limit', () => {
    expect(soundDurationProblem(2.4)).toBe(null)
    expect(soundDurationProblem(MAX_SOUND_SECONDS)).toBe(null)
  })

  it('refuses a clip it could not measure', () => {
    expect(soundDurationProblem(0)).toBe('unreadable')
    expect(soundDurationProblem(NaN)).toBe('unreadable')
  })

  it('refuses a clip longer than the limit', () => {
    expect(soundDurationProblem(MAX_SOUND_SECONDS + 0.5)).toBe('too-long')
  })
})

// The native build mirrors each picked sound to a file because the WebView's IndexedDB can come
// back empty after an app update. jsdom has no IndexedDB at all, which is exactly that case.
describe('sound mirror', () => {
  const fresh = async () => {
    vi.resetModules()
    return import('./custom-sound.js')
  }
  const record = { name: 'campana.mp3', type: 'audio/mpeg', data: new Uint8Array([1, 2, 3]).buffer }
  const mirrorOf = saved => ({
    read: vi.fn(async key => saved[key] || null),
    has: vi.fn(async key => key in saved),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  })

  const realCreate = URL.createObjectURL
  beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:mirror') })
  afterEach(() => { URL.createObjectURL = realCreate })

  it('brings the sound back from the mirror when IndexedDB has nothing', async () => {
    const m = await fresh()
    const mirror = mirrorOf({ 'rest-end': record })
    m.setSoundMirror(mirror)
    await expect(m.restSound.load()).resolves.toBe('campana.mp3')
    expect(mirror.read).toHaveBeenCalledWith('rest-end')
    expect(m.restSound.clips()).toEqual(['blob:mirror'])
  })

  it('keeps each slot apart', async () => {
    const m = await fresh()
    m.setSoundMirror(mirrorOf({ progress: record }))
    await expect(m.restSound.load()).resolves.toBe(null)
    await expect(m.progressSound.load()).resolves.toBe('campana.mp3')
  })

  it('falls back to the default when the mirror has nothing either', async () => {
    const m = await fresh()
    m.setSoundMirror(mirrorOf({}))
    await expect(m.exerciseEndSound.load()).resolves.toBe(null)
    expect(m.exerciseEndSound.clips()).toHaveLength(1)   // the bundled bells
  })

  it('never rejects, even when the mirror throws', async () => {
    const m = await fresh()
    m.setSoundMirror({ read: async () => { throw new Error('boom') }, has: async () => false, write: async () => {}, remove: async () => {} })
    await expect(m.restSound.load()).resolves.toBe(null)
  })

  it('without a mirror (web build) loads the default as before', async () => {
    const m = await fresh()
    await expect(m.restSound.load()).resolves.toBe(null)
  })
})

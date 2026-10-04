import { describe, it, expect, vi } from 'vitest'
import { deviceClass, lockFor, applyOrientationLock } from './orientation-lock.js'

describe('deviceClass', () => {
  it('treats phones as phones in either orientation', () => {
    expect(deviceClass(390, 844)).toBe('phone')
    expect(deviceClass(844, 390)).toBe('phone')
    expect(deviceClass(360, 800)).toBe('phone')
  })

  it('treats a 600px short side and up as a tablet in either orientation', () => {
    expect(deviceClass(600, 960)).toBe('tablet')
    expect(deviceClass(1280, 800)).toBe('tablet')
    expect(deviceClass(820, 1180)).toBe('tablet')
  })

  it('does not flip a phone to tablet just because it is held sideways', () => {
    expect(deviceClass(932, 430)).toBe('phone')
  })

  it('falls back to phone on missing or nonsense sizes', () => {
    expect(deviceClass(0, 0)).toBe('phone')
    expect(deviceClass(undefined, 800)).toBe('phone')
    expect(deviceClass(NaN, NaN)).toBe('phone')
  })
})

describe('lockFor', () => {
  it('locks phones to portrait and tablets to landscape', () => {
    expect(lockFor(390, 844)).toBe('portrait')
    expect(lockFor(1280, 800)).toBe('landscape')
  })
})

describe('applyOrientationLock', () => {
  it('asks the API for the device orientation and reports it', async () => {
    const lock = vi.fn().mockResolvedValue(undefined)
    expect(await applyOrientationLock({ width: 800, height: 1280, orientation: { lock } })).toBe('landscape')
    expect(lock).toHaveBeenCalledWith('landscape')
    expect(await applyOrientationLock({ width: 390, height: 844, orientation: { lock } })).toBe('portrait')
  })

  it('returns null when the browser refuses the lock', async () => {
    const lock = vi.fn().mockRejectedValue(new Error('NotSupportedError'))
    expect(await applyOrientationLock({ width: 390, height: 844, orientation: { lock } })).toBeNull()
  })

  it('returns null when the API does not exist', async () => {
    expect(await applyOrientationLock({ width: 390, height: 844 })).toBeNull()
    expect(await applyOrientationLock({ width: 390, height: 844, orientation: {} })).toBeNull()
    expect(await applyOrientationLock(undefined)).toBeNull()
  })
})

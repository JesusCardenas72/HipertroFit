import { describe, expect, it } from 'vitest'
import { isNewer, parseManifest } from './app-update.js'

const BASE = 'https://example.github.io/HipertroFit/version.json'
const SHA = 'a'.repeat(64)
const ok = { versionCode: 27, versionName: '2.5.0', apk: 'HipertroFit.apk', sha256: SHA, size: 8000000 }

describe('parseManifest', () => {
  it('resolves the APK next to version.json and busts the CDN cache with the versionCode', () => {
    const m = parseManifest(ok, BASE)
    expect(m).toEqual({
      versionCode: 27,
      versionName: '2.5.0',
      url: 'https://example.github.io/HipertroFit/HipertroFit.apk?v=27',
      sha256: SHA,
      size: 8000000,
    })
  })

  it('rejects anything that is not a complete manifest', () => {
    expect(parseManifest(null, BASE)).toBeNull()
    expect(parseManifest('27', BASE)).toBeNull()
    expect(parseManifest({ ...ok, versionCode: 0 }, BASE)).toBeNull()
    expect(parseManifest({ ...ok, versionCode: '2.5' }, BASE)).toBeNull()
    expect(parseManifest({ ...ok, apk: '' }, BASE)).toBeNull()
    expect(parseManifest({ ...ok, sha256: 'abc' }, BASE)).toBeNull()
  })

  it('refuses an APK served over plain http', () => {
    expect(parseManifest({ ...ok, apk: 'http://evil.example/x.apk' }, BASE)).toBeNull()
  })

  it('accepts a numeric string versionCode and an upper-case hash', () => {
    const m = parseManifest({ ...ok, versionCode: '28', sha256: SHA.toUpperCase() }, BASE)
    expect(m.versionCode).toBe(28)
    expect(m.sha256).toBe(SHA)
  })
})

describe('isNewer', () => {
  const m = parseManifest(ok, BASE)
  it('compares versionCodes, as Android does', () => {
    expect(isNewer(m, '26')).toBe(true)
    expect(isNewer(m, 26)).toBe(true)
    expect(isNewer(m, '27')).toBe(false)
    expect(isNewer(m, '30')).toBe(false)
  })
  it('is false without a manifest or an installed build', () => {
    expect(isNewer(null, '26')).toBe(false)
    expect(isNewer(m, null)).toBe(false)
    expect(isNewer(m, 'web')).toBe(false)
  })
})

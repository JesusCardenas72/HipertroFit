// Self-update of the sideloaded Android APK — the mobile counterpart of the desktop app's
// electron-updater. `npm run publicar` (scripts/publicar.mjs) builds the APK and pushes it, with
// a version.json beside it, to the repository's gh-pages branch, which GitHub Pages serves at
// UPDATE_URL. On every launch and every return to the foreground the app reads that file; when
// it names a higher versionCode than the installed one, the APK is downloaded in the background
// (AppUpdatePlugin.java) and the user is offered the system installer.
//
// Android never lets an app replace itself silently: the last step is always the system's own
// "Update this app?" dialog. Data survives it — same package, same signing key.
import { MOBILE } from './mobile.js'

/** Where the published version.json lives; '' disables the check (see package.json). */
export const UPDATE_URL = typeof __UPDATE_URL__ === 'string' ? __UPDATE_URL__ : ''

/**
 * The published manifest, validated. Anything malformed is null — a half-written or foreign
 * file must never be taken for an update.
 */
export function parseManifest(json, base = UPDATE_URL) {
  if (!json || typeof json !== 'object') return null
  const code = Number(json.versionCode)
  if (!Number.isInteger(code) || code <= 0) return null
  if (typeof json.apk !== 'string' || !json.apk) return null
  if (typeof json.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(json.sha256)) return null
  let url
  try { url = new URL(json.apk, base || undefined) } catch (e) { return null }
  if (url.protocol !== 'https:') return null
  // The versionCode in the query busts the Pages CDN, which caches the fixed APK name.
  url.searchParams.set('v', String(code))
  return {
    versionCode: code,
    versionName: typeof json.versionName === 'string' ? json.versionName : String(code),
    url: url.href,
    sha256: json.sha256.toLowerCase(),
    size: Number(json.size) || 0,
  }
}

/** True when the manifest is an update for an install at build `installed` (its versionCode). */
export function isNewer(manifest, installed) {
  if (!manifest || installed == null || installed === '') return false
  const cur = Number(installed)
  return Number.isFinite(cur) && manifest.versionCode > cur
}

// --- runtime (mobile build only) -------------------------------------------------------------

let once = null
function plugin() {
  if (!MOBILE) return Promise.resolve(null)
  if (!once) {
    once = import('@capacitor/core')
      .then(core => core.Capacitor.getPlatform() === 'android' ? { plugin: core.registerPlugin('AppUpdate') } : null)
      .catch(() => null)
  }
  return once   // a box, never the bare plugin — see androidPluginBox() in mobile.js
}

/** Installed versionCode, or null off Android. */
async function installedBuild() {
  try {
    const { App } = await import('@capacitor/app')
    return (await App.getInfo()).build
  } catch (e) { return null }
}

/**
 * What the published version.json says about this install. Never throws:
 *   { status: 'off' }               not Android, or no UPDATE_URL in this build
 *   { status: 'current' }           the published version is not newer
 *   { status: 'update', update }    a newer APK (parseManifest's shape)
 *   { status: 'error' }             offline, or the file was missing or malformed
 */
export async function checkForUpdate() {
  if (!UPDATE_URL || !(await plugin())) return { status: 'off' }
  try {
    const res = await fetch(UPDATE_URL + (UPDATE_URL.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return { status: 'error' }
    const manifest = parseManifest(await res.json())
    if (!manifest) return { status: 'error' }
    return isNewer(manifest, await installedBuild()) ? { status: 'update', update: manifest } : { status: 'current' }
  } catch (e) { return { status: 'error' } }
}

/**
 * Downloads the APK into the app's cache and checks it (hash, package, versionCode).
 * Resolves true when it is ready to install; an already-downloaded copy is reused.
 * `onProgress` gets the percentage (−1 when the size is unknown).
 */
export async function downloadUpdate(manifest, onProgress) {
  const p = (await plugin())?.plugin
  if (!p) return false
  const sub = onProgress ? await p.addListener('progress', e => onProgress(e.percent)).catch(() => null) : null
  try {
    await p.download({ url: manifest.url, sha256: manifest.sha256, versionCode: manifest.versionCode })
    return true
  } catch (e) { return false } finally { sub?.remove() }
}

/**
 * Hands the downloaded APK to the system installer. The first time, Android first asks to
 * allow HipertroFit to install apps; the plugin opens that screen and carries on once it is
 * granted. Resolves false when it could not get that far.
 */
export async function installUpdate() {
  const p = (await plugin())?.plugin
  if (!p) return false
  try { await p.install(); return true } catch (e) { return false }
}

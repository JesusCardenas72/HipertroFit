// Orientation policy: a phone stays upright, a tablet stays on its side.
//
// "Tablet" is the same line Android draws for its sw600dp resource qualifier: the SHORT side
// of the physical screen is at least 600 CSS px. The short side does not change when the
// device rotates, so a phone held sideways is still a phone — unlike comparing against the
// viewport width, which would call it a tablet the moment it turned.
//
// Native shells enforce this themselves (MainActivity.java for Android, Info.plist for iOS —
// keep the 600 there in step). This file covers the installed web app (PWA), where the
// manifest can only name one orientation for every device and so cannot express the rule.

export const TABLET_MIN_SHORT_SIDE = 600

/** 'tablet' | 'phone' from the physical screen size in CSS px. Unknown sizes count as phone. */
export function deviceClass(width, height) {
  const w = Number(width), h = Number(height)
  if (!(w > 0) || !(h > 0)) return 'phone'
  return Math.min(w, h) >= TABLET_MIN_SHORT_SIDE ? 'tablet' : 'phone'
}

/** The Screen Orientation API lock type for that device: 'portrait' or 'landscape'. */
export function lockFor(width, height) {
  return deviceClass(width, height) === 'tablet' ? 'landscape' : 'portrait'
}

/**
 * Lock the screen to its device's orientation. Best effort: browsers only honour it for an
 * installed, standalone/fullscreen web app (and not at all on iOS Safari), and reject it
 * elsewhere — a rejection or a missing API is simply "stay unlocked", never an error.
 * `scr` is injectable for tests.
 */
export async function applyOrientationLock(scr = globalThis.screen) {
  if (!scr || !scr.orientation || typeof scr.orientation.lock !== 'function') return null
  const type = lockFor(scr.width, scr.height)
  try {
    await scr.orientation.lock(type)
    return type
  } catch {
    return null
  }
}

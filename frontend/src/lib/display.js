// How big the app is drawn on this device: the whole interface (`ui`) and, on top of it, the
// text (`text`), both in percent of the normal size. Kept per device in localStorage, not in the
// synced state: a phone and a tablet signed in to the same account want different sizes.
//
// The interface is scaled the way pinch-zoom would, not by multiplying lengths: on a phone the
// viewport meta tag is rewritten so the page lays out on a narrower (or wider) screen and the
// browser draws it larger (or smaller). Everything — vh, touches, drags — stays in one set of
// pixels that way. A desktop browser ignores that tag, so there the root gets CSS `zoom`, and
// `--ui-zoom` lets the stylesheet's viewport units (`--vh`, `--dvh`) undo it.
//
// Text is a multiplier, `--fs`, that every font size in index.css is written against.

export const UI_SCALE = { min: 85, max: 120, step: 5 }
export const TEXT_SCALE = { min: 85, max: 130, step: 5 }
export const DEFAULT_DISPLAY = { ui: 100, text: 100 }
const KEY = 'gym_display_v1'

/** A percentage snapped onto `range`'s steps and kept inside it; anything unreadable is 100. */
export function clampScale(v, range) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 100
  const snapped = Math.round(n / range.step) * range.step
  return Math.min(range.max, Math.max(range.min, snapped))
}

/** Stored settings read back safely: missing or broken values fall back to normal size. */
export function cleanDisplay(x) {
  return { ui: clampScale(x?.ui ?? 100, UI_SCALE), text: clampScale(x?.text ?? 100, TEXT_SCALE) }
}

/**
 * The viewport meta content that draws the page at `scale` (1 = normal) on a screen `width` CSS
 * pixels wide at normal size: laid out `width / scale` wide and shown at `scale`, pinned there.
 * At 1 it is the app's own tag (index.html), exactly.
 */
export function viewportContent(scale, width) {
  if (scale === 1 || !(width > 0)) return 'width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no'
  const s = +scale.toFixed(2)
  return `width=${Math.round(width / s)},initial-scale=${s},minimum-scale=${s},maximum-scale=${s},viewport-fit=cover,user-scalable=no`
}

export function loadDisplay() {
  try { return cleanDisplay(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return { ...DEFAULT_DISPLAY } }
}

export function saveDisplay(d) {
  const clean = cleanDisplay(d)
  try {
    if (clean.ui === 100 && clean.text === 100) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(clean))
  } catch { /* private mode: it still applies for this visit */ }
  applyDisplay(clean)
  return clean
}

// The screen's width in CSS pixels at normal size — what `device-width` means — read off the
// visual viewport, which knows both how wide it is and how far it is zoomed.
const screenWidth = () => {
  const vv = window.visualViewport
  return vv ? vv.width * vv.scale : window.innerWidth
}

let current = { ...DEFAULT_DISPLAY }
let listening = false

// Touch screens without hover are the browsers that honour the viewport tag (phones, tablets,
// the Capacitor shells); a mouse-driven desktop browser ignores it.
const honoursViewport = () => !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches

function applyUi(scale) {
  const de = document.documentElement
  const meta = document.querySelector('meta[name="viewport"]')
  const tag = meta && honoursViewport()
  if (meta) meta.setAttribute('content', viewportContent(tag ? scale : 1, screenWidth()))
  const z = tag ? 1 : scale
  de.style.zoom = z === 1 ? '' : String(z)
  de.style.setProperty('--ui-zoom', String(z))
}

/** Draws the app at `d` ({ ui, text } in percent). Safe to call before the first render. */
export function applyDisplay(d = current) {
  current = cleanDisplay(d)
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--fs', String(current.text / 100))
  applyUi(current.ui / 100)
  // Turning the phone changes how wide the screen is: back to the plain tag to measure it, then
  // the scaled one worked out again.
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('orientationchange', () => {
      if (current.ui === 100 || !honoursViewport()) return
      document.querySelector('meta[name="viewport"]')?.setAttribute('content', viewportContent(1))
      setTimeout(() => applyUi(current.ui / 100), 300)
    })
  }
}

// Which plates go on each side of the bar for a given total.
//
// A barbell set is logged as the total on the bar; loading it means subtracting the bar and
// splitting the rest into pairs of the plates the gym actually has, heaviest first. Greedy works
// for every real plate set (each plate is at least half the next one up), and what cannot be made
// with the smallest plate is reported, not rounded away — the weight logged stays what was asked.

/** Every plate the settings offer, heaviest first. */
export const PLATE_CHOICES = {
  kg: [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5],
  lb: [55, 45, 35, 25, 10, 5, 2.5, 1.25],
}
/** The plates assumed until the user picks: a standard gym's. */
export const DEFAULT_PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
}
// Bar weight by the catalogue's equipment value. The straight bars follow the user's setting.
const BARS = {
  kg: { barbell: 20, 'olympic barbell': 20, 'ez barbell': 10, 'trap bar': 25 },
  lb: { barbell: 45, 'olympic barbell': 45, 'ez barbell': 25, 'trap bar': 55 },
}
const STRAIGHT = ['barbell', 'olympic barbell']

const unitOf = S => (S && S.unit === 'lb' ? 'lb' : 'kg')
const r2 = v => Math.round(v * 100) / 100

/** Whether an exercise is loaded with plates on a bar. */
export const isPlateLoaded = ex => !!ex && Object.prototype.hasOwnProperty.call(BARS.kg, ex.eq)

/** The bar an exercise is loaded on, in the profile's unit. */
export function barFor(S, ex) {
  const u = unitOf(S)
  if (!isPlateLoaded(ex)) return null
  const own = Number(S && S.barWeight)
  if (STRAIGHT.includes(ex.eq) && own > 0) return own
  return BARS[u][ex.eq]
}

/** The plates the profile has, heaviest first. */
export function platesOf(S) {
  const u = unitOf(S)
  const own = Array.isArray(S && S.plateSet) ? S.plateSet.map(Number).filter(p => PLATE_CHOICES[u].includes(p)) : null
  return (own && own.length ? own : DEFAULT_PLATES[u]).slice().sort((a, b) => b - a)
}

/**
 * Plates per side for `total` on a `bar`: { side: [25, 10, 2.5], rest, short }.
 * `rest` is what is left per side that no plate makes (0 when it loads exactly); `short` says the
 * total is below the empty bar. Plates repeat as needed.
 */
export function loadBar(total, bar, plates) {
  const T = Number(total) || 0
  if (T < bar - 1e-9) return { side: [], rest: 0, short: true }
  let left = r2((T - bar) / 2)
  const side = []
  for (const p of plates) {
    while (left >= p - 1e-9) { side.push(p); left = r2(left - p) }
  }
  return { side, rest: left, short: false }
}

/** loadBar for an exercise and a profile: null when the exercise is not plate-loaded. */
export function platesFor(S, ex, total) {
  const bar = barFor(S, ex)
  if (bar == null) return null
  return { bar, ...loadBar(total, bar, platesOf(S)) }
}

/** "25 + 10 + 2,5" — the plates of one side grouped, "2 × 20 + 5" when a plate repeats. */
export function sideLabel(side, fmt = String) {
  const out = []
  for (const p of side) {
    const last = out[out.length - 1]
    if (last && last.p === p) last.n++
    else out.push({ p, n: 1 })
  }
  return out.map(x => (x.n > 1 ? x.n + ' × ' : '') + fmt(x.p)).join(' + ')
}

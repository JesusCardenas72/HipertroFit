// A date typed by hand, in the order the language writes dates: 21/10/2026 in Spanish,
// 10/21/2026 in American English, 2026/10/21 in Chinese. The value underneath is always the
// ISO day (YYYY-MM-DD) the rest of the app stores — see components/ui.jsx DateField, which
// pairs this with the system's calendar.

const pad = n => String(n).padStart(2, '0')

/** The order `locale` writes day, month and year in, and the separator between them. */
export function dateOrder(locale) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(2026, 9, 21))
    const order = parts.filter(p => p.type === 'day' || p.type === 'month' || p.type === 'year').map(p => p.type)
    const lit = parts.find(p => p.type === 'literal')
    if (order.length === 3) return { order, sep: lit ? lit.value.trim() || '/' : '/' }
  } catch { /* unknown locale */ }
  return { order: ['day', 'month', 'year'], sep: '/' }
}

/** The ISO day written the way `fmt` ({ order, sep }) reads it; '' for no date. */
export function formatDay(iso, fmt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return ''
  const v = { year: m[1], month: m[2], day: m[3] }
  return fmt.order.map(k => v[k]).join(fmt.sep)
}

/**
 * What was typed, as an ISO day — or null while it isn't one yet (unfinished, or a day that
 * doesn't exist, like 31/02). Any non-digit separates the numbers; a two-digit year is 20xx.
 */
export function parseDay(text, fmt) {
  const nums = String(text || '').split(/\D+/).filter(Boolean)
  if (nums.length !== 3) return null
  const v = {}
  fmt.order.forEach((k, i) => { v[k] = Number(nums[i]) })
  if (String(nums[fmt.order.indexOf('year')]).length === 2) v.year += 2000
  const { year, month, day } = v
  if (!(year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1)) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

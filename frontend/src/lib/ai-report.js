// AI analysis reports as they are kept in state, and the bits of the server exchange worth testing.
//
// A report is what POST /api/ai/analyze answered, stamped with the day, the focus and where it
// came from, so an old one still says which model wrote it. Only the last few are kept (S.aiReports,
// newest first): they are a reading aid, not a log, and they travel with the synced state.

/** Reports kept in state. */
export const MAX_REPORTS = 5

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const rows = (v, fields) => (Array.isArray(v) ? v : [])
  .filter(x => x && typeof x === 'object')
  .slice(0, 20)
  .map(x => Object.fromEntries(fields.map(f => [f, str(x[f], 600)])))

/**
 * The stored report for a server response. Re-validated here even though the server already
 * cleaned it: the state is also written by older and newer app versions and by backup imports.
 */
export function reportOf(res, { focus = 'overview', date, id } = {}) {
  const a = (res && res.answer) || {}
  return {
    id: id || String(Date.now()),
    d: date,
    focus,
    host: str(res && res.host, 120),
    model: str(res && res.model, 120),
    summary: str(a.summary, 6000),
    alerts: rows(a.alerts, ['type', 'target', 'detail']),
    suggestions: rows(a.suggestions, ['action', 'target', 'group', 'reason']),
    structured: a.structured !== false,
  }
}

/** Prepend a report, keeping the newest MAX_REPORTS. Never mutates. */
export const addReport = (list, report) => [report, ...(Array.isArray(list) ? list : [])].slice(0, MAX_REPORTS)

/** Drop one report by id. */
export const removeReport = (list, id) => (Array.isArray(list) ? list : []).filter(r => r && r.id !== id)

/**
 * A request failure as an i18n key. The server relay (api/ai.js) and the direct call
 * (lib/ai-provider.js) both only raise categories, so the mapping is closed; anything else —
 * offline, a proxy page — is the generic one.
 */
export function aiErrorKey(err) {
  const msg = err && err.message
  const status = err && err.status
  if (msg === 'daily ai limit reached') return 'You have used today\'s AI analyses.'
  if (msg === 'ai provider rate limit reached') return 'The AI provider is busy or over its free limit. Try again later.'
  if (msg === 'ai provider rejected the key') return 'The AI provider rejected the server key. Ask the administrator.'
  if (msg === 'analysis already running') return 'An analysis is already running.'
  // Only the bring-your-own-key path (lib/ai-provider.js) raises these.
  if (msg === 'ai provider rejected your key') return 'The provider rejected your API key. Check it in the provider settings.'
  if (msg === 'ai provider unreachable') return 'Could not reach the provider. Check the URL, your connection and, for Ollama, OLLAMA_ORIGINS.'
  if (msg === 'ai model not found') return 'The provider does not know that model. Check the model name.'
  if (status === 504) return 'The AI provider took too long to answer.'
  if (status === 404) return 'AI analysis is not configured on this server.'
  return 'The analysis could not be completed. Try again later.'
}

/**
 * Extra privacy notice for a provider host: `{ key, tone }` (an i18n key; 'warn' or 'ok'), or null.
 * Google's free Gemini tier may use what is sent to improve its products; a local model sends
 * nothing anywhere — "this server" through the relay, "this device" when called directly.
 */
export function providerNotice(host, { direct = false } = {}) {
  const h = String(host || '').toLowerCase()
  if (!h) return null
  if (/(^|\.)googleapis\.com(:|$)/.test(h)) return { key: "Google's free Gemini tier may use what you send to improve its products.", tone: 'warn' }
  if (/^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+(:\d+)?$)/.test(h)) {
    return direct
      ? { key: 'Processed by a model on this device — nothing leaves it.', tone: 'ok' }
      : { key: 'Processed on a model hosted by this server — nothing leaves it.', tone: 'ok' }
  }
  return null
}

/** Human label for a suggestion action key, as an i18n key. Unknown actions fall back to "Other". */
export const ACTION_KEY = {
  increase_weight: 'Increase weight',
  add_set: 'Add a set',
  reduce_volume: 'Reduce volume',
  add_volume: 'Add volume',
  deload: 'Deload',
  swap_exercise: 'Swap exercise',
  keep: 'Keep as is',
  other: 'Other',
}
export const actionKey = action => ACTION_KEY[action] || ACTION_KEY.other

// "Bring your own key": the AI analysis called straight from the browser, for guests, for the mobile
// app on its own and for any server without a provider configured (phase three).
//
// Same wire format as the server relay (api/ai.js): the OpenAI-compatible /chat/completions
// endpoint, plain fetch, no SDK. Every listed provider answers a browser preflight
// (Access-Control-Allow-Origin), so no proxy is involved — the request goes from this device to the
// provider and nowhere else. Ollama is the exception that needs OLLAMA_ORIGINS set on its side.
//
// The key is the user's, so it is handled like the Hevy import key: never part of the synced state
// (S), never in a backup export. Provider, URL and model are remembered on this device; the key is
// only written to localStorage when the user asks for it ("Remember on this device"), otherwise it
// lives in this module until the page is reloaded.
//
// callProvider/parseAnswer deliberately mirror api/ai.js — the api image cannot import from the
// frontend and vice versa. ai-provider.test.js runs both parsers on the same inputs to keep them
// from drifting.

/** Presets. `model` is a starting point the user can change; `keyUrl` is where a key is created. */
export const PROVIDERS = [
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', keyUrl: 'https://console.groq.com/keys' },
  { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: '', modelHint: 'model-id:free', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'ollama', name: 'Ollama', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b', noKey: true },
  { id: 'custom', name: 'Custom', base: '', model: '' },
]
export const providerById = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[PROVIDERS.length - 1]

export const BYOK_STORAGE = 'gym_ai_byok_v1'
const MAX_PROMPT = 40000
const TIMEOUT_MS = 90000

let sessionKey = ''   // the key when it is not remembered — gone on reload

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A config object with every field present and trimmed. */
export function normalizeByok(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const provider = providerById(r.provider).id
  return {
    provider,
    base: str(r.base, 300).replace(/\/+$/, ''),
    model: str(r.model, 200),
    key: str(r.key, 400),
    // Whether this config was saved with a key. A key that was not remembered is gone after a
    // reload, and the config must then ask for it again rather than call the provider without one.
    keyed: r.keyed === true || !!str(r.key, 400),
    remember: r.remember === true,
    jsonMode: r.jsonMode !== false,
  }
}

/**
 * Why a base URL cannot be used, as an i18n key, or null. https only — a key sent over plain
 * http is readable on the way — except to this device itself, which is where a local Ollama is.
 */
export function baseUrlError(base) {
  let u
  try { u = new URL(base) } catch { return 'Enter the provider URL.' }
  if (u.username || u.password) return 'The URL must not contain credentials.'
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return null
  return 'Use an https:// URL (plain http only works for localhost).'
}

/** Whether a config can be used to analyze: valid URL, a model, and a key unless the preset needs none. */
export function byokReady(cfg) {
  const c = normalizeByok(cfg)
  if (baseUrlError(c.base) || !c.model) return false
  if (c.key) return true
  return !c.keyed && (!!providerById(c.provider).noKey || c.provider === 'custom')
}

/** The config remembered on this device, with the session key filled in when none was stored. */
export function loadByok(storage = globalThis.localStorage) {
  let stored = null
  try { stored = JSON.parse(storage.getItem(BYOK_STORAGE)) } catch { stored = null }
  if (!stored) return null
  const c = normalizeByok(stored)
  if (!c.key && sessionKey) c.key = sessionKey
  return c
}

/** Remember a config. The key is persisted only with `remember`; otherwise it stays in memory. */
export function saveByok(cfg, storage = globalThis.localStorage) {
  const c = normalizeByok(cfg)
  sessionKey = c.key
  const persisted = c.remember ? c : { ...c, key: '' }
  try { storage.setItem(BYOK_STORAGE, JSON.stringify(persisted)) } catch { /* storage blocked: session only */ }
  return c
}

/** Forget the provider and the key, stored and in memory. */
export function clearByok(storage = globalThis.localStorage) {
  sessionKey = ''
  try { storage.removeItem(BYOK_STORAGE) } catch { /* ignore */ }
}

export const hostOf = base => { try { return new URL(base).host } catch { return '' } }

const SYSTEM = 'You are a strength and hypertrophy coach inside a gym tracker. Base every statement on the data you are given. Reply with a single JSON object: {"summary": string, "alerts": [{"type": string, "target": string, "detail": string}], "suggestions": [{"action": string, "target": string, "group": string, "reason": string}]}.'

/** The chat-completions request body — the same one the server relay sends. */
export function providerRequest(cfg, prompt) {
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    temperature: 0.3,
  }
  if (cfg.jsonMode) body.response_format = { type: 'json_object' }
  return body
}

const cap = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v, fields, max) => (Array.isArray(v) ? v : [])
  .filter(x => x && typeof x === 'object')
  .slice(0, max)
  .map(x => Object.fromEntries(fields.map(f => [f, cap(x[f], 600)])))
  .filter(x => Object.values(x).some(Boolean))

/** The model's text as `{ summary, alerts, suggestions, structured }` — mirror of api/ai.js. */
export function parseAnswer(text) {
  const raw = String(text || '').trim()
  let obj = null
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { obj = JSON.parse(raw.slice(start, end + 1)) } catch { obj = null }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { summary: cap(raw, 6000), alerts: [], suggestions: [], structured: false }
  }
  return {
    summary: cap(obj.summary, 6000),
    alerts: list(obj.alerts, ['type', 'target', 'detail'], 20),
    suggestions: list(obj.suggestions, ['action', 'target', 'group', 'reason'], 20),
    structured: true,
  }
}

// Errors carry the same messages the server relay answers with, so lib/ai-report.js aiErrorKey
// explains both paths with one table.
const fail = (status, message) => Object.assign(new Error(message), { status })

/**
 * Call the provider from this device. Resolves in the shape POST /api/ai/analyze answers with
 * (`{ answer, usage, host, model }`), so the sheet stores both the same way.
 */
export async function callProvider(cfg, prompt, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const c = normalizeByok(cfg)
  if (baseUrlError(c.base) || !c.model) throw fail(400, 'ai not configured')
  if (!prompt || prompt.length > MAX_PROMPT) throw fail(400, 'prompt too long')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let r
  try {
    r = await fetchImpl(c.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: 'Bearer ' + c.key } : {}) },
      body: JSON.stringify(providerRequest(c, prompt)),
      signal: ctrl.signal,
    })
  } catch (e) {
    // A CORS refusal and a closed port look identical from here: both are a TypeError.
    throw ctrl.signal.aborted ? fail(504, 'ai provider timed out') : fail(502, 'ai provider unreachable')
  } finally {
    clearTimeout(timer)
  }
  const text = await r.text().catch(() => '')
  if (!r.ok) {
    if (r.status === 429) throw fail(429, 'ai provider rate limit reached')
    if (r.status === 401 || r.status === 403) throw fail(401, 'ai provider rejected your key')
    if (r.status === 404) throw fail(502, 'ai model not found')
    throw fail(502, 'ai provider error')
  }
  let data
  try { data = JSON.parse(text) } catch { throw fail(502, 'ai provider returned invalid JSON') }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw fail(502, 'ai provider returned no answer')
  const u = data.usage || {}
  return {
    answer: parseAnswer(content),
    usage: { prompt_tokens: +u.prompt_tokens || null, completion_tokens: +u.completion_tokens || null },
    host: hostOf(c.base),
    model: c.model,
  }
}

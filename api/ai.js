/* AI analysis relay — phase two of the "Analyze with AI" feature.

   The browser builds the digest and the prompt (frontend/src/lib/ai-digest.js, ai-prompt.js), so
   every figure comes from the same helpers as the screens; this module only forwards that prompt
   to a provider the operator configured, with a key that never reaches the browser.

   One code path for every provider: the OpenAI-compatible `/chat/completions` endpoint, which
   Gemini, Groq, OpenRouter, Mistral and a local Ollama all expose. No SDK — plain fetch.

   Everything here is pure or takes its fetch/clock by argument, so it is testable without
   network (ai.test.js). server.js owns the route, the session check and the audit entry. */

const truthy = v => /^(1|true|yes|on)$/i.test(String(v || ''));
const int = (v, def, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.min(max, Math.max(min, n)) : def;
};

/** Longest prompt accepted, in characters. The digest is ~10K; the rest is headroom, not a budget. */
export const MAX_PROMPT = 40000;

/**
 * Provider settings from the environment. `enabled` needs a base URL and a model; the key is
 * optional because a local Ollama takes none. AI_ENABLED=0 switches a configured provider off.
 */
export function aiConfig(env = process.env) {
  const base = String(env.AI_BASE_URL || '').trim().replace(/\/+$/, '');
  const model = String(env.AI_MODEL || '').trim();
  let host = null;
  try { if (base) host = new URL(base).host; } catch { /* invalid URL: stays disabled */ }
  const off = env.AI_ENABLED != null && String(env.AI_ENABLED).trim() !== '' && !truthy(env.AI_ENABLED);
  return {
    enabled: !!(host && model && !off),
    base, model, host,
    key: String(env.AI_API_KEY || '').trim(),
    // Per user, per UTC day. 0 = unlimited (a single-user instance on a local model).
    dailyLimit: int(env.AI_DAILY_LIMIT, 20, 0, 10000),
    timeoutMs: int(env.AI_TIMEOUT_MS, 90000, 5000, 600000),
    // Structured output: on by default; a model that rejects response_format can turn it off.
    jsonMode: env.AI_JSON_MODE == null || String(env.AI_JSON_MODE).trim() === '' ? true : truthy(env.AI_JSON_MODE),
  };
}

/** What the client may know about the provider: whether it is on, and where the data goes. */
export const publicAiConfig = cfg => cfg.enabled
  ? { enabled: true, host: cfg.host, model: cfg.model, daily_limit: cfg.dailyLimit }
  : { enabled: false };

/**
 * Per-user daily counter, in memory. A restart forgets the day's count — acceptable for a cap
 * whose job is to keep one account from draining a free tier, not to bill anyone.
 */
export function createQuota(now = () => Date.now()) {
  const used = new Map();   // uid -> { day, n }
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const count = uid => { const u = used.get(uid); return u && u.day === today() ? u.n : 0; };
  return {
    remaining(uid, limit) { return limit ? Math.max(0, limit - count(uid)) : null; },
    take(uid, limit) {
      if (limit && count(uid) >= limit) return false;
      used.set(uid, { day: today(), n: count(uid) + 1 });
      return true;
    },
    // A failed provider call should not cost the user one of the day's analyses.
    refund(uid) { const u = used.get(uid); if (u && u.day === today() && u.n > 0) u.n--; },
  };
}

/** Validate the request body. Returns `{ prompt }` or `{ error }`. */
export function readAiRequest(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return { error: 'prompt required' };
  if (prompt.length > MAX_PROMPT) return { error: 'prompt too long' };
  return { prompt };
}

const SYSTEM = 'You are a strength and hypertrophy coach inside a gym tracker. Base every statement on the data you are given. Reply with a single JSON object: {"summary": string, "alerts": [{"type": string, "target": string, "detail": string}], "suggestions": [{"action": string, "target": string, "group": string, "reason": string}]}.';

/** The chat-completions request body for a prompt. */
export function providerRequest(cfg, prompt) {
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    temperature: 0.3,
  };
  if (cfg.jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, fields, max) => (Array.isArray(v) ? v : [])
  .filter(x => x && typeof x === 'object')
  .slice(0, max)
  .map(x => Object.fromEntries(fields.map(f => [f, str(x[f], 600)])))
  .filter(x => Object.values(x).some(Boolean));

/**
 * Read the model's text back into `{ summary, alerts, suggestions }`.
 *
 * Models wrap JSON in code fences or add a sentence before it, and small local ones sometimes
 * ignore the format altogether — so the first `{…}` block is tried, and if nothing parses the
 * whole text becomes the summary rather than an error. Every field is trimmed and capped: this is
 * provider output going straight into the user's state.
 */
export function parseAnswer(text) {
  const raw = String(text || '').trim();
  let obj = null;
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { obj = null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { summary: str(raw, 6000), alerts: [], suggestions: [], structured: false };
  }
  return {
    summary: str(obj.summary, 6000),
    alerts: list(obj.alerts, ['type', 'target', 'detail'], 20),
    suggestions: list(obj.suggestions, ['action', 'target', 'group', 'reason'], 20),
    structured: true,
  };
}

/** A provider failure with an HTTP status to answer the client with and a short log message. */
export class AiError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail || message; }
}

/**
 * Call the provider. Resolves `{ answer, usage }`; rejects with AiError.
 *
 * Provider error bodies are logged (detail) but never echoed to the client, which only learns
 * the category: rate limited, rejected, unreachable, timed out.
 */
export async function callProvider(cfg, prompt, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  let r;
  try {
    r = await fetchImpl(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
      body: JSON.stringify(providerRequest(cfg, prompt)),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw ctrl.signal.aborted
      ? new AiError(504, 'ai provider timed out')
      : new AiError(502, 'ai provider unreachable', e && e.message);
  } finally {
    clearTimeout(timer);
  }
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    const detail = 'HTTP ' + r.status + ' ' + text.slice(0, 300);
    if (r.status === 429) throw new AiError(429, 'ai provider rate limit reached', detail);
    if (r.status === 401 || r.status === 403) throw new AiError(502, 'ai provider rejected the key', detail);
    throw new AiError(502, 'ai provider error', detail);
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new AiError(502, 'ai provider returned invalid JSON', text.slice(0, 300)); }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new AiError(502, 'ai provider returned no answer', text.slice(0, 300));
  const u = data.usage || {};
  return {
    answer: parseAnswer(content),
    usage: { prompt_tokens: +u.prompt_tokens || null, completion_tokens: +u.completion_tokens || null },
  };
}

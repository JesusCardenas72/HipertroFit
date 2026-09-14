import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiConfig, publicAiConfig, createQuota, readAiRequest, providerRequest, parseAnswer, callProvider,
  AiError, MAX_PROMPT,
} from './ai.js';

const GROQ = { AI_BASE_URL: 'https://api.groq.com/openai/v1/', AI_MODEL: 'openai/gpt-oss-20b', AI_API_KEY: ' sk-1 ' };

test('aiConfig: disabled until a base URL and a model are both set', () => {
  assert.equal(aiConfig({}).enabled, false);
  assert.equal(aiConfig({ AI_BASE_URL: 'https://x.test/v1' }).enabled, false);
  assert.equal(aiConfig({ AI_MODEL: 'm' }).enabled, false);
  assert.equal(aiConfig({ AI_BASE_URL: 'not a url', AI_MODEL: 'm' }).enabled, false);
  const c = aiConfig(GROQ);
  assert.equal(c.enabled, true);
  assert.equal(c.base, 'https://api.groq.com/openai/v1');   // trailing slash dropped
  assert.equal(c.host, 'api.groq.com');
  assert.equal(c.key, 'sk-1');
  assert.equal(c.dailyLimit, 20);
  assert.equal(c.jsonMode, true);
});

test('aiConfig: a local model needs no key, AI_ENABLED=0 switches it off, limits are clamped', () => {
  const ollama = aiConfig({ AI_BASE_URL: 'http://ollama:11434/v1', AI_MODEL: 'qwen2.5:7b', AI_DAILY_LIMIT: '0', AI_TIMEOUT_MS: '1', AI_JSON_MODE: 'off' });
  assert.equal(ollama.enabled, true);
  assert.equal(ollama.key, '');
  assert.equal(ollama.dailyLimit, 0);
  assert.equal(ollama.timeoutMs, 5000);
  assert.equal(ollama.jsonMode, false);
  assert.equal(aiConfig({ ...GROQ, AI_ENABLED: '0' }).enabled, false);
  assert.equal(aiConfig({ ...GROQ, AI_ENABLED: 'yes' }).enabled, true);
  assert.equal(aiConfig({ ...GROQ, AI_DAILY_LIMIT: 'lots' }).dailyLimit, 20);
});

test('publicAiConfig never exposes the key or the full URL', () => {
  const pub = publicAiConfig(aiConfig(GROQ));
  assert.deepEqual(pub, { enabled: true, host: 'api.groq.com', model: 'openai/gpt-oss-20b', daily_limit: 20 });
  assert.doesNotMatch(JSON.stringify(pub), /sk-1|openai\/v1/);
  assert.deepEqual(publicAiConfig(aiConfig({})), { enabled: false });
});

test('quota: per user, per UTC day, refundable, unlimited at 0', () => {
  let t = Date.parse('2026-09-14T10:00:00Z');
  const q = createQuota(() => t);
  assert.equal(q.take('a', 2), true);
  assert.equal(q.take('a', 2), true);
  assert.equal(q.take('a', 2), false);
  assert.equal(q.remaining('a', 2), 0);
  assert.equal(q.take('b', 2), true);        // another user has their own count
  q.refund('a');
  assert.equal(q.remaining('a', 2), 1);
  t = Date.parse('2026-09-15T00:00:01Z');    // next day starts fresh
  assert.equal(q.remaining('a', 2), 2);
  assert.equal(q.remaining('a', 0), null);
  for (let i = 0; i < 50; i++) assert.equal(q.take('c', 0), true);
});

test('readAiRequest: requires a non-empty prompt within the size cap', () => {
  assert.deepEqual(readAiRequest({}), { error: 'prompt required' });
  assert.deepEqual(readAiRequest({ prompt: 42 }), { error: 'prompt required' });
  assert.deepEqual(readAiRequest({ prompt: '   ' }), { error: 'prompt required' });
  assert.deepEqual(readAiRequest({ prompt: 'x'.repeat(MAX_PROMPT + 1) }), { error: 'prompt too long' });
  assert.deepEqual(readAiRequest({ prompt: ' hi ' }), { prompt: 'hi' });
});

test('providerRequest: chat-completions body, JSON mode only when enabled', () => {
  const body = providerRequest(aiConfig(GROQ), 'data');
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.equal(body.messages[0].role, 'system');
  assert.deepEqual(body.messages[1], { role: 'user', content: 'data' });
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal('response_format' in providerRequest(aiConfig({ ...GROQ, AI_JSON_MODE: '0' }), 'x'), false);
});

test('parseAnswer: reads fenced JSON, caps and cleans fields, falls back to text', () => {
  const fenced = 'Here you go:\n```json\n{"summary":" Good block. ","alerts":[{"type":"stall","target":"Bench","detail":"3 sessions","extra":"x"},null,"junk"],"suggestions":[{"action":"deload","reason":"streak"}]}\n```';
  assert.deepEqual(parseAnswer(fenced), {
    summary: 'Good block.',
    alerts: [{ type: 'stall', target: 'Bench', detail: '3 sessions' }],
    suggestions: [{ action: 'deload', target: '', group: '', reason: 'streak' }],
    structured: true,
  });
  assert.deepEqual(parseAnswer('{"summary":"s","suggestions":[{"action":"add_volume","group":"chest","reason":"r"}]}').suggestions,
    [{ action: 'add_volume', target: '', group: 'chest', reason: 'r' }]);
  assert.deepEqual(parseAnswer('Train more legs.'), { summary: 'Train more legs.', alerts: [], suggestions: [], structured: false });
  assert.equal(parseAnswer('{broken').structured, false);
  assert.equal(parseAnswer(JSON.stringify({ summary: 'x', alerts: Array(50).fill({ type: 'a', detail: 'b' }) })).alerts.length, 20);
  assert.equal(parseAnswer(JSON.stringify({ summary: 'y'.repeat(9000) })).summary.length, 6000);
});

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('callProvider: posts to /chat/completions with the key and returns the parsed answer', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return reply(200, { choices: [{ message: { content: '{"summary":"ok","alerts":[],"suggestions":[]}' } }], usage: { prompt_tokens: 900, completion_tokens: 120 } })(); };
  const out = await callProvider(aiConfig(GROQ), 'data', fetchImpl);
  assert.equal(seen.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(seen.opts.headers.Authorization, 'Bearer sk-1');
  assert.equal(JSON.parse(seen.opts.body).messages[1].content, 'data');
  assert.deepEqual(out, { answer: { summary: 'ok', alerts: [], suggestions: [], structured: true }, usage: { prompt_tokens: 900, completion_tokens: 120 } });
});

test('callProvider: no Authorization header without a key', async () => {
  let headers;
  await callProvider(aiConfig({ AI_BASE_URL: 'http://ollama:11434/v1', AI_MODEL: 'm' }), 'p', async (u, o) => { headers = o.headers; return reply(200, { choices: [{ message: { content: 'plain' } }] })(); });
  assert.equal('Authorization' in headers, false);
});

test('callProvider: maps provider failures to client-safe errors without echoing the body', async () => {
  const cfg = aiConfig(GROQ);
  const fails = async (fetchImpl, status, message) => {
    await assert.rejects(callProvider(cfg, 'p', fetchImpl), e => {
      assert.ok(e instanceof AiError);
      assert.equal(e.status, status);
      assert.equal(e.message, message);
      assert.doesNotMatch(e.message, /secret-body/);
      return true;
    });
  };
  await fails(reply(429, 'secret-body'), 429, 'ai provider rate limit reached');
  await fails(reply(401, 'secret-body'), 502, 'ai provider rejected the key');
  await fails(reply(500, 'secret-body'), 502, 'ai provider error');
  await fails(reply(200, 'secret-body'), 502, 'ai provider returned invalid JSON');
  await fails(reply(200, { choices: [] }), 502, 'ai provider returned no answer');
  await fails(async () => { throw new Error('ECONNREFUSED'); }, 502, 'ai provider unreachable');
});

test('callProvider: aborts a provider that never answers', async () => {
  const cfg = { ...aiConfig(GROQ), timeoutMs: 20 };
  const hang = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(callProvider(cfg, 'p', hang), e => e.status === 504);
});

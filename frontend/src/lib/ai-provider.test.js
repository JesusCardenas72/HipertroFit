import { describe, it, expect, beforeEach } from 'vitest'
import {
  PROVIDERS, providerById, normalizeByok, baseUrlError, byokReady, loadByok, saveByok, clearByok,
  hostOf, providerRequest, parseAnswer, callProvider, BYOK_STORAGE,
} from './ai-provider.js'
import * as server from '../../../api/ai.js'

// An in-memory stand-in for localStorage, so each test starts clean and can read what was written.
const memoryStorage = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), raw: m }
}

const GROQ = { provider: 'groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', key: 'gsk_secret' }

describe('presets', () => {
  it('every hosted preset is https with a model or a hint, and a place to get a key', () => {
    for (const p of PROVIDERS.filter(x => x.id !== 'custom' && x.id !== 'ollama')) {
      expect(baseUrlError(p.base), p.id).toBeNull()
      expect(p.model || p.modelHint, p.id).toBeTruthy()
      expect(p.keyUrl, p.id).toMatch(/^https:\/\//)
    }
  })
  it('falls back to Custom for an unknown id', () => {
    expect(providerById('nope').id).toBe('custom')
  })
})

describe('config', () => {
  it('normalizes and trims every field', () => {
    expect(normalizeByok({ provider: 'x', base: ' https://a.test/v1/ ', model: ' m ', key: ' k ', remember: 'yes' }))
      .toEqual({ provider: 'custom', base: 'https://a.test/v1', model: 'm', key: 'k', keyed: true, remember: false, jsonMode: true })
    expect(normalizeByok(null)).toMatchObject({ provider: 'custom', base: '', key: '' })
  })

  it('accepts https anywhere, plain http only to this device', () => {
    expect(baseUrlError('https://api.groq.com/openai/v1')).toBeNull()
    expect(baseUrlError('http://localhost:11434/v1')).toBeNull()
    expect(baseUrlError('http://127.0.0.1:11434/v1')).toBeNull()
    expect(baseUrlError('http://192.168.1.20:11434/v1')).toMatch(/https/)
    expect(baseUrlError('https://user:pw@x.test')).toMatch(/credentials/)
    expect(baseUrlError('')).toMatch(/URL/)
  })

  it('is ready with a valid URL, a model, and a key unless the provider takes none', () => {
    expect(byokReady(GROQ)).toBe(true)
    expect(byokReady({ ...GROQ, key: '' })).toBe(false)
    expect(byokReady({ ...GROQ, model: '' })).toBe(false)
    expect(byokReady({ provider: 'ollama', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b' })).toBe(true)
    expect(byokReady({ provider: 'custom', base: 'https://llm.home.test/v1', model: 'm' })).toBe(true)
  })
})

describe('storage', () => {
  let storage
  beforeEach(() => { storage = memoryStorage(); clearByok(storage) })

  it('asks for a forgotten key again instead of calling without one', () => {
    saveByok({ provider: 'custom', base: 'https://llm.home.test/v1', model: 'm', key: 'k' }, storage)
    clearByok({ removeItem: () => {} })            // drops only the in-memory key, as a reload does
    const reloaded = loadByok(storage)
    expect(reloaded).toMatchObject({ key: '', keyed: true })
    expect(byokReady(reloaded)).toBe(false)
  })

  it('does not write the key unless asked to remember it, but keeps it for this session', () => {
    saveByok(GROQ, storage)
    expect(storage.raw.get(BYOK_STORAGE)).not.toContain('gsk_secret')
    expect(loadByok(storage)).toMatchObject({ provider: 'groq', key: 'gsk_secret', remember: false })
  })

  it('persists the key when remembered', () => {
    saveByok({ ...GROQ, remember: true }, storage)
    expect(JSON.parse(storage.raw.get(BYOK_STORAGE)).key).toBe('gsk_secret')
  })

  it('forgets everything on clear, the in-memory key included', () => {
    saveByok(GROQ, storage)
    clearByok(storage)
    expect(loadByok(storage)).toBeNull()
    saveByok({ ...GROQ, key: '' }, storage)
    expect(loadByok(storage).key).toBe('')
  })

  it('survives unreadable or blocked storage', () => {
    storage.setItem(BYOK_STORAGE, '{nope')
    expect(loadByok(storage)).toBeNull()
    const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(loadByok(blocked)).toBeNull()
    expect(saveByok(GROQ, blocked).key).toBe('gsk_secret')
    expect(() => clearByok(blocked)).not.toThrow()
  })
})

describe('parity with the server relay (api/ai.js)', () => {
  const samples = [
    'Here:\n```json\n{"summary":" ok ","alerts":[{"type":"stall","target":"Bench","detail":"3","x":1},null],"suggestions":[{"action":"deload","reason":"r"}]}\n```',
    'Plain prose answer.',
    '{broken',
    JSON.stringify({ summary: 'y'.repeat(9000), alerts: Array(40).fill({ type: 'a', detail: 'b' }) }),
    '',
  ]
  it('parses answers identically', () => {
    for (const s of samples) expect(parseAnswer(s)).toEqual(server.parseAnswer(s))
  })
  it('sends the same request body', () => {
    const cfg = { model: 'm', jsonMode: true }
    expect(providerRequest(cfg, 'p')).toEqual(server.providerRequest(cfg, 'p'))
    expect(providerRequest({ ...cfg, jsonMode: false }, 'p')).toEqual(server.providerRequest({ ...cfg, jsonMode: false }, 'p'))
  })
})

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })

describe('callProvider', () => {
  it('calls the provider directly with the key and answers in the server relay shape', async () => {
    let seen
    const fetchImpl = async (url, opts) => { seen = { url, opts }; return reply(200, { choices: [{ message: { content: '{"summary":"ok","alerts":[],"suggestions":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })() }
    const out = await callProvider(GROQ, 'digest', { fetchImpl })
    expect(seen.url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(seen.opts.headers.Authorization).toBe('Bearer gsk_secret')
    expect(JSON.parse(seen.opts.body).messages[1].content).toBe('digest')
    expect(out).toEqual({ answer: { summary: 'ok', alerts: [], suggestions: [], structured: true }, usage: { prompt_tokens: 10, completion_tokens: 2 }, host: 'api.groq.com', model: 'openai/gpt-oss-20b' })
  })

  it('sends no Authorization header without a key', async () => {
    let headers
    await callProvider({ provider: 'ollama', base: 'http://localhost:11434/v1', model: 'q' }, 'p', { fetchImpl: async (u, o) => { headers = o.headers; return reply(200, { choices: [{ message: { content: 'text' } }] })() } })
    expect('Authorization' in headers).toBe(false)
  })

  it('refuses to send over plain http to another machine, or without a model', async () => {
    const never = async () => { throw new Error('must not be called') }
    await expect(callProvider({ ...GROQ, base: 'http://evil.test/v1' }, 'p', { fetchImpl: never })).rejects.toMatchObject({ message: 'ai not configured' })
    await expect(callProvider({ ...GROQ, model: '' }, 'p', { fetchImpl: never })).rejects.toMatchObject({ message: 'ai not configured' })
    await expect(callProvider(GROQ, 'x'.repeat(40001), { fetchImpl: never })).rejects.toMatchObject({ message: 'prompt too long' })
  })

  it('maps failures to the shared error categories', async () => {
    const cases = [
      [reply(429, 'x'), 'ai provider rate limit reached'],
      [reply(401, 'x'), 'ai provider rejected your key'],
      [reply(404, 'x'), 'ai model not found'],
      [reply(500, 'x'), 'ai provider error'],
      [reply(200, 'not json'), 'ai provider returned invalid JSON'],
      [reply(200, { choices: [] }), 'ai provider returned no answer'],
      [async () => { throw new TypeError('Failed to fetch') }, 'ai provider unreachable'],
    ]
    for (const [fetchImpl, message] of cases) {
      await expect(callProvider(GROQ, 'p', { fetchImpl })).rejects.toMatchObject({ message })
    }
  })

  it('times out a provider that never answers', async () => {
    const hang = (u, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    await expect(callProvider(GROQ, 'p', { fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({ status: 504 })
  })

  it('hostOf tolerates a bad URL', () => {
    expect(hostOf('https://openrouter.ai/api/v1')).toBe('openrouter.ai')
    expect(hostOf('nope')).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { reportOf, addReport, removeReport, aiErrorKey, providerNotice, actionKey, MAX_REPORTS } from './ai-report.js'

const res = {
  host: 'api.groq.com', model: 'gpt-oss-20b',
  answer: {
    summary: 'Solid block.',
    alerts: [{ type: 'stall', target: 'Bench', detail: '3 sessions', junk: 1 }, 'bad'],
    suggestions: [{ action: 'deload', reason: 'streak' }],
    structured: true,
  },
}

describe('reportOf', () => {
  it('stamps the answer with date, focus and provider, keeping only known fields', () => {
    expect(reportOf(res, { focus: 'volume', date: '2026-09-14', id: 'r1' })).toEqual({
      id: 'r1', d: '2026-09-14', focus: 'volume', host: 'api.groq.com', model: 'gpt-oss-20b',
      summary: 'Solid block.',
      alerts: [{ type: 'stall', target: 'Bench', detail: '3 sessions' }],
      suggestions: [{ action: 'deload', target: '', group: '', reason: 'streak' }],
      structured: true,
    })
  })

  it('survives a malformed response', () => {
    const r = reportOf(null, { date: '2026-09-14', id: 'x' })
    expect(r).toMatchObject({ summary: '', alerts: [], suggestions: [], focus: 'overview', structured: true })
    expect(reportOf({ answer: { summary: 7, alerts: 'no', structured: false } }, { id: 'y' })).toMatchObject({ summary: '', alerts: [], structured: false })
  })
})

describe('report list', () => {
  it('keeps the newest reports first, capped, without mutating', () => {
    let list = []
    for (let i = 0; i < MAX_REPORTS + 2; i++) list = addReport(list, { id: String(i) })
    expect(list.map(r => r.id)).toEqual(['6', '5', '4', '3', '2'])
    const before = [{ id: 'a' }]
    addReport(before, { id: 'b' })
    expect(before).toEqual([{ id: 'a' }])
    expect(addReport(undefined, { id: 'z' })).toEqual([{ id: 'z' }])
  })

  it('removes one report by id', () => {
    expect(removeReport([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }])
    expect(removeReport(null, 'a')).toEqual([])
  })
})

describe('aiErrorKey', () => {
  it('maps every server category to its own message', () => {
    const keys = [
      { message: 'daily ai limit reached', status: 429 },
      { message: 'ai provider rate limit reached', status: 429 },
      { message: 'ai provider rejected the key', status: 502 },
      { message: 'analysis already running', status: 409 },
      { message: 'ai provider timed out', status: 504 },
      { message: 'ai not configured', status: 404 },
      { message: 'ai provider rejected your key', status: 401 },
      { message: 'ai provider unreachable', status: 502 },
      { message: 'ai model not found', status: 502 },
    ].map(aiErrorKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('falls back to a generic message', () => {
    expect(aiErrorKey(new TypeError('Failed to fetch'))).toBe('The analysis could not be completed. Try again later.')
    expect(aiErrorKey(undefined)).toBe('The analysis could not be completed. Try again later.')
  })
})

describe('providerNotice', () => {
  it('warns about Gemini free-tier data use', () => {
    expect(providerNotice('generativelanguage.googleapis.com')).toMatchObject({ tone: 'warn', key: expect.stringMatching(/Gemini/) })
  })
  it('reassures for a model on the local network', () => {
    for (const h of ['ollama:11434', 'localhost:11434', '192.168.1.20:11434', '10.0.0.5', 'llm']) {
      expect(providerNotice(h), h).toMatchObject({ tone: 'ok', key: expect.stringMatching(/nothing leaves/) })
    }
  })
  it('says "this device" for a local model called directly', () => {
    expect(providerNotice('localhost:11434', { direct: true })).toMatchObject({ tone: 'ok', key: expect.stringMatching(/this device/) })
    expect(providerNotice('localhost:11434')).toMatchObject({ key: expect.stringMatching(/this server/) })
  })
  it('says nothing extra for other hosted providers', () => {
    expect(providerNotice('api.groq.com')).toBeNull()
    expect(providerNotice('openrouter.ai')).toBeNull()
    expect(providerNotice('evilgoogleapis.com')).toBeNull()
    expect(providerNotice('')).toBeNull()
  })
})

describe('actionKey', () => {
  it('labels known actions and falls back to Other', () => {
    expect(actionKey('deload')).toBe('Deload')
    expect(actionKey('launch_rocket')).toBe('Other')
  })
})

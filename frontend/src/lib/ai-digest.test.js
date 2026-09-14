import { describe, it, expect } from 'vitest'
import { buildDigest, findingsOf, DIGEST_RECENT } from './ai-digest.js'
import { buildPrompt, approxTokens, RESPONSE_SCHEMA } from './ai-prompt.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp === 'chest').id
const OTHER = EXDB.find(e => e.bp === 'upper arms' && e.id !== LIFT).id
const TODAY = '2026-09-14'
const NOW = Date.parse(TODAY + 'T18:00:00')

const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }
const sets = (w, ...reps) => reps.map(r => ({ w, r, done: true }))
const session = (d, entries, extra = {}) => ({
  id: 'w' + d, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
  routineId: 'r1', name: 'Push', entries, ...extra,
})
const base = (workouts, extra = {}) => ({
  unit: 'kg', exWeights: {}, bodyweight: [], targetW: null, program: null, meso: null,
  routines: [{ id: 'r1', name: 'Push', ex: [cfg] }],
  workouts, ...extra,
})
const digestOf = S => buildDigest(S, { now: NOW, today: TODAY })

describe('buildDigest', () => {
  it('is anonymous: no profile identity, ids or session notes leak into it', () => {
    const S = base([session('2026-09-10', [{ id: LIFT, sets: sets(40, 10, 10, 10) }], { note: 'knee hurt, call Ana', bw: 81 })],
      { name: 'Jane Doe', uid: 'u-123', email: 'jane@example.com' })
    const text = JSON.stringify(digestOf(S))
    expect(text).not.toMatch(/Jane|u-123|example\.com|knee hurt|w2026/)
  })

  it('spells out the most recent sessions newest first, work sets only, with RIR when rated', () => {
    const ws = Array.from({ length: 8 }, (_, i) => session('2026-09-0' + (i + 1), [{
      id: LIFT, sets: [{ w: 20, r: 10, done: true, phase: 'warmup' }, { w: 40, r: 10, done: true, rir: 2 }, { w: 40, r: 9, done: false }],
    }]))
    const d = digestOf(base(ws))
    expect(d.recent).toHaveLength(DIGEST_RECENT)
    expect(d.recent[0].date).toBe('2026-09-08')
    expect(d.recent[0].exercises[0].sets).toBe('40x10@2')
    expect(d.recent[0].minutes).toBe(60)
  })

  it('reads the double progression back through the engine and flags a lift ready to progress', () => {
    const d = digestOf(base([session('2026-09-10', [{ id: LIFT, target: { sets: 3, reps: 12 }, sets: sets(40, 12, 12, 12) }])]))
    expect(d.progression).toHaveLength(1)
    expect(d.progression[0]).toMatchObject({ state: 'ready', weight: 40, range: [8, 12], last_reps: [12, 12, 12] })
    expect(d.findings).toContainEqual({ type: 'ready-to-progress', exercise: d.progression[0].exercise })
  })

  it('reports adherence and flags more than a week without training', () => {
    const d = digestOf(base([session('2026-08-30', [{ id: LIFT, sets: sets(40, 10) }])]))
    expect(d.adherence).toMatchObject({ sessions_total: 1, last_session: '2026-08-30', days_since_last: 15 })
    expect(d.findings).toContainEqual({ type: 'inactive', days: 15 })
  })

  it('keeps old sessions in the total but out of the trend window', () => {
    const d = digestOf(base([
      session('2025-01-01', [{ id: LIFT, sets: sets(100, 5) }]),
      session('2026-09-01', [{ id: LIFT, sets: sets(40, 10) }]),
    ]))
    expect(d.adherence.sessions_total).toBe(2)
    expect(d.adherence.sessions_in_window).toBe(1)
    expect(d.strength).toEqual([])        // one point in the window is not a trend
  })

  it('computes the estimated-1RM trend and flags a drop of 5% or more', () => {
    const d = digestOf(base([
      session('2026-08-01', [{ id: OTHER, sets: sets(30, 10) }]),
      session('2026-09-01', [{ id: OTHER, sets: sets(25, 10) }]),
    ], { routines: [] }))
    expect(d.strength[0]).toMatchObject({ sessions: 2, e1rm_first: 40, e1rm_last: 33.3, e1rm_best: 40, change_pct: -16.8 })
    expect(d.findings).toContainEqual({ type: 'strength-drop', exercise: d.strength[0].exercise, change_pct: -16.8 })
  })

  it('judges volume against the programmed plan, not a half-trained block', () => {
    const S = base([], { program: { on: true, seq: ['r1', 'rest'], anchor: '2026-09-01', strategy: 'full-body' } })
    const d = digestOf(S)
    expect(d.volume.planned.sessions).toBe(3)
    const chest = d.volume.planned.groups.find(g => g.group === 'chest')
    expect(chest).toEqual({ group: 'chest', sets: 9, status: 'low' })
    expect(d.findings).toContainEqual({ type: 'volume-low', group: 'chest', sets: 9, source: 'plan' })
    expect(d.microcycle).toMatchObject({ strategy: 'full-body', length: 3, next_session: 1, next_routine: 'Push' })
  })

  it('ignores a sequence whose routines no longer exist instead of calling every group low', () => {
    const d = digestOf(base([], { program: { on: true, seq: ['gone', 'rest'], anchor: '2026-09-01', strategy: 'upper-lower' } }))
    expect(d.volume.planned).toBeNull()
    expect(d.findings.some(f => f.type === 'volume-low')).toBe(false)
  })

  it('does not call a half-trained block low when there is no plan', () => {
    const d = digestOf(base([session('2026-09-10', [{ id: LIFT, sets: sets(40, 10) }])], { routines: [] }))
    expect(d.findings.some(f => f.type === 'volume-low')).toBe(false)
  })

  it('suggests the deload once three loading microcycles are closed', () => {
    const ws = Array.from({ length: 9 }, (_, i) => session('2026-08-' + String(10 + i).padStart(2, '0'), [{ id: OTHER, sets: sets(20, 10) }]))
    const d = digestOf(base(ws, { routines: [{ id: 'r1', name: 'Push', ex: [] }], program: { on: true, seq: ['r1'], anchor: '2026-08-10', strategy: 'full-body' } }))
    expect(d.mesocycle).toMatchObject({ loading_streak: 3, deload_suggested: true, deload_mandatory: false })
    expect(d.findings[0]).toEqual({ type: 'deload-suggested', loading_microcycles: 3 })
  })

  it('summarises body weight against the goal', () => {
    const d = digestOf(base([], { targetW: 78, bodyweight: [
      { d: '2026-05-01', w: 90 }, { d: '2026-07-01', w: 84 }, { d: '2026-08-20', w: 82.4 }, { d: '2026-09-12', w: 81.2 },
    ] }))
    expect(d.bodyweight).toEqual({ latest: { date: '2026-09-12', weight: 81.2 }, goal: 78, change_4w: -1.2, change_12w: -2.8 })
  })

  it('uses the injected name resolver', () => {
    const d = buildDigest(base([session('2026-09-10', [{ id: LIFT, sets: sets(40, 10) }])]), { now: NOW, today: TODAY, nameOf: () => 'Press banca' })
    expect(d.recent[0].exercises[0].exercise).toBe('Press banca')
    expect(d.routines[0].exercises[0]).toEqual({ exercise: 'Press banca', sets: 3, reps: '8-12', weight: 40, progression: 'double' })
  })

  it('handles an empty profile', () => {
    const d = digestOf(base([], { routines: [] }))
    expect(d.adherence.last_session).toBeNull()
    expect(d.bodyweight).toBeNull()
    expect(d.findings).toEqual([])
  })
})

describe('findingsOf', () => {
  it('puts a mandatory deload above everything else', () => {
    const d = {
      mesocycle: { deload_mandatory: true, deload_suggested: true, loading_streak: 5 },
      progression: [{ exercise: 'A', state: 'deload', stalled_sessions: 3 }, { exercise: 'B', state: 'fatigue' }],
      adherence: { days_since_last: 2 },
      volume: { planned: null, current: { sessions: 0, groups: [] } },
      microcycle: { length: 3 },
      strength: [],
    }
    expect(findingsOf(d)).toEqual([
      { type: 'deload-mandatory', loading_microcycles: 5 },
      { type: 'stalled', exercise: 'A', sessions: 3 },
      { type: 'fatigue', exercise: 'B' },
    ])
  })
})

describe('buildPrompt', () => {
  const digest = digestOf(base([session('2026-09-10', [{ id: LIFT, sets: sets(40, 10) }])]))

  it('embeds the digest verbatim as JSON and states the app rules', () => {
    const p = buildPrompt(digest)
    expect(JSON.parse(p.slice(p.indexOf('Data:\n') + 6))).toEqual(digest)
    expect(p).toContain('10–20 effective sets')
    expect(p).toContain('RIR <= 4')
  })

  it('answers in the app language and follows the chosen focus', () => {
    const p = buildPrompt(digest, { lang: 'es', focus: 'volume' })
    expect(p).toContain('Answer in Español.')
    expect(p).toContain('Focus on volume')
    expect(buildPrompt(digest, { lang: 'xx' })).toContain('Answer in English.')
  })

  it('asks for a group key on volume suggestions, from the app groups', () => {
    const p = buildPrompt(digest, { json: true })
    expect(p).toContain('"group"')
    expect(p).toContain('legs, chest, back, delts, biceps, triceps, abs')
    expect(RESPONSE_SCHEMA.properties.suggestions.items.properties.group.enum).toEqual(['legs', 'chest', 'back', 'delts', 'biceps', 'triceps', 'abs'])
  })

  it('asks for JSON only when requested, matching the schema keys', () => {
    expect(buildPrompt(digest)).not.toContain('JSON only')
    const p = buildPrompt(digest, { json: true })
    for (const key of RESPONSE_SCHEMA.required) expect(p).toContain('"' + key + '"')
  })

  it('stays well inside a free-tier request', () => {
    expect(approxTokens(buildPrompt(digest))).toBeLessThan(4000)
    expect(approxTokens('abcdefgh')).toBe(2)
  })
})

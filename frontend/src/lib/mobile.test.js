import { describe, expect, it } from 'vitest'
import { isoOf } from './format.js'
import { registerPlugin } from '@capacitor/core'
import { androidPluginBox, backupFileName, base64ToBytes, buildReminderNotifications, bytesToBase64 } from './mobile.js'

const push = { id: 'push', name: 'Push' }
const pull = { id: 'pull', name: 'Pull' }
const legs = { id: 'legs', name: 'Legs' }
const state = (patch = {}) => ({
  routines: [push, pull, legs], week: {}, dayPlan: {}, workouts: [],
  reminder: { on: true, time: '08:00' }, ...patch,
})
const iso = d => isoOf(d)

describe('buildReminderNotifications', () => {
  it('announces the sessions left in a deload microcycle as a deload, then reads as usual', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    // A 3-session block not started yet, marked as the deload: the next three reminders say so.
    const st = state({
      week: { 1: 'push', 2: 'pull', 3: 'legs', 4: 'push', 5: 'pull' },
      program: { strategy: 'full-body', seq: ['push', 'pull', 'legs'], cycleStart: '2026-06-01' },
      meso: { deloads: [0], pct: 0.4 },
    })
    const n = buildReminderNotifications(st, now)
    expect(n.slice(0, 3).every(x => /Deload/.test(x.title))).toBe(true)
    expect(n[0].body).toContain('40')
    expect(n[3].title).not.toMatch(/Deload/)
  })

  it('expands the weekly baseline into future dated notifications', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push', 3: 'pull' } }), now)

    expect(notifications.slice(0, 2).map(n => iso(n.schedule.at))).toEqual([
      iso(now), iso(new Date(2026, 5, 3)),
    ])
    expect(notifications[0].body).toContain('Push')
    expect(notifications[0].schedule.allowWhileIdle).toBe(true)
  })

  it('uses rest today and a routine override tomorrow when rescheduling', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const today = iso(now), tomorrow = iso(new Date(2026, 5, 2))
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, dayPlan: { [today]: 'rest', [tomorrow]: 'pull' },
    }), now)

    expect(notifications.slice(0, 1).map(n => [iso(n.schedule.at), n.body])).toEqual([
      [tomorrow, expect.stringContaining('Pull')],
    ])
  })

  it('schedules a valid override on a weekly rest day', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const wednesday = new Date(2026, 5, 3)
    const notifications = buildReminderNotifications(state({ dayPlan: { [iso(wednesday)]: 'legs' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(wednesday) && n.body.includes('Legs'))).toBe(true)
  })

  it('suppresses dates that already have a completed workout', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, workouts: [{ d: iso(now) }],
    }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
  })

  it("skips today's reminder after the configured local time has passed", () => {
    const now = new Date(2026, 5, 1, 9, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
    expect(notifications.some(n => iso(n.schedule.at) === iso(new Date(2026, 5, 8)))).toBe(true)
  })
})
describe('backupFileName', () => {
  it('names one file per day, so the same day overwrites rather than piling up', () => {
    expect(backupFileName('2026-09-10')).toBe('hipertrofit-backup-2026-09-10.json')
    expect(backupFileName('2026-09-10')).toBe(backupFileName('2026-09-10'))
    expect(backupFileName('2026-09-11')).not.toBe(backupFileName('2026-09-10'))
  })
})

describe('androidPluginBox', () => {
  const core = platform => ({ registerPlugin, Capacitor: { getPlatform: () => platform } })

  it('a bare plugin proxy looks like a thenable — why it has to be boxed', () => {
    // What broke the audio focus: the proxy answers `then` with a native-method stub, so a promise
    // resolved with it calls that stub, which never settles — the plugin was never reached.
    expect(typeof registerPlugin('ThenTrapBare').then).toBe('function')
  })

  it('boxes the plugin so it survives being resolved through a promise', async () => {
    const box = await Promise.resolve().then(() => androidPluginBox(core('android'), 'ThenTrapBoxed'))
    expect(typeof box.plugin.pause).toBe('function')
    expect(box.plugin).toBe(registerPlugin('ThenTrapBoxed'))
  })

  it('is null off Android', () => {
    expect(androidPluginBox(core('ios'), 'ThenTrapIos')).toBe(null)
    expect(androidPluginBox(core('web'), 'ThenTrapWeb')).toBe(null)
  })
})

// The custom-sound mirror stores the clip as base64; a byte lost on the way is a broken file.
describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(new Uint8Array(base64ToBytes(bytesToBase64(bytes.buffer)))).toEqual(bytes)
  })

  // Larger than one 32 KB slice, so the slices have to join up exactly.
  it('round-trips a clip larger than one slice', () => {
    const bytes = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 31) & 255)
    expect(new Uint8Array(base64ToBytes(bytesToBase64(bytes.buffer)))).toEqual(bytes)
  })
})

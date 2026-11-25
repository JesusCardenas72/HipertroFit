// The running session as one ongoing notification (Android app): where you are and what is next,
// readable from the lock screen or the shade without opening the app between sets.
//
// Pure: given the state and the rest timer it returns the text, or null when there is nothing
// running. lib/mobile.js puts it in the tray; components/SessionNotifier.jsx decides when.

import { t, exerciseNameFor } from './i18n.js'
import { exOr } from './exercises.js'
import { setLabel } from './history.js'
import { isWarmupRow } from './workout-model.js'

/** The notification's fixed id: one per device, replaced on every update. */
export const SESSION_NOTICE_ID = 9100

const two = n => String(n).padStart(2, '0')
const clock = ms => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}` }

/** The first undone set from the current exercise on: { entry, i } or null when all are done. */
export function nextSetOf(A) {
  const entries = (A && A.entries) || []
  const from = Math.max(0, Math.min(entries.length - 1, A && Number.isInteger(A.cur) ? A.cur : 0))
  for (let k = 0; k < entries.length; k++) {
    const e = entries[(from + k) % entries.length]
    const i = (e.sets || []).findIndex(s => !s.done)
    if (i >= 0) return { entry: e, i }
  }
  return null
}

/**
 * { title, body } for the running session, or null without one (or for a past workout being
 * logged, which has no clock). `timer` is the rest countdown (useUI), `now` the time to read it at.
 */
export function sessionNotice(S, timer = null, now = Date.now()) {
  const A = S && S.active
  if (!A || A.backfill) return null
  const all = (A.entries || []).flatMap(e => e.sets || [])
  const done = all.filter(s => s.done).length
  const title = `${A.name || t('Workout')} · ${t('{0} sets', done + '/' + all.length)}`
  const lines = []
  if (timer && timer.endsAt > now) lines.push(t('Resting until {0}', clock(timer.endsAt)))
  const next = nextSetOf(A)
  if (next) {
    const { entry, i } = next
    const s = entry.sets[i]
    const warm = isWarmupRow(s)
    const num = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
    const of = entry.sets.filter(x => isWarmupRow(x) === warm).length
    const what = warm ? t('Warm-up') + ' ' + num : t('Set {0}', num) + '/' + of
    lines.push(`${exerciseNameFor(exOr(entry.id))} · ${what} · ${setLabel(entry.id, s, entry.target)}`)
  } else lines.push(t('Every set is done — finish the workout.'))
  return { title, body: lines.join('\n') }
}

/** What decides whether the notification needs rewriting: changes to anything shown. */
export function noticeKey(S, timer) {
  const n = sessionNotice(S, timer, 0)
  return n ? n.title + '|' + n.body + '|' + (timer ? timer.endsAt : '') : ''
}

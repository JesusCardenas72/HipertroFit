// A compact, anonymous digest of the training state, meant to be read by an LLM.
//
// The model interprets; it does not compute. Every figure here comes from the same pure helpers
// the screens use — cycleVolume/plannedVolume for volume, doubleProgressStatus for the double
// progression, mesoState for the deload, e1rmSeries for strength — so whatever an assistant says
// about "your chest volume" is the number the home panel shows, not one it made up from raw sets.
//
// Deliberately small (a few thousand tokens at most) so it fits any free tier and can be pasted
// into a chat by hand, and deliberately anonymous: no profile name, uid, notes or timestamps
// finer than a date. `findings` is the deterministic part — what the app can already flag
// without any model at all — and doubles as a hint for the model about what to look at first.

import { cycleVolume, plannedVolume, volumeStatus, VOLUME_GROUPS, VOLUME_TARGET } from './volume.js'
import { cyclePosition, strategyOf, nextStepOf, trainingSteps } from './microcycle.js'
import { mesoState } from './mesocycle.js'
import { doubleProgressExercises, doubleProgressStatus } from './double-progress.js'
import { e1rmSeries } from './onerm.js'
import { rirOf } from './effort.js'
import { isWarmupRow } from './workout-model.js'
import { EXIDX } from './exercises.js'
import { todayISO } from './format.js'

const DAY = 86400000
const round1 = v => Math.round(v * 10) / 10

/** How many weeks of history the digest looks back over, by default. */
export const DIGEST_WEEKS = 12
/** Most recent sessions spelled out set by set. */
export const DIGEST_RECENT = 6
/** Exercises with a strength trend (the most trained ones in the window). */
export const DIGEST_LIFTS = 8

// Catalogue name, else whatever the logged entry remembers, else the id.
const defaultName = (id, entry) =>
  (EXIDX[id] && EXIDX[id].n) || (entry && (entry.muscleSnapshot?.n || entry.exercise?.n || entry.n)) || id

const timeOf = w => w.start || Date.parse(w.d + 'T12:00:00')
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / DAY)

// "40x10@2" — weight x reps, RIR when rated; timed and cardio rows in their own units.
function setText(s) {
  const rir = rirOf(s)
  let txt
  if (s.sec != null) txt = (s.w ? s.w + 'x' : '') + s.sec + 's'
  else if (s.min != null) txt = s.min + 'min' + (s.speed ? '@' + s.speed + 'km/h' : '')
  else txt = (Number(s.w) || 0) + 'x' + (Number(s.r) || 0)
  return rir == null || s.sec != null || s.min != null ? txt : txt + '@' + rir
}

// `judge` adds the low/ok/high status — only for a whole microcycle's worth of sets. The block in
// progress is partial by definition, and a status on it would read "low" to a model on day one.
function volumeRows(v, judge) {
  return VOLUME_GROUPS.map(g => {
    const sets = round1(v.groups[g.key] || 0)
    return judge ? { group: g.key, sets, status: volumeStatus(sets) } : { group: g.key, sets }
  })
}

function bodyweightOf(S, today) {
  const log = (S.bodyweight || []).filter(b => b && b.w > 0)
  if (!log.length && !S.targetW) return null
  const latest = log[log.length - 1] || null
  // Change against the oldest weigh-in inside the window (not before it — a gap is not a trend).
  const changeOver = days => {
    if (!latest) return null
    const first = log.find(b => daysBetween(b.d, today) <= days)
    return first && first !== latest ? round1(latest.w - first.w) : null
  }
  return {
    latest: latest ? { date: latest.d, weight: latest.w } : null,
    goal: S.targetW || null,
    change_4w: changeOver(28),
    change_12w: changeOver(84),
  }
}

function strengthOf(S, windowed, nameOf, since) {
  const count = {}
  for (const w of windowed) for (const e of w.entries || []) {
    if ((e.sets || []).some(s => s.done && !isWarmupRow(s))) count[e.id] = (count[e.id] || 0) + 1
  }
  return Object.keys(count)
    .sort((a, b) => count[b] - count[a] || a.localeCompare(b))
    .map(id => {
      const pts = e1rmSeries(S, id).filter(p => (p.t || Date.parse(p.d)) >= since)
      if (pts.length < 2) return null
      const first = pts[0], last = pts[pts.length - 1]
      const best = Math.max(...pts.map(p => p.y))
      return {
        exercise: nameOf(id, null),
        sessions: pts.length,
        e1rm_first: first.y, e1rm_last: last.y, e1rm_best: best,
        change_pct: round1((last.y - first.y) / first.y * 100),
      }
    })
    .filter(Boolean)
    .slice(0, DIGEST_LIFTS)
}

function progressionOf(S, nameOf) {
  return doubleProgressExercises(S).map(({ cfg, routine }) => {
    const st = doubleProgressStatus(S, cfg, routine)
    return {
      exercise: nameOf(cfg.id, null),
      state: st.state,
      weight: st.weight,
      range: [st.bottom, st.top],
      last_reps: st.reps,
      stalled_sessions: st.stalls || 0,
      deload_after: st.deloadAt || null,
      sessions_to_top: st.sessionsLeft,
    }
  })
}

/**
 * Deterministic findings, most pressing first. Each is `{ type, ...detail }` — no prose, so the
 * UI translates them and the model reads them as structured hints.
 */
export function findingsOf(d) {
  const out = []
  if (d.mesocycle.deload_mandatory) out.push({ type: 'deload-mandatory', loading_microcycles: d.mesocycle.loading_streak })
  else if (d.mesocycle.deload_suggested) out.push({ type: 'deload-suggested', loading_microcycles: d.mesocycle.loading_streak })
  for (const p of d.progression) {
    if (p.state === 'deload') out.push({ type: 'stalled', exercise: p.exercise, sessions: p.stalled_sessions })
    else if (p.state === 'fatigue') out.push({ type: 'fatigue', exercise: p.exercise })
    else if (p.state === 'ready') out.push({ type: 'ready-to-progress', exercise: p.exercise })
  }
  if (d.adherence.days_since_last != null && d.adherence.days_since_last > 7) {
    out.push({ type: 'inactive', days: d.adherence.days_since_last })
  }
  // Volume is only judged against the plan (a block half trained is not low yet) or, with no
  // plan, once the block has been fully trained.
  const judged = d.volume.planned || (d.volume.current.sessions >= d.microcycle.length ? d.volume.current : null)
  if (judged) for (const g of judged.groups) {
    if (g.status !== 'ok') out.push({ type: g.status === 'low' ? 'volume-low' : 'volume-high', group: g.group, sets: g.sets, source: judged === d.volume.planned ? 'plan' : 'logged' })
  }
  for (const s of d.strength) if (s.change_pct <= -5) out.push({ type: 'strength-drop', exercise: s.exercise, change_pct: s.change_pct })
  return out
}

/**
 * Build the digest.
 *
 * `nameOf(id, entry)` names an exercise (the UI passes the translated display name);
 * `now`/`today` pin the clock for tests; `weeks` sets the look-back window.
 */
export function buildDigest(S, { now = Date.now(), today = todayISO(), weeks = DIGEST_WEEKS, nameOf = defaultName } = {}) {
  const since = now - weeks * 7 * DAY
  const workouts = (S.workouts || []).slice().sort((a, b) => timeOf(a) - timeOf(b))
  const windowed = workouts.filter(w => timeOf(w) >= since)
  const last = workouts[workouts.length - 1] || null

  const pos = cyclePosition(S)
  const meso = mesoState(S)
  const current = cycleVolume(S)
  // A sequence whose routines were all deleted (or are empty) plans nothing — that is no plan
  // to judge volume against, not a plan with zero sets in every group.
  const plan = trainingSteps(S.program).length ? plannedVolume(S) : null
  const planned = plan && plan.total > 0 ? plan : null

  const digest = {
    generated: today,
    unit: S.unit || 'kg',
    window_weeks: weeks,
    microcycle: {
      strategy: strategyOf(S),
      length: pos.len,
      index: pos.cycle,
      next_session: pos.step + 1,
      remaining: pos.remaining,
      next_routine: null,
    },
    mesocycle: {
      loading_streak: meso.streak,
      deload_now: meso.deload,
      deload_scheduled: meso.scheduled,
      deload_suggested: meso.suggest,
      deload_mandatory: meso.mandatory,
      deload_pct: meso.pct,
    },
    adherence: {
      sessions_total: workouts.length,
      sessions_in_window: windowed.length,
      per_week: round1(windowed.length / weeks),
      last_session: last ? last.d : null,
      days_since_last: last ? daysBetween(last.d, today) : null,
    },
    volume: {
      target: VOLUME_TARGET,
      current: { sessions: current.sessions, rated_sets: current.rated, unrated_sets: current.unrated, groups: volumeRows(current, current.sessions >= pos.len) },
      planned: planned ? { sessions: planned.sessions, groups: volumeRows(planned, true) } : null,
    },
    progression: progressionOf(S, nameOf),
    strength: strengthOf(S, windowed, nameOf, since),
    bodyweight: bodyweightOf(S, today),
    routines: (S.routines || []).map(r => ({
      name: r.name || '',
      exercises: (r.ex || []).map(c => ({ exercise: nameOf(c.id, null), sets: c.sets || 1, reps: c.repsMin && c.reps ? c.repsMin + '-' + c.reps : c.reps || null, weight: c.weight || 0, progression: c.prog || null })),
    })),
    recent: windowed.slice(-DIGEST_RECENT).reverse().map(w => ({
      date: w.d,
      routine: w.name || null,
      minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
      deload: w.excludeFromProgression === true || undefined,
      exercises: (w.entries || []).map(e => ({
        exercise: nameOf(e.id, e),
        sets: (e.sets || []).filter(s => s.done && !isWarmupRow(s)).map(setText).join(' '),
      })).filter(e => e.sets),
    })),
  }
  const nextId = nextStepOf(S)
  const nextRoutine = nextId && (S.routines || []).find(r => r.id === nextId)
  digest.microcycle.next_routine = nextRoutine ? nextRoutine.name || null : null
  digest.findings = findingsOf(digest)
  return digest
}

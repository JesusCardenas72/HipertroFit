// How each muscle group answered a session, and what that says about next microcycle's sets.
//
// The volume band (volume.js) is a population figure: 12–20 sets of chest suits most people, not
// necessarily you, and not in every week of a mesocycle. What tells the two apart is how the
// muscle responds. So, when a session ends, each group it trained gets three quick answers:
//
//   pump  — how congested the muscle got:        0 low · 1 good · 2 great
//   work  — how the session's workload felt:     0 easy · 1 about right · 2 too much
//   sore  — how it arrived at this session:      0 not sore · 1 recovered just in time · 2 still sore
//
// They are stored on the finished workout (`w.feedback = { chest: { pump, work, sore } }`), and
// when the microcycle closes the answers of its sessions are read back per group into a step:
// more sets when the muscle recovers early and the work feels easy, fewer when it arrives still
// sore or the work was too much. The step becomes a proposal on the routines' set counts
// (ai-actions.js nudgeProposal), shown and applied only on the user's say-so.
//
// Recovery weighs more than pump: a great pump is a sign the dose already works, a muscle still
// sore when it is trained again is a sign the dose is beyond what it recovers from — and that is
// the one that costs growth.
//
// The volume ramp (Settings, `S.volumeRamp`, on unless switched off) is the default those answers
// modulate, the way a hypertrophy mesocycle is run: it starts low and climbs. Closing a loading
// microcycle adds one set to every group the plan trains, up to the top of its band, unless its
// answers say to hold or cut; answers asking for more still go up to the MRV. Closing the deload
// starts the next mesocycle again from the bottom of each band.

import { VOLUME_GROUPS, groupVolume, plannedVolume, targetOf } from './volume.js'
import { cycleWorkouts, isExtra, trainingSteps } from './microcycle.js'
import { mesoState } from './mesocycle.js'
import { nudgeProposal, nudgeBlocker, applyProposal } from './ai-actions.js'

export const FEEDBACK_FIELDS = ['pump', 'work', 'sore']

/** Points each answer adds to a session's score: positive asks for more sets, negative for fewer. */
export const FEEDBACK_POINTS = {
  pump: [0.5, 0, -0.5],
  work: [1, 0, -1.5],
  sore: [1, 0, -1.5],
}

// Below this many sets a group was only brushed by the session: asking about its pump is noise.
export const MIN_FEEDBACK_SETS = 1

const clean = v => (v === 0 || v === 1 || v === 2 ? v : null)

/** One group's answers, tidied: each field 0–2 or left out. Null when nothing is left. */
export function normalizeAnswer(a) {
  if (!a || typeof a !== 'object') return null
  const out = {}
  for (const f of FEEDBACK_FIELDS) { const v = clean(a[f]); if (v != null) out[f] = v }
  return Object.keys(out).length ? out : null
}

/** A workout's feedback, tidied: unknown groups and empty answers dropped. */
export function normalizeFeedback(fb) {
  const out = {}
  if (!fb || typeof fb !== 'object') return out
  const keys = new Set(VOLUME_GROUPS.map(g => g.key))
  for (const k in fb) {
    if (!keys.has(k)) continue
    const a = normalizeAnswer(fb[k])
    if (a) out[k] = a
  }
  return out
}

/**
 * The groups a finished workout trained enough to ask about, in panel order, with the sets each
 * got. Every done work set counts here, rated or not — the question is whether the muscle worked.
 */
export function feedbackGroups(w) {
  const { groups } = groupVolume(w ? [w] : [], () => true)
  return VOLUME_GROUPS
    .filter(g => (groups[g.key] || 0) >= MIN_FEEDBACK_SETS)
    .map(g => ({ key: g.key, name: g.name, sets: Math.round(groups[g.key] * 10) / 10 }))
}

/** One session's answers for one group → its score. Unanswered fields count as neutral. */
export function answerScore(a) {
  const n = normalizeAnswer(a)
  if (!n) return null
  let s = 0
  for (const f of FEEDBACK_FIELDS) if (n[f] != null) s += FEEDBACK_POINTS[f][n[f]]
  return s
}

/** Average score → sets to add or remove next microcycle (−2…+2). */
export function stepOf(score) {
  if (score == null) return 0
  if (score >= 1.5) return 2
  if (score >= 0.5) return 1
  if (score <= -2) return -2
  if (score <= -1) return -1
  return 0
}

/**
 * What the answers of a run of workouts say about one group: how many sessions answered, the
 * average score, the step it asks for, and the answers that pushed it (for the "why" line) —
 * each field's most frequent answer when it is not the neutral one.
 */
export function groupSignal(workouts, key) {
  const answers = (workouts || []).map(w => normalizeFeedback(w && w.feedback)[key]).filter(Boolean)
  if (!answers.length) return { sessions: 0, score: null, step: 0, reasons: [] }
  const score = Math.round(answers.reduce((s, a) => s + answerScore(a), 0) / answers.length * 100) / 100
  const reasons = []
  for (const f of FEEDBACK_FIELDS) {
    const count = [0, 0, 0]
    for (const a of answers) if (a[f] != null) count[a[f]]++
    const top = count.indexOf(Math.max(...count))
    if (count[top] > 0 && top !== 1) reasons.push({ f, v: top })
  }
  return { sessions: answers.length, score, step: stepOf(score), reasons }
}

/** Whether the volume ramp runs (Settings). On unless switched off. */
export const rampOn = S => !!S && S.volumeRamp !== false

// One set a microcycle: the ramp's step for a group with no answers, or answers that did not ask
// to hold (score 0 or better, rounded down to a hold by stepOf).
export const RAMP_STEP = 1

const round1 = v => Math.round((v || 0) * 10) / 10
const cloneRoutines = S => ({ ...S, routines: (S.routines || []).map(r => ({ ...r, ex: (r.ex || []).map(c => ({ ...c })) })) })

// The merged set changes between S and the trial copy it was walked on.
function changesBetween(S, trial) {
  const changes = []
  ;(S.routines || []).forEach((r, ri) => (r.ex || []).forEach((cfg, idx) => {
    const now = trial.routines[ri].ex[idx]
    const from = Math.max(1, Math.round(cfg && cfg.sets) || 1), to = Math.max(1, Math.round(now && now.sets) || 1)
    if (cfg && from !== to) changes.push({ routineId: r.id, routineName: r.name || '', idx, exId: cfg.id, from, to })
  }))
  return changes
}

// Walk `wanted` ({ g, sig, step, source, opts }) in order on a trial copy: each group's nudge sees
// the sets the earlier ones moved. Ramp-only groups that cannot move are left out — the ramp has
// nothing to say about them — while a group the user's answers asked about keeps its reason.
function walk(S, wanted, skip) {
  const trial = cloneRoutines(S)
  const before = plannedVolume(S).groups
  const groups = []
  for (const { g, sig, step, source, opts } of wanted) {
    const off = skip.includes(g.key)
    const p = off ? null : nudgeProposal(trial, g.key, step, opts)
    if (p) applyProposal(trial, p)
    const capped = !off && !p ? nudgeBlocker(trial, g.key, step) || (step > 0 ? 'max' : 'min') : false
    if (capped && source !== 'feedback') continue
    groups.push({ key: g.key, name: g.name, signal: { ...sig, step }, source, skipped: off, capped, changes: p ? p.changes : [] })
  }
  const after = plannedVolume(trial).groups
  for (const x of groups) {
    x.before = round1(before[x.key])
    x.after = x.skipped || x.capped ? x.before : round1(after[x.key])
  }
  return { groups, changes: changesBetween(S, trial) }
}

/**
 * A new mesocycle opening after the deload: every group the plan takes above the bottom of its
 * band comes back down to it, never below, so the ramp has room to climb again.
 */
export function mesoStartPlan(S, { skip = [] } = {}) {
  if (!trainingSteps(S && S.program).length) return { blocked: 'noplan', groups: [], changes: [], kind: 'start' }
  const planned = plannedVolume(S).groups
  const wanted = []
  for (const g of VOLUME_GROUPS) {
    const min = targetOf(g).min
    const over = Math.floor((planned[g.key] || 0) - min)
    if (over >= 1) wanted.push({ g, sig: { sessions: 0, score: null, reasons: [] }, step: -over, source: 'start', opts: { floor: min } })
  }
  return { blocked: null, kind: 'start', ...walk(S, wanted, skip) }
}

/**
 * The set changes the running microcycle's feedback proposes for the next one.
 *
 * `blocked` says why nothing is proposed at all: 'deload' when this microcycle or the next is a
 * deload (the deload already decides the next block's volume, and a deload's answers say nothing
 * about the loading dose), 'none' when no session answered, 'noplan' when there is no calendar
 * programming to hold a planned microcycle — then `groups` still lists what each group asks for,
 * to act on by hand. Otherwise `groups` lists every group that asked for a step — with what it
 * moves the plan from and to, or `capped` with the reason no exercise could take it
 * (nudgeBlocker: 'max', 'min', 'noexercise') — and `changes` the merged set changes of the groups
 * not in `skip`, ready for applyProposal.
 *
 * Groups are walked in panel order on a trial copy, so a later group sees the sets an earlier one
 * already added; only primary movers are touched (nudgeProposal), so they rarely meet.
 */
export function feedbackPlan(S, { skip = [] } = {}) {
  const empty = { blocked: null, groups: [], changes: [] }
  const m = mesoState(S)
  const ramp = rampOn(S)
  if (m.next) return { ...empty, blocked: 'deload' }
  if (m.deload) return ramp ? mesoStartPlan(S, { skip }) : { ...empty, blocked: 'deload' }
  const ws = cycleWorkouts(S).filter(w => !isExtra(w))
  const signals = VOLUME_GROUPS.map(g => ({ g, sig: groupSignal(ws, g.key) }))
  const asked = signals.filter(x => x.sig.sessions > 0)
  const planned = plannedVolume(S).groups
  const wanted = []
  for (const { g, sig } of signals) {
    const band = targetOf(g)
    if (sig.sessions > 0) {
      // Answers asking for more go up to the MRV (nudgeProposal's default); the ramp's own set
      // only to the top of the band.
      if (sig.step) wanted.push({ g, sig, step: sig.step, source: 'feedback' })
      else if (ramp && sig.score >= 0 && (planned[g.key] || 0) >= 1) wanted.push({ g, sig, step: RAMP_STEP, source: 'ramp', opts: { ceil: band.max } })
    } else if (ramp && (planned[g.key] || 0) >= 1) {
      wanted.push({ g, sig, step: RAMP_STEP, source: 'ramp', opts: { ceil: band.max } })
    }
  }
  if (!asked.length && !wanted.length) return { ...empty, blocked: 'none' }
  if (!trainingSteps(S && S.program).length) {
    const groups = wanted.filter(x => x.source === 'feedback')
      .map(({ g, sig }) => ({ key: g.key, name: g.name, signal: sig, source: 'feedback', skipped: false, capped: 'noplan', changes: [] }))
    return { ...empty, blocked: 'noplan', groups, asked: asked.length }
  }
  return { blocked: null, ...walk(S, wanted, skip), asked: asked.length }
}

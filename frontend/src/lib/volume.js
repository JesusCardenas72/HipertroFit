// Training volume as effective sets, accumulated over a microcycle.
//
// "Effective set" here is this project's volume unit: a completed work set taken close
// enough to failure to drive hypertrophy — RIR <= 4 (see the volumen-series-efectivas
// note). Effort logging is optional and usually off, so a set with no RIR logged is
// counted as effective too — you do not leave a working set in the tank on purpose — and
// the coverage figures let the UI say how much of the volume is actually rated. Warm-ups
// never count.
//
// The window is the microcycle, NOT the calendar week: for a Push/Pull/Legs split one
// microcycle is two full rounds = 6 sessions, and six training days routinely spill past
// seven calendar days, so counting by week would cut one microcycle in two. Where the block
// starts and ends is lib/microcycle.js's business; this file only adds its sets up. Volume
// accumulates inside the block and restarts with the next one — it is not a rolling window.
// Everything trained inside the block counts, planned or not: an extra session squeezed in
// mid-microcycle adds all of its sets here (it just does not consume one of the block's
// planned slots — see microcycle.js isPlannedSession).
//
// Grouping is deliberately per-set, taking the strongest involvement of any muscle in a
// group rather than summing the group's muscles: a squat counts as one leg set, not as
// quads + glutes + hamstrings stacked. Secondary muscles still earn partial credit (the
// 0.4 weight from musclesOf), which is the usual way fractional volume is counted.

import { cycleWorkouts, cycleStrip, workoutDaysOver, microcycleLen, isExtra } from './microcycle.js'
import { REST } from './program.js'
import { volumeMusclesOf, LATS, REAR_DELTS } from './muscles.js'
import { EXIDX } from './exercises.js'
import { rirOf } from './effort.js'
import { isWarmupRow } from './workout-model.js'
import { resumableOf } from './paused-workout.js'
import { todayISO } from './format.js'

// This project's volume threshold. Distinct from effort.js HARD_RIR (3), which labels a
// set "hard" for the muscle map; this is the product decision for what counts as volume.
export const EFFECTIVE_RIR = 4

// Effective-set target per muscle group per microcycle (the adaptive band from the note). A
// group can carry its own `target` instead — the parts of a split Back or Legs do, see below.
export const VOLUME_TARGET = { min: 10, max: 20 }

/** The band a group is judged against: the one its method gave it, or the shared 10–20. */
export const targetOf = g => (g && g.target) || VOLUME_TARGET

// The muscle groups shown on the home volume panel, in display order, each folding one or
// more canonical muscles (see lib/muscles.js MUSCLES, plus the volume-only 'lats'). Names are
// i18n keys; `short`, when present, is the compact label the bar rows use so the bars get the
// width.
//   - "Side delts" uses the whole deltoids group as a proxy: the dataset does not separate
//     the three heads, so this over-counts pressing. Labelled as the user asked for.
//   - Legs folds every lower-body muscle; Back is upper back, lats and lower back, as specified.
//   - Either can be split into its parts (Settings ▸ Training volume, S.volumeSplit), each
//     independently. The parts cover every muscle the whole group did — adductors and hip
//     flexors count with the glutes, the shins with the calves — so nothing drops out of the
//     panel when it is split. Upper back takes the traps and the rear delts too (the whole
//     group never did). `parent` is the whole group a part belongs to, so the panel can show
//     the parts together under it.
//   - Each part has its own band, because they recover so differently: the upper back
//     (short range, slow-twitch) tolerates 10–22, the lats 10–20; the erectors get a big
//     isometric dose from every deadlift, squat and heavy row, so only 0–6 direct sets.
//     Quads (huge systemic fatigue) 8–18, hamstrings 6–16, calves 8–20, glutes 4–12.
//   - `direct` parts count only sets where one of their muscles is the main target: the
//     erector band is for direct work, so the 0.4 a squat or deadlift lends the lower back
//     must not fill it. Glutes are NOT direct: squats and RDLs grow them about as well as
//     hip thrusts, so their indirect sets earn the usual secondary credit like any group.
const LEGS = { key: 'legs', name: 'Legs', muscles: ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'hip-flexors', 'calves', 'tibialis'] }
const LEGS_SPLIT = [
  { key: 'glutes', name: 'Glutes', parent: 'legs', target: { min: 4, max: 12 }, muscles: ['gluteal', 'adductors', 'hip-flexors'] },
  { key: 'hamstrings', name: 'Hamstrings', parent: 'legs', target: { min: 6, max: 16 }, muscles: ['hamstring'] },
  { key: 'quads', name: 'Quads', parent: 'legs', target: { min: 8, max: 18 }, muscles: ['quadriceps'] },
  { key: 'calves', name: 'Calves', parent: 'legs', target: { min: 8, max: 20 }, muscles: ['calves', 'tibialis'] },
]
const BACK = { key: 'back', name: 'Back muscles', muscles: ['upper-back', LATS, 'lower-back'] }
const BACK_SPLIT = [
  { key: 'upper-back', name: 'Upper back', parent: 'back', target: { min: 10, max: 22 }, muscles: ['upper-back', 'trapezius', REAR_DELTS] },
  { key: 'lats', name: 'Lats', parent: 'back', target: { min: 10, max: 20 }, muscles: [LATS] },
  { key: 'erectors', name: 'Spinal erectors', short: 'Erectors', parent: 'back', direct: true, target: { min: 0, max: 6 }, muscles: ['lower-back'] },
]
const REST_GROUPS = [
  { key: 'delts', name: 'Side delts', short: 'Lat. delts', muscles: ['deltoids', REAR_DELTS] },
  { key: 'biceps', name: 'Biceps', muscles: ['biceps'] },
  { key: 'triceps', name: 'Triceps', muscles: ['triceps'] },
  { key: 'abs', name: 'Abs', short: 'ABS', muscles: ['abs', 'obliques'] },
]
const CHEST = { key: 'chest', name: 'Chest', muscles: ['chest'] }

/** The user's split choice, tidied: { back, legs } booleans, anything else is "not split". */
export const normalizeVolumeSplit = split => ({ back: !!(split && split.back), legs: !!(split && split.legs) })

// ---- How the target band of each group is set (Settings ▸ Training volume, S.volumeMethod) ----
//
// Two methods, the user's choice:
//   - 'classic' — the reference volume landmarks per muscle: maintenance (mv), minimum effective
//     (min), maximum adaptive (max) and maximum recoverable (mrv) sets per microcycle, with the
//     usual weekly frequency and rep range. The band a group is judged against is min–max (the
//     optimal volume); mv/mrv/freq/reps travel along as reference (`ref`) for the Settings table.
//     The dataset does not separate the delt heads, so the delts row uses the lateral head's
//     landmarks; a split Back's lats and an unsplit Back both read the lats (dorsal) row. Groups
//     the table has no row for (whole legs, calves, upper back, erectors) keep their own band.
//   - 'simple' — each group gets a priority and the priority sets the band: low 6–8, medium
//     8–10, high 12–15 effective sets per microcycle.
export const VOLUME_METHODS = ['classic', 'simple']
export const PRIORITIES = ['low', 'medium', 'high']
export const PRIORITY_TARGET = { low: { min: 6, max: 8 }, medium: { min: 8, max: 10 }, high: { min: 12, max: 15 } }
// Erectors count direct sets only (see BACK_SPLIT), so they start low; everything else medium.
const DEFAULT_PRIORITY = { erectors: 'low' }

const landmark = (mv, min, max, mrv, freq, reps) => ({ target: { min, max }, ref: { mv, mrv, freq, reps } })
const LATS_ROW = landmark(10, 14, 22, 25, '2–4', '6–20')
export const CLASSIC_LANDMARKS = {
  biceps: landmark(8, 14, 20, 26, '2–6', '8–15'),
  delts: landmark(0, 8, 12, 14, '2–6', '10–20'),
  chest: landmark(10, 12, 20, 22, '1–3', '8–12'),
  quads: landmark(8, 12, 18, 20, '1–3', '8–15'),
  hamstrings: landmark(6, 10, 16, 20, '2–3', '3–20'),
  glutes: landmark(0, 4, 12, 16, '2–3', '8–12'),
  lats: LATS_ROW,
  back: LATS_ROW,
  triceps: landmark(0, 12, 20, 26, '2–4', '6–20'),
  abs: landmark(0, 16, 20, 26, '3–5', '8–20'),
}

/** The method in force, tidied: 'classic' unless 'simple' was chosen. */
export const normalizeVolumeMethod = m => (m === 'simple' ? 'simple' : 'classic')

/** A group's priority under the simplified method: the user's pick, else its default. */
export const priorityOf = (priorities, key) => {
  const p = priorities && priorities[key]
  return PRIORITIES.includes(p) ? p : (DEFAULT_PRIORITY[key] || 'medium')
}

// A group with the band the chosen method gives it.
function withTarget(g, method, priorities) {
  if (method === 'simple') {
    const priority = priorityOf(priorities, g.key)
    return { ...g, priority, target: PRIORITY_TARGET[priority] }
  }
  const row = CLASSIC_LANDMARKS[g.key]
  return row ? { ...g, target: row.target, ref: row.ref } : { ...g, target: g.target || VOLUME_TARGET }
}

/** The panel's groups for a split choice and target method, in display order. */
export function volumeGroups(split, method = 'classic', priorities = {}) {
  const { back, legs } = normalizeVolumeSplit(split)
  const m = normalizeVolumeMethod(method)
  return [...(legs ? LEGS_SPLIT : [LEGS]), CHEST, ...(back ? BACK_SPLIT : [BACK]), ...REST_GROUPS]
    .map(g => withTarget(g, m, priorities))
}

/** Every group key any split can produce — the fixed vocabulary the AI response schema allows. */
export const ALL_GROUP_KEYS = [...new Set([...volumeGroups({ back: true, legs: true }), ...volumeGroups()].map(g => g.key))]

// The groups in force. Like the secondary weight in lib/muscles.js, the split is a user setting
// pushed in by the store, so every reader (panel, plan, AI digest and proposals) agrees on it
// without threading it through. A live binding: importers always see the current list.
export let VOLUME_GROUPS = volumeGroups()
let CONFIG = { split: undefined, method: 'classic', priorities: {} }

// muscle slug -> the groups it counts toward (rear delts count toward two once back is split).
let GROUP_OF = {}
const indexGroups = () => {
  GROUP_OF = {}
  for (const g of VOLUME_GROUPS) for (const slug of g.muscles) (GROUP_OF[slug] = GROUP_OF[slug] || []).push(g)
}
indexGroups()

/** Set which groups are split into their parts from here on (store -> lib). */
export function setVolumeSplit(split) {
  CONFIG = { ...CONFIG, split }
  VOLUME_GROUPS = volumeGroups(CONFIG.split, CONFIG.method, CONFIG.priorities)
  indexGroups()
}

/** Set how each group's target band is chosen from here on (store -> lib): method + priorities. */
export function setVolumeMethod(method, priorities) {
  CONFIG = { ...CONFIG, method: normalizeVolumeMethod(method), priorities: priorities || {} }
  VOLUME_GROUPS = volumeGroups(CONFIG.split, CONFIG.method, CONFIG.priorities)
  indexGroups()
}

/** The method in force ('classic' | 'simple'). */
export const volumeMethod = () => CONFIG.method

/** A completed work set that counts as volume: RIR <= 4, or unrated (counted, per product). */
export const isEffectiveSet = s => { const r = rirOf(s); return r == null || r <= EFFECTIVE_RIR }

// The muscle map a workout entry trains, resolving the same way loadOf does: a completed
// entry may carry its own weighted snapshot (custom exercise since deleted); otherwise the
// catalogue entry by id wins, then whatever metadata the entry itself holds.
function entryMuscles(entry) {
  const historical = entry.exercise || entry
  const source = historical && historical.muscleWeights ? historical : (EXIDX[entry.id] || historical)
  return volumeMusclesOf(source)
}

// Credit `n` sets of an exercise to each group it trains, at the strongest involvement of
// any of the group's muscles — never their sum. A `direct` group only takes a muscle the
// exercise targets primarily (a full 1).
function creditSet(groups, mus, n) {
  const best = {}
  for (const slug in mus) {
    for (const g of GROUP_OF[slug] || []) {
      if (g.direct && mus[slug] < 1) continue
      best[g.key] = Math.max(best[g.key] || 0, mus[slug])
    }
  }
  for (const g in best) groups[g] += best[g] * n
}

/** What one work set of a planned or logged exercise credits each group: { groupKey: weight }. */
export function setCredit(entry) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  creditSet(groups, entryMuscles(entry), 1)
  return groups
}

/**
 * Effective-set volume per muscle group across a set of workouts.
 *
 * `pick` decides which done work sets count toward the volume (defaults to the RIR<=4
 * rule) — `effective` is how many did; the rated/unrated coverage counts every done work set
 * regardless, so the UI can report how much of the window was actually rated. Per set, each group is credited with
 * the strongest involvement of any of its muscles — never their sum.
 */
export function groupVolume(workouts, pick = isEffectiveSet) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  let rated = 0, unrated = 0, effective = 0
  for (const w of workouts || []) {
    for (const e of w.entries || []) {
      const mus = entryMuscles(e)
      for (const s of e.sets || []) {
        if (!s.done || isWarmupRow(s)) continue
        if (rirOf(s) == null) unrated++; else rated++
        if (pick && !pick(s)) continue
        effective++
        creditSet(groups, mus, 1)
      }
    }
  }
  return { groups, rated, unrated, total: rated + unrated, effective }
}

/**
 * Effective-set volume per muscle group over the current microcycle — everything logged
 * since the block opened (lib/microcycle.js), off-plan sessions included. `sessions` says
 * how many that is, so the UI can show the block filling up rather than implying the count
 * is final.
 *
 * A session left paused in the block (lib/paused-workout.js) adds the sets already done in it:
 * they were trained, whether or not the session is ever finished. It is not a session of the
 * block yet, so `sessions` does not count it.
 */
export function cycleVolume(S, today = todayISO()) {
  const win = cycleWorkouts(S)
  // Loose extra work adds its sets but is not a session of the block.
  return { ...groupVolume([...win, ...resumableOf(S, today)]), sessions: win.filter(w => !isExtra(w)).length }
}

// Credit the work sets of a paused session still to do — its plan from here on.
function creditRemaining(groups, session) {
  for (const e of session.entries || []) {
    const n = (e.sets || []).filter(x => !x.done && !isWarmupRow(x)).length
    if (n) creditSet(groups, entryMuscles(e), n)
  }
}

// Credit every work set a routine configures (warm-ups never count); returns how many that is.
function creditRoutine(groups, routine) {
  let total = 0
  for (const cfg of (routine && routine.ex) || []) {
    const n = Math.max(1, Math.round(cfg.sets) || 1)
    creditSet(groups, entryMuscles(cfg), n)
    total += n
  }
  return total
}

/**
 * The volume the programming plans for one microcycle, before anything is trained — what the
 * Programming sheet shows while the sequence is being built.
 *
 * One microcycle is microcycleLen(S) sessions, taken from the sequence's training steps in
 * order and wrapping around: a Push/Pull/Legs sequence under the PPL strategy (6 sessions) is
 * counted twice, which is what the block will actually train. Rest days and deleted routines
 * plan nothing. Each exercise contributes the work sets its routine configures (`sets`, warm-ups
 * never count), credited per group the same way groupVolume credits a logged set, so the plan
 * reads on the same scale as the live panel. Every planned set is assumed effective.
 */
export function plannedVolume(S) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  const routines = (S && S.routines) || []
  const byId = id => routines.find(r => r.id === id)
  // A deleted routine still holds its slot in the block (microcycleLen counts it); it just
  // plans no sets.
  const steps = ((S && S.program && S.program.seq) || []).filter(x => x && x !== REST)
  const len = steps.length ? microcycleLen(S) : 0
  let total = 0
  for (let i = 0; i < len; i++) total += creditRoutine(groups, byId(steps[i % steps.length]))
  return { groups, rated: total, unrated: 0, total, sessions: len }
}

/**
 * The volume the running microcycle still plans: the sets of the steps it has open (cycleStrip),
 * credited the same way plannedVolume credits them. A step counts until a session fills it, so
 * what was done in that session — more or less than planned — replaces its plan. Nothing is ahead
 * once the block is complete, nor once its scheduled workout days are over: from then on the
 * calendar has no more sessions for it.
 *
 * A step whose routine is paused is half trained: its done sets already count (cycleVolume), so
 * only the sets left in the paused session are ahead, not the routine's whole plan again.
 */
export function plannedAhead(S, today = todayISO()) {
  const groups = {}
  for (const g of VOLUME_GROUPS) groups[g.key] = 0
  if (workoutDaysOver(S, today)) return { groups }
  const routines = (S && S.routines) || []
  const paused = resumableOf(S, today).filter(p => p.routineId)
  for (const step of cycleStrip(S)) {
    if (step.state === 'done') continue
    const k = paused.findIndex(p => p.routineId === step.routineId)
    if (k >= 0) creditRemaining(groups, paused.splice(k, 1)[0])
    else creditRoutine(groups, routines.find(r => r.id === step.routineId))
  }
  return { groups }
}

/** Traffic-light status of a group's effective-set count against a target band (default 10–20). */
export function volumeStatus(v, target = VOLUME_TARGET) {
  if (v < target.min) return 'low'
  if (v > target.max) return 'high'
  return 'ok'
}

/** CSS colour token for a volume status — under-target, in-band, over-target. */
export const volumeColor = status =>
  status === 'ok' ? 'var(--green)' : status === 'high' ? 'var(--red)' : 'var(--orange)'

const round1 = n => Math.round((n || 0) * 10) / 10

/**
 * One group's row of the live volume panel read against the plan: effective sets done so far
 * (`done`), the sets the microcycle plans for it (`planned`, plannedVolume), the share of that
 * plan already executed (`pct`, null when the group plans nothing) and the band's top, the
 * optimal maximum (`max`). The plan is meant to sit below that maximum — `over` flags a plan
 * that does not, so the panel can show the programming itself overshoots.
 */
export function groupProgress(group, vol, planned) {
  const band = targetOf(group)
  const done = round1(vol && vol.groups[group.key])
  const plan = round1(planned && planned.groups[group.key])
  return {
    done, planned: plan, max: band.max, min: band.min,
    pct: plan > 0 ? Math.round(done / plan * 100) : null,
    over: plan > band.max,
  }
}

/** Work sets done in the block against the sets it plans: { done, planned, pct }. */
export function cycleExecution(vol, planned) {
  const done = (vol && vol.total) || 0
  const plan = (planned && planned.total) || 0
  return { done, planned: plan, pct: plan > 0 ? Math.round(done / plan * 100) : null }
}

/**
 * What a block will still lack: for each group, the whole effective sets that take it up to its
 * minimum on top of what it has done and of `ahead`, the volume still to come (plannedAhead). So
 * off-plan work brings the count down, and at the end of the block, with nothing ahead, it is what
 * the block actually lacks. `done` is read at the same one decimal the panel shows (groupProgress),
 * so the count never disagrees with the figure beside it, and it is rounded up to whole sets — a
 * group 2.4 short needs 3, since two would leave it at 9.6. At or past its minimum a group owes
 * nothing, and so does one whose band has no minimum (the erectors' band starts at 0). The counts
 * are per group and must not be added up: one compound set also feeds the groups it trains alongside.
 * `excess` is the other side of the same reading: the whole sets the group will end up past its
 * optimal maximum, rounded up too — 1.2 over takes two sets off to get back under it.
 */
export function minimumGaps(vol, ahead) {
  return VOLUME_GROUPS.map(g => {
    const p = groupProgress(g, vol, null)
    const left = (ahead && ahead.groups[g.key]) || 0
    return {
      ...g, done: p.done, min: p.min,
      remaining: Math.max(0, Math.ceil(round1(p.min - p.done - left))),
      excess: Math.max(0, Math.ceil(round1(p.done + left - p.max))),
    }
  })
}

// What the same exercise looked like LAST time, set by set, and what to put in the row today.
//
// The card already prints one aggregate "Last time: 60×10, 60×10, 60×8" line. That answers
// "how did it go", not "what do I put in THIS row" — which is the question you are actually
// holding the bar over. These helpers pair each work row of the live session with the set that
// sat in the same position last session, and turn the session's progression plan (or, with no
// plan, last time's own numbers) into the values that row should carry.
//
// Pure on purpose: deciding what you lift next is exactly the logic CONTRIBUTING.md says must
// live here with a test beside it, not inside a component.

import { isWarmupRow } from './workout-model.js'
import { rerampWarmups } from './history.js'

const num = v => (v == null || v === '' ? null : Number(v))
const same = (a, b) => {
  const x = num(a), y = num(b)
  if (x == null || y == null) return x === y
  return Math.abs(x - y) < 1e-9
}

/**
 * Position of a row among the work rows of its list — the number the reference is keyed by.
 * Warm-ups are prep, not the session (the same rule lastEntryFor applies to history), so they
 * are skipped in the count and have no work index of their own.
 */
export function workIndexOf(sets, i) {
  const rows = Array.isArray(sets) ? sets : []
  if (i < 0 || i >= rows.length || isWarmupRow(rows[i])) return null
  let n = 0
  for (let k = 0; k < i; k++) if (!isWarmupRow(rows[k])) n++
  return n
}

/**
 * Last session's set for a work position.
 *
 * Positions line up one-to-one while both sessions have the same number of sets. Past the end —
 * you are on set 4 and last time you did 3 — the last set carries on being the reference rather
 * than the row going blank: the question "what did I do on the final set" is the one that still
 * has an answer, and a blank there is the row where the extra work is decided.
 */
export function referenceSet(prevSets, workIndex) {
  const rows = (Array.isArray(prevSets) ? prevSets : []).filter(s => s && !isWarmupRow(s))
  if (!rows.length || workIndex == null || workIndex < 0) return null
  return rows[Math.min(workIndex, rows.length - 1)]
}

/**
 * The values this row should carry to follow the progressive overload the app decided on.
 *
 * The session's prescription (`plan`, from nextPrescription) wins wherever it has an opinion —
 * that is the policy the user picked in the exercise's progression settings. Anything it left
 * open falls back to what was done last time, so an exercise with progression off still gets
 * "what you lifted last time" as its reference instead of nothing.
 *
 * Returns only the fields that differ from what the row already holds, or null when the row is
 * already right — the caller uses that to decide whether the "apply" chip is worth showing at
 * all. A logged set and a warm-up return null: neither is a row a prescription speaks to.
 */
export function suggestionFor({ mode = 'reps', plan = null, row = {}, reference = null, effort = null, base = null, step = 2.5 } = {}) {
  if (!row || row.done || isWarmupRow(row)) return null
  const want = targetFor({ mode, plan, reference, effort, base, step })
  if (!want) return null
  const diff = {}
  for (const k of Object.keys(want)) if (!same(row[k], want[k])) diff[k] = want[k]
  return Object.keys(diff).length ? diff : null
}

// How much harder one session asks for when weight and reps stay put: one rep closer to
// failure, which is a whole point on either scale (RIR 2 → 1, RPE 8 → 9).
const EFFORT_SCALE = { rir: { f: 'rir', dir: -1, min: 0, max: 10 }, rpe: { f: 'rpe', dir: 1, min: 6, max: 10 } }

/** The heaviest work set last session — the weight the prescription was decided from. */
export function topWeight(prevSets) {
  const ws = (Array.isArray(prevSets) ? prevSets : []).filter(s => s && !isWarmupRow(s)).map(s => num(s.w)).filter(w => w != null)
  return ws.length ? Math.max(...ws) : null
}

/**
 * The weight one set position should carry. The prescription speaks about the session's top
 * weight (`base`, the heaviest set last time); a set that sat below it last session — a pyramid,
 * a back-off set — moves by the same amount instead of being flattened onto one number. That is
 * what keeps a 110/120/130 ramp from coming back as 130/130/130, or a row from being offered
 * less than it lifted last time. A deload scales each set by the same fraction instead.
 */
function positionWeight(plan, reference, base, step) {
  const pw = plan?.weight != null ? num(plan.weight) : null
  const rw = num(reference?.w)
  if (pw == null) return rw
  if (rw == null || !(base > 0) || rw >= base) return pw
  if (plan.kind === 'deload') {
    const v = rw * pw / base
    return step > 0 ? Math.round(Math.round(v / step) * step * 10) / 10 : Math.round(v * 10) / 10
  }
  return Math.max(0, Math.round((rw + pw - base) * 10) / 10)
}

/**
 * Every value a work row should carry to follow the progression — weight, reps (or seconds) and,
 * when the profile logs it, the effort (`effort`: 'rir' | 'rpe').
 *
 * The plan decides weight and reps as described on suggestionFor, but a session-wide plan can
 * still leave one set exactly where it was — double progression aims at the weakest set, and a
 * "decide" at the top of the range holds everything until the athlete picks. A policy that
 * holds the load (`hold`, or an undecided `decide`) therefore owes every set one lever, in
 * order: never fewer reps than that set did at the same weight; one more rep, up to the plan's
 * `top`; failing that, one rep closer to failure on the effort scale. When weight or reps go up
 * the effort stays where it was — more load at the same effort is the overload. A deload, a
 * fatigued session, a plan that already moved (`up`) or progression off never push. No logged
 * effort last time means nothing to aim at, so none is set.
 */
export function targetFor({ mode = 'reps', plan = null, reference = null, effort = null, base = null, step = 2.5 } = {}) {
  // Cardio has no overload rule in the engine (nextPrescription only decides weight/reps/sec),
  // so there is nothing to suggest beyond what the plan already wrote into the row.
  if (mode === 'cardio') return null
  const want = {}
  if (mode === 'time') {
    const sec = plan?.sec != null ? plan.sec : num(reference?.sec)
    const w = positionWeight(plan, reference, base, step)
    if (sec != null && sec > 0) want.sec = sec
    if (w != null) want.w = w
    return Object.keys(want).length ? want : null
  }
  const w = positionWeight(plan, reference, base, step)
  let r = plan?.reps != null ? plan.reps : num(reference?.r)
  const rw = num(reference?.w), rr = num(reference?.r)
  const sameLoad = w == null || rw == null || same(w, rw)
  const owes = !!plan && (plan.kind === 'hold' || plan.kind === 'decide') && !plan.fatigue && sameLoad
  if (owes && rr != null && r != null && r < rr) r = rr
  const top = num(plan?.top)
  if (owes && rr != null && r != null && same(r, rr) && top > 0 && r < top) r = Math.min(top, r + (plan.stride > 0 ? plan.stride : 1))
  if (w != null) want.w = w
  if (r != null && r > 0) want.r = r
  const e = EFFORT_SCALE[effort]
  const prev = e && reference ? num(reference[e.f]) : null
  if (prev != null) {
    const sameReps = r == null || rr == null || same(r, rr)
    const next = owes && sameReps ? prev + e.dir : prev
    want[e.f] = Math.min(e.max, Math.max(e.min, next))
  }
  return Object.keys(want).length ? want : null
}

/**
 * Which lever today's target moves against the same set last time, as `{ f, d }` pairs —
 * `w` in load units, `r` in reps, `rir`/`rpe` in points (RIR going down reads as -1). Empty
 * when nothing moves: the row card says so instead of showing two identical numbers.
 */
export function overloadOf(target, reference) {
  if (!target || !reference) return []
  const out = []
  for (const f of ['w', 'r', 'sec', 'rir', 'rpe']) {
    const a = num(target[f]), b = num(reference[f])
    if (a == null || b == null || same(a, b)) continue
    out.push({ f, d: Math.round((a - b) * 10) / 10 })
  }
  return out
}

/**
 * Write the progression's targets into a freshly built list, so the steppers already hold the
 * numbers to lift instead of a chip having to be tapped first. Only undone work rows are touched,
 * each against the set in its own position last session (referenceSet). A plan that is off, a
 * first session or no plan at all leaves the rows exactly as they were built.
 */
export function seedTargets(sets, prevSets, { mode = 'reps', plan = null, effort = null, step = 2.5 } = {}) {
  const rows = Array.isArray(sets) ? sets : []
  if (!plan || plan.kind === 'off' || plan.kind === 'first') return rows
  const base = topWeight(prevSets)
  const out = rows.map((row, i) => {
    if (!row || row.done || isWarmupRow(row)) return row
    const want = targetFor({ mode, plan, reference: referenceSet(prevSets, workIndexOf(rows, i)), effort, base, step })
    return want ? { ...row, ...want } : row
  })
  // The first work set may now sit below the top weight, so the warm-ups ramp toward it again.
  return out.some(isWarmupRow) ? rerampWarmups(out, step) : out
}

/**
 * How many work sets today's list is short of.
 *
 * A policy may decide the next step is a set rather than a plate — that is how bodyweight work
 * progresses once reps top out (see nextPrescription). Sessions are built with that already
 * applied, so this normally reads 0; it speaks up when the plan was decided after the rows were
 * built, when a set was removed by hand, or when last session simply had more sets than today's
 * list does and dropping one was not deliberate.
 */
export function extraSetsWanted(plan, sets, prevSets) {
  const rows = (Array.isArray(sets) ? sets : []).filter(s => !isWarmupRow(s))
  const prev = (Array.isArray(prevSets) ? prevSets : []).filter(s => s && !isWarmupRow(s))
  const target = plan?.sets > 0 ? plan.sets : prev.length
  return Math.max(0, target - rows.length)
}

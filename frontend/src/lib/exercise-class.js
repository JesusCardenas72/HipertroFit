// What kind of lift an exercise is, and the rep range that follows from it.
//
// Three classes, each with its own optimal working range for double progression:
//   · compound  — heavy multi-joint free-weight work (squat, deadlift, bench, rows, pull-ups):
//                 5–12, low enough to load heavily, where technique limits the set.
//   · machine   — multi-joint work on a stable path (leg press, chest press, hack squat,
//                 Smith machine, cable pulldowns/rows): 8–10, stability lets you push close
//                 to failure without technique breaking down first.
//   · isolation — single-joint (analytic) work (curls, raises, extensions, flyes, calves,
//                 abs): 10–20, small muscles and joints that do better with lighter loads.
//
// The catalogue has no mechanics field, so the class is read off the name, the target muscle
// and the equipment. The rules were cross-checked against free-exercise-db (yuhonas), which
// does label compound/isolation, and against common strength-training references; OVERRIDES
// holds the exercises the rules alone got wrong.

import { defaultConfig, lastEntryFor } from './history.js'
import { normalizeRepRange } from './rep-range.js'

export const EXERCISE_CLASSES = ['compound', 'machine', 'isolation']

export const CLASS_REP_RANGE = {
  compound: { repsMin: 5, reps: 12 },
  machine: { repsMin: 8, reps: 10 },
  isolation: { repsMin: 10, reps: 20 },
}

export const CLASS_NAME = {
  compound: 'Heavy compound',
  machine: 'Stable machine',
  isolation: 'Isolation',
}

// Equipment that guides the path of the load. A multi-joint lift on one of these is a
// "stable machine" lift, not a heavy compound.
const STABLE_EQUIPMENT = ['leverage machine', 'sled machine', 'smith machine', 'cable']

// Single-joint by nature, whatever else the name says ("squat calf raise" is a calf raise).
const ALWAYS_ISOLATION = /\b(calf|calves|wrist|finger|forearm|stretch|shrug|neck|gripper|hand squeeze)\b/

// Whole-body / heavy multi-joint patterns. Checked before the isolation words so a combo like
// "squat to curl" or "clean and press" stays a compound.
const HEAVY_COMPOUND = /\b(squats?|deadlifts?|clean|snatch|jerk|thrusters?|lunges?|swing|get up|burpee|muscle up|pistol|step-?ups?|rack pull)\b/

const ISOLATION = /\b(curls?|fly|flyes?|flys|raises?|pullover|kick ?backs?|push ?downs?|press ?downs?|extensions?|hyperextension|crunch(es)?|sit-?ups?|twists?|side bend|plank|abduction|adduction|face pull|concentration|preacher|skull ?crushers?|french press|svend press|pec deck|cross[ -]?overs?|reverse fly|rear delt|clamshell|leg lift|v-up|jackknife|windmill|rollerout|ab roll|rotation|chop|y-raise|lateral raise|front raise|triceps? press|tate press|straight arm|scapular|lateral bent|flutter kicks?|toe touch|wipers|femoral|deltoid rear|around world|iron cross|chest squeeze|round arm|knees? to chest|keens to chest)\b/

const COMPOUND = /\b(press(es)?|rows?|pull-?ups?|chin-?ups?|pull ?downs?|dips?|push-?ups?|pushups?|good morning|hip thrust|glute bridge|bridge|high pull|inverted|renegade|pull through|hack)\b/

// Target muscles that, when nothing in the name decides it, are trained single-joint.
const ISOLATION_TARGETS = ['abs', 'calves', 'forearms', 'spine', 'serratus anterior', 'levator scapulae',
  'abductors', 'adductors', 'biceps', 'triceps', 'traps']

// Exercises the rules misread. Keyed by catalogue id.
const OVERRIDES = {
  '0052': 'compound', // barbell jm bench press — a close-grip press, multi-joint
  '0450': 'compound', // ez barbell jm bench press
  '0524': 'compound', // kettlebell bent press — a full-body press
  '0548': 'compound', // kettlebell sumo high pull
  '0120': 'compound', // barbell upright row
  '0119': 'compound', // barbell upright row v. 2
  '0121': 'compound', // barbell upright row v. 3
  '0123': 'compound', // barbell wide-grip upright row
  '0044': 'compound', // barbell good morning — heavy hip hinge
  '0115': 'compound', // barbell stiff leg good morning
  '0090': 'compound', // barbell seated good morning
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()

/** 'compound' | 'machine' | 'isolation' for a catalogue or custom exercise. */
export function classifyExercise(ex) {
  if (!ex) return 'isolation'
  if (ex.cls && EXERCISE_CLASSES.includes(ex.cls)) return ex.cls
  if (OVERRIDES[ex.id]) return OVERRIDES[ex.id]
  if (!isMultiJoint(ex)) return 'isolation'
  const name = norm(ex.n)
  // Name words only count when the equipment field is missing (custom exercises): "back lever"
  // is a bodyweight hold, not a lever machine.
  const stable = STABLE_EQUIPMENT.includes(ex.eq) || (!ex.eq && /\b(lever|machine|smith|sled)\b/.test(name))
  return stable ? 'machine' : 'compound'
}

function isMultiJoint(ex) {
  const name = norm(ex.n)
  if (ALWAYS_ISOLATION.test(name)) return false
  if (HEAVY_COMPOUND.test(name)) return true
  if (ISOLATION.test(name)) return false
  if (COMPOUND.test(name)) return true
  return !ISOLATION_TARGETS.includes(ex.tg)
}

/** The default double-progression rep range for an exercise, as { repsMin, reps }. */
export function repRangeFor(ex) {
  return { ...CLASS_REP_RANGE[classifyExercise(ex)] }
}

// The heaviest work set of the last session that trained this exercise, or 0 when it has never
// been trained. Warm-ups are already excluded by lastEntryFor.
export function lastWorkWeight(S, exId) {
  const last = S?.workouts ? lastEntryFor(S, exId) : null
  if (!last) return 0
  return Math.max(0, ...last.sets.map(s => Number(s.w) || 0))
}

// Starting point for an exercise being added while designing a routine: double progression,
// the rep range of its class, and the weight last lifted (0 with no history). Timed and cardio
// exercises have no rep range, so they keep the plain dataset default. Everything here is a
// suggestion — the config sheet shows it and the user can change any of it; values the
// exercise was already given elsewhere (S.exDefaults) still win, see seedConfig.
export function routineExerciseConfig(S, ex) {
  const base = defaultConfig(ex.id)
  if (base.mode !== 'reps') return base
  const range = repRangeFor(ex)
  const stride = base.side ? 2 : 1
  return { ...base, prog: 'double', ...normalizeRepRange(range.reps, range.repsMin, stride), weight: lastWorkWeight(S, ex.id) }
}

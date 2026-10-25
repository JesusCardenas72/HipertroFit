// Movement patterns: what a routine slot asks for ("a horizontal push", "a hinge") as opposed to
// the exercise that fills it. A generated routine is a list of pattern slots, and each slot offers
// every exercise of its pattern (see docs/design/generador-de-rutinas.md).
//
// Built-in exercises get their pattern from the same reviewed movement families that decide their
// muscles (scripts/audit-exercise-muscles.mjs → exercise-muscles.json, overlaid onto the catalogue
// by lib/exercises.js), so the two never disagree. Stretches, mobility, jumps, carries, olympic
// lifts and cardio have none: they fill no strength slot. A custom exercise carries the pattern
// its owner picked, or none.

/** Every pattern, in the order a picker lists them: pushes, pulls, legs, core. `name` is an i18n key. */
export const PATTERNS = [
  { key: 'horizontal_push', name: 'Horizontal push', region: 'push' },
  { key: 'incline_push', name: 'Incline push', region: 'push' },
  { key: 'vertical_push', name: 'Vertical push', region: 'push' },
  { key: 'chest_fly', name: 'Chest fly', region: 'push' },
  { key: 'lateral_raise', name: 'Lateral raise', region: 'push' },
  { key: 'front_raise', name: 'Front raise', region: 'push' },
  { key: 'elbow_extension', name: 'Elbow extension (triceps)', region: 'push' },
  { key: 'vertical_pull', name: 'Vertical pull', region: 'pull' },
  { key: 'horizontal_pull', name: 'Horizontal pull', region: 'pull' },
  { key: 'straight_arm_pull', name: 'Straight-arm pull', region: 'pull' },
  { key: 'rear_delt', name: 'Rear delt', region: 'pull' },
  { key: 'elbow_flexion', name: 'Elbow flexion (biceps)', region: 'pull' },
  { key: 'shrug', name: 'Shrug', region: 'pull' },
  { key: 'squat', name: 'Squat / leg press', region: 'legs' },
  { key: 'lunge', name: 'Lunge / single leg', region: 'legs' },
  { key: 'hinge', name: 'Hip hinge', region: 'legs' },
  { key: 'hip_extension', name: 'Hip extension', region: 'legs' },
  { key: 'knee_extension', name: 'Knee extension', region: 'legs' },
  { key: 'knee_flexion', name: 'Knee flexion (hamstrings)', region: 'legs' },
  { key: 'calf_raise', name: 'Calf raise', region: 'legs' },
  { key: 'hip_abduction', name: 'Hip abduction', region: 'legs' },
  { key: 'hip_adduction', name: 'Hip adduction', region: 'legs' },
  { key: 'core_flexion', name: 'Core flexion', region: 'core' },
  { key: 'core_anti', name: 'Core anti-extension', region: 'core' },
  { key: 'core_rotation', name: 'Core rotation', region: 'core' },
]

const BY_KEY = Object.fromEntries(PATTERNS.map(p => [p.key, p]))

/** Whether `key` names a pattern. */
export const isPattern = key => !!BY_KEY[key]

/** The pattern key of a catalogue or custom exercise, or null when it fills no slot. */
export const patternOf = ex => (ex && isPattern(ex.pattern) ? ex.pattern : null)

/** The i18n key naming a pattern (pass it through t()), or '' for an unknown one. */
export const patternName = key => (BY_KEY[key] ? BY_KEY[key].name : '')

/** Exercises of `list` that fill the slot of `key`, in the order given. */
export const exercisesOfPattern = (list, key) => (list || []).filter(ex => patternOf(ex) === key)

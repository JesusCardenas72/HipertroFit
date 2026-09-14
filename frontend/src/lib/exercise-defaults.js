// Per-exercise defaults that follow the exercise everywhere it is used, instead of being
// re-typed into every routine that happens to include it.
//
// The split is deliberate. How an exercise is *performed* — the rep target, the rest it needs,
// whether it is bodyweight, whether reps are counted per side, the belt load, the rep ceiling,
// the intensifier, and how it progresses — is a property of the exercise: the first time you
// configure it anywhere, that is what it means, and every later routine should start there.
// How *much* of it a routine asks for — sets, and the working weight on loaded work — is the
// routine's business, and two routines are expected to disagree about it.
//
// Every function here takes a config whose `bodyweight` is already RESOLVED to a boolean by
// the caller (a saved config only writes the flag when it differs from the dataset, so
// `cfg.bodyweight` on its own cannot be trusted). See isBw in history.js.

export const GLOBAL_FIELDS = ['bodyweight', 'reps', 'repsMin', 'repsMax', 'restSec', 'side', 'weight', 'intensifier', 'prog', 'inc']

// English label per field, for the "this changes it everywhere" dialog. Plain strings, so this
// module stays loadable without the i18n runtime — the caller passes them through t().
export const GLOBAL_LABEL = {
  bodyweight: 'Bodyweight',
  reps: 'Reps',
  repsMin: 'Reps from',
  repsMax: 'Top of the range',
  restSec: 'Rest (s)',
  side: 'Reps per side',
  weight: 'Added weight',
  intensifier: 'Intensifier',
  prog: 'Progression rule',
  inc: 'Increment',
}

// `weight` is global only on bodyweight work, where the stepper means "Added ({unit})" — the
// belt load that makes a dip a dip, and which travels with the exercise. On loaded work the
// same key holds the working weight, which is the most routine-specific number there is.
// Which global fields a config's form actually offers, by mode. A Time config has no rep
// target and its progression step is in seconds, not kilos — so saving one must not overwrite
// what the Reps form remembered, and seeding one must not pull a kilo step into a seconds
// stepper. Everything outside the mode's set is left exactly as it was.
export const GLOBAL_FIELDS_BY_MODE = {
  reps: GLOBAL_FIELDS,
  time: ['bodyweight', 'restSec', 'weight', 'prog'],
  cardio: ['restSec'],
}
export const fieldsForMode = mode => GLOBAL_FIELDS_BY_MODE[mode] || GLOBAL_FIELDS

export function isGlobalField(field, cfg, mode) {
  if (!fieldsForMode(mode).includes(field)) return false
  if (field === 'weight') return !!(cfg && cfg.bodyweight)
  return true
}

export function globalFieldsFor(cfg, mode) {
  return fieldsForMode(mode).filter(field => isGlobalField(field, cfg, mode))
}

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)

// The values worth remembering for this exercise, read off a config the user just saved.
// Absent fields stay absent, so clearing an intensifier or a progression rule propagates
// exactly like setting one.
export function pickGlobals(cfg, mode) {
  const out = {}
  if (!cfg) return out
  for (const field of globalFieldsFor(cfg, mode)) if (cfg[field] !== undefined) out[field] = cfg[field]
  return out
}

// Seed a config that is being created: routine-local fields come from `base` (the dataset
// default, or last session's target in a freestyle add), global ones from whatever the
// exercise was given the first time it was configured anywhere.
export function seedConfig(base, globals, mode) {
  const out = { ...base }
  if (!globals) return out
  // `bodyweight` decides whether `weight` is global at all, so it lands before the loop reads
  // the field list off `out`.
  if (globals.bodyweight !== undefined && fieldsForMode(mode).includes('bodyweight')) out.bodyweight = globals.bodyweight
  // A base that already proposes a double-progression range keeps its range unless the exercise
  // was given one of its own: a lone remembered `reps` (from a straight-sets rule) would
  // otherwise overwrite the top of the range and leave a 10-11 range where 10-20 was meant.
  const keepRange = base && base.prog === 'double' && base.repsMin !== undefined
    && globals.repsMin === undefined && (globals.prog === undefined || globals.prog === 'double')
  for (const field of globalFieldsFor(out, mode)) {
    if (keepRange && field === 'reps') continue
    if (globals[field] !== undefined) out[field] = globals[field]
  }
  return out
}

// Which remembered values saving this config would overwrite, as {field, from, to}. Empty the
// first time an exercise is configured — there is nothing to overwrite yet, so nothing to ask
// about. A field the config no longer carries reports `to: undefined` (the intensifier was
// removed, the rest went back to the default timer) and is a change like any other.
export function changedGlobals(cfg, globals, mode) {
  if (!globals) return []
  return globalFieldsFor(cfg, mode)
    .filter(field => field in globals && !same(cfg[field], globals[field]))
    .map(field => ({ field, from: globals[field], to: cfg[field] }))
}

// The defaults map after saving this config. Fields this mode's form never showed keep the
// value they had; fields it did show are replaced wholesale, so clearing one propagates.
// Returns a new object — the store update is the caller's job.
export function applyGlobals(store, exId, cfg, mode) {
  const previous = (store || {})[exId] || {}
  const touched = globalFieldsFor(cfg, mode)
  const kept = Object.fromEntries(Object.entries(previous).filter(([field]) => !touched.includes(field)))
  return { ...(store || {}), [exId]: { ...kept, ...pickGlobals(cfg, mode) } }
}

// Where an exercise being added to `routineId` was already set up, as { routine, cfg }, or null.
// Another routine is preferred over a second copy in the same one; among several, the first in
// the plan wins. `cfg` is the whole planned config — local fields included — minus the fields
// that only mean something in the routine it came from (its superset link).
export function previousRoutineConfig(routines, exId, routineId) {
  const withEx = (routines || []).filter(r => (r.ex || []).some(e => e.id === exId))
  const routine = withEx.find(r => r.id !== routineId) || withEx[0]
  if (!routine) return null
  const { id, sg, ...cfg } = routine.ex.find(e => e.id === exId)
  return { routine, cfg }
}

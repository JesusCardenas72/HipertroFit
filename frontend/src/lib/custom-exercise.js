// A user-created exercise, built from the fields of the create/edit form.
//
// A custom exercise carries the same fields as a catalogue row, so every consumer (picker,
// planner, stats, exercise class, muscle map) reads it without a special case:
//   n   name                      bp  body part           eq  equipment
//   tg  target muscle (1st primary)  mg  main muscle      sm  secondary muscles
//   st  instruction steps         img still image         gif animation
//   frame  which frame of the gif the still was taken from, so the picker reopens on it
// plus the fields only custom rows have: desc, primaries/secondaries/muscleGroups, cls (the
// exercise class, when the user picked one instead of letting the name decide) and custom.
//
// Images are stored inline as data: URLs — the exercise lives in synced state, and a URL to a
// file on one device would not resolve on another. The form downsizes them first, see
// MAX_IMAGE_BYTES.

import { EXERCISE_CLASSES } from './exercise-class.js'

export const NAME_MAX = 120
export const DESC_MAX = 1000
export const STEPS_MAX = 20
export const STEP_MAX = 300
// Whole state is pushed to the server (5 MB body cap) and kept in localStorage, so an image
// has to stay small: a downsized JPEG is ~50 KB, an animated GIF is kept as is up to this.
export const MAX_IMAGE_BYTES = 800 * 1024

/** Instruction text (one step per line) → cleaned step list. */
export function parseSteps(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim().slice(0, STEP_MAX))
    .filter(Boolean)
    .slice(0, STEPS_MAX)
}

/** Step list → text for the textarea. */
export const stepsText = st => (Array.isArray(st) ? st : []).join('\n')

const isDataImage = v => typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(v)

/** Approximate decoded size of a data: URL, in bytes. */
export const dataUrlBytes = v => {
  const i = String(v || '').indexOf(',')
  return i < 0 ? 0 : Math.floor((v.length - i - 1) * 3 / 4)
}

/**
 * The persisted record for a custom exercise.
 * `f` = { id, n, bp, eq, cls, primaries, secondaries, desc, steps, img, gif, frame }.
 * Cardio carries no muscle groups (it logs time + speed), matching the form.
 */
export function buildCustomExercise(f) {
  const cardio = f.bp === 'cardio'
  const prim = cardio ? [] : [...new Set(f.primaries || [])]
  const sm = cardio ? [] : [...new Set(f.secondaries || [])].filter(m => !prim.includes(m))
  const img = isDataImage(f.img) && dataUrlBytes(f.img) <= MAX_IMAGE_BYTES ? f.img : ''
  const gif = img && isDataImage(f.gif) && dataUrlBytes(f.gif) <= MAX_IMAGE_BYTES ? f.gif : ''
  const st = Array.isArray(f.steps) ? parseSteps(f.steps.join('\n')) : parseSteps(f.steps)
  return {
    id: f.id,
    n: String(f.n || '').trim().slice(0, NAME_MAX),
    bp: f.bp,
    eq: String(f.eq || '').trim() || 'custom',
    tg: prim[0] || '',
    mg: prim[0] || '',
    sm,
    muscleGroups: [...prim, ...sm],
    primaries: prim,
    secondaries: sm,
    desc: String(f.desc || '').trim().slice(0, DESC_MAX),
    st,
    ...(EXERCISE_CLASSES.includes(f.cls) ? { cls: f.cls } : {}),
    ...(img ? { img } : {}),
    ...(gif ? { gif } : {}),
    ...(gif && Number.isInteger(f.frame) && f.frame > 0 ? { frame: f.frame } : {}),
    custom: true,
  }
}

/* ---- rest between exercises ----
   The break after the closing set of an exercise, before the next one starts. It is a different
   break from the one between two sets of the same lift: you walk to another station, load a
   different bar, maybe set up a bench — so it can be given its own length.

   A choice is one of:
     'sets'  — no separate time: the between-exercises break is the between-sets rest the
               finished exercise earned (its own restSec, or the global rest timer). This is
               what every workout did before the setting existed, and stays the default.
     0       — no rest at all between exercises.
     n > 0   — exactly n seconds, whatever the finished exercise's own rest was.

   It is set in two places: Settings (S.restExSec, the app-wide default; null reads as 'sets')
   and the running workout (S.active.restExSec, absent = follow Settings). The workout wins.
   A single exercise of the running workout can override both for the break after it
   (entry.restExSec, absent = follow the workout); see exerciseRestChoice. */

// 0:30 to 10:00 in 30-second steps.
export const REST_EX_PRESETS = Array.from({ length: 20 }, (_, i) => (i + 1) * 30)

const isSeconds = v => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The app-wide choice as stored in S — anything that is not a number of seconds is 'sets'. */
export function settingChoice(settingSec) {
  return isSeconds(settingSec) ? settingSec : 'sets'
}

const isChoice = v => v === 'sets' || isSeconds(v)

/**
 * The per-exercise choice for the break after a unit (one exercise, or a superset's members),
 * or undefined when none of them sets one. Across a superset the longest time wins, as the
 * between-sets rest does; 'sets' only counts when no member asks for a number of seconds.
 */
export function exerciseRestChoice(entries, unit) {
  const choices = (unit || []).map(i => entries?.[i]?.restExSec).filter(isChoice)
  const secs = choices.filter(isSeconds)
  if (secs.length) return Math.max(...secs)
  return choices.length ? 'sets' : undefined
}

/**
 * Seconds to rest after an exercise is finished and another one follows.
 *
 * `setRestSec` is the rest the closing set earned on its own (restSecFor), used when neither
 * the workout nor Settings asks for a separate time. `workoutChoice` is the running session's
 * override (undefined/null = none), `settingSec` the Settings value, and `exerciseChoice` the
 * finished exercise's own override (exerciseRestChoice), which wins over both.
 */
export function restBetweenExercisesSec(setRestSec, workoutChoice, settingSec, exerciseChoice) {
  const choice = isChoice(exerciseChoice) ? exerciseChoice
    : isChoice(workoutChoice) ? workoutChoice : settingChoice(settingSec)
  return isSeconds(choice) ? Math.round(choice) : (setRestSec > 0 ? setRestSec : 0)
}

/** Label for a choice in a picker. `t` is the i18n function, passed in to keep this pure. */
export function restExLabel(choice, t) {
  if (choice === 'sets' || !isSeconds(choice)) return t('Same as between sets')
  if (choice === 0) return t('Off')
  const sec = Math.round(choice)
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0')
}

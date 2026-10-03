// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finishWorkout } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const clone = value => JSON.parse(JSON.stringify(value))
const id = EXDB[0].id

function install(doneFlags, extra = {}) {
  const S = clone(DEF)
  S.active = {
    id: 'finish-test', d: '2026-10-03', start: Date.now(), routineId: null,
    name: 'Finish test', bw: null, cur: 0,
    entries: [{ id, target: { mode: 'reps', sets: doneFlags.length, reps: 5, weight: 40 }, sets: doneFlags.map(done => ({ w: 40, r: 5, done })) }],
    ...extra,
  }
  useStore.setState({ S, user: null })
}

// Answer the "Finish early?" / "Nothing logged yet" confirmation with its confirm button.
function confirmTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  sheet.render(sheet.close).props.onConfirm()
}

let endExercise
beforeEach(() => {
  localStorage.clear()
  endExercise = vi.fn()
  useUI.setState({ sheets: [], timer: null, work: null, endExercise })
})

// Cutting a session short ends it the way its last set would have: with the exercise-end sound.
describe('exercise-end sound when a workout is finished', () => {
  it('rings when the session is finished early', () => {
    install([true, false])
    finishWorkout()
    expect(endExercise).not.toHaveBeenCalled()   // not before the confirmation
    confirmTopSheet()
    expect(endExercise).toHaveBeenCalledOnce()
    expect(endExercise).toHaveBeenCalledWith(null)
    expect(useStore.getState().S.active).toBeNull()
  })

  it('rings when nothing was logged and it is finished anyway', () => {
    install([false, false])
    finishWorkout()
    confirmTopSheet()
    expect(endExercise).toHaveBeenCalledOnce()
  })

  it('does not ring again for a session its last set already finished', () => {
    install([true, true])
    finishWorkout()
    expect(endExercise).not.toHaveBeenCalled()
    expect(useStore.getState().S.active).toBeNull()
  })

  it('stays silent for a past workout being logged', () => {
    install([true, false], { backfill: { durationMin: 60, replaceId: null } })
    finishWorkout()
    confirmTopSheet()
    expect(endExercise).not.toHaveBeenCalled()
  })
})

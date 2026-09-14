// @vitest-environment happy-dom
// The exercise-config sheet's half of the global/local split. The rules themselves are unit
// tested in lib/exercise-defaults.test.js; what is checked here is the wiring: a new instance
// really does start from what the exercise was given elsewhere, and a change to one of those
// values cannot get past the sheet without being shown and accepted.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, addExerciseToRoutine } from './sheets.jsx'
import { routineExerciseConfig } from './lib/exercise-class.js'

const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

const stepper = (host, label) => [...host.querySelectorAll('.stp-w')]
  .find(el => el.querySelector('.stp-l')?.textContent === label)

const value = (host, label) => stepper(host, label)?.querySelector('input').value

const button = (host, re) => [...host.querySelectorAll('button')]
  .find(b => re.test(b.textContent.trim()))

const bump = (host, label, dir) => act(() => {
  stepper(host, label).querySelectorAll('button')[dir === 'up' ? 1 : 0].click()
})

describe('exercise config: fields that belong to the exercise', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', exDefaults: {} } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('starts a new instance from what the exercise was given in another routine', () => {
    useStore.setState(s => ({ S: { ...s.S, exDefaults: { [ex.id]: { reps: 6, restSec: 180, bodyweight: false } } } }))
    exConfigSheet(ex, null, vi.fn())
    const host = renderTop()
    expect(value(host, 'Reps')).toBe('6')
    expect(value(host, 'Rest (s)')).toBe('180')
    // Sets is the routine's own business — it comes from the dataset default, not from
    // whatever the last routine happened to ask for.
    expect(value(host, 'Sets')).toBe('3')
  })

  it('marks the exercise-wide fields, and only those, in their own colour', () => {
    exConfigSheet(ex, null, vi.fn())
    const host = renderTop()
    expect(stepper(host, 'Reps').querySelector('.stp').className).toContain('gfield')
    expect(stepper(host, 'Rest (s)').querySelector('.stp').className).toContain('gfield')
    expect(stepper(host, 'Sets').querySelector('.stp').className).not.toContain('gfield')
    expect(host.querySelector('.gfield-key')).toBeTruthy()
  })

  it('saves a first configuration straight through — there is nothing to overwrite yet', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, null, onSave)
    const host = renderTop()
    act(() => { button(host, /^add to routine$/i).click() })
    expect(onSave).toHaveBeenCalledOnce()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useStore.getState().S.exDefaults[ex.id]).toMatchObject({ reps: 10 })
  })

  it('saves a routine-local change without asking', () => {
    useStore.setState(s => ({ S: { ...s.S, exDefaults: { [ex.id]: { reps: 10, bodyweight: false } } } }))
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 0, mode: 'reps' }, onSave)
    const host = renderTop()
    bump(host, 'Sets', 'up')
    act(() => { button(host, /^save$/i).click() })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sets: 4, reps: 10 }))
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('asks before rewriting a value every routine shares, and cancelling changes nothing', () => {
    useStore.setState(s => ({ S: { ...s.S, exDefaults: { [ex.id]: { reps: 10, bodyweight: false } } } }))
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 0, mode: 'reps' }, onSave)
    const host = renderTop()
    bump(host, 'Reps', 'up')
    act(() => { button(host, /^save$/i).click() })

    // The config sheet stays open underneath, so a change can be corrected rather than retyped.
    expect(useUI.getState().sheets).toHaveLength(2)
    expect(onSave).not.toHaveBeenCalled()
    const dialog = renderTop()
    expect(dialog.textContent).toContain('Change this for every routine?')
    expect(dialog.querySelector('.gfield-diff').textContent).toContain('10 → 11')

    act(() => { button(dialog, /^cancel$/i).click() })
    expect(onSave).not.toHaveBeenCalled()
    expect(useStore.getState().S.exDefaults[ex.id].reps).toBe(10)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('accepting writes the value for every routine and saves this one', () => {
    useStore.setState(s => ({ S: { ...s.S, exDefaults: { [ex.id]: { reps: 10, bodyweight: false } } } }))
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 0, mode: 'reps' }, onSave)
    const host = renderTop()
    bump(host, 'Reps', 'up')
    act(() => { button(host, /^save$/i).click() })
    const dialog = renderTop()
    act(() => { button(dialog, /^accept$/i).click() })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reps: 11 }))
    expect(useStore.getState().S.exDefaults[ex.id].reps).toBe(11)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('a new routine exercise starts on double progression, its class range and last weight', () => {
    const squat = EXDB.find(e => e.id === '0043')
    const S = { workouts: [{ d: '2026-09-01', entries: [{ id: squat.id, sets: [{ w: 90, reps: 8, done: true }] }] }] }
    const onSave = vi.fn()
    exConfigSheet(squat, null, onSave, null, { id: 'r1', ex: [] }, routineExerciseConfig(S, squat))
    const host = renderTop()
    expect(value(host, 'Reps from')).toBe('5')
    expect(value(host, 'Reps up to')).toBe('12')
    expect(value(host, 'Weight (kg)')).toBe('90')
    act(() => { button(host, /^add to routine$/i).click() })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ prog: 'double', repsMin: 5, reps: 12, weight: 90 }))
  })
})

describe('adding an exercise that another routine already set up', () => {
  const squat = EXDB.find(e => e.id === '0043')
  const planned = { id: squat.id, sets: 4, reps: 8, repsMin: 6, prog: 'double', weight: 100, restSec: 180, sg: 'x' }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], exDefaults: {},
      routines: [{ id: 'legs', name: 'Legs A', ex: [planned] }, { id: 'new', name: 'Legs B', ex: [] }] } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('tells the user, shows the parameters and accepts them as they are', () => {
    const onAdd = vi.fn()
    addExerciseToRoutine(squat, { id: 'new', ex: [] }, onAdd)
    const host = renderTop()
    expect(host.textContent).toContain('Legs A')
    expect(host.textContent).toContain('6–8')
    expect(host.textContent).toContain('100')
    act(() => { button(host, /^accept$/i).click() })
    expect(onAdd).toHaveBeenCalledWith({ sets: 4, reps: 8, repsMin: 6, prog: 'double', weight: 100, restSec: 180 })
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('opens the config sheet on those parameters to change them', () => {
    const onAdd = vi.fn()
    addExerciseToRoutine(squat, { id: 'new', ex: [] }, onAdd)
    const notice = renderTop()
    act(() => { button(notice, /review and change/i).click() })
    const host = renderTop()
    expect(value(host, 'Sets')).toBe('4')
    expect(value(host, 'Reps from')).toBe('6')
    expect(value(host, 'Reps up to')).toBe('8')
    expect(value(host, 'Weight (kg)')).toBe('100')
    bump(host, 'Sets', 'up')
    act(() => { button(host, /^add to routine$/i).click() })
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ sets: 5, reps: 8, repsMin: 6, weight: 100 }))
  })

  it('goes straight to the class defaults for an exercise never set up', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [] } }))
    addExerciseToRoutine(squat, { id: 'new', ex: [] }, vi.fn())
    const host = renderTop()
    expect(value(host, 'Reps from')).toBe('5')
    expect(value(host, 'Reps up to')).toBe('12')
  })
})

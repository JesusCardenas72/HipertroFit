// A microcycle laid out on the calendar as a repeating sequence of days.
//
// The weekly plan (S.week) maps each weekday to a routine, which cannot express a training
// block whose length is not seven days: two Push/Pull/Legs rounds are six sessions, and once
// rest days are interleaved the block routinely spans nine, ten, eleven calendar days and
// then drifts against the week. A program is that block spelled out instead — an ordered
// sequence of steps, each a routine or a rest day — anchored to a start date and repeated
// from there, so "Legs, rest, Push, Pull, rest, …" projects onto real dates however long it
// takes to come back around. See the periodizacion-microciclo note.
//
// The program is the calendar layout only; the volume window (how many recent sessions make
// one microcycle for the effective-set panel) stays S.microcycleSessions — see lib/volume.js.

import { isoOf } from './format.js'

// The step value that marks a planned rest day, as opposed to a routine id.
export const REST = 'rest'

/** Whole days from `aISO` to `bISO` (b − a). Compared at local noon so a DST change in
 * between still counts as one calendar day, not 23 or 25 hours. */
export function daysBetween(aISO, bISO) {
  const a = new Date(aISO + 'T12:00:00'), b = new Date(bISO + 'T12:00:00')
  return Math.round((b - a) / 86400000)
}

/** A program that is turned on and has a sequence and an anchor to project from. */
export function programActive(program) {
  return !!(program && program.on && Array.isArray(program.seq) && program.seq.length && program.anchor)
}

/**
 * The step a program schedules for one date: a routine id, REST, or null.
 *
 * null means the program does not speak for this date — it is inactive, or the date falls
 * before the anchor (a block scheduled to start later leaves earlier days to the weekly plan).
 * A routine id is returned even if that routine was since deleted; the caller decides what a
 * dangling id means (effectiveRoutineId treats it as rest).
 */
export function programStep(program, iso) {
  if (!programActive(program)) return null
  const n = daysBetween(program.anchor, iso)
  if (n < 0) return null
  const seq = program.seq
  const step = seq[((n % seq.length) + seq.length) % seq.length]
  return step || REST
}

/** Project `days` days from `fromISO` inclusive: [{ iso, step }] with step per programStep. */
export function projectProgram(program, fromISO, days) {
  const out = []
  const base = new Date(fromISO + 'T12:00:00')
  for (let i = 0; i < days; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const iso = isoOf(d)
    out.push({ iso, step: programStep(program, iso) })
  }
  return out
}

/** Training (non-rest) steps in one pass of the sequence — the sessions per round. */
export const sessionsPerRound = program =>
  Array.isArray(program?.seq) ? program.seq.filter(s => s && s !== REST).length : 0

/** A fresh program shell anchored today, off until the user turns it on. */
export const emptyProgram = (anchor = isoOf(new Date())) => ({ on: false, seq: [], anchor })

// Two ways to lay the sequence out. `cycle` repeats it every seq.length days from the anchor.
// `week` keeps seven steps, Monday first, and anchors on a Monday, so programStep's day count
// from the anchor lands on the weekday with no special case.
export const SEQ_CYCLE = 'cycle'
export const SEQ_WEEK = 'week'
export const programMode = program => program?.mode === SEQ_WEEK ? SEQ_WEEK : SEQ_CYCLE

/** The Monday (ISO) of the week that holds `iso`. */
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoOf(d)
}

/** The seven steps of a weekday program from the weekly plan, Monday first (week[0] is Sunday). */
export const weekSequence = week => Array.from({ length: 7 }, (_, i) => (week && week[(i + 1) % 7]) || REST)

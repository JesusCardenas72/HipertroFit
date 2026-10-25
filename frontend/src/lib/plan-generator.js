// The plan generator: a split (lib/split-templates.js) turned into real routines and a program.
//
// Each day is a list of movement-pattern slots. For every slot the user sees every exercise of
// that pattern in three groups, in this order: their favourites, the ones their equipment profile
// allows, then the rest (candidatesFor). Each slot comes filled with the best of those (autoPick)
// so a plan is complete before anything is touched; the user swaps what they want.
//
// Sets per slot start from the level and are then moved one at a time until every muscle group's
// planned volume for one microcycle sits in its band (balanceSets) — the same groups, credits and
// bands as the volume panel (lib/volume.js), so the plan reads on the scale the app judges it by.
// A count the user set by hand stays put.
//
// Applying a draft adds ordinary routines (in a folder of their own) and an ordinary program, so
// the workout screen, double progression, the volume panel and deloads all work unchanged.
// See docs/design/generador-de-rutinas.md.

import { allExercises, EXIDX } from './exercises.js'
import { isPattern, patternOf } from './movement-patterns.js'
import { classifyExercise, routineExerciseConfig } from './exercise-class.js'
import { seedConfig } from './exercise-defaults.js'
import { modeOf, cleanupSg } from './history.js'
import { isFavorite } from './favorites.js'
import { ownsEquipment } from './equipment.js'
import { plannedVolume, setCredit, VOLUME_GROUPS, targetOf } from './volume.js'
import { REST } from './program.js'
import { closeMicrocycle, microcycleLen } from './microcycle.js'
import { restartMeso } from './mesocycle.js'
import { addFolder } from './folders.js'
import { uid, todayISO } from './format.js'
import { SPLITS, daysOf, hasVariants, layoutOf } from './split-templates.js'

// `slots` per day, starting sets per slot role, the RIR to train at, and A/B variants by default.
export const LEVELS = {
  beginner: { name: 'Beginner', slots: 6, sets: { main: 3, secondary: 2, accessory: 2 }, rir: '2–3', variants: false },
  intermediate: { name: 'Intermediate', slots: 6, sets: { main: 3, secondary: 3, accessory: 2 }, rir: '1–2', variants: true },
  advanced: { name: 'Advanced', slots: 7, sets: { main: 4, secondary: 3, accessory: 3 }, rir: '0–2', variants: true },
}
export const LEVEL_KEYS = Object.keys(LEVELS)

/** Rest between sets by slot role, in seconds — the main lift gets the longest. */
export const REST_SEC = { main: 180, secondary: 120, accessory: 90 }
/** The fewest and most sets the balancing may give a slot of each role. */
export const SET_LIMITS = { main: [2, 5], secondary: [2, 5], accessory: [1, 5] }

// Well-known exercises per pattern, best first: they win ties inside each group. The defaults
// lean towards a long muscle length where the research found it grew more (seated leg curl,
// overhead triceps extension, incline curl).
const STAPLES = {
  horizontal_push: ['0025', '0289', '0577', '0748', '0251', '0662'],
  incline_push: ['0314', '0047', '0757', '0169'],
  vertical_push: ['0405', '0091', '0603', '0426', '0766', '0587'],
  chest_fly: ['0155', '0596', '0308'],
  lateral_raise: ['0334', '0178', '0584'],
  front_raise: ['0310', '0162'],
  rear_delt: ['0203', '0602', '0378', '0233'],
  elbow_extension: ['0194', '0200', '0201', '0061', '0030', '0351'],
  vertical_pull: ['2330', '0198', '0652', '1326', '0818'],
  horizontal_pull: ['0861', '0027', '0293', '1350', '0581', '0574'],
  straight_arm_pull: ['0238', '0237'],
  elbow_flexion: ['0318', '0031', '0294', '0313', '0868', '0372', '0447'],
  shrug: ['0406', '0095'],
  squat: ['0043', '0739', '0743', '0042', '1760', '3281'],
  lunge: ['0410', '0336', '0054', '0431'],
  hinge: ['0085', '0032', '1459', '0811', '0044', '0489'],
  hip_extension: ['1409'],
  knee_extension: ['0585'],
  knee_flexion: ['0599', '0586', '0582'],
  calf_raise: ['0605', '0594', '0773', '0417'],
  hip_abduction: ['0597'],
  hip_adduction: ['0598', '0168'],
  core_flexion: ['0175', '0472', '0274', '0277'],
  core_anti: ['2135', '0979'],
  core_rotation: ['0243', '2399', '0687'],
}
// Everyday gym equipment first; balls, rollers and the like rarely what a slot is looking for.
const EQ_SCORE = {
  'barbell': 1.5, 'dumbbell': 1.5, 'cable': 1.5, 'leverage machine': 1.5, 'sled machine': 1.5, 'smith machine': 1,
  'ez barbell': 1, 'body weight': 1, 'band': 0, 'kettlebell': 0, 'weighted': 0, 'olympic barbell': 0, 'trap bar': 0,
  'rope': 0, 'assisted': -0.5, 'custom': 0,
}

/** How well `ex` suits a slot of `role` (higher first). Pure; only orders exercises within a group. */
export function slotScore(ex, role, prefer) {
  let s = 0
  const i = (STAPLES[patternOf(ex)] || []).indexOf(ex.id)
  if (i >= 0) s += 12 - i
  const cls = classifyExercise(ex)
  if (prefer && cls === prefer) s += 3
  if (role === 'main') s += cls === 'compound' ? 3 : cls === 'machine' ? 1 : 0
  else if (role === 'secondary') s += cls !== 'isolation' ? 2 : 0
  else s += cls !== 'compound' ? 2 : 0
  s += EQ_SCORE[ex.eq] != null ? EQ_SCORE[ex.eq] : -1.5
  const n = String(ex.n || '').toLowerCase()
  if (/v\. ?\d|\((male|female)\)|stability ball|exercise ball|bosu|towel|arm blaster|back pov|side pov/.test(n)) s -= 2
  if (/\bone arm\b|\bsingle\b|\balternate\b|\bkneeling\b|\btwisting\b/.test(n)) s -= 0.5
  if (role === 'main' && modeOf({ id: ex.id }) === 'time') s -= 3
  return s
}

/**
 * Every exercise of a slot's pattern, in the three groups the user picks from: `favorites`
 * (whatever the equipment), `owned` (what the profile allows; everything when there is no
 * profile) and `rest`. Each group best first.
 */
export function candidatesFor(S, slot, profile) {
  const all = allExercises(S).filter(ex => patternOf(ex) === slot.pattern)
    .map(ex => ({ ex, s: slotScore(ex, slot.role, slot.prefer) }))
    .sort((a, b) => b.s - a.s || String(a.ex.n).localeCompare(String(b.ex.n)))
    .map(x => x.ex)
  const favorites = [], owned = [], rest = []
  for (const ex of all) {
    if (isFavorite(S, ex.id)) favorites.push(ex)
    else if (ownsEquipment(profile, ex) !== false) owned.push(ex)
    else rest.push(ex)
  }
  return { favorites, owned, rest }
}

/**
 * The exercise a slot starts with: a favourite the equipment allows, else the best the equipment
 * allows, else any favourite, else anything. Never one already in the same day; one used on
 * another day only when nothing else in that group is left (variety between A and B).
 */
export function autoPick(groups, profile, inDay = new Set(), usedElsewhere = new Set()) {
  const order = [groups.favorites.filter(ex => ownsEquipment(profile, ex) !== false), groups.owned, groups.favorites, groups.rest]
  for (const list of order) {
    const free = list.filter(ex => !inDay.has(ex.id))
    if (!free.length) continue
    return (free.find(ex => !usedElsewhere.has(ex.id)) || free[0]).id
  }
  return null
}

// A sequence of day keys / 'rest' is usable when it trains every day of the draft, nothing else.
function validSeq(seq, days) {
  if (!Array.isArray(seq)) return false
  const keys = new Set(days.map(d => d.key))
  const training = seq.filter(k => k !== 'rest')
  return training.every(k => keys.has(k)) && days.every(d => training.includes(d.key))
}

/**
 * The plan as it stands in the generator: `{ split, level, variants, days, seq }`.
 *
 * `picks` and `sets` are what the user changed, keyed by slot (`dayKey:index`, or the key an
 * added slot got); `seq` the day order they chose (day keys and 'rest'), else the split's own
 * week; `layout` the days whose slots they rearranged (lib/plan-layout.js). Pure: S is only read.
 */
export function buildDraft(S, { split, level, variants, profile = null, picks = {}, sets = {}, seq = null, layout = {} }) {
  const lvl = LEVELS[level] || LEVELS.intermediate
  const v = hasVariants(split, variants)
  const used = new Set()
  const days = daysOf(split, v).map(d => {
    const inDay = new Set()
    // A day the user rearranged (lib/plan-layout.js) keeps its own slots; otherwise the
    // template's, as many as the level takes.
    const own = Array.isArray(layout && layout[d.key]) ? layout[d.key].filter(sl => sl && sl.id && isPattern(sl.pattern) && SET_LIMITS[sl.role]) : null
    const defs = own || d.slots.slice(0, lvl.slots).map((sl, i) => ({ ...sl, id: d.key + ':' + i }))
    const slots = defs.map(({ id: key, sg, ...sl }) => {
      const picked = picks[key] && EXIDX[picks[key]] ? picks[key] : null
      const id = picked || autoPick(candidatesFor(S, sl, profile), profile, inDay, used)
      if (id) { inDay.add(id); used.add(id) }
      const pinned = sets[key] != null
      return { key, ...sl, ...(sg ? { sg } : {}), id, picked: !!picked, pinned, sets: pinned ? sets[key] : lvl.sets[sl.role] }
    })
    return { key: d.key, name: d.name, glyph: d.glyph, slots }
  })
  const draft = { split, level, variants: v, days, seq: validSeq(seq, days) ? [...seq] : layoutOf(split, v) }
  balanceSets(S, draft)
  return draft
}

// The draft as the S that plannedVolume reads: routines keyed by day, the sequence, the strategy.
const draftState = (S, draft) => ({
  ...S,
  routines: draft.days.map(d => ({ id: d.key, ex: d.slots.filter(sl => sl.id && sl.sets > 0).map(sl => ({ id: sl.id, sets: sl.sets })) })),
  program: { seq: draft.seq.map(k => (k === 'rest' ? REST : k)), strategy: SPLITS[draft.split].strategy },
})

/** Planned effective sets per muscle group for one microcycle of the draft (volume panel scale). */
export const draftVolume = (S, draft) => plannedVolume(draftState(S, draft))

/**
 * Move sets the user has not fixed, one at a time, until every group sits in its band: take the
 * group furthest outside it, then the slot that trains it as a primary mover and pushes the other
 * groups out of theirs the least. Bounded by SET_LIMITS and a pass cap, so it always ends; a group
 * no free slot can fix stays as it is and shows on the bars. Direct-only groups (the erectors)
 * are not chased. Mutates `draft`.
 */
export function balanceSets(S, draft) {
  const st = draftState(S, draft)
  const steps = st.program.seq.filter(k => k !== REST)
  const len = microcycleLen(st)
  const count = {}
  for (let i = 0; i < len && steps.length; i++) count[steps[i % steps.length]] = (count[steps[i % steps.length]] || 0) + 1
  const groups = VOLUME_GROUPS.filter(g => !g.direct)
  const credit = {}
  const free = draft.days.flatMap(d => d.slots.map(sl => ({ sl, c: count[d.key] || 0 })))
    .filter(x => x.sl.id && x.c && !x.sl.pinned && x.sl.sets > 0)
  for (const x of free) credit[x.sl.id] = credit[x.sl.id] || setCredit({ id: x.sl.id })
  const blocked = new Set()
  for (let pass = 0; pass < 80; pass++) {
    const vol = draftVolume(S, draft).groups
    let worst = null, gap = 0
    for (const g of groups) {
      if (blocked.has(g.key)) continue
      const t = targetOf(g), v = vol[g.key] || 0
      const off = v < t.min ? t.min - v : v > t.max ? v - t.max : 0
      if (off > gap + 1e-9) { gap = off; worst = g }
    }
    if (!worst) break
    const t = targetOf(worst), dir = (vol[worst.key] || 0) < t.min ? 1 : -1
    let best = null, bestScore = 0
    for (const x of free) {
      const cr = credit[x.sl.id]
      if ((cr[worst.key] || 0) < 1) continue
      const [lo, hi] = SET_LIMITS[x.sl.role], n = x.sl.sets + dir
      if (n < lo || n > hi) continue
      let harm = 0
      for (const g of groups) {
        if (g === worst || !cr[g.key]) continue
        const gt = targetOf(g), v = vol[g.key] || 0, nv = v + dir * cr[g.key] * x.c
        if (dir > 0 && nv > gt.max) harm += nv - Math.max(gt.max, v)
        if (dir < 0 && nv < gt.min) harm += Math.min(gt.min, v) - nv
      }
      const score = x.c - harm * 2 + (dir > 0 ? (x.sl.role === 'accessory' ? 0.3 : 0) : (x.sl.role === 'main' ? -0.3 : 0))
      if (score > bestScore) { bestScore = score; best = x }
    }
    if (!best) { blocked.add(worst.key); continue }
    best.sl.sets += dir
  }
  return draft
}

/** The routine entry for a filled slot: class rep range, double progression, last weight, rest by role. */
export function slotConfig(S, sl) {
  const ex = EXIDX[sl.id]
  const mode = modeOf({ id: ex.id })
  // Values the exercise was already given elsewhere (S.exDefaults) win, as when adding by hand.
  const cfg = seedConfig({ ...routineExerciseConfig(S, ex), restSec: REST_SEC[sl.role] }, S.exDefaults?.[ex.id], mode)
  return { id: ex.id, ...cfg, sets: sl.sets, slot: { pattern: sl.pattern, role: sl.role } }
}

/**
 * Write a draft into a draft state (call inside store.update): one new routine per day in a new
 * folder named `name`, and the program switched to the draft's sequence under the split's
 * strategy, its microcycle and mesocycle counted afresh. Existing routines are left alone.
 * `label` turns a day's i18n key into the routine name. Returns the new folder and routine ids.
 */
export function applyDraft(s, draft, { name, label = x => x, today = todayISO() } = {}) {
  const folder = addFolder(s, name)
  const ids = {}
  for (const d of draft.days) {
    ids[d.key] = uid()
    // Linked slots become a superset of the routine; a slot left out loosens what it broke.
    const ex = d.slots.filter(sl => sl.id && sl.sets > 0).map(sl => ({ ...slotConfig(s, sl), ...(sl.sg ? { sg: sl.sg } : {}) }))
    cleanupSg(ex)
    s.routines.push({
      id: ids[d.key], name: label(d.name), emoji: d.glyph, ...(folder ? { folder: folder.id } : {}), ex,
    })
  }
  const closed = closeMicrocycle(s, SPLITS[draft.split].strategy, today)
  s.program = {
    ...closed, on: true, anchor: closed.cycleStart,
    seq: draft.seq.map(k => (k === 'rest' ? REST : ids[k])),
    gen: { v: 1, split: draft.split, level: draft.level, variants: draft.variants, createdAt: today },
  }
  s.meso = restartMeso(s)
  return { folder, ids }
}

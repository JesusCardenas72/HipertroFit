import { t } from './i18n.js'
import { EXDB } from './exercises-data.js'
import { ADJUSTABLE_DUMBBELLS, ladderOf } from './load-scale.js'

// Adjustable dumbbells are not an equipment value of the catalogue — the exercises say
// "dumbbell" — but a set you own, with its own range: the first weight, the last, and what one
// click adds. A profile that has them can do every dumbbell exercise, and their range is what a
// dumbbell exercise's "Adjustable dumbbells" switch starts from (see lib/load-scale.js).
export const ADJUSTABLE = 'adjustable dumbbell'

// Every equipment value present in the catalogue, most common first — this becomes the
// checklist Settings shows when you build a profile. Adjustable dumbbells follow, last.
export const ALL_EQUIPMENT = (() => {
  const c = {}
  EXDB.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return [...Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1)), ADJUSTABLE]
})()

// Body weight is never gated by a profile — no gym or home setup can take it away from you,
// and every profile should be able to see bodyweight exercises regardless of what's checked.
const ALWAYS_AVAILABLE = 'body weight'

export function activeProfile(S) {
  if (!S.equipFilterOn) return null
  const profiles = S.equipProfiles || []
  return profiles.find(p => p.id === S.activeEquipId) || null
}

// What a profile's checklist covers: its own values, plus "dumbbell" when it has adjustable ones.
function covers(profile, eq) {
  const have = profile.equipment || []
  return have.includes(eq) || (eq === 'dumbbell' && have.includes(ADJUSTABLE))
}

// Whether an exercise is usable under the active profile. With filtering off, or no profile
// selected, everything is available — this is purely additive, never a trap that hides your
// whole library because you haven't set anything up yet.
export function exAvailable(S, ex) {
  const p = activeProfile(S)
  if (!p) return true
  if (!ex.eq || ex.eq === ALWAYS_AVAILABLE) return true
  return covers(p, ex.eq)
}

// Whether `profile` has what `ex` needs, whatever the Library filter is set to: true / false, or
// null with no profile at all (nothing is known, so nothing is ruled out). The plan generator
// sorts every slot's exercises by it (favourites, then what you own, then the rest).
export function ownsEquipment(profile, ex) {
  if (!profile) return null
  if (!ex.eq || ex.eq === ALWAYS_AVAILABLE) return true
  return covers(profile, ex.eq)
}

export function newProfile(name) {
  return { id: 'eq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, equipment: [] }
}

/** A profile's adjustable dumbbells `{ from, to, step }`, the defaults filling what is missing. */
export function adjustableOf(profile) {
  const adj = { ...ADJUSTABLE_DUMBBELLS, ...(profile && profile.adj) }
  return ladderOf({ adj }) ? adj : { ...ADJUSTABLE_DUMBBELLS }
}

/**
 * The adjustable dumbbells an exercise's switch starts from: those of the selected profile when
 * it has them, else of any profile that does, else the defaults (4–32.5 kg, 1.5 kg a click).
 * Whether the Library filter is on doesn't matter — the set you own is the same either way.
 */
export function adjustableFor(S) {
  const profiles = (S && S.equipProfiles) || []
  const owners = profiles.filter(p => (p.equipment || []).includes(ADJUSTABLE))
  const p = owners.find(x => x.id === S.activeEquipId) || owners[0]
  return p ? adjustableOf(p) : { ...ADJUSTABLE_DUMBBELLS }
}

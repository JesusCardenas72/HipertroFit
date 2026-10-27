// Routine glyphs.
//
// Routines used to store a literal emoji in `r.emoji` ('💪', '🦵', …). The
// redesign stores an icon key instead, but the field keeps its name so existing
// synced state stays readable by both builds — no migration, no lost routines.
//
// glyphOf() accepts either form: a known icon key passes through, a legacy emoji
// is mapped, and anything unrecognised falls back to the default.

import { ICON_NAMES } from '../components/Icon.jsx'

export const DEFAULT_GLYPH = 'figureStrength'

// The picker offers glyphs that describe a TRAINING DAY — the split, the kit, or
// the kind of session. The first version offered trophy/medal/crown/flag/star,
// which say how a workout went, not what it is; nobody names a routine "crown".
// Grouped, because 20 loose icons is a wall — you scan the group first.
export const GLYPH_GROUPS = [
  // First, because naming the three days of a split is the most common thing a
  // picker is opened for — the muscles each day trains, in order.
  { key: 'Push / Pull / Legs', items: ['pushDay', 'pullDay', 'legDay'] },
  // Muscle maps: a day named after what it trains ("Back & biceps") gets that
  // muscle lit on the body, front-view muscles before back-view ones.
  { key: 'Upper body', items: ['chest', 'shoulders', 'biceps', 'core', 'triceps', 'lats', 'upperBack', 'lowerBack'] },
  { key: 'Lower body', items: ['glutes', 'quads', 'hamstrings', 'calves'] },
  { key: 'Equipment', items: ['figureStrength', 'dumbbell', 'barbell', 'kettlebell', 'machine'] },
  { key: 'Cardio',    items: ['figureRun', 'bike', 'swim', 'boxing', 'timer'] },
  { key: 'Recovery',  items: ['stretch', 'moon', 'heart', 'flame', 'bolt'] },
]
export const GLYPHS = GLYPH_GROUPS.flatMap(g => g.items)

// Keys the picker used to offer, redrawn as muscle maps. Stored routines (and
// split templates) keep the old key; it just renders as the new glyph.
const REDRAWN = {
  bench: 'pushDay', pullup: 'pullDay', squat: 'legDay',
  arm: 'biceps', abs: 'core', legs: 'legDay',
}

// Legacy emoji → icon key, so routines created before the redesign keep a
// sensible glyph instead of all collapsing onto the default.
const LEGACY = {
  '💪': 'arm', '🦾': 'arm', '🫸': 'bench', '🫷': 'pullup',
  '🏋️': 'dumbbell', '🏋': 'dumbbell', '🏋️‍♀️': 'dumbbell',
  '🦵': 'legs', '🍑': 'legs',
  '🔥': 'flame', '⚡': 'bolt', '💥': 'bolt', '🧨': 'bolt', '😤': 'flame',
  '🏃': 'figureRun', '🏃‍♀️': 'figureRun', '🚴': 'bike', '🏊': 'swim',
  '🤸': 'stretch', '🧘': 'stretch', '🧘‍♀️': 'stretch',
  '🥊': 'boxing', '🧗': 'pullup', '⛰️': 'figureRun', '🏔️': 'figureRun', '🚀': 'bolt',
  '🎯': 'target', '🏆': 'trophy', '🥇': 'medal', '⭐': 'star', '🌟': 'star',
  '👑': 'crown', '🛡️': 'shield', '⚔️': 'shield', '❤️‍🔥': 'heart',
  '🦍': 'kettlebell', '🐂': 'barbell', '🐻': 'kettlebell', '🦁': 'boxing',
  '🐺': 'figureRun', '🦈': 'swim', '🤖': 'machine',
}

const current = k => REDRAWN[k] || k

export function glyphOf(v) {
  if (!v) return DEFAULT_GLYPH
  if (ICON_NAMES.includes(v)) return current(v)
  if (LEGACY[v]) return current(LEGACY[v])
  // strip variation selectors / ZWJ sequences and retry the base emoji
  const base = [...v].filter(c => c !== '️' && c !== '‍')[0]
  return LEGACY[base] ? current(LEGACY[base]) : DEFAULT_GLYPH
}

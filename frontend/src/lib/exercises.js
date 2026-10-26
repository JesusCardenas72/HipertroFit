import { EXDB } from './exercises-data.js'
import { exerciseMuscleMetadataFor } from './exercise-muscles.js'
import { isPattern } from './movement-patterns.js'
import { t, getVersion, exerciseNameSearchText } from './i18n-core.js'

export { EXDB }

// The generated dataset remains the compatibility/raw export. The runtime catalogue applies
// the reviewed muscle metadata (lib/exercise-muscles.js) as a narrow overlay, so imports and
// historical tests that rely on the upstream shape keep working while EXIDX and pickers see the
// corrected model.
const catalogueExercise = ex => {
  const metadata = exerciseMuscleMetadataFor(ex?.id)
  if (!Object.keys(metadata).length) return ex
  const out = { ...ex, ...metadata }
  // A future dataset row may carry explicit arrays of its own; preserve those over the overlay.
  for (const key of ['primaries', 'secondaries']) {
    if (Object.prototype.hasOwnProperty.call(ex, key)) out[key] = ex[key]
  }
  if (Array.isArray(out.primaries)) out.primaries = [...out.primaries]
  if (Array.isArray(out.secondaries)) out.secondaries = [...out.secondaries]
  return out
}

export const CATALOGUE = EXDB.map(catalogueExercise)

// The generated dataset already supplies secondary muscles for most exercises. Keep the
// handful of conservative catalogue additions that are useful to the muscle map here so a
// dataset refresh does not erase them. Values follow the dataset's existing alias vocabulary.
const SECONDARY_ADDITIONS = {
  '0027': ['rear deltoids'], // barbell bent over row
  '0293': ['rear deltoids'], // dumbbell bent over row
  '0499': ['rear deltoids'], // inverted row
  '0861': ['rear deltoids'], // cable seated row
}

// Secondary muscles for an exercise, with the small conservative additions applied as an
// overlay. The raw dataset is never mutated - consumers that want the pristine catalogue
// (export, print, import) keep reading EXDB untouched, while the muscle map sees the
// enriched list. Values follow the dataset's existing alias vocabulary.
export const smOf = ex => {
  const base = Array.isArray(ex?.sm) ? ex.sm : (ex?.sm ? [ex.sm] : [])
  return [...new Set([...base, ...(SECONDARY_ADDITIONS[ex?.id] || [])])]
}

/**
 * The muscles an exercise works, split into the ones it is for and the ones that help: the
 * catalogue's primaries (or its target muscle) and its secondaries (or the overlay above),
 * a muscle never listed twice. Same reading as the exercise's detail sheet.
 */
export function muscleTagsOf(ex) {
  const explicit = !!ex?.primaries?.length
  const primary = [...new Set(explicit ? ex.primaries : (ex?.tg ? [ex.tg] : []))]
  // With explicit primaries an empty secondaries list is a decision (a calf raise has none),
  // not a gap to fill from the dataset's free-text list.
  const secondary = (explicit ? (ex.secondaries || []) : smOf(ex)).filter((m, i, all) => !primary.includes(m) && all.indexOf(m) === i)
  return { primary, secondary }
}

export const EXIDX = {}
CATALOGUE.forEach(e => { EXIDX[e.id] = e })

// The user's own muscle corrections for built-in exercises live in synced state S.exMuscles
// ({ id: { primaries, secondaries } }) and are pushed in here by the store, like the custom
// catalogue below, so every EXIDX[id] lookup (volume, recovery, muscle map, stats) sees them.
// Movement-pattern corrections ride the same overlay: S.exPatterns ({ id: patternKey | '' }),
// where '' means "fills no slot" and an absent id keeps the catalogue's pattern.
let muscleEdits = {}
let patternEdits = {}
const editedRow = new Map()
const withEdits = ex => editedRow.get(ex.id) || ex
function rebuildEdits() {
  editedRow.clear()
  for (const ex of CATALOGUE) {
    let row = ex
    const edit = muscleEdits[ex.id]
    const primaries = Array.isArray(edit?.primaries) ? [...new Set(edit.primaries)] : []
    if (primaries.length) {
      const secondaries = [...new Set(Array.isArray(edit.secondaries) ? edit.secondaries : [])].filter(m => !primaries.includes(m))
      row = { ...row, primaries, secondaries, musclesEdited: true }
    }
    const pattern = patternEdits[ex.id]
    if (pattern === '' || isPattern(pattern)) {
      row = { ...row, patternEdited: true }
      if (pattern) row.pattern = pattern
      else delete row.pattern
    }
    if (row !== ex) editedRow.set(ex.id, row)
    if (!customIds.includes(ex.id)) EXIDX[ex.id] = withEdits(ex)
  }
}
export function registerMuscleEdits(map) {
  const next = map && typeof map === 'object' ? map : {}
  if (next === muscleEdits) return
  muscleEdits = next
  rebuildEdits()
}
export function registerPatternEdits(map) {
  const next = map && typeof map === 'object' ? map : {}
  if (next === patternEdits) return
  patternEdits = next
  rebuildEdits()
}
/** The catalogue row as shipped, before any S.exMuscles / S.exPatterns correction. */
export const catalogueRow = id => CATALOGUE.find(ex => ex.id === id)
export const BODYPARTS = [...new Set(CATALOGUE.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => {
    delete EXIDX[id]
    const builtIn = CATALOGUE.find(ex => ex.id === id)
    if (builtIn) EXIDX[id] = withEdits(builtIn)
  })
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...CATALOGUE.map(withEdits)]

function searchableText(value) {
  if (Array.isArray(value)) return value.map(searchableText).join(' ')
  if (value == null) return ''
  try { return String(value) } catch { return '' }
}

/** Case-insensitive search over built-in and legacy custom exercise metadata. */
function isSubsequence(needle, hay) {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

// Fuzzy match score for one exercise against a query. Best hits: exact field match, then
// field prefix, then word-boundary starts, then substrings (closer to the start scores
// better), and finally typo-tolerant ordered subsequences. Fields are weighted - the name
// dominates, target/equipment matter, muscles and description are supporting evidence.
// 0 means no match, so matchesExerciseSearch stays a boolean filter while the picker can
// rank results by score.
export function searchScore(exercise, query) {
  const needle = searchableText(query).toLowerCase().trim()
  if (!needle) return 1
  const source = exercise && typeof exercise === 'object' ? exercise : {}
  const fields = [['n', 100], ['tg', 40], ['eq', 40], ['sm', 30], ['muscleGroups', 30], ['primaries', 30], ['secondaries', 30], ['desc', 10], ['cues', 10]]
  // Token-level matching: every query word must match somewhere (any order), so
  // "press bench" finds "Bench Press". The score sums each token's best hit.
  const tokens = needle.split(/[^a-z0-9]+/).filter(Boolean)
  if (!tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    let best = 0
    for (const [field, weight] of fields) {
      const hay = searchableText(source[field]).toLowerCase()
      if (!hay) continue
      if (hay === token) best = Math.max(best, weight * 4)
      else if (hay.startsWith(token)) best = Math.max(best, weight * 3)
      const idx = hay.indexOf(token)
      if (idx > 0) best = Math.max(best, weight * 2 - Math.min(idx, 20) * 0.5)
      if (hay.split(/[^a-z0-9]+/).some(w => w.startsWith(token))) best = Math.max(best, weight * 2.5)
      if (isSubsequence(token, hay)) best = Math.max(best, weight + Math.max(0, 10 - (hay.length - token.length)))
    }
    if (!best) return 0 // every token must match
    total += best
  }
  return total
}

export function matchesExerciseSearch(exercise, query) {
  return searchScore(exercise, query) > 0
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment. `import.meta.env` is undefined in plain
// Node; the guard keeps this module loadable without Vite.
const ENV = import.meta.env || {}
const IMG_BASE = ENV.VITE_IMG_BASE || 'img/'
const GIF_BASE = ENV.VITE_GIF_BASE || 'gif/'
// A custom exercise carries its picture inline (data: URL), so it is used as is.
const mediaSrc = (base, file) => /^data:/.test(file || '') ? file : base + file
export const imgSrc = ex => mediaSrc(IMG_BASE, ex.img)
export const gifSrc = ex => mediaSrc(GIF_BASE, ex.gif)

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }

// Normalizes text by lowercasing and stripping diacritics/accents (e.g. "elevação" -> "elevacao")
export const normalizeStr = s => (s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

// Multi-token, accent-insensitive and multilingual exercise search.
// Matches when all whitespace-separated words in the query appear anywhere in the exercise's
// name, equipment, target muscle, body part (both in English and translated to active language),
// secondary muscles or description.
//
// The haystack is built once per exercise and cached: NFD-normalising ~1300 catalogue entries
// on every keystroke costs ~8ms on a desktop and several times that on a phone. The cache key
// is the i18n version (bumped by every setLang), so switching language rebuilds the translated
// terms. Custom exercises are re-cached automatically — the store clones state on update, so an
// edited exercise arrives as a new object the WeakMap has never seen.
const corpusCache = new WeakMap()

function corpusOf(e) {
  const v = getVersion()
  const hit = corpusCache.get(e)
  if (hit && hit.v === v) return hit.s
  const sm = Array.isArray(e?.sm) ? e.sm : []
  const s = normalizeStr([
    exerciseNameSearchText(e),
    e?.tg || '', t(e?.tg || ''),
    e?.eq || '', t(e?.eq || ''),
    e?.bp || '', t(e?.bp || ''),
    ...sm, ...sm.map(m => t(m)),
    e?.desc || ''
  ].join(' '))
  corpusCache.set(e, { v, s })
  return s
}

export function matchExercise(e, query) {
  if (!query) return true
  const tokens = normalizeStr(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  if (!e || typeof e !== 'object') return false
  const corpus = corpusOf(e)
  return tokens.every(tok => corpus.includes(tok))
}

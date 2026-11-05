// Supplementary exercise sources: three public repositories whose exercises can be imported
// into a user's own custom list. Nothing here is bundled with the app. Each source is read
// at the moment the user opens the import sheet, from its raw GitHub URL, and every record is
// turned into a candidate in the catalogue's vocabulary (body part, equipment, muscles, steps).
//
// Licences differ per source and every candidate carries its own credit line; see NOTICE.md.
//   RepDB     RepDB Free Tier: use inside applications with attribution, no republishing as a dataset.
//   GymBells  CC BY-NC 4.0: non-commercial use, with attribution.
//   LibreFit  GPL-3.0 with additional terms: keep the author attribution visible.

export const SUPPLEMENT_SOURCES = [
  {
    id: 'repdb',
    name: 'RepDB',
    base: 'https://raw.githubusercontent.com/RepDB/exercise-dataset/main/',
    index: 'exercises.json',
    credit: 'Exercise data by RepDB (repdb.co)',
  },
  {
    id: 'gymbells',
    name: 'GymBells',
    base: 'https://raw.githubusercontent.com/gellyfish-ai/gymbells-exercises/main/',
    index: 'exercises.json',
    text: 'text/en.json',
    credit: 'Exercise illustrations by GymBells (gymbells.gellyfish.dev), CC BY-NC 4.0',
  },
  {
    id: 'librefit',
    name: 'LibreFit',
    base: 'https://raw.githubusercontent.com/LibreFitOrg/LibreFit/main/',
    index: 'app/src/main/res/raw/exercises.json',
    credit: 'Exercise data from LibreFit (GPL-3.0)',
  },
]

const sourceById = id => SUPPLEMENT_SOURCES.find(s => s.id === id)

// Comparable form of a name: no accents, case, spaces or punctuation.
export const normName = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '')

const key = s => String(s || '').trim().toLowerCase().replace(/_/g, ' ')

// Muscle names of the sources (free-exercise-db style, RepDB snake_case) → the catalogue's
// target / secondary vocabulary. Anything not listed is dropped rather than guessed.
const MUSCLE = {
  abdominals: 'abs', abs: 'abs', 'lower abs': 'abs',
  obliques: 'obliques',
  chest: 'pectorals', pectorals: 'pectorals', 'upper chest': 'pectorals',
  'serratus anterior': 'serratus anterior',
  biceps: 'biceps', brachialis: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms', 'wrist flexors': 'forearms', 'wrist extensors': 'forearms',
  shoulders: 'delts', deltoids: 'delts', 'rear deltoids': 'delts', 'rear delts': 'delts',
  traps: 'traps', trapezius: 'traps', neck: 'traps',
  'levator scapulae': 'levator scapulae',
  lats: 'lats', 'latissimus dorsi': 'lats',
  'upper back': 'upper back', 'middle back': 'upper back', rhomboids: 'upper back', back: 'upper back',
  'lower back': 'lower back', 'erector spinae': 'spine', spine: 'spine',
  glutes: 'glutes', 'gluteus maximus': 'glutes',
  hamstrings: 'hamstrings',
  quadriceps: 'quads', quads: 'quads',
  adductors: 'adductors', 'inner thighs': 'adductors', groin: 'adductors',
  abductors: 'abductors',
  calves: 'calves', soleus: 'calves',
  'hip flexors': 'hip flexors',
}
export const muscleName = src => MUSCLE[key(src)] || ''
export const musclesOf = list => [...new Set((Array.isArray(list) ? list : []).map(muscleName).filter(Boolean))]

const BODY_PART = {
  upper_legs: 'upper legs', lower_legs: 'lower legs', upper_arms: 'upper arms', lower_arms: 'lower arms',
  back: 'back', waist: 'waist', chest: 'chest', shoulders: 'shoulders', cardio: 'cardio',
}
// Body part implied by a target muscle, for sources that do not name one.
const BODY_OF_MUSCLE = {
  abs: 'waist', obliques: 'waist',
  pectorals: 'chest', 'serratus anterior': 'chest',
  biceps: 'upper arms', triceps: 'upper arms',
  forearms: 'lower arms',
  glutes: 'upper legs', quads: 'upper legs', hamstrings: 'upper legs', adductors: 'upper legs',
  abductors: 'upper legs', 'hip flexors': 'upper legs',
  calves: 'lower legs',
  delts: 'shoulders', traps: 'shoulders',
  'upper back': 'back', lats: 'back', spine: 'back', 'lower back': 'back', 'levator scapulae': 'back',
}

// Equipment labels of the sources → the catalogue's equipment words.
const EQUIPMENT = {
  'body only': 'body weight', 'body weight': 'body weight', bodyweight: 'body weight', none: 'body weight',
  dumbbell: 'dumbbell', dumbbells: 'dumbbell',
  barbell: 'barbell', 'olympic barbell': 'olympic barbell',
  'e-z curl bar': 'ez barbell', 'ez barbell': 'ez barbell',
  cable: 'cable',
  machine: 'leverage machine', 'leverage machine': 'leverage machine',
  kettlebell: 'kettlebell', kettlebells: 'kettlebell',
  band: 'band', bands: 'band', 'resistance band': 'band',
  'medicine ball': 'medicine ball',
  'exercise ball': 'stability ball', 'stability ball': 'stability ball',
  'smith machine': 'smith machine',
  'foam roll': 'roller', roller: 'roller',
}
export function equipmentName(src) {
  const k = key(src)
  if (!k) return ''
  if (EQUIPMENT[k]) return EQUIPMENT[k]
  // GymBells ids look like "ab_crunch_machine": match on the words they contain.
  if (k.includes('machine')) return 'leverage machine'
  if (k.includes('cable')) return 'cable'
  if (k.includes('dumbbell')) return 'dumbbell'
  if (k.includes('barbell')) return 'barbell'
  if (k.includes('kettlebell')) return 'kettlebell'
  if (k.includes('band')) return 'band'
  if (k.includes('ball')) return 'stability ball'
  if (k.includes('body')) return 'body weight'
  return ''
}

const listOf = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(x => String(x).trim()).filter(Boolean)

// One candidate, in the shape the custom exercise form takes as its starting point.
function candidate(source, sid, f) {
  const cardio = f.category === 'cardio'
  const primaries = cardio ? [] : f.primaries
  const secondaries = cardio ? [] : f.secondaries.filter(m => !primaries.includes(m))
  const bp = cardio ? 'cardio' : (BODY_PART[String(f.bodyPart || '').trim().toLowerCase()] || BODY_OF_MUSCLE[primaries[0]] || '')
  const names = [f.n, f.nEn].map(x => String(x || '').trim().slice(0, 120)).filter(Boolean)
  return {
    key: source.id + ':' + sid,
    source: source.id,
    sid: String(sid),
    n: names[0] || '',
    names: [...new Set(names)],
    bp,
    eq: f.eq || '',
    primaries,
    secondaries,
    steps: listOf(f.steps).slice(0, 20).map(s => s.slice(0, 300)),
    desc: String(f.desc || '').trim().slice(0, 1000),
    imageUrl: f.imageUrl || '',
    credit: source.credit,
  }
}

const img = (base, path) => (path ? base + encodeURI(path) : '')

/** RepDB exercises.json → candidates. `lang` picks the language of names, steps and description. */
export function fromRepDB(index, source = sourceById('repdb'), lang = 'es') {
  return (index?.exercises || []).map(e => {
    const n = e['name_' + lang] || e.name_en
    if (!n) return null
    const pick = field => e[field + '_' + lang] || e[field + '_en']
    return candidate(source, e.id, {
      n, nEn: e.name_en, bodyPart: e.body_part,
      eq: e.is_bodyweight ? 'body weight' : '',
      primaries: musclesOf(e.primary_muscles),
      secondaries: musclesOf(e.secondary_muscles),
      steps: pick('instructions'), desc: pick('description'),
      category: e.category,
      // Some records have one picture (flat.main), others a start and a peak (flat.start).
      imageUrl: img(source.base, e.images?.flat?.main || e.images?.flat?.start),
    })
  }).filter(Boolean)
}

/** GymBells exercises.json + text/en.json → candidates (names and steps come from the text file). */
export function fromGymBells(index, texts, source = sourceById('gymbells')) {
  const out = []
  for (const [id, e] of Object.entries(index?.exercises || {})) {
    const t = texts?.exercises?.[id]
    const n = t?.name
    if (!n) continue
    out.push(candidate(source, id, {
      n, eq: equipmentName(listOf(e.equipment)[0]),
      primaries: musclesOf(e.primary_muscles),
      secondaries: musclesOf(e.secondary_muscles),
      steps: t.steps, category: e.category,
      imageUrl: e.pose ? img(source.base, `images/${e.pose}/start.png`) : '',
    }))
  }
  return out
}

/** LibreFit exercises.json (a plain array) → candidates. */
export function fromLibreFit(list, source = sourceById('librefit')) {
  return (Array.isArray(list) ? list : []).map(e => {
    if (!e?.name) return null
    const first = listOf(e.images)[0]
    return candidate(source, e.id || e.name, {
      n: e.name, eq: equipmentName(e.equipment),
      primaries: musclesOf(e.primaryMuscles),
      secondaries: musclesOf(e.secondaryMuscles),
      steps: e.instructions, category: e.category,
      imageUrl: first ? img(source.base, 'app/src/main/assets/' + first) : '',
    })
  }).filter(Boolean)
}

/** Candidates whose name (in any language offered) is not already taken, and not repeated. */
export function freshOnly(candidates, takenNames) {
  const taken = new Set((takenNames || []).map(normName))
  const seen = new Set()
  return (candidates || []).filter(c => {
    const ks = c.names.map(normName).filter(Boolean)
    if (!ks.length || ks.some(k => taken.has(k) || seen.has(k))) return false
    ks.forEach(k => seen.add(k))
    return true
  })
}

const defaultFetchJson = url => fetch(url).then(r => {
  if (!r.ok) throw new Error('fetch')
  return r.json()
})

const cache = new Map()

/**
 * Candidates from one source, read over the network and cached for the session.
 * `fetchJson` is injectable for tests. Throws when the index cannot be read.
 */
export async function loadSource(id, fetchJson = defaultFetchJson) {
  if (cache.has(id)) return cache.get(id)
  const source = sourceById(id)
  if (!source) throw new Error('unknown-source')
  const index = await fetchJson(source.base + source.index)
  let list
  if (id === 'repdb') list = fromRepDB(index, source)
  else if (id === 'gymbells') list = fromGymBells(index, await fetchJson(source.base + source.text), source)
  else list = fromLibreFit(index, source)
  cache.set(id, list)
  return list
}

export const clearSupplementCache = () => cache.clear()

/**
 * A candidate as the starting point of the custom exercise form: the same fields a catalogue
 * row has, plus the picture to download and the credit line to keep with the saved exercise.
 */
export function importSeed(c) {
  return {
    id: '',
    n: c.n,
    bp: c.bp,
    eq: c.eq,
    tg: c.primaries[0] || '',
    mg: c.primaries[0] || '',
    sm: c.secondaries,
    primaries: c.primaries,
    secondaries: c.secondaries,
    st: c.steps,
    desc: c.desc,
    custom: false,
    credit: c.credit,
    imageUrl: c.imageUrl,
  }
}

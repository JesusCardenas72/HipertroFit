import { describe, it, expect, beforeEach } from 'vitest'
import {
  SUPPLEMENT_SOURCES, normName, muscleName, musclesOf, equipmentName,
  fromRepDB, fromGymBells, fromLibreFit, freshOnly, importSeed, loadSource, clearSupplementCache,
} from './supplement-catalogue.js'

const repSource = SUPPLEMENT_SOURCES.find(s => s.id === 'repdb')
const gymSource = SUPPLEMENT_SOURCES.find(s => s.id === 'gymbells')
const libSource = SUPPLEMENT_SOURCES.find(s => s.id === 'librefit')

describe('muscle and equipment vocabulary', () => {
  it('maps source muscle names to the catalogue vocabulary and drops unknown ones', () => {
    expect(muscleName('abdominals')).toBe('abs')
    expect(muscleName('gluteus_maximus')).toBe('glutes')    // RepDB snake_case reads with spaces
    expect(muscleName('Gluteus Maximus')).toBe('glutes')
    expect(muscleName('unknown_thing')).toBe('')
    expect(muscleName('shoulders')).toBe('delts')
    expect(muscleName('ankles')).toBe('')
    expect(musclesOf(['chest', 'Chest', 'triceps', 'ankles'])).toEqual(['pectorals', 'triceps'])
  })
  it('maps equipment labels, including GymBells ids', () => {
    expect(equipmentName('body only')).toBe('body weight')
    expect(equipmentName('e-z curl bar')).toBe('ez barbell')
    expect(equipmentName('ab_crunch_machine')).toBe('leverage machine')
    expect(equipmentName('cable')).toBe('cable')
    expect(equipmentName('exercise_ball')).toBe('stability ball')
    expect(equipmentName('')).toBe('')
  })
  it('normName ignores accents, case, spaces and punctuation', () => {
    expect(normName('3/4 Sit-Up')).toBe(normName('3/4 sit up'))
    expect(normName('Elevación de gemelos')).toBe('elevaciondegemelos')
  })
})

describe('fromRepDB', () => {
  const index = {
    exercises: [{
      id: '90-90-hold', name_en: '90/90 Hold', name_es: 'Estiramiento 90/90',
      description_en: 'Seated hip stretch.', description_es: 'Estiramiento sentado de cadera.',
      instructions_en: ['Sit down.', 'Hold.'], instructions_es: ['Siéntate.', 'Mantén.'],
      body_part: 'upper_legs', primary_muscles: ['hip_flexors'], secondary_muscles: ['glutes', 'gluteus_maximus'],
      is_bodyweight: true, images: { flat: { main: 'images/flat/90-90-hold-main.webp' } },
    }],
  }
  it('uses the Spanish name, steps and description when asked for es', () => {
    const [c] = fromRepDB(index, repSource, 'es')
    expect(c.key).toBe('repdb:90-90-hold')
    expect(c.n).toBe('Estiramiento 90/90')
    expect(c.names).toEqual(['Estiramiento 90/90', '90/90 Hold'])
    expect(c.steps).toEqual(['Siéntate.', 'Mantén.'])
    expect(c.desc).toBe('Estiramiento sentado de cadera.')
    expect(c.bp).toBe('upper legs')
    expect(c.eq).toBe('body weight')
    expect(c.primaries).toEqual(['hip flexors'])
    expect(c.secondaries).toEqual(['glutes'])        // 'glutes' and 'gluteus_maximus' are one muscle
    expect(c.imageUrl).toBe(repSource.base + 'images/flat/90-90-hold-main.webp')
    expect(c.credit).toBe('Exercise data by RepDB (repdb.co)')
  })
  it('takes the start picture when a record has no main one', () => {
    const [c] = fromRepDB({ exercises: [{ id: 's', name_en: 'Switch', images: { flat: { start: 'images/flat/s-start.webp', peak: 'images/flat/s-peak.webp' } } }] }, repSource, 'en')
    expect(c.imageUrl).toBe(repSource.base + 'images/flat/s-start.webp')
  })
  it('falls back to English when a language is missing', () => {
    const [c] = fromRepDB({ exercises: [{ id: 'x', name_en: 'Plank', instructions_en: ['Hold.'] }] }, repSource, 'de')
    expect(c.n).toBe('Plank')
    expect(c.steps).toEqual(['Hold.'])
  })
})

describe('fromGymBells', () => {
  it('joins the index with the English text file and uses the start picture', () => {
    const index = { exercises: { Ab_Crunch_Machine: { pose: 'ab-crunch-machine', equipment: ['ab_crunch_machine'], primary_muscles: ['abdominals'], secondary_muscles: [], category: 'strength' } } }
    const texts = { exercises: { Ab_Crunch_Machine: { name: 'Machine Crunch', steps: ['Sit down.', 'Curl.'] } } }
    const [c] = fromGymBells(index, texts, gymSource)
    expect(c.key).toBe('gymbells:Ab_Crunch_Machine')
    expect(c.n).toBe('Machine Crunch')
    expect(c.bp).toBe('waist')
    expect(c.eq).toBe('leverage machine')
    expect(c.primaries).toEqual(['abs'])
    expect(c.steps).toEqual(['Sit down.', 'Curl.'])
    expect(c.imageUrl).toBe(gymSource.base + 'images/ab-crunch-machine/start.png')
  })
  it('skips exercises with no text', () => {
    expect(fromGymBells({ exercises: { A: { pose: 'a' } } }, { exercises: {} }, gymSource)).toEqual([])
  })
})

describe('fromLibreFit', () => {
  it('reads the plain array and points the picture at the app assets', () => {
    const list = [{ id: '3_4_Sit-Up', name: '3/4 Sit-Up', equipment: 'body only', primaryMuscles: ['abdominals'], secondaryMuscles: [], instructions: ['Lie down.'], images: ['3_4_Sit-Up/0.webp', '3_4_Sit-Up/1.webp'] }, { name: '' }]
    const out = fromLibreFit(list, libSource)
    expect(out).toHaveLength(1)
    expect(out[0].n).toBe('3/4 Sit-Up')
    expect(out[0].eq).toBe('body weight')
    expect(out[0].imageUrl).toBe(libSource.base + 'app/src/main/assets/3_4_Sit-Up/0.webp')
    expect(out[0].credit).toBe('Exercise data from LibreFit (GPL-3.0)')
  })
  it('a cardio entry carries no muscles and the cardio body part', () => {
    const [c] = fromLibreFit([{ name: 'Rowing', category: 'cardio', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'] }], libSource)
    expect(c.bp).toBe('cardio')
    expect(c.primaries).toEqual([])
    expect(c.secondaries).toEqual([])
  })
})

describe('freshOnly', () => {
  const cands = [
    { key: 'a', names: ['3/4 Sit-Up'] },
    { key: 'b', names: ['Estiramiento 90/90', '90/90 Hold'] },
    { key: 'c', names: ['Curl de bíceps'] },
    { key: 'd', names: ['Curl de biceps'] },   // same name without the accent: a repeat
  ]
  it('drops names already taken in any language and repeats inside the list', () => {
    const out = freshOnly(cands, ['3/4 sit-up', '90/90 Hold'])
    expect(out.map(c => c.key)).toEqual(['c'])
  })
  it('keeps everything when nothing is taken', () => {
    expect(freshOnly(cands, []).map(c => c.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('importSeed', () => {
  it('turns a candidate into the form starting point, keeping its picture and credit', () => {
    const [c] = fromLibreFit([{ name: '3/4 Sit-Up', equipment: 'body only', primaryMuscles: ['abdominals'], secondaryMuscles: ['hip flexors'], instructions: ['Lie down.'], images: ['3_4_Sit-Up/0.webp'] }], libSource)
    const seed = importSeed(c)
    expect(seed).toMatchObject({ id: '', n: '3/4 Sit-Up', bp: 'waist', eq: 'body weight', tg: 'abs', primaries: ['abs'], secondaries: ['hip flexors'], st: ['Lie down.'], custom: false })
    expect(seed.credit).toBe('Exercise data from LibreFit (GPL-3.0)')
    expect(seed.imageUrl).toBe(libSource.base + 'app/src/main/assets/3_4_Sit-Up/0.webp')
  })
})

describe('loadSource', () => {
  beforeEach(() => clearSupplementCache())
  it('reads the source index and caches it for the session', async () => {
    const calls = []
    const fetchJson = async url => { calls.push(url); return [{ name: 'Plank', id: 'p' }] }
    const first = await loadSource('librefit', fetchJson)
    const second = await loadSource('librefit', fetchJson)
    expect(first[0].n).toBe('Plank')
    expect(second).toBe(first)
    expect(calls).toHaveLength(1)
  })
  it('reads the GymBells text file as well as the index', async () => {
    const fetchJson = async url => url.endsWith('exercises.json')
      ? { exercises: { P: { pose: 'p', equipment: ['bodyweight'], primary_muscles: ['abdominals'] } } }
      : { exercises: { P: { name: 'Plank', steps: ['Hold.'] } } }
    const [c] = await loadSource('gymbells', fetchJson)
    expect(c.n).toBe('Plank')
  })
  it('rejects an unknown source and a failed fetch', async () => {
    await expect(loadSource('nope', async () => ({}))).rejects.toThrow('unknown-source')
    await expect(loadSource('repdb', async () => { throw new Error('fetch') })).rejects.toThrow('fetch')
  })
})

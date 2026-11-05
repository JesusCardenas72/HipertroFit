import { describe, it, expect } from 'vitest'
import { EXIDX, EXDB, imgSrc } from './exercises.js'
import { REPDB_MAIN_IMAGES, REPDB_IMAGE_BASE } from './exercise-images.js'

describe('RepDB main pictures of built-in exercises', () => {
  const ids = Object.keys(REPDB_MAIN_IMAGES)

  it('every mapped id is a built-in exercise', () => {
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(EXDB.some(e => e.id === id)).toBe(true)
    }
  })
  it('the catalogue and the picture helper serve the RepDB picture for a mapped exercise', () => {
    const id = ids[0]
    expect(EXIDX[id].img).toBe(REPDB_IMAGE_BASE + REPDB_MAIN_IMAGES[id])
    expect(imgSrc(EXIDX[id])).toBe(REPDB_IMAGE_BASE + REPDB_MAIN_IMAGES[id])
  })
  it('an exercise without a RepDB match keeps the bundled picture', () => {
    const id = EXDB.find(e => !REPDB_MAIN_IMAGES[e.id]).id
    expect(imgSrc(EXIDX[id])).toBe('img/' + EXDB.find(e => e.id === id).img)
  })
})

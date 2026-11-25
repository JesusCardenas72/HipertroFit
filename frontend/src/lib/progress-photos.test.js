import { describe, it, expect } from 'vitest'
import { orderPhotos, comparePair, listPhotos } from './progress-photos.js'

const p = (d, t = 0) => ({ id: d + t, d, t })

describe('progress photos', () => {
  it('orders newest first, then by the time taken', () => {
    expect(orderPhotos([p('2026-10-01'), p('2026-11-01', 1), p('2026-11-01', 2)]).map(x => x.id))
      .toEqual(['2026-11-012', '2026-11-011', '2026-10-010'])
  })

  it('compares the oldest with the newest, only across different days', () => {
    expect(comparePair([p('2026-11-01'), p('2026-09-01'), p('2026-10-01')])).toEqual({ before: p('2026-09-01'), after: p('2026-11-01') })
    expect(comparePair([p('2026-11-01', 1), p('2026-11-01', 2)])).toBeNull()
    expect(comparePair([p('2026-11-01')])).toBeNull()
  })

  it('lists nothing where IndexedDB is unavailable, instead of throwing', async () => {
    expect(await listPhotos()).toEqual([])
  })
})

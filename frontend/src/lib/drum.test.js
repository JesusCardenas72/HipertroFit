import { describe, it, expect } from 'vitest'
import { drumChambers, drumHome, chamberOf, clampChamber, drumSteps, drumSettle, drumArmed, drumRubber, railIndexAt, drumCylinder, drumReach, DRUM_SNAP, DRUM_FLICK } from './drum.js'

const work = (n, done = 0) => Array.from({ length: n }, (_, i) => ({ w: 50, r: 8, done: i < done }))
const warm = n => Array.from({ length: n }, () => ({ w: 20, r: 10, phase: 'warmup', done: false }))
const pick = cs => cs.map(c => (c.warm ? 'w' : '') + 'ABC'[c.member] + c.num)

describe('drumChambers', () => {
  it('lists a single exercise row by row', () => {
    const entries = [{ id: 'x', sets: work(3) }]
    expect(pick(drumChambers(entries, [0]))).toEqual(['A1', 'A2', 'A3'])
  })

  it('interleaves a superset by round and keeps the uneven tail', () => {
    const entries = [{ id: 'a', sets: work(3) }, { id: 'b', sets: work(2) }]
    expect(pick(drumChambers(entries, [0, 1]))).toEqual(['A1', 'B1', 'A2', 'B2', 'A3'])
  })

  it('puts every warm-up first so the work rounds stay in step', () => {
    const entries = [{ id: 'a', sets: [...warm(2), ...work(2)] }, { id: 'b', sets: work(2) }]
    const cs = drumChambers(entries, [0, 1])
    expect(pick(cs)).toEqual(['wA1', 'wA2', 'A1', 'B1', 'A2', 'B2'])
    // and every chamber points back at the real row
    expect(cs.map(c => [c.entry, c.set])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [0, 3], [1, 1]])
  })

  it('numbers each chamber within its own phase', () => {
    const cs = drumChambers([{ id: 'a', sets: [...warm(1), ...work(3)] }], [0])
    expect(cs.map(c => c.num + '/' + c.of)).toEqual(['1/1', '1/3', '2/3', '3/3'])
  })

  it('survives a missing entry', () => {
    expect(drumChambers([{ id: 'a', sets: work(1) }], [0, 4])).toHaveLength(1)
    expect(drumChambers(null, [0])).toEqual([])
  })
})

describe('drumHome', () => {
  it('rests on the first set still to do, in firing order', () => {
    const entries = [{ id: 'a', sets: work(3, 1) }, { id: 'b', sets: work(3, 1) }]
    const cs = drumChambers(entries, [0, 1])
    expect(cs[drumHome(entries, cs)]).toMatchObject({ entry: 0, set: 1 })
  })

  it('shows the last chamber once everything is done', () => {
    const entries = [{ id: 'a', sets: work(2, 2) }]
    expect(drumHome(entries, drumChambers(entries, [0]))).toBe(1)
  })

  it('finds a row by entry and set', () => {
    const entries = [{ id: 'a', sets: work(2) }, { id: 'b', sets: work(2) }]
    expect(chamberOf(drumChambers(entries, [0, 1]), 1, 1)).toBe(3)
  })
})

describe('turning the drum', () => {
  const pitch = 100

  it('springs back short of the snap margin', () => {
    expect(drumSteps(-(DRUM_SNAP * pitch - 1), pitch)).toBe(0)
    expect(drumSettle({ from: 2, drag: -20, pitch, count: 5 })).toBe(2)
  })

  it('moves one chamber once the margin is passed — up is next, down is previous', () => {
    expect(drumSteps(-(DRUM_SNAP * pitch + 1), pitch)).toBe(1)
    expect(drumSteps(DRUM_SNAP * pitch + 1, pitch)).toBe(-1)
  })

  it('counts whole pitches and the leftover past the margin', () => {
    expect(drumSteps(-250, pitch)).toBe(3)
    expect(drumSteps(-210, pitch)).toBe(2)
  })

  it('turns one chamber on a quick flick even when short', () => {
    expect(drumSteps(-10, pitch, -(DRUM_FLICK + 0.1))).toBe(1)
    expect(drumSteps(10, pitch, DRUM_FLICK + 0.1)).toBe(-1)
  })

  it('never lands outside the drum', () => {
    expect(drumSettle({ from: 0, drag: 500, pitch, count: 4 })).toBe(0)
    expect(drumSettle({ from: 3, drag: -500, pitch, count: 4 })).toBe(3)
  })

  it('arms only towards a chamber that exists', () => {
    expect(drumArmed({ from: 1, drag: -40, pitch, count: 3 })).toBe(true)
    expect(drumArmed({ from: 2, drag: -40, pitch, count: 3 })).toBe(false)
    expect(drumArmed({ from: 1, drag: -10, pitch, count: 3 })).toBe(false)
  })

  it('follows the finger inside and resists past the ends', () => {
    expect(drumRubber({ from: 1, drag: -50, pitch, count: 3 })).toBe(-50)
    const past = drumRubber({ from: 0, drag: 100, pitch, count: 3 })
    expect(past).toBeGreaterThan(0)
    expect(past).toBeLessThan(100)
    const end = drumRubber({ from: 2, drag: -100, pitch, count: 3 })
    expect(end).toBeLessThan(0)
    expect(end).toBeGreaterThan(-100)
  })

  it('clamps any index', () => {
    expect(clampChamber(-3, 4)).toBe(0)
    expect(clampChamber(9, 4)).toBe(3)
    expect(clampChamber(1, 0)).toBe(0)
  })
})

describe('railIndexAt', () => {
  it('maps a point on the rail to its chamber', () => {
    expect(railIndexAt(0, 200, 4)).toBe(0)
    expect(railIndexAt(99, 200, 4)).toBe(1)
    expect(railIndexAt(199, 200, 4)).toBe(3)
    expect(railIndexAt(400, 200, 4)).toBe(3)
    expect(railIndexAt(-5, 200, 4)).toBe(0)
  })
})

describe('drumCylinder', () => {
  const geo = { count: 6, hero: 300, strip: 50, gap: 10, radius: 240 }
  const P = 900   // the stage's perspective, px
  // A face's two edges as seen on screen, top first.
  const edges = c => [-c.h / 2, c.h / 2].map(u => {
    const y = c.y + u * Math.cos(c.tilt), z = c.z - u * Math.sin(c.tilt)
    return y * P / (P - z)
  })

  it('shows the chamber in front square on, full size, at the front of the cylinder', () => {
    const l = drumCylinder({ ...geo, pos: 2 })
    expect(l[2].tilt).toBeCloseTo(0)
    expect(l[2].y).toBeCloseTo(0)
    expect(l[2].h).toBe(300)
    expect(l[1].h).toBe(50)
    expect(l[1].tilt).toBeLessThan(0)
    expect(l[3].tilt).toBeGreaterThan(0)
  })

  it('keeps every face on the cylinder: both edges of each chord sit at the radius', () => {
    for (const c of drumCylinder({ ...geo, pos: 2.37 })) {
      for (const u of [-c.h / 2, c.h / 2]) {
        const y = c.y + u * Math.cos(c.tilt), z = c.z - u * Math.sin(c.tilt) + 240
        expect(Math.hypot(y, z)).toBeCloseTo(240, 6)
      }
    }
  })

  it('never lets one face cover another on screen while the drum turns, past the ends too', () => {
    for (let pos = -0.4; pos <= 5.4; pos += 0.05) {
      const l = drumCylinder({ ...geo, pos }).filter(c => !c.back)
      for (let i = 1; i < l.length; i++) {
        expect(edges(l[i])[0]).toBeGreaterThan(edges(l[i - 1])[1])
      }
    }
  })

  it('turns smoothly: a small turn moves every face a little, never a jump', () => {
    let prev = drumCylinder({ ...geo, pos: 0 })
    for (let pos = 0.01; pos <= 5; pos += 0.01) {
      const l = drumCylinder({ ...geo, pos })
      l.forEach((c, i) => expect(Math.abs(c.tilt - prev[i].tilt)).toBeLessThan(0.05))
      prev = l
    }
  })

  it('hides faces that have turned round the back of the cylinder', () => {
    const l = drumCylinder({ ...geo, pos: 0 })
    expect(l[0].back).toBe(false)
    expect(l[5].back).toBe(true)
  })
})

describe('drumReach', () => {
  const geo = { hero: 320, strip: 50, gap: 10, radius: 256, perspective: 900 }

  it('reserves nothing above the first set nor below the last', () => {
    const first = drumReach({ ...geo, pos: 0, count: 4 })
    expect(first.above).toBe(0)
    expect(first.below).toBeGreaterThan(0)
    const last = drumReach({ ...geo, pos: 3, count: 4 })
    expect(last.below).toBe(0)
    expect(last.above).toBeCloseTo(first.below, 6)
  })

  it('is less than the neighbours flat height, since they tilt away round the curve', () => {
    const { above, below } = drumReach({ ...geo, pos: 2, count: 5 })
    expect(above).toBeCloseTo(below, 6)
    expect(below).toBeGreaterThan(geo.strip / 2)
    expect(below).toBeLessThan(2 * (geo.strip + geo.gap))
  })

  it('never shrinks as the drum turns off the first set', () => {
    const at = pos => drumReach({ ...geo, pos, count: 3 }).above
    const steps = [0, 0.25, 0.5, 0.75, 1].map(at)
    steps.slice(1).forEach((r, i) => expect(r).toBeGreaterThanOrEqual(steps[i]))
    expect(steps[4]).toBeGreaterThan(0)
  })

  it('a single chamber needs no room', () => {
    expect(drumReach({ ...geo, pos: 0, count: 1 })).toEqual({ above: 0, below: 0 })
  })
})

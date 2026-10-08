import { describe, expect, it } from 'vitest'
import { springStep, atRest, neck, gooLayers, gooStack } from './dock-physics.js'

describe('springStep', () => {
  it('settles on its target, overshooting on the way like a spring', () => {
    let s = { x: 0, v: 0 }
    let peak = 0
    for (let i = 0; i < 200; i++) { s = springStep(s, 10); peak = Math.max(peak, s.x) }
    expect(peak).toBeGreaterThan(10)
    expect(atRest(s, 10)).toBe(true)
  })

  it('stays put when already resting on its target', () => {
    expect(springStep({ x: 4, v: 0 }, 4)).toEqual({ x: 4, v: 0 })
  })
})

describe('neck', () => {
  it('is whole at rest and thins as the drops are pulled apart', () => {
    expect(neck(0)).toBe(1)
    expect(neck(-5)).toBe(1)
    expect(neck(10)).toBeLessThan(1)
    expect(neck(20)).toBeLessThan(neck(10))
  })

  it('never wears away on its own while the drops still hold', () => {
    expect(neck(1000)).toBe(0.18)
  })
})

describe('gooLayers', () => {
  const blob = (cx, layer, r = 30) => ({ cx, cy: 30, r, fill: 'red', layer })

  it('bridges neighbours of one layer, in x order, at full height when resting', () => {
    const [layer] = gooLayers([blob(124, 'a'), blob(62, 'a')], 62)
    expect(layer.circles.map(c => c.cx)).toEqual([62, 124])
    expect(layer.bridges).toEqual([{ x: 62, y: 0, w: 62, h: 60 }])
  })

  it('narrows the bridge as one drop is pulled away', () => {
    const [layer] = gooLayers([blob(0, 'a'), blob(90, 'a')], 62)
    expect(layer.bridges[0].h).toBeLessThan(60)
    expect(layer.bridges[0].y).toBeGreaterThan(0)
  })

  it('keeps separate layers apart, so two capsules never melt into one', () => {
    const layers = gooLayers([blob(0, 'a'), blob(62, 'b')], 62)
    expect(layers).toHaveLength(2)
    expect(layers.every(l => l.bridges.length === 0)).toBe(true)
  })
})

describe('gooStack', () => {
  const card = (cy, layer = 'u1') => ({ cx: 170, cy, w: 340, h: 70, fill: 'red', layer })

  it('joins stacked cards of a layer with a full-width bridge while they sit together', () => {
    const [layer] = gooStack([card(115), card(35)], 10)
    expect(layer.rects.map(r => r.cy)).toEqual([35, 115])
    expect(layer.bridges).toEqual([{ x: 0, y: 35, w: 340, h: 80 }])
  })

  it('necks the bridge down as a card is pulled away, and keeps layers apart', () => {
    const [near] = gooStack([card(35), card(115)], 10)
    const [far] = gooStack([card(35), card(160)], 10)
    expect(far.bridges[0].w).toBeLessThan(near.bridges[0].w)
    expect(far.bridges[0].x + far.bridges[0].w / 2).toBe(170)
    expect(gooStack([card(35, 'a'), card(115, 'b')], 10).every(layer => layer.bridges.length === 0)).toBe(true)
  })
})

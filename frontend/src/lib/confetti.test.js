import { describe, it, expect } from 'vitest'
import { burst, step, alive, CONFETTI_COLORS } from './confetti.js'

// A deterministic stand-in for Math.random.
const seq = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) }

describe('confetti', () => {
  it('bursts the requested number of particles from the origin, upwards', () => {
    const ps = burst(60, 100, 400, { rand: seq() })
    expect(ps).toHaveLength(60)
    ps.forEach(p => {
      expect(p.x).toBe(100)
      expect(p.y).toBe(400)
      expect(p.vy).toBeLessThan(0)
      expect(CONFETTI_COLORS).toContain(p.color)
    })
  })

  it('rises, slows, then falls under gravity and fades out', () => {
    let p = burst(1, 0, 500, { rand: seq() })[0]
    const startVy = p.vy
    p = step(p)
    expect(p.y).toBeLessThan(500)
    for (let i = 0; i < 120; i++) p = step(p)
    expect(p.vy).toBeGreaterThan(0)            // falling now
    expect(p.vy).not.toBe(startVy)
    for (let i = 0; i < 200; i++) p = step(p)
    expect(p.life).toBe(0)
    expect(alive(p, 800)).toBe(false)
  })

  it('treats a bigger time step like several small ones, roughly', () => {
    const p = burst(1, 0, 0, { rand: seq() })[0]
    let a = p
    for (let i = 0; i < 4; i++) a = step(a)
    const b = step(p, 4)
    expect(Math.abs(a.y - b.y)).toBeLessThan(Math.abs(a.y) * 0.25 + 5)
  })
})

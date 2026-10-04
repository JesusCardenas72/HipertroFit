// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SlideDeck from './SlideDeck.jsx'
import { TURN_BANDS, TURN_MS } from '../lib/slide.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container

const screen = id => <div data-screen={id}><button type="button">press {id}</button></div>

function draw(props) {
  act(() => root.render(<SlideDeck render={screen} directionOf={(a, b) => (b > a ? 1 : -1)} {...props} />))
}

beforeEach(() => {
  window.innerWidth = 400
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SlideDeck, turning', () => {
  it('draws a screen at rest as itself: flat, real, nothing wrapped round the cylinder', () => {
    draw({ current: 0, turn: true })
    expect(container.querySelector('.deck-bands')).toBeNull()
    expect(container.querySelector('.deck-ghost')).toBeNull()
    expect(container.querySelectorAll('.deck-layer')).toHaveLength(1)
  })

  it('wraps both screens round the cylinder as one is dragged in, the real ones kept unseen underneath', () => {
    draw({ current: 0, peek: 1, dir: 1, dx: -150, turn: true })
    expect(container.querySelectorAll('.deck-band')).toHaveLength(2 * TURN_BANDS)
    const layers = [...container.querySelectorAll('.deck-layer')]
    expect(layers).toHaveLength(2)
    layers.forEach(l => expect(l.className).toContain('deck-ghost'))
  })

  it('gives every band a picture of its screen, with nothing in it that could be pressed or found by id', () => {
    draw({ current: 0, peek: 1, dir: 1, dx: -150, turn: true })
    const hosts = [...container.querySelectorAll('.deck-band-in')]
    expect(hosts).toHaveLength(2 * TURN_BANDS)
    hosts.forEach(h => {
      expect(h.hasAttribute('inert')).toBe(true)
      expect(h.closest('.deck-band').getAttribute('aria-hidden')).toBe('true')
      expect(h.querySelector('[data-screen]')).not.toBeNull()
    })
    expect(hosts.filter(h => h.querySelector('[data-screen="1"]'))).toHaveLength(TURN_BANDS)
    // the picture does not count as one of the deck's layers
    expect(container.querySelectorAll('.deck-layer')).toHaveLength(2)
  })

  it('keeps the screen in front flat and real while its neighbour waits wrapped a screen away', () => {
    draw({ current: 0, peek: 1, dir: 1, dx: 0, turn: true })
    // the neighbour waits a screen away, wrapped; the one in front is flat and real
    const real = container.querySelector('.deck-layer:not(.deck-over)')
    expect(real.className).not.toContain('deck-ghost')
    expect(container.querySelectorAll('.deck-band')).toHaveLength(TURN_BANDS)
  })

  it('goes back to flat, real screens once the drag is over and the deck has settled', async () => {
    draw({ current: 0, peek: 1, dir: 1, dx: -150, turn: true })
    expect(container.querySelector('.deck-bands')).not.toBeNull()
    // let go short of the threshold: the deck springs back on its own, then drops the neighbour
    draw({ current: 0, turn: true })
    expect(container.querySelectorAll('.deck-band.anim').length).toBeGreaterThan(0)
    await act(async () => { await new Promise(r => setTimeout(r, TURN_MS + 80)) })
    expect(container.querySelector('.deck-bands')).toBeNull()
    expect(container.querySelector('.deck-ghost')).toBeNull()
    expect(container.querySelectorAll('.deck-layer')).toHaveLength(1)
  })

  it('animates a settle from where the finger left it to the flat screen, band by band', () => {
    draw({ current: 0, peek: 1, dir: 1, dx: -150, turn: true })
    draw({ current: 1, turn: true })
    const bands = [...container.querySelectorAll('.deck-band.anim')]
    expect(bands).toHaveLength(2 * TURN_BANDS)
    // every band has both ends of its own movement, and the screen that lands ends flat
    bands.forEach(b => ['--fx', '--fz', '--fr', '--tx', '--tz', '--tr'].forEach(v => expect(b.style.getPropertyValue(v)).not.toBe('')))
    const landing = bands.filter(b => b.style.getPropertyValue('--tr') === '0deg')
    expect(landing).toHaveLength(TURN_BANDS)
  })

  it('leaves a flat slide as it was: only the turn wraps', () => {
    draw({ current: 0, peek: 1, dir: 1, dx: -150 })
    expect(container.querySelector('.deck-bands')).toBeNull()
    expect(container.querySelector('.deck-ghost')).toBeNull()
  })
})

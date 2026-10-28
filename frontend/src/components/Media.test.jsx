// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Media, { Thumb } from './Media.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: { gifSize: 'full' } }
  state.snapshot = () => ({
    S: state.S,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})

const EX = { id: 'bench', n: 'bench press', gif: 'bench.gif', img: 'bench.jpg' }

let host, root
beforeEach(() => {
  mocks.S = { gifSize: 'full' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = props => act(() => root.render(<Media ex={EX} {...props} />))

describe('Media gifSize', () => {
  it('renders the full animation by default and toggles to mini in the workout', () => {
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
    act(() => { host.querySelector('.giftoggle').click() })
    expect(mocks.S.gifSize).toBe('mini')
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia.mini')).toBeTruthy()
  })

  it('steps the toggle from mini to off (hidden) as the next size in the sequence', () => {
    mocks.S = { gifSize: 'mini' }
    mount({ minimizable: true })
    act(() => { host.querySelector('.giftoggle').click() })
    expect(mocks.S.gifSize).toBe('off')
  })

  it("renders nothing at all in the workout when gifSize is 'off'", () => {
    mocks.S = { gifSize: 'off' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia')).toBeFalsy()
    expect(host.querySelector('img')).toBeFalsy()
    expect(host.innerHTML).toBe('')
  })

  it("'off' only applies to the workout — the detail sheet (not minimizable) still shows media", () => {
    mocks.S = { gifSize: 'off' }
    mount({})
    expect(host.querySelector('.exmedia img')).toBeTruthy()
  })

  it('treats a legacy/unknown value as full', () => {
    mocks.S = { gifSize: 'huge' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
  })
})

describe('Thumb', () => {
  const show = ex => act(() => root.render(<Thumb ex={ex} muscle />))
  const CURL = { id: 'curl', n: 'barbell curl', primaries: ['biceps'], secondaries: ['forearm'] }

  it('stands the trained muscle in for a missing picture', () => {
    show(CURL)
    const pic = host.querySelector('.thumb-x img.icn-img')
    expect(pic.getAttribute('src')).toContain('biceps')
  })

  it('badges the trained muscle on the exercise picture in a list', () => {
    show({ ...CURL, img: 'curl.jpg' })
    expect(host.querySelector('.thumb-wrap > img.thumb')).toBeTruthy()
    expect(host.querySelector('.thumb-wrap > .thumb-mus').getAttribute('src')).toContain('biceps')
  })

  it('keeps the plain picture without the `muscle` flag, and for cardio', () => {
    act(() => root.render(<Thumb ex={{ ...CURL, img: 'curl.jpg' }} />))
    expect(host.querySelector('.thumb-mus')).toBeFalsy()
    show({ id: 'run', bp: 'cardio', tg: 'cardiovascular system', img: 'run.jpg' })
    expect(host.querySelector('.thumb-mus')).toBeFalsy()
  })
})

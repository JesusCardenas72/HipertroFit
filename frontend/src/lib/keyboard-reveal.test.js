// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installKeyboardReveal, isTypingField } from './keyboard-reveal.js'

// A window stand-in whose visible area is shortened by an on-screen keyboard.
function fakeWindow(visibleHeight, innerHeight = 800) {
  const viewport = { height: visibleHeight, offsetTop: 0, addEventListener() {}, removeEventListener() {} }
  return {
    document,
    innerHeight,
    visualViewport: viewport,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    scrollBy() {},
  }
}

describe('isTypingField', () => {
  it('accepts text, number and textarea fields', () => {
    expect(isTypingField(Object.assign(document.createElement('input'), { type: 'text' }))).toBe(true)
    expect(isTypingField(Object.assign(document.createElement('input'), { type: 'number' }))).toBe(true)
    expect(isTypingField(document.createElement('textarea'))).toBe(true)
  })

  it('ignores controls that never open the keyboard', () => {
    for (const type of ['checkbox', 'radio', 'range', 'file', 'button', 'date', 'time']) {
      expect(isTypingField(Object.assign(document.createElement('input'), { type }))).toBe(false)
    }
    expect(isTypingField(document.createElement('div'))).toBe(false)
  })
})

describe('installKeyboardReveal', () => {
  let cleanup

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.useRealTimers()
  })

  it('lifts a sheet field above the keyboard and releases it on blur', () => {
    document.body.innerHTML = '<div class="sheet"><input id="f" type="number"></div>'
    cleanup = installKeyboardReveal(fakeWindow(500))
    const sheet = document.querySelector('.sheet')
    const field = document.getElementById('f')

    field.focus()
    vi.advanceTimersByTime(0)
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('300px')
    expect(sheet.style.getPropertyValue('--picker-visual-height')).toBe('500px')
    expect(sheet.hasAttribute('data-kb')).toBe(true)

    field.blur()
    vi.advanceTimersByTime(150)
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('')
    expect(sheet.hasAttribute('data-kb')).toBe(false)
  })

  it('scrolls the nearest scroller so a field under the keyboard comes back into view', () => {
    document.body.innerHTML = '<div id="scroll" style="overflow-y:auto"><input id="f" type="text"></div>'
    cleanup = installKeyboardReveal(fakeWindow(500))
    const scroller = document.getElementById('scroll')
    const field = document.getElementById('f')
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 800 })
    // The field's bottom sits 36px below the 484px line (visible bottom minus margin).
    field.getBoundingClientRect = () => ({ top: 480, bottom: 520 })

    field.focus()
    vi.advanceTimersByTime(0)
    expect(scroller.scrollTop).toBe(36)
  })

  it('moves the whole sheet up when its field is still under the keyboard', () => {
    document.body.innerHTML = '<div class="sheet"><input id="f" type="text"></div>'
    cleanup = installKeyboardReveal(fakeWindow(500))
    const sheet = document.querySelector('.sheet')
    // Bottom edge of the field is 116px below the 484px line even after the lift.
    document.getElementById('f').getBoundingClientRect = () => ({ top: 560, bottom: 600 })

    document.getElementById('f').focus()
    vi.advanceTimersByTime(0)
    expect(sheet.style.getPropertyValue('--kb-shift')).toBe('-116px')
  })

  it('does nothing for a field that is already clear of the keyboard', () => {
    document.body.innerHTML = '<div class="sheet"><input id="f" type="text"></div>'
    cleanup = installKeyboardReveal(fakeWindow(800))
    const sheet = document.querySelector('.sheet')
    document.getElementById('f').focus()
    vi.advanceTimersByTime(0)
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('0px')
  })
})

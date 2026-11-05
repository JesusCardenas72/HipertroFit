/* Keeps the field being typed in visible while the on-screen keyboard is up.

   The keyboard shrinks the visual viewport only. The layout viewport, the page and any bottom
   sheet keep their size, so a text or number field near the foot of a screen or sheet ends up
   under the keys — and the user types blind. use-sheet-keyboard.js fixes this for the sheets that
   opt in one by one; this installs it once for every field in the app, so no screen has to remember.

   For a field inside a .sheet we write the same two properties the picker sheets use
   (--picker-keyboard-bottom / --picker-visual-height) plus data-kb, which index.css reads to lift the
   sheet and cap its height. For a field anywhere else we scroll its nearest scrollable ancestor
   just far enough that the field clears the keyboard. Both are recomputed from fresh rects, so
   they converge even when the browser has already scrolled the field itself. */

const MARGIN = 16
// Input types that never bring up the keyboard (or bring up a native picker instead).
const NO_KEYBOARD = new Set(['checkbox', 'radio', 'range', 'file', 'button', 'submit', 'reset', 'color', 'hidden', 'date', 'time'])

export function isTypingField(el) {
  if (!el || typeof el.tagName !== 'string') return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return !NO_KEYBOARD.has((el.type || 'text').toLowerCase())
}

// The nearest ancestor that actually scrolls vertically, or null for the page itself.
function scrollerOf(el, doc) {
  for (let node = el.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

export function installKeyboardReveal(win = typeof window !== 'undefined' ? window : null) {
  const viewport = win?.visualViewport
  if (!win || !viewport) return () => {}
  const doc = win.document

  let field = null      // the typing field we are keeping visible
  let sheet = null      // the .sheet it lives in, if any, while it is lifted
  let timers = []

  // Bottom edge of what is actually visible, in layout-viewport pixels.
  const visibleBottom = () => (viewport.offsetTop || 0) + viewport.height
  const visibleTop = () => viewport.offsetTop || 0

  const releaseSheet = () => {
    if (!sheet) return
    sheet.style.removeProperty('--picker-keyboard-bottom')
    sheet.style.removeProperty('--picker-visual-height')
    sheet.style.removeProperty('--kb-shift')
    sheet.removeAttribute('data-kb')
    sheet = null
  }

  const place = () => {
    if (!field || !field.isConnected || doc.activeElement !== field) return
    const inset = Math.max(0, win.innerHeight - visibleBottom())

    const holder = field.closest('.sheet')
    if (holder !== sheet) releaseSheet()
    sheet = holder
    if (sheet) {
      sheet.style.setProperty('--picker-keyboard-bottom', `${inset}px`)
      sheet.style.setProperty('--picker-visual-height', `${viewport.height}px`)
      sheet.setAttribute('data-kb', '')
    }

    // Measure after the lift above, so a sheet that just moved is not measured where it was.
    const rect = field.getBoundingClientRect()
    const bottomLimit = visibleBottom() - MARGIN
    const topLimit = visibleTop() + MARGIN

    // Still under the keys after the lift (the keyboard did not report its height, or the field
    // sits high in a tall sheet): move the whole sheet up by the rest, so the field is in view.
    if (sheet && rect.bottom > bottomLimit) {
      const prev = parseFloat(sheet.style.getPropertyValue('--kb-shift')) || 0
      sheet.style.setProperty('--kb-shift', `${prev - (rect.bottom - bottomLimit)}px`)
      return
    }

    const scroller = scrollerOf(field, doc)
    let delta = 0
    if (rect.bottom > bottomLimit) delta = rect.bottom - bottomLimit
    else if (rect.top < topLimit) delta = rect.top - topLimit
    if (!delta) return
    if (scroller) scroller.scrollTop += delta
    else win.scrollBy(0, delta)
  }

  const schedulePlace = () => {
    place()
    // The keyboard animates in over a few hundred ms; the viewport events are not reliable on
    // every platform, so re-check a couple of times while it settles.
    timers.forEach(clearTimeout)
    timers = [win.setTimeout(place, 150), win.setTimeout(place, 400)]
  }

  const onFocusIn = e => {
    if (!isTypingField(e.target)) return
    field = e.target
    schedulePlace()
  }

  const onFocusOut = () => {
    // Focus can hop straight to another field (Next, or a neighbouring cell); only let go when
    // nothing typing has the focus once the browser has settled it.
    win.setTimeout(() => {
      if (isTypingField(doc.activeElement)) return
      field = null
      timers.forEach(clearTimeout)
      timers = []
      releaseSheet()
    }, 100)
  }

  const onViewportChange = () => { if (field) place() }

  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('focusout', onFocusOut)
  viewport.addEventListener('resize', onViewportChange)
  viewport.addEventListener('scroll', onViewportChange)

  return () => {
    doc.removeEventListener('focusin', onFocusIn)
    doc.removeEventListener('focusout', onFocusOut)
    viewport.removeEventListener('resize', onViewportChange)
    viewport.removeEventListener('scroll', onViewportChange)
    timers.forEach(clearTimeout)
    field = null
    releaseSheet()
  }
}

/* Pictures of a screen's DOM, for faces that are drawn bent round the cylinder (SetDrum's chambers,
   SlideDeck's screens).
   A bent face is cut into bands and every band shows its own part of the face, so each needs a copy
   of it — a copy of the *DOM*, which is all it takes: nothing in it is alive, no handlers, no ids, no
   focus. A face is only drawn this way while it is turning, and nobody presses a button on a face
   that is going by; the real one stays mounted and unseen, keeping its state, and the copies follow
   whenever it changes. */

/** Replaces what is in `host` with a copy of what is in `src`. `keepStyle` keeps the inline style of src's own children. */
export function copyFace(host, src, { keepStyle = false } = {}) {
  host.textContent = ''
  for (const n of src.childNodes) {
    const c = n.cloneNode(true)
    if (c.nodeType === 1) {
      if (!keepStyle) c.removeAttribute('style')
      c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'))
    }
    host.appendChild(c)
  }
  // A copied field starts from its attribute, not from what has been typed into it.
  const from = src.querySelectorAll('input,textarea,select'), to = host.querySelectorAll('input,textarea,select')
  from.forEach((e, k) => { if (to[k]) to[k].value = e.value })
}

/**
 * Runs `fill` now and again, at most once a frame, whenever `src` changes in a way that shows.
 * `attrs` are the attributes that count: not a style that changes with every frame of the turn.
 * Returns the function that stops it.
 */
export function followFace(src, fill, attrs) {
  fill()
  if (typeof MutationObserver === 'undefined') return () => {}
  let raf = 0
  const mo = new MutationObserver(() => {
    if (typeof requestAnimationFrame === 'undefined') { fill(); return }
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(fill)
  })
  mo.observe(src, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attrs })
  return () => { mo.disconnect(); if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf) }
}

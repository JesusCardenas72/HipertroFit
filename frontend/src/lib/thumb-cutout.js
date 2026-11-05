// Exercise thumbnails are JPEGs with a white studio background, which shows as a white box on
// the dark cards. cutoutBackground() makes that background transparent: a near-white pixel is
// cleared only when it is connected to the picture's edge through other near-white pixels, so
// a white highlight enclosed by the figure stays opaque.

/**
 * Clear the alpha of background pixels in place. `px` is RGBA bytes (ImageData.data), `w`×`h`.
 * A pixel is background when all of R, G, B are at least `threshold` and it is reachable from
 * the border through such pixels. Returns `px` for convenience.
 */
export function cutoutBackground(px, w, h, threshold = 235) {
  const light = p => px[p * 4] >= threshold && px[p * 4 + 1] >= threshold && px[p * 4 + 2] >= threshold
  const seen = new Uint8Array(w * h)
  const stack = []
  const push = p => { if (!seen[p] && light(p)) { seen[p] = 1; stack.push(p) } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()
    px[p * 4 + 3] = 0
    const x = p % w, y = (p - x) / w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }
  return px
}

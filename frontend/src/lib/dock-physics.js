/**
 * The physics behind the workout dock: thumbnails that ride damped springs, and superset
 * capsules drawn as drops of liquid that stretch, neck down and snap apart. Pure numbers in,
 * numbers out — WorkoutDock steps them once a frame and paints the result.
 */

/**
 * One frame of a damped spring pulling `x` toward `target`. `k` is how hard it pulls, `d` how
 * much velocity survives the frame: low and it settles flat, near 1 and it wobbles.
 */
export function springStep({ x, v }, target, k = 0.16, d = 0.74) {
  const nv = (v + (target - x) * k) * d
  return { x: x + nv, v: nv }
}

export function atRest({ x, v }, target, eps = 0.05) {
  return Math.abs(target - x) < eps && Math.abs(v) < eps
}

/**
 * How thick the neck between two drops is, as a share of a full capsule: whole while they sit
 * at their resting distance, thinning as `gap` (how far they are pulled past it) grows. It never
 * thins below `min` on its own — the break is the magnet letting go, not the neck wearing away.
 */
export function neck(gap, reach = 52, min = 0.18) {
  if (gap <= 0) return 1
  return Math.max(min, Math.pow(Math.max(0, 1 - gap / reach), 0.7))
}

/**
 * Group drawable blobs (`{ cx, cy, r, fill, layer }`) into the layers that are blurred
 * together. Within a layer, neighbours in x order are joined by a bridge whose height follows
 * `neck`; `rest` is the centre-to-centre distance of two members sitting side by side.
 */
export function gooLayers(blobs, rest) {
  const layers = new Map()
  for (const blob of blobs) {
    if (!layers.has(blob.layer)) layers.set(blob.layer, [])
    layers.get(blob.layer).push(blob)
  }
  return [...layers.values()].map(list => {
    const circles = [...list].sort((a, b) => a.cx - b.cx)
    const bridges = []
    for (let i = 1; i < circles.length; i++) {
      const a = circles[i - 1]
      const b = circles[i]
      const h = 2 * Math.min(a.r, b.r) * neck(b.cx - a.cx - rest)
      bridges.push({ x: a.cx, y: (a.cy + b.cy) / 2 - h / 2, w: b.cx - a.cx, h })
    }
    return { fill: circles[0].fill, circles, bridges }
  })
}

/**
 * The same drops stacked down a column instead of along a row — the plan editor's list, where
 * every blob is a rounded card (`{ cx, cy, w, h, fill, layer }`) rather than a circle. Within a
 * layer, neighbours in y order are joined by a bridge as wide as the narrower card times `neck`,
 * measured on how far their facing edges have been pulled past `restGap`, the gap between two
 * cards sitting one above the other.
 */
export function gooStack(blobs, restGap) {
  const layers = new Map()
  for (const blob of blobs) {
    if (!layers.has(blob.layer)) layers.set(blob.layer, [])
    layers.get(blob.layer).push(blob)
  }
  return [...layers.values()].map(list => {
    const rects = [...list].sort((a, b) => a.cy - b.cy)
    const bridges = []
    for (let i = 1; i < rects.length; i++) {
      const a = rects[i - 1]
      const b = rects[i]
      const gap = (b.cy - b.h / 2) - (a.cy + a.h / 2)
      const w = Math.min(a.w, b.w) * neck(gap - restGap)
      bridges.push({ x: (a.cx + b.cx) / 2 - w / 2, y: a.cy, w, h: b.cy - a.cy })
    }
    return { fill: rects[0].fill, rects, bridges }
  })
}

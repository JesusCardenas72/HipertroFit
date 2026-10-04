/**
 * The revolver drum: an alternative way of looking at one screen of a workout, where the sets of
 * an exercise (or of a whole superset) are chambers of a cylinder and only the one in front of
 * you is drawn at full size. Turning the drum only changes which set is *shown* — it never ticks
 * anything off. Everything here is arithmetic on indexes and pixels, no DOM and no React, so the
 * order of the chambers and the point where a drag jumps to the next one are pinned by a test.
 */
import { isWarmupRow } from './workout-model.js'

/** Fraction of a chamber's pitch a drag has to cover before letting go turns the drum. */
export const DRUM_SNAP = 0.32
/** A quick flick turns the drum one chamber even when it was short of the snap (px/ms). */
export const DRUM_FLICK = 0.55
/** How far, in px, a drag has to go before it commits to an axis. */
export const DRUM_LOCK = 10
/** Past either end the drum gives this fraction of the drag, so the end is felt, not silent. */
export const DRUM_RUBBER = 0.28

/**
 * The chambers of one screen, in the order they are fired.
 *
 * A single exercise is simply its rows. A superset is done back to back, so its chambers are
 * interleaved by round — A1, B1, A2, B2… — the same order the superset flow walks
 * (lib/supersetFlow.js). Warm-ups are their own phase: every member's warm-ups come first,
 * interleaved the same way, then the work sets, so a member with two warm-ups and one with none
 * do not get their first work sets knocked out of step.
 *
 * Each chamber: { entry, set, member, warm, num, of } — `num`/`of` number it within its own
 * phase of its own exercise (warm-up 1 of 2, set 3 of 4), the way the list view numbers rows.
 */
export function drumChambers(entries, unit) {
  if (!Array.isArray(entries) || !Array.isArray(unit)) return []
  const members = unit.filter(idx => Array.isArray(entries[idx]?.sets))
  const phase = warm => members.map((idx, member) => {
    const rows = []
    entries[idx].sets.forEach((s, set) => { if (isWarmupRow(s) === warm) rows.push({ entry: idx, set, member, warm }) })
    return rows.map((r, k) => ({ ...r, num: k + 1, of: rows.length }))
  })
  const out = []
  for (const lists of [phase(true), phase(false)]) {
    const rounds = Math.max(0, ...lists.map(l => l.length))
    for (let k = 0; k < rounds; k++) lists.forEach(l => { if (l[k]) out.push(l[k]) })
  }
  return out
}

/**
 * Where the drum rests when a screen opens or a set has just been ticked: the first chamber
 * still to do, else the last one (everything is done — show how it ended).
 */
export function drumHome(entries, chambers) {
  if (!chambers?.length) return 0
  const i = chambers.findIndex(c => !entries[c.entry]?.sets?.[c.set]?.done)
  return i >= 0 ? i : chambers.length - 1
}

/** Index of the chamber for a given row, or -1. */
export function chamberOf(chambers, entry, set) {
  return (chambers || []).findIndex(c => c.entry === entry && c.set === set)
}

/** Keeps an index inside the drum. */
export function clampChamber(i, count) {
  if (!(count > 0)) return 0
  return Math.min(count - 1, Math.max(0, Math.round(i) || 0))
}

/**
 * How many chambers a drag has turned the drum by, signed: dragging the finger *up* brings the
 * next chamber in (+), dragging it down brings the previous one back (−) — the content follows
 * the finger, as any scrolled list does. Whole pitches count in full; the leftover counts as one
 * more once it passes DRUM_SNAP. A drag short of that is a cancel, unless it was a flick.
 */
export function drumSteps(drag, pitch, velocity = 0) {
  if (!(pitch > 0)) return 0
  const travel = -drag / pitch
  const whole = Math.trunc(travel)
  const rest = travel - whole
  let steps = whole + (Math.abs(rest) >= DRUM_SNAP ? Math.sign(rest) : 0)
  if (steps === 0 && Math.abs(velocity) >= DRUM_FLICK) steps = velocity < 0 ? 1 : -1
  return steps
}

/** The chamber a drag lands on once the finger lets go (see drumSteps), kept inside the drum. */
export function drumSettle({ from, drag, pitch, velocity = 0, count }) {
  return clampChamber(from + drumSteps(drag, pitch, velocity), count)
}

/**
 * Whether the drag has passed the point where letting go turns the drum — the moment the
 * incoming chamber lights up and the phone gives its click. Same rule as drumSteps, minus the
 * flick, and only towards a chamber that exists.
 */
export function drumArmed({ from, drag, pitch, count }) {
  const steps = drumSteps(drag, pitch)
  return steps !== 0 && clampChamber(from + steps, count) !== from
}

/**
 * The drag as drawn: followed one to one inside the drum, resisted past its first or last
 * chamber. `from` is the resting index, the result is in px like the input.
 */
export function drumRubber({ from, drag, pitch, count }) {
  if (!(pitch > 0) || !(count > 0)) return 0
  const pos = from - drag / pitch
  const lo = 0, hi = count - 1
  if (pos < lo) return (from - lo) * pitch + (drag - (from - lo) * pitch) * DRUM_RUBBER
  if (pos > hi) return -(hi - from) * pitch + (drag + (hi - from) * pitch) * DRUM_RUBBER
  return drag
}

/**
 * The drum as a revolver's cylinder of `radius` px, turned to `pos` (a fractional index while
 * it turns). The chamber at `pos` is drawn full `hero` height and the rest as `strip` capsules;
 * growth is linear in the distance to `pos`, so as one shrinks the next grows. Each is a flat face
 * inscribed in it — a chord exactly as long as the chamber is tall — with a chord of `gap` left
 * between neighbours, so the faces form a convex polygon: seen from the front no face can ever
 * cover another, however the cylinder is turned. The one at `pos` faces the viewer square on;
 * the rest tilt away round the curve.
 *
 * Returns per chamber `y`, `z` (its centre in px: down from the axis line, towards the viewer,
 * 0 being the cylinder's front), `tilt` (radians, + faces downward), `h`, `grow`, and `back`
 * when the face has turned past the side of the cylinder and should not be drawn.
 */
export function drumCylinder({ pos, count, hero, strip, gap, radius }) {
  if (!(count > 0)) return []
  const R = Math.max(radius, hero / 2 + 1, strip)
  const arc = len => 2 * Math.asin(Math.min(1, len / (2 * R)))
  const p = Math.min(count - 1, Math.max(0, pos))
  const extra = Math.max(0, hero - strip)
  const g = arc(gap)
  const out = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const grow = 1 - Math.min(1, Math.abs(i - p))
    const h = strip + extra * grow
    const a = arc(h)
    out.push({ mid: start + a / 2, a, h, grow })
    start += a + g
  }
  const k = Math.min(count - 2, Math.floor(p))
  const step = count > 1 ? out[k + 1].mid - out[k].mid : arc(hero) / 2 + g + arc(strip) / 2
  const ref = (count > 1 ? out[k].mid + (p - k) * step : out[0].mid) + (pos - p) * step
  return out.map(({ mid, a, h, grow }) => {
    const tilt = mid - ref
    const d = R * Math.cos(a / 2)          // axis to the face's centre
    return {
      y: d * Math.sin(tilt), z: d * Math.cos(tilt) - R, tilt, h, grow,
      back: Math.abs(tilt) + a / 2 > Math.PI / 2 - 0.02,
    }
  })
}

/**
 * How much a chamber is bent round the cylinder, 0..1, from how much of it is shown (`grow`, as
 * drumCylinder gives it). The chamber resting in front is a flat card you can read and press, so it
 * is not bent at all; the moment it starts to leave — or one starts to arrive — its surface wraps
 * round the curve, fully so a fifth of the way through. Continuous at both ends, so neither the
 * start nor the end of a turn has a visible switch.
 */
export const DRUM_BEND_RAMP = 0.18
export function drumBend(grow) {
  return Math.max(0, Math.min(1, (1 - grow) / DRUM_BEND_RAMP))
}

/**
 * One chamber's face cut into `slices` bands, each placed on the cylinder on its own, so the
 * surface curves instead of leaning as a single flat card. Band j shows the part of the face at
 * `e` px from its middle and is placed by `y`, `z` and `rot` (radians, + faces downward) exactly
 * as drumCylinder places a whole face. It covers `unit` px of the surface (its chord) and is drawn
 * `len` tall, a little over that so neighbours overlap and no seam shows. What the face carries is
 * never cropped to fit: the whole sticker is laid on the face, so the caller squeezes or stretches
 * its content to `unit` per band — a sticker on a drum, not a window onto one. `step` is the angle
 * the band covers, so its top edge faces `rot - step / 2` and its bottom edge `rot + step / 2`.
 *
 * With `bend` at 1 the content is wrapped on the cylinder: every band's edges sit on the circle,
 * so the bands tile it end to end, the middle ones facing you, those above and below turned away
 * and foreshortened — the look of a label round a drum. With `bend` at 0 the bands are slices of
 * the flat face drumCylinder gives, lying in one plane. Anything between blends the two.
 */
export function drumFace({ pos, index, count, hero, strip, gap, radius, slices = 8, overlap = 0.75, bend }) {
  const c = drumCylinder({ pos, count, hero, strip, gap, radius })[index]
  if (!c || !(slices > 0)) return []
  const R = Math.max(radius, hero / 2 + 1, strip)
  const a = 2 * Math.asin(Math.min(1, c.h / (2 * R)))      // the face's angle
  const d = R * Math.cos(a / 2)                              // axis to the flat face
  const k = bend ?? drumBend(c.grow)
  const share = c.h / slices
  const step = a / slices                                    // one band's angle
  const chord = 2 * R * Math.sin(step / 2)                   // ... its chord, as long as it is drawn
  const dist = R * Math.cos(step / 2)                        // axis to a band's chord
  const mix = (flat, bent) => flat + (bent - flat) * k
  return Array.from({ length: slices }, (_, j) => {
    const e = -c.h / 2 + (j + 0.5) * share
    const at = c.tilt + (e / c.h) * a
    const rot = mix(c.tilt, at)
    const unit = mix(share, chord)
    return {
      e, unit, len: unit + 2 * overlap, rot, step,
      y: mix(d * Math.sin(c.tilt) + e * Math.cos(c.tilt), dist * Math.sin(at)),
      z: mix(d * Math.cos(c.tilt) - R - e * Math.sin(c.tilt), dist * Math.cos(at) - R),
      back: Math.abs(rot) + step / 2 > Math.PI / 2 - 0.02,
    }
  })
}

/**
 * How far a face turned `rot` radians away from you has faded into the page, 0..1: a face seen
 * square on is as drawn, one edge-on is gone.
 */
export function drumShade(rot) {
  return 1 - Math.max(0, Math.cos(rot)) ** 0.7
}

/**
 * How far the drum actually reaches above and below the hero's edges, in px on screen: the
 * chambers within `near` of `pos` (the ones SetDrum mounts), each face's two edges rotated by its
 * tilt and projected through a `perspective` centred on the hero. Neighbours round the curve are
 * foreshortened well below their flat height, so this — not the strip height — is the room the
 * stage needs: the first set gets none above it, the last none below.
 */
export function drumReach({ pos, count, hero, strip, gap, radius, perspective, near = 2.4 }) {
  if (!(count > 1)) return { above: 0, below: 0 }
  const p = Math.min(count - 1, Math.max(0, pos))
  const drum = drumCylinder({ pos: p, count, hero, strip, gap, radius })
  let top = -hero / 2, bottom = hero / 2
  drum.forEach(({ y, z, tilt, h, back }, i) => {
    if (back || Math.abs(i - p) > near) return
    for (const e of [-h / 2, h / 2]) {
      const Y = y + e * Math.cos(tilt), Z = z - e * Math.sin(tilt)
      const at = Y * perspective / (perspective - Z)
      top = Math.min(top, at)
      bottom = Math.max(bottom, at)
    }
  })
  return { above: -hero / 2 - top, below: bottom - hero / 2 }
}

/** The chamber under a point of the side rail: `y` from the rail's top, rail `height` px tall. */
export function railIndexAt(y, height, count) {
  if (!(count > 0) || !(height > 0)) return 0
  return clampChamber(Math.floor((y / height) * count), count)
}

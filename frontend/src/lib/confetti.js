// Confetti burst physics, kept framework-free so the canvas component only draws.
//
// Particles leave one origin in a cone pointing up, slow down in the air, fall under gravity and
// flutter (a spin that also squashes the piece, which is what makes paper read as paper).

export const CONFETTI_COLORS = ['#30d158', '#0a84ff', '#ffd60a', '#ff375f', '#ff9f0a', '#bf5af2', '#40c8e0']

/** `n` particles bursting from (x, y). `rand` is injectable so tests are deterministic. */
export function burst(n, x, y, { rand = Math.random, power = 1, colors = CONFETTI_COLORS } = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    // Mostly upwards: -90° ± 70°.
    const angle = -Math.PI / 2 + (rand() - 0.5) * (Math.PI * 7 / 9)
    const speed = (7 + rand() * 11) * power
    out.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + rand() * 6,
      h: 8 + rand() * 8,
      rot: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 0.4,
      tilt: rand() * Math.PI * 2,
      color: colors[Math.floor(rand() * colors.length) % colors.length],
      life: 1
    })
  }
  return out
}

const GRAVITY = 0.32
const DRAG = 0.985
const FADE_PER_FRAME = 1 / 150   // ~2.5 s at 60 fps

/** Advance one particle by `dt` frames (1 = one 60 fps frame). Returns a new particle. */
export function step(p, dt = 1) {
  const drag = Math.pow(DRAG, dt)
  const vx = p.vx * drag
  const vy = p.vy * drag + GRAVITY * dt
  return {
    ...p,
    vx, vy,
    x: p.x + vx * dt + Math.sin(p.tilt) * 0.6 * dt,
    y: p.y + vy * dt,
    rot: p.rot + p.spin * dt,
    tilt: p.tilt + 0.1 * dt,
    life: Math.max(0, p.life - FADE_PER_FRAME * dt)
  }
}

/** Whether a particle is still worth drawing inside a viewport `height` tall. */
export const alive = (p, height) => p.life > 0 && p.y < height + 40

import { useLayoutEffect, useRef } from 'react'

const ITEM = 40 // px, one value's row (.wheel-it in index.css)
const STEP = 24 // degrees of the drum between neighbouring values
const R = ITEM / (STEP * Math.PI / 180) // drum radius: neighbours sit one row apart at the band
const MAGNET = 0.7 // 0 = values follow the finger exactly, 1 = they cling to the band until halfway
const REACH = 4 // values either side of the band that are drawn on the drum

// The drum shows the scroll position bent towards the nearest slot: close to it the values hang
// on, past halfway they're pulled into the next one, like a magnet catching or a gear tooth
// dropping into place.
const magnet = f => f * (1 - MAGNET) + MAGNET * Math.sign(f) * 0.5 * (2 * Math.abs(f)) ** 3
// The clunk once it lands: a short overshoot in the direction it was turning, damped out.
const KICK_MS = 380
const kick = t => 0.22 * Math.exp(-t / 90) * Math.sin(t / KICK_MS * 2.6 * Math.PI)
const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A picker wheel: the values scroll under a band, and whichever one comes to rest in it is the
 * value. Native scrolling with snap points does the physics — a flick coasts and lands on a
 * value — and the choice is reported once the scroll settles, not on every frame it passes.
 * On top of that the values are drawn on a drum (each tilted and placed by its angle from the
 * band) that is magnetised to its slots and gives a little overshoot when it lands.
 * Tapping a value turns the wheel to it. `data-nodrag` keeps a sheet's swipe-to-dismiss off it.
 */
export default function Wheel({ values, value, onChange, format = String, label }) {
  const ref = useRef(null)
  const settle = useRef(0)
  const m = useRef({ raf: 0, last: null, dir: 0, kickAt: 0, kickDir: 0, drawn: [] })
  const at = Math.max(0, values.findIndex(v => v === value))

  const paint = now => {
    const el = ref.current, st = m.current
    st.raf = 0
    if (!el) return
    const pos = el.scrollTop / ITEM
    const n = Math.round(pos)
    let shown = still() ? pos : n + magnet(pos - n)
    const t = now - st.kickAt
    if (st.kickAt && t < KICK_MS) { shown += st.kickDir * kick(t); st.raf = requestAnimationFrame(paint) }
    else st.kickAt = 0
    // The rows stay put and their label is what moves: snap points follow transformed boxes, so
    // moving the rows themselves would drag the slots along with the drawing.
    const kids = el.children, drawn = []
    for (const i of st.drawn) if (Math.abs(i - n) > REACH && kids[i]) kids[i].firstChild.style.cssText = ''
    for (let i = Math.max(0, n - REACH); i <= Math.min(kids.length - 1, n + REACH); i++) {
      const lab = kids[i].firstChild.style
      const a = Math.max(-90, Math.min(90, (i - shown) * STEP))
      const rad = a * Math.PI / 180
      // where the drum puts it, minus where the scroll already has it
      const dy = R * Math.sin(rad) - (i - pos) * ITEM
      const near = Math.max(0, 1 - Math.abs(i - shown))
      lab.transform = `translateY(${dy.toFixed(2)}px) perspective(260px) rotateX(${(-a).toFixed(2)}deg) scale(${(0.9 + 0.1 * near).toFixed(3)})`
      lab.opacity =(0.15 + 0.85 * Math.cos(rad) ** 2).toFixed(3)
      drawn.push(i)
    }
    st.drawn = drawn
  }
  const draw = () => { if (!m.current.raf) m.current.raf = requestAnimationFrame(paint) }

  // Follow a value changed from outside (another tab, a cascade) without fighting a scroll in
  // flight: only when the band is not already on it.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && Math.round(el.scrollTop / ITEM) !== at) el.scrollTop = at * ITEM
    cancelAnimationFrame(m.current.raf)
    paint(performance.now())
  }, [at, values.length])
  const land = () => {
    const st = m.current
    if (st.dir && !still()) { st.kickAt = performance.now(); st.kickDir = st.dir; draw() }
    st.dir = 0
  }
  // scrollend straight from the element: React doesn't hand it on as a prop
  useLayoutEffect(() => {
    const el = ref.current
    el?.addEventListener('scrollend', land)
    return () => { el?.removeEventListener('scrollend', land); cancelAnimationFrame(m.current.raf) }
  }, [])
  const onScroll = () => {
    const el = ref.current, st = m.current
    if (!el) return
    const pos = el.scrollTop / ITEM
    if (st.last != null && pos !== st.last) st.dir = Math.sign(pos - st.last)
    st.last = pos
    st.kickAt = 0
    draw()
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))
      if (!('onscrollend' in window)) land()
      if (values[i] !== value) onChange(values[i])
    }, 110)
  }
  return <div className="wheel" data-nodrag>
    <div className="wheel-band" aria-hidden="true" />
    <div className="wheel-scroll" ref={ref} onScroll={onScroll} role="listbox" aria-label={label}>
      {values.map((v, i) => (
        <div key={i} role="option" aria-selected={i === at} className={'wheel-it' + (i === at ? ' on' : '')}
          onClick={() => { const el = ref.current; if (el?.scrollTo) el.scrollTo({ top: i * ITEM, behavior: 'smooth' }); else if (v !== value) onChange(v) }}><span>{format(v)}</span></div>
      ))}
    </div>
  </div>
}

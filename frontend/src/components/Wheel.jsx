import { useLayoutEffect, useRef } from 'react'

const ITEM = 40 // px, one value's row (.wheel-it in index.css)

/**
 * A picker wheel: the values scroll under a band, and whichever one comes to rest in it is the
 * value. Native scrolling with snap points does the physics — a flick coasts and lands on a
 * value — and the choice is reported once the scroll settles, not on every frame it passes.
 * Tapping a value turns the wheel to it. `data-nodrag` keeps a sheet's swipe-to-dismiss off it.
 */
export default function Wheel({ values, value, onChange, format = String, label }) {
  const ref = useRef(null)
  const settle = useRef(0)
  const at = Math.max(0, values.findIndex(v => v === value))
  // Follow a value changed from outside (another tab, a cascade) without fighting a scroll in
  // flight: only when the band is not already on it.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && Math.round(el.scrollTop / ITEM) !== at) el.scrollTop = at * ITEM
  }, [at])
  const onScroll = () => {
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)))
      if (values[i] !== value) onChange(values[i])
    }, 110)
  }
  return <div className="wheel" data-nodrag>
    <div className="wheel-band" aria-hidden="true" />
    <div className="wheel-scroll" ref={ref} onScroll={onScroll} role="listbox" aria-label={label}>
      {values.map((v, i) => (
        <div key={i} role="option" aria-selected={i === at} className={'wheel-it' + (i === at ? ' on' : '')}
          onClick={() => { const el = ref.current; if (el?.scrollTo) el.scrollTo({ top: i * ITEM, behavior: 'smooth' }); else if (v !== value) onChange(v) }}>{format(v)}</div>
      ))}
    </div>
  </div>
}

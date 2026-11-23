import { useState } from 'react'

// An open/closed toggle remembered on this device (a per-viewer convenience, never app data):
// storage can be missing or throw (private mode, cleared site data), so it falls back to `initial`.
export function usePersistedToggle(key, initial = true) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v == null ? initial : v === '1'
    } catch { return initial }
  })
  const toggle = () => setOpen(o => {
    try { localStorage.setItem(key, o ? '0' : '1') } catch { /* not remembered */ }
    return !o
  })
  return [open, toggle]
}

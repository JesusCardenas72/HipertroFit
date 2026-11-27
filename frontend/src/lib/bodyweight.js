// Body-weight helpers the AI Coach reads (a reduced port of openGym 1.4.5 lib/bodyweight.js).
// HipertroFit keeps one weigh-in per day, { d, w, t? }.

/** When a weigh-in was made, in ms: its own timestamp when it is on its day, else noon. */
export function weighInAt(b) {
  const t = Number(b?.t)
  if (t > 0) {
    const d = new Date(t)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (iso === b.d) return t
  }
  return new Date(b?.d + 'T12:00:00').getTime()
}

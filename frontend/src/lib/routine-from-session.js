// What a session changed about the routine it was started from, and the routine it would leave
// behind if you kept those changes. Only the shape of the plan counts: which exercises, in what
// order, which are paired in a superset, and the config of any exercise you re-set during the
// session (`retuned`). Logged weights, reps and an added set are not routine changes — the next
// session already reads those back from history.

// The k-th occurrence of each exercise in the session pairs with the k-th one in the routine, so
// a routine that lists the same exercise twice keeps each config where it was.
function matchRoutineConfigs(entries, ex) {
  const pools = new Map()
  ex.forEach(cfg => {
    if (!pools.has(cfg.id)) pools.set(cfg.id, [])
    pools.get(cfg.id).push(cfg)
  })
  return entries.map(e => pools.get(e.id)?.shift() || null)
}

/**
 * The routine's exercise list as the session left it. Exercises that came from the routine and
 * were not re-set keep the routine's own config untouched (the session's set count is history's,
 * not the routine's); added, swapped-in and re-set ones take the config they were trained with.
 */
export function routineFromSession(active, routine) {
  const entries = active?.entries || []
  const matched = matchRoutineConfigs(entries, routine?.ex || [])
  return entries.map((e, i) => {
    const base = matched[i] && !e.retuned ? matched[i] : { ...(matched[i] || {}), ...(e.target || {}) }
    const { sg: _sg, ...cfg } = base
    return { ...cfg, id: e.id, ...(e.sg ? { sg: e.sg } : {}) }
  })
}

// Superset ids are labels, not content: a pair undone and redone gets a fresh id but is the same
// plan. Relabel them by order of appearance before comparing.
function canonical(ex) {
  const labels = new Map()
  return ex.map(cfg => {
    const { sg, ...rest } = cfg
    if (sg && !labels.has(sg)) labels.set(sg, labels.size + 1)
    return stable({ ...rest, ...(sg ? { sg: labels.get(sg) } : {}) })
  })
}
function stable(v) {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]))
  return v
}

/** Whether the session's plan differs from the routine it started from. */
export function sessionChangedRoutine(active, routine) {
  if (!active || !routine || !Array.isArray(routine.ex)) return false
  return JSON.stringify(canonical(routineFromSession(active, routine))) !== JSON.stringify(canonical(routine.ex))
}

// Favourite exercises (★): the ones you already use — in a routine or in a logged workout — minus
// the ones you took out by hand (S.favOff, an array of exercise ids).
//
// Derived, not a list you build: an exercise becomes a favourite the moment you use it. Taking
// one out only hides it from the favourites; the history and routines that put it there stay
// untouched, and it can be put back from the same star. Pickers and the Library list favourites
// first, and a generated routine's slots offer them before anything else, most completed work
// sets first (lib/plan-generator.js candidatesFor).

/** Use count per exercise id, from routines and the log, before any hand removal. */
export function usageMap(S) {
  const u = {}
  ;((S && S.routines) || []).forEach(r => (r.ex || []).forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  ;((S && S.workouts) || []).forEach(w => (w.entries || []).forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}

// Every store update clones S, so one computation per state object is enough. The arrays and
// their lengths guard the rare read of a draft mid-update.
const memo = new WeakMap()
const keyOf = S => [S.routines, S.workouts, S.favOff, (S.routines || []).length, (S.workouts || []).length, (S.favOff || []).length]
const same = (a, b) => a.every((x, i) => x === b[i])

function cached(S) {
  const key = keyOf(S)
  const hit = memo.get(S)
  if (hit && same(hit.key, key)) return hit
  const usage = usageMap(S)
  const map = { ...usage }
  for (const id of Array.isArray(S.favOff) ? S.favOff : []) delete map[id]
  const out = { key, usage, map }
  memo.set(S, out)
  return out
}

/** Favourites as id → use count. */
export const favoriteMap = S => S ? cached(S).map : {}

/** Whether exercise `id` is a favourite. */
export const isFavorite = (S, id) => !!favoriteMap(S)[id]

/** Whether `id` can be a favourite at all: only what you have used can. */
export const canFavorite = (S, id) => !!(S && cached(S).usage[id])

/** Take `id` out of the favourites or put it back (call inside store.update). Returns whether it is one now. */
export function toggleFavorite(s, id) {
  const list = Array.isArray(s.favOff) ? s.favOff : []
  const back = list.includes(id)
  s.favOff = back ? list.filter(x => x !== id) : [...list, id]
  memo.delete(s)
  return back
}

/** `list` with the favourites moved to the front, each part keeping its own order. */
export function favoritesFirst(S, list) {
  const map = favoriteMap(S)
  const fav = [], rest = []
  for (const ex of list || []) (map[ex.id] ? fav : rest).push(ex)
  return fav.length ? [...fav, ...rest] : list || []
}

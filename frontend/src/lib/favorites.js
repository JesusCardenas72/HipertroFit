// Favourite exercises: the ones the user marked with a heart (S.favEx, an array of exercise ids).
//
// An explicit choice, unlike the picker's "Chosen" filter, which is derived from what the
// routines and the log already use. Pickers list favourites first, and a generated routine's
// slots offer them before anything else (docs/design/generador-de-rutinas.md). The plan
// generator widens this by default: exercises with completed work sets in history join the
// favourites group, most sets first (lib/plan-generator.js candidatesFor).

/** Whether exercise `id` is a favourite. */
export const isFavorite = (S, id) => Array.isArray(S && S.favEx) && S.favEx.includes(id)

/** Mark or unmark `id` on a draft state (call inside store.update). Returns the new value. */
export function toggleFavorite(s, id) {
  const list = Array.isArray(s.favEx) ? s.favEx : []
  const on = !list.includes(id)
  s.favEx = on ? [...list, id] : list.filter(x => x !== id)
  return on
}

/** `list` with the favourites moved to the front, each part keeping its own order. */
export function favoritesFirst(S, list) {
  const fav = [], rest = []
  for (const ex of list || []) (isFavorite(S, ex.id) ? fav : rest).push(ex)
  return fav.length ? [...fav, ...rest] : list || []
}

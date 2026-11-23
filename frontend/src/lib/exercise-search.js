// The exercise picker's three filters — database, muscle group (body part) and equipment — over
// one list that mixes the app's catalogue with the supplementary sources. Every filter narrows
// the options of the others, so each chip on screen has exercises behind it.
//
// Entries are `{ db, bp, eq }` plus whatever the caller needs to render them; the text search,
// favourites and equipment profile are applied by the caller before this.

export const ALL_DB = 'all'   // every database at once
export const APP_DB = 'app'   // the app's own catalogue, custom exercises included

const countBy = (list, k) => {
  const c = {}
  list.forEach(e => { if (e[k]) c[e[k]] = (c[e[k]] || 0) + 1 })
  return c
}

/**
 * Apply the filters and work out what each chip row offers.
 * The database is the primary choice and is never dropped. A body part absent from that
 * database, or an equipment absent from that database × body part, is ignored (not cleared):
 * the caller keeps it, and it applies again once another filter brings it back.
 * Returns `{ list, bpOn, eqOn, bpOpts, eqOpts, dbCounts }`; `dbCounts[ALL_DB]` is the total.
 */
export function facetSearch(entries, { db = APP_DB, bp = '', eq = '' } = {}, order = []) {
  const all = entries || []
  const inDb = all.filter(e => db === ALL_DB || e.db === db)
  const bpOn = bp && inDb.some(e => e.bp === bp) ? bp : ''
  const inBp = bpOn ? inDb.filter(e => e.bp === bpOn) : inDb
  const eqCount = countBy(inBp, 'eq')
  const eqOpts = Object.keys(eqCount).sort((a, b) => eqCount[b] - eqCount[a] || (a < b ? -1 : 1))
  const eqOn = eqCount[eq] ? eq : ''
  const list = eqOn ? inBp.filter(e => e.eq === eqOn) : inBp
  // Body parts that still have exercises with the chosen equipment, in the catalogue's order.
  const bpSet = new Set((eqOn ? inDb.filter(e => e.eq === eqOn) : inDb).map(e => e.bp).filter(Boolean))
  const bpOpts = [...order.filter(b => bpSet.has(b)), ...[...bpSet].filter(b => !order.includes(b)).sort()]
  // How many exercises each database has for the body part and equipment as chosen (not as
  // applied here), so a database lacking them reads 0 instead of looking unfiltered.
  const matching = all.filter(e => (!bp || e.bp === bp) && (!eq || e.eq === eq))
  const dbCounts = { ...countBy(matching, 'db'), [ALL_DB]: matching.length }
  return { list, bpOn, eqOn, bpOpts, eqOpts, dbCounts }
}

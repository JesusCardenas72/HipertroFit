// Routine folders — a flat, one-level way to file routines on the Plan screen.
//
// S.folders is an ordered list of { id, name, open }. A routine points at its folder with
// `routine.folder` (an id); a missing or dangling id means "not in a folder", so deleting a
// folder, importing a plan or restoring an old backup can never hide a routine. Folders are
// only a view over S.routines: the week plan, the program and history keep referencing
// routines by id and never notice where they are filed.

import { uid } from './format.js'

export const FOLDER_NAME_MAX = 40

const cleanName = name => String(name ?? '').trim().slice(0, FOLDER_NAME_MAX)

export function newFolder(name) {
  return { id: 'f' + uid(), name: cleanName(name), open: true }
}

/** The folder a routine is actually shown in — null for loose routines and dangling ids. */
export function folderOf(st, routine) {
  const id = routine && routine.folder
  return id && (st.folders || []).some(f => f.id === id) ? id : null
}

/** Routines split into the loose ones and one group per folder, both in S.routines order.
 *  Every folder gets a group, empty ones included, so it can still be opened and filled. */
export function groupRoutines(st) {
  const folders = st.folders || []
  const byId = new Map(folders.map(f => [f.id, []]))
  const loose = []
  for (const r of st.routines || []) {
    const bucket = r.folder && byId.get(r.folder)
    if (bucket) bucket.push(r)
    else loose.push(r)
  }
  return { loose, folders: folders.map(folder => ({ folder, routines: byId.get(folder.id) })) }
}

/* ---- mutations: run inside useStore.update on the draft state ---- */

/** Adds a folder and returns it; a blank name is refused (null). */
export function addFolder(s, name) {
  if (!cleanName(name)) return null
  const f = newFolder(name)
  s.folders = [...(s.folders || []), f]
  return f
}

export function renameFolder(s, id, name) {
  const f = (s.folders || []).find(x => x.id === id)
  if (!f || !cleanName(name)) return false
  f.name = cleanName(name)
  return true
}

export function toggleFolder(s, id) {
  const f = (s.folders || []).find(x => x.id === id)
  if (f) f.open = !f.open
}

/** Swap a folder with its neighbour (dir -1 up, +1 down). */
export function moveFolder(s, id, dir) {
  const list = s.folders || []
  const i = list.findIndex(x => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return false
  ;[list[i], list[j]] = [list[j], list[i]]
  return true
}

/** Removes the folder only — its routines are kept and become loose. */
export function deleteFolder(s, id) {
  s.folders = (s.folders || []).filter(x => x.id !== id)
  for (const r of s.routines || []) if (r.folder === id) delete r.folder
}

/** File a routine into a folder; a null/unknown folder id takes it out of any folder. */
export function moveRoutineToFolder(s, routineId, folderId) {
  const r = (s.routines || []).find(x => x.id === routineId)
  if (!r) return false
  if (folderId && (s.folders || []).some(f => f.id === folderId)) {
    r.folder = folderId
    const f = s.folders.find(x => x.id === folderId)
    f.open = true
  } else delete r.folder
  return true
}

/* ---- dragging a routine on the Plan list ---- */

/** The Plan list's rows top to bottom as the screen draws them: each folder header, followed by
 *  its routines while it is open, then the loose routines. Each row is
 *  { kind: 'folder' | 'routine', id, folder, open }. */
export function planRows(st) {
  const { loose, folders } = groupRoutines(st)
  const rows = []
  for (const { folder: f, routines } of folders) {
    rows.push({ kind: 'folder', id: f.id, folder: null, open: !!f.open })
    if (f.open) for (const r of routines) rows.push({ kind: 'routine', id: r.id, folder: f.id, open: false })
  }
  for (const r of loose) rows.push({ kind: 'routine', id: r.id, folder: null, open: false })
  return rows
}

/** Where a routine let go at `y` lands. `others` are the visible rows except the dragged one,
 *  top to bottom, each with its measured `top` / `bottom`. Over the middle of a folder header it
 *  goes into that folder (`join` is that row); otherwise it drops into the gap `slot`, filed with
 *  whichever side of the gap it is nearer: after the routine above (its folder), as the first of
 *  the open folder above, or before the routine below. With neither, it comes out loose. */
export function planDropIntent(others, y) {
  const list = Array.isArray(others) ? others : []
  const slot = list.reduce((n, o) => n + (y > (o.top + o.bottom) / 2 ? 1 : 0), 0)
  const hit = list.findIndex(o => {
    const inset = (o.bottom - o.top) * 0.22
    return o.kind === 'folder' && y >= o.top + inset && y <= o.bottom - inset
  })
  if (hit >= 0) return { slot, join: hit, folder: list[hit].id, at: 'end' }
  const above = list[slot - 1], below = list[slot]
  const up = above?.kind === 'routine' ? { folder: above.folder, after: above.id }
    : above?.kind === 'folder' && above.open ? { folder: above.id, at: 'start' } : null
  const down = below?.kind === 'routine' ? { folder: below.folder, before: below.id } : null
  let place
  if (up && down) place = up.folder === down.folder || y < (above.bottom + below.top) / 2 ? up : down
  else place = up || down || { folder: null, at: above ? 'end' : 'start' }
  return { slot, join: null, ...place }
}

/** Moves a routine to where `planDropIntent` said, filing it in (or out of) a folder and placing
 *  it in S.routines so it shows there. A target folder opens. False when nothing changed. */
export function dropRoutine(s, id, intent) {
  const list = s.routines || []
  const from = list.findIndex(r => r.id === id)
  if (from < 0 || !intent) return false
  const folders = s.folders || []
  const fid = intent.folder && folders.some(f => f.id === intent.folder) ? intent.folder : null
  const was = list.map(r => r.id + ':' + (folderOf(s, r) || '')).join()
  const [r] = list.splice(from, 1)
  if (fid) r.folder = fid
  else delete r.folder
  const inGroup = x => folderOf(s, x) === fid
  const ref = intent.after ?? intent.before
  let to = ref != null ? list.findIndex(x => x.id === ref) : -1
  if (to >= 0 && intent.after != null) to += 1
  if (to < 0) {
    if (intent.at === 'start') {
      to = list.findIndex(inGroup)
      if (to < 0) to = list.length
    } else {
      to = list.length
      for (let i = list.length - 1; i >= 0; i--) if (inGroup(list[i])) { to = i + 1; break }
    }
  }
  list.splice(to, 0, r)
  if (fid) folders.find(f => f.id === fid).open = true
  return list.map(x => x.id + ':' + (folderOf(s, x) || '')).join() !== was
}

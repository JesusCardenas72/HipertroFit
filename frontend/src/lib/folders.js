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

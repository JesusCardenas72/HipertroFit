import { describe, it, expect } from 'vitest'
import { addFolder, deleteFolder, dropRoutine, folderOf, groupRoutines, planDropIntent, planRows, moveFolder, moveRoutineToFolder, renameFolder, toggleFolder, FOLDER_NAME_MAX } from './folders.js'

const state = () => ({
  folders: [{ id: 'fa', name: 'Bloque A', open: true }, { id: 'fb', name: 'Bloque B', open: false }],
  routines: [
    { id: 'r1', name: 'Push', ex: [], folder: 'fa' },
    { id: 'r2', name: 'Pull', ex: [] },
    { id: 'r3', name: 'Legs', ex: [], folder: 'fa' },
    { id: 'r4', name: 'Old', ex: [], folder: 'gone' },
  ],
})

describe('groupRoutines', () => {
  it('splits routines by folder, keeping routine order, with dangling ids shown loose', () => {
    const g = groupRoutines(state())
    expect(g.loose.map(r => r.id)).toEqual(['r2', 'r4'])
    expect(g.folders.map(x => [x.folder.id, x.routines.map(r => r.id)])).toEqual([['fa', ['r1', 'r3']], ['fb', []]])
  })

  it('works on a profile saved before folders existed', () => {
    const g = groupRoutines({ routines: [{ id: 'r1', folder: 'x' }] })
    expect(g.loose.map(r => r.id)).toEqual(['r1'])
    expect(g.folders).toEqual([])
  })
})

describe('folderOf', () => {
  it('returns the folder id only when that folder exists', () => {
    const s = state()
    expect(folderOf(s, s.routines[0])).toBe('fa')
    expect(folderOf(s, s.routines[1])).toBeNull()
    expect(folderOf(s, s.routines[3])).toBeNull()
  })
})

describe('folder mutations', () => {
  it('adds a trimmed folder and refuses a blank name', () => {
    const s = { routines: [] }
    expect(addFolder(s, '   ')).toBeNull()
    const f = addFolder(s, '  Fuerza  ')
    expect(f.name).toBe('Fuerza')
    expect(s.folders).toEqual([f])
    expect(addFolder(s, 'x'.repeat(99)).name).toHaveLength(FOLDER_NAME_MAX)
  })

  it('renames, toggles and reorders', () => {
    const s = state()
    expect(renameFolder(s, 'fa', '')).toBe(false)
    expect(renameFolder(s, 'fa', 'Hipertrofia')).toBe(true)
    toggleFolder(s, 'fb')
    expect(s.folders[1].open).toBe(true)
    expect(moveFolder(s, 'fa', -1)).toBe(false)
    expect(moveFolder(s, 'fa', 1)).toBe(true)
    expect(s.folders.map(f => f.name)).toEqual(['Bloque B', 'Hipertrofia'])
  })

  it('deleting a folder keeps its routines, now loose', () => {
    const s = state()
    deleteFolder(s, 'fa')
    expect(s.folders.map(f => f.id)).toEqual(['fb'])
    expect(s.routines).toHaveLength(4)
    expect(s.routines.filter(r => r.folder === 'fa')).toEqual([])
  })

  it('moves a routine into a folder (opening it) and back out', () => {
    const s = state()
    expect(moveRoutineToFolder(s, 'r2', 'fb')).toBe(true)
    expect(s.routines[1].folder).toBe('fb')
    expect(s.folders[1].open).toBe(true)
    moveRoutineToFolder(s, 'r2', null)
    expect('folder' in s.routines[1]).toBe(false)
    moveRoutineToFolder(s, 'r1', 'nope')
    expect('folder' in s.routines[0]).toBe(false)
    expect(moveRoutineToFolder(s, 'missing', 'fa')).toBe(false)
  })
})

// Rows 40px tall with 8px between them, laid out from the top like the Plan list.
const laidOut = rows => rows.map((row, i) => ({ ...row, top: i * 48, bottom: i * 48 + 40 }))

describe('planRows', () => {
  it('lists each folder header, its routines only while open, then the loose routines', () => {
    expect(planRows(state()).map(r => r.kind + ':' + r.id)).toEqual(['folder:fa', 'routine:r1', 'routine:r3', 'folder:fb', 'routine:r2', 'routine:r4'])
    expect(planRows(state())[1].folder).toBe('fa')
  })
})

describe('planDropIntent', () => {
  // the list with r3 lifted: fa, r1, fb (closed), r2, r4
  const others = () => laidOut(planRows(state()).filter(r => r.id !== 'r3'))

  it('drops into a folder when let go over the middle of its header', () => {
    expect(planDropIntent(others(), 2 * 48 + 20)).toMatchObject({ join: 2, folder: 'fb', at: 'end' })
  })

  it("files it with the routine above, inside that routine's folder", () => {
    expect(planDropIntent(others(), 48 + 30)).toMatchObject({ join: null, slot: 2, folder: 'fa', after: 'r1' })
  })

  it('goes first into an open folder dropped right under its header', () => {
    expect(planDropIntent(others(), 36)).toMatchObject({ slot: 1, join: null, folder: 'fa', at: 'start' })
  })

  it('comes out loose when dropped between loose routines', () => {
    expect(planDropIntent(others(), 3 * 48 + 30)).toMatchObject({ folder: null, after: 'r2' })
  })

  it('picks the nearer side of a gap between a folder and the loose routines', () => {
    const rows = laidOut([
      { kind: 'folder', id: 'fa', open: true }, { kind: 'routine', id: 'r1', folder: 'fa' },
      { kind: 'routine', id: 'r2', folder: null },
    ])
    expect(planDropIntent(rows, 48 + 41)).toMatchObject({ folder: 'fa', after: 'r1' })
    expect(planDropIntent(rows, 48 + 46)).toMatchObject({ folder: null, before: 'r2' })
  })

  it('comes out loose above every folder or below the last closed one', () => {
    const rows = laidOut([{ kind: 'folder', id: 'fb', open: false }])
    expect(planDropIntent(rows, -10)).toMatchObject({ slot: 0, folder: null, at: 'start' })
    expect(planDropIntent(rows, 60)).toMatchObject({ slot: 1, folder: null, at: 'end' })
  })
})

describe('dropRoutine', () => {
  it('files a loose routine at the end of a folder and opens it', () => {
    const s = state()
    expect(dropRoutine(s, 'r2', { folder: 'fb', at: 'end' })).toBe(true)
    expect(s.routines.find(r => r.id === 'r2').folder).toBe('fb')
    expect(s.folders[1].open).toBe(true)
  })

  it('reorders inside a folder and takes routines out of one', () => {
    const s = state()
    dropRoutine(s, 'r3', { folder: 'fa', before: 'r1' })
    expect(groupRoutines(s).folders[0].routines.map(r => r.id)).toEqual(['r3', 'r1'])
    dropRoutine(s, 'r1', { folder: null, after: 'r4' })
    expect(groupRoutines(s).loose.map(r => r.id)).toEqual(['r2', 'r4', 'r1'])
    dropRoutine(s, 'r3', { folder: null, at: 'start' })
    expect(groupRoutines(s).loose.map(r => r.id)).toEqual(['r3', 'r2', 'r4', 'r1'])
  })

  it('appends to an empty folder and reports a drop that changes nothing', () => {
    const s = state()
    dropRoutine(s, 'r2', { folder: 'fb', at: 'start' })
    expect(groupRoutines(s).folders[1].routines.map(r => r.id)).toEqual(['r2'])
    expect(dropRoutine(s, 'r1', { folder: 'fa', before: 'r3' })).toBe(false)
    expect(dropRoutine(s, 'missing', { folder: null })).toBe(false)
  })

  it('treats a vanished target folder as loose', () => {
    const s = state()
    dropRoutine(s, 'r1', { folder: 'gone', at: 'end' })
    expect('folder' in s.routines.find(r => r.id === 'r1')).toBe(false)
  })
})

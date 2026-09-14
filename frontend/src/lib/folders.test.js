import { describe, it, expect } from 'vitest'
import { addFolder, deleteFolder, folderOf, groupRoutines, moveFolder, moveRoutineToFolder, renameFolder, toggleFolder, FOLDER_NAME_MAX } from './folders.js'

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

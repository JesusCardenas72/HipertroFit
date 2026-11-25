// Progress photos, kept on this device only.
//
// A photo is a few hundred KB even downsized, and S is synced to the server and mirrored to a
// file on every change — photos would bloat both and put pictures of someone's body on a server
// they may share. So they live in this browser's (or the app's WebView's) IndexedDB, outside S,
// and never leave the device: not synced, not in the JSON backup. The UI says so.

const DB_NAME = 'hipertrofit-photos'
const STORE = 'photos'
const MAX_SIDE = 1280

/** Newest first, then by time taken — the order the gallery shows. */
export const orderPhotos = list => (list || []).slice()
  .sort((a, b) => String(b.d).localeCompare(String(a.d)) || (b.t || 0) - (a.t || 0))

/** The oldest and newest photo, to compare side by side — null with fewer than two days. */
export function comparePair(list) {
  const all = orderPhotos(list)
  if (all.length < 2) return null
  const newest = all[0], oldest = all[all.length - 1]
  return newest.d === oldest.d ? null : { before: oldest, after: newest }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function withStore(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

/** Every stored photo, newest first. Empty when IndexedDB is unavailable. */
export async function listPhotos() {
  try { return orderPhotos(await withStore('readonly', st => st.getAll())) } catch (e) { return [] }
}

/** Delete one photo by id. */
export const deletePhoto = id => withStore('readwrite', st => st.delete(id))

// A picked image file → JPEG data URL no longer than MAX_SIDE on its long side.
function downsize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * scale))
      c.height = Math.max(1, Math.round(img.naturalHeight * scale))
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not-image')) }
    img.src = url
  })
}

/** Store a picked image as the photo of day `d`. Resolves with the stored record. */
export async function addPhoto(file, d) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('not-image')
  const img = await downsize(file)
  const rec = { id: d + '-' + Date.now().toString(36), d, t: Date.now(), img }
  await withStore('readwrite', st => st.put(rec))
  return rec
}

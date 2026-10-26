import { describe, it, expect, afterEach, vi } from 'vitest'
import { imageFromTransfer, pictureFromClipboard, pictureFromUrl } from './image-file.js'

const file = (type, name = 'x') => ({ type, name })

describe('imageFromTransfer', () => {
  it('takes the first image item of a paste / drop and ignores text', () => {
    const png = file('image/png')
    const dt = { items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png', getAsFile: () => png }] }
    expect(imageFromTransfer(dt)).toBe(png)
  })
  it('falls back to the file list, and is null without an image', () => {
    const jpg = file('image/jpeg')
    expect(imageFromTransfer({ items: [], files: [file('text/plain'), jpg] })).toBe(jpg)
    expect(imageFromTransfer({ items: [{ kind: 'string', type: 'text/plain' }], files: [] })).toBe(null)
    expect(imageFromTransfer(null)).toBe(null)
  })
})

describe('pictureFromClipboard', () => {
  afterEach(() => vi.unstubAllGlobals())
  const clip = clipboard => vi.stubGlobal('navigator', { clipboard })
  const textItem = text => ({ types: ['text/plain'], getType: async () => ({ text: async () => text }) })

  it('reports a browser without clipboard access', async () => {
    clip(undefined)
    await expect(pictureFromClipboard()).rejects.toThrow('unsupported')
  })
  it('tells a refused permission apart', async () => {
    clip({ read: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }) } })
    await expect(pictureFromClipboard()).rejects.toThrow('denied')
  })
  it('says so when the clipboard holds neither an image nor an image address', async () => {
    clip({ read: async () => [textItem('press banca')] })
    await expect(pictureFromClipboard()).rejects.toThrow('no-image')
  })
  it('downloads a copied image address', async () => {
    clip({ read: async () => [textItem(' https://example.com/a.png ')] })
    const fetch = vi.fn(async () => { throw new TypeError('cors') })
    vi.stubGlobal('fetch', fetch)
    await expect(pictureFromClipboard()).rejects.toThrow('fetch')
    expect(fetch).toHaveBeenCalledWith('https://example.com/a.png')
  })
})

describe('pictureFromUrl', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('treats an HTTP error as a failed download', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false }))
    await expect(pictureFromUrl('img/x.jpg')).rejects.toThrow('fetch')
  })
  it('rejects a response that is not an image', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => ({ type: 'text/html', size: 10 }) }))
    await expect(pictureFromUrl('img/x.jpg')).rejects.toThrow('not-image')
  })
})

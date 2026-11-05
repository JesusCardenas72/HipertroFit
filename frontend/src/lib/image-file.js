// Turns a picked image file into the inline picture a custom exercise stores (browser-only).
//
// The still is always redrawn onto a canvas, capped at MAX_SIDE px and saved as JPEG, so a
// 4 MB phone photo lands as a few tens of KB. An animated GIF is kept as is for the animation
// (a canvas would flatten it, and there is no GIF encoder here) when it fits MAX_IMAGE_BYTES;
// any of its frames can be the still, decoded by lib/gif-frames.js.

import { MAX_IMAGE_BYTES } from './custom-exercise.js'
import { parseGif, renderFrame, dataUrlToBytes } from './gif-frames.js'

const MAX_SIDE = 640

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = () => reject(r.error)
  r.readAsDataURL(file)
})

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('not an image'))
  img.src = src
})

// Any drawable source → downsized JPEG data URL on white (transparent areas would turn black).
function toJpeg(source, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width || 1, height || 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

/** A decoded GIF frame drawn onto a canvas of the GIF's size. */
export function frameCanvas(gif, index, canvas = document.createElement('canvas')) {
  canvas.width = gif.width
  canvas.height = gif.height
  canvas.getContext('2d').putImageData(new ImageData(renderFrame(gif, index), gif.width, gif.height), 0, 0)
  return canvas
}

/** Frame `index` of a parsed GIF as the JPEG still. */
export const frameToJpeg = (gif, index) => toJpeg(frameCanvas(gif, index), gif.width, gif.height)

/** Parsed GIF from a data: URL, or null when it cannot be read. */
export function gifFromDataUrl(url) {
  try { return parseGif(dataUrlToBytes(url)) } catch { return null }
}

/** A video the browser can decode into a still: an MP4 or WebM, by type or by extension. */
export const isVideoFile = file => !!file && (/^video\/(mp4|webm)$/.test(file.type || '') || /\.(mp4|webm)$/i.test(file.name || ''))

/** A picture file or a video file: what the picker, paste and drop accept. */
export const isPictureFile = file => !!file && (/^image\//.test(file.type || '') || isVideoFile(file))

// A frame half a second in (the very first one is often black) of a video, as the JPEG still.
// Throws 'not-image' when the browser cannot decode the file.
async function frameFromVideo(file) {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = () => reject(new Error('not-image'))
      video.src = url
    })
    if (!video.videoWidth) throw new Error('not-image')
    if (Number.isFinite(video.duration) && video.duration > 0.5) {
      await new Promise((resolve, reject) => {
        video.onseeked = resolve
        video.onerror = () => reject(new Error('not-image'))
        video.currentTime = 0.5
      })
    }
    return toJpeg(video, video.videoWidth, video.videoHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * → { img, gif, frame } (gif is '' for a still image, for a GIF with a single frame, and for a
 * video, whose still is one of its frames). Throws 'too-large' / 'not-image'.
 */
export async function pictureFromFile(file) {
  if (!isPictureFile(file)) throw new Error('not-image')
  if (isVideoFile(file)) return { img: await frameFromVideo(file), gif: '', frame: 0 }
  const src = await readAsDataUrl(file)
  if (file.type === 'image/gif') {
    const gif = gifFromDataUrl(src)
    if (gif && gif.frames.length > 1) {
      if (file.size > MAX_IMAGE_BYTES) throw new Error('too-large')
      return { img: frameToJpeg(gif, 0), gif: src, frame: 0 }
    }
  }
  let el
  try { el = await loadImage(src) } catch { throw new Error('not-image') }
  return { img: toJpeg(el, el.naturalWidth, el.naturalHeight), gif: '', frame: 0 }
}

/**
 * The same picture from an image URL — a built-in exercise's media when it is copied, or an
 * image address pasted from the web. Throws like pictureFromFile, or 'fetch' when it cannot be
 * downloaded (offline, or a site that does not allow other pages to read its images).
 */
export async function pictureFromUrl(url) {
  let res
  try { res = await fetch(url) } catch { throw new Error('fetch') }
  if (!res.ok) throw new Error('fetch')
  return pictureFromFile(await res.blob())
}

const isImageUrl = text => /^(https?:\/\/\S+|data:image\/[a-z]+;base64,\S+)$/i.test(text)

/** The first image file in a paste or drop event's DataTransfer, or null. */
export function imageFromTransfer(dt) {
  if (!dt) return null
  for (const item of dt.items || []) {
    if (item.kind === 'file' && (/^image\//.test(item.type) || /^video\/(mp4|webm)$/.test(item.type))) return item.getAsFile()
  }
  return [...(dt.files || [])].find(isPictureFile) || null
}

/**
 * The picture on the system clipboard, for a "Paste image" button: an image copied in the
 * browser ("Copy image") or, failing that, a copied image address. Throws 'unsupported' (no
 * clipboard access here — Ctrl+V / long-press paste still reaches imageFromTransfer),
 * 'denied', 'no-image', or what pictureFromFile / pictureFromUrl throw.
 */
export async function pictureFromClipboard() {
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : null
  if (!cb || (!cb.read && !cb.readText)) throw new Error('unsupported')
  let text = ''
  try {
    if (cb.read) {
      for (const item of await cb.read()) {
        const type = item.types.find(x => /^image\//.test(x))
        if (type) return pictureFromFile(await item.getType(type))
        if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text()
      }
    } else text = await cb.readText()
  } catch (err) {
    throw new Error(err && err.name === 'NotAllowedError' ? 'denied' : 'unsupported')
  }
  text = text.trim()
  if (isImageUrl(text)) return pictureFromUrl(text)
  throw new Error('no-image')
}

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

/**
 * → { img, gif, frame } (gif is '' for a still image, and for a GIF with a single frame).
 * Throws 'too-large' / 'not-image'.
 */
export async function pictureFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('not-image')
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

/**
 * Pra-pemrosesan foto struk sebelum OCR, sepenuhnya di klien.
 *
 * Bagian piksel (computeOcrSize, toGrayscale, stretchContrast, prepareReceiptPixels)
 * murni: tanpa DOM, bisa diuji langsung. Hanya prepareImageForOcr yang memakai canvas.
 */

/** Lebar target hasil; foto yang lebih kecil diperbesar ke lebar ini. */
export const OCR_TARGET_WIDTH = 1600

/** Ukuran hasil: hanya memperbesar, tidak pernah memperkecil. */
export function computeOcrSize(
  width: number,
  height: number,
  targetWidth: number = OCR_TARGET_WIDTH,
): { width: number; height: number } {
  if (width >= targetWidth) return { width, height }
  const scale = targetWidth / width
  return { width: targetWidth, height: Math.round(height * scale) }
}

function assertRgba(rgba: Uint8ClampedArray): void {
  if (rgba.length % 4 !== 0) {
    throw new RangeError(`Buffer RGBA harus kelipatan 4, dapat ${rgba.length}`)
  }
}

/** Ubah ke abu-abu (luma BT.601). Mengembalikan buffer baru; alpha dipertahankan. */
export function toGrayscale(rgba: Uint8ClampedArray): Uint8ClampedArray {
  assertRgba(rgba)
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const y = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    out[i] = y
    out[i + 1] = y
    out[i + 2] = y
    out[i + 3] = rgba[i + 3]
  }
  return out
}

/** Nilai intensitas pertama yang kumulatif jumlah pikselnya mencapai target. */
function percentileValue(hist: Uint32Array, target: number): number {
  const need = Math.max(1, target)
  let cum = 0
  for (let v = 0; v < 256; v++) {
    cum += hist[v]
    if (cum >= need) return v
  }
  return 255
}

/**
 * Regang kontras linear: nilai di persentil rendah jadi 0, di persentil tinggi jadi 255.
 * Dipakai setelah toGrayscale (kanal R dipakai untuk histogram). Gambar seragam dikembalikan apa adanya.
 */
export function stretchContrast(
  rgba: Uint8ClampedArray,
  lowPct = 0.01,
  highPct = 0.99,
): Uint8ClampedArray {
  assertRgba(rgba)
  const out = new Uint8ClampedArray(rgba)
  const hist = new Uint32Array(256)
  let total = 0
  for (let i = 0; i < rgba.length; i += 4) {
    hist[rgba[i]]++
    total++
  }
  if (total === 0) return out

  const lo = percentileValue(hist, total * lowPct)
  const hi = percentileValue(hist, total * highPct)
  if (hi <= lo) return out

  const scale = 255 / (hi - lo)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = (out[i] - lo) * scale
    out[i + 1] = (out[i + 1] - lo) * scale
    out[i + 2] = (out[i + 2] - lo) * scale
  }
  return out
}

/** Grayscale lalu regang kontras. */
export function prepareReceiptPixels(rgba: Uint8ClampedArray): Uint8ClampedArray {
  return stretchContrast(toGrayscale(rgba))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar struk tidak bisa dimuat'))
    img.src = src
  })
}

/**
 * Siapkan gambar untuk OCR: perbesar, grayscale, regang kontras, lalu kembalikan canvas.
 * Bila apa pun gagal, gambar asli dikembalikan dan OCR tetap jalan tanpa pra-pemrosesan.
 */
export async function prepareImageForOcr(
  source: string | HTMLImageElement,
): Promise<string | HTMLImageElement | HTMLCanvasElement> {
  try {
    const img = typeof source === 'string' ? await loadImage(source) : source
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return source

    const size = computeOcrSize(w, h)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return source

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, size.width, size.height)

    const frame = ctx.getImageData(0, 0, size.width, size.height)
    frame.data.set(prepareReceiptPixels(frame.data))
    ctx.putImageData(frame, 0, 0)
    return canvas
  } catch (e) {
    console.warn('[OCR] Pra-pemrosesan gambar dilewati:', e)
    return source
  }
}

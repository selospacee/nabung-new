import { describe, it, expect } from 'vitest'
import {
  computeOcrSize,
  toGrayscale,
  stretchContrast,
  prepareReceiptPixels,
  OCR_TARGET_WIDTH,
} from './imagePrep'

/** Buffer RGBA dari daftar [r, g, b, a] */
function rgba(...px: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flat())
}

describe('computeOcrSize', () => {
  it('memperbesar gambar yang lebarnya di bawah target, rasio dijaga', () => {
    expect(computeOcrSize(800, 1200)).toEqual({ width: OCR_TARGET_WIDTH, height: 2400 })
  })

  it('tidak memperkecil gambar yang sudah lebar', () => {
    expect(computeOcrSize(2000, 1000)).toEqual({ width: 2000, height: 1000 })
  })

  it('lebar tepat sama dengan target tidak diubah', () => {
    expect(computeOcrSize(1600, 900)).toEqual({ width: 1600, height: 900 })
  })
})

describe('toGrayscale', () => {
  it('merah murni menjadi abu-abu sesuai luma BT.601, alpha dipertahankan', () => {
    const out = toGrayscale(rgba([255, 0, 0, 255]))
    expect(Array.from(out)).toEqual([76, 76, 76, 255])
  })

  it('alpha tidak diubah', () => {
    const out = toGrayscale(rgba([10, 20, 30, 128]))
    expect(out[3]).toBe(128)
  })

  it('panjang bukan kelipatan 4 ditolak', () => {
    expect(() => toGrayscale(new Uint8ClampedArray(3))).toThrow(RangeError)
  })
})

describe('stretchContrast', () => {
  it('rentang sempit diregangkan ke 0..255 berdasarkan persentil', () => {
    // 100 piksel abu-abu, separuh 100 dan separuh 140
    const px: number[][] = []
    for (let i = 0; i < 100; i++) {
      const v = i % 2 ? 140 : 100
      px.push([v, v, v, 255])
    }
    const out = stretchContrast(rgba(...px))
    expect(out[0]).toBe(0) // 100 -> 0
    expect(out[4]).toBe(255) // 140 -> 255
  })

  it('gambar seragam tidak berubah', () => {
    const input = rgba([120, 120, 120, 255], [120, 120, 120, 255])
    expect(Array.from(stretchContrast(input))).toEqual(Array.from(input))
  })

  it('input tidak dimodifikasi (mengembalikan buffer baru)', () => {
    const input = rgba([100, 100, 100, 255], [140, 140, 140, 255])
    const copy = new Uint8ClampedArray(input)
    stretchContrast(input)
    expect(Array.from(input)).toEqual(Array.from(copy))
  })
})

describe('prepareReceiptPixels', () => {
  it('teks gelap dan latar terang menjadi kontras penuh, panjang buffer sama', () => {
    const px: number[][] = []
    for (let i = 0; i < 100; i++) {
      const v = i % 2 ? 200 : 80
      px.push([v, v, v, 255])
    }
    const input = rgba(...px)
    const out = prepareReceiptPixels(input)
    expect(out.length).toBe(input.length)
    expect(out[0]).toBe(0)
    expect(out[4]).toBe(255)
    // alpha tidak tersentuh
    expect(out[3]).toBe(255)
  })
})

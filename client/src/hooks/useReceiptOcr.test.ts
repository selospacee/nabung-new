import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const ocr = vi.hoisted(() => ({
  recognize: vi.fn(),
  createWorker: vi.fn(),
  logger: undefined as undefined | ((m: { status: string; progress: number }) => void),
}))

vi.mock('tesseract.js', () => ({
  default: {
    PSM: { SINGLE_BLOCK: '6' },
    createWorker: ocr.createWorker,
  },
}))

// AI dimatikan di tes; jalur AI diuji terpisah bila perlu.
vi.mock('../lib/aiParser', () => ({
  isAIAvailable: () => false,
  parseReceiptWithAI: vi.fn(),
}))

// Pra-pemrosesan kanvas tidak tersedia di jsdom; tes ini hanya menguji alur OCR.
vi.mock('../utils/imagePrep', () => ({
  prepareImageForOcr: async (src: unknown) => src,
}))

import { useReceiptOcr } from './useReceiptOcr'
import { parseReceiptWithAI } from '../lib/aiParser'

async function run(recognizeReceipt: (src: string) => Promise<unknown>, src = 'data:image/jpeg;base64,AAAA') {
  let value: any = null
  let thrown: any = null
  await act(async () => {
    try {
      value = await recognizeReceipt(src)
    } catch (e) {
      thrown = e
    }
  })
  return { value, thrown }
}

beforeEach(() => {
  ocr.recognize.mockReset()
  ocr.createWorker.mockReset()
  ocr.createWorker.mockImplementation(async (_langs: string, _oem: number, opts: { logger?: typeof ocr.logger }) => {
    ocr.logger = opts?.logger
    return {
      setParameters: vi.fn(async () => undefined),
      recognize: (img: unknown) => ocr.recognize(img),
      terminate: vi.fn(async () => undefined),
    }
  })
  vi.mocked(parseReceiptWithAI).mockReset()
})

describe('useReceiptOcr — error path (#4)', () => {
  it('rejects on OCR failure instead of resolving with an empty result', async () => {
    ocr.recognize.mockRejectedValue(new Error('tesseract boom'))
    const { result } = renderHook(() => useReceiptOcr())

    const { value, thrown } = await run(result.current.recognizeReceipt)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toBe('tesseract boom')
    // the regression: caller used to receive a parsed object and could save a blank transaction
    expect(value).toBeNull()
  })

  it('exposes the failure: error set, progress back to 0, not processing', async () => {
    ocr.recognize.mockRejectedValue(new Error('tesseract boom'))
    const { result } = renderHook(() => useReceiptOcr())

    await run(result.current.recognizeReceipt)

    expect(result.current.error).toBe('tesseract boom')
    expect(result.current.progress).toBe(0)
    expect(result.current.isProcessing).toBe(false)
  })

  it('completes progress at 100 on success, and never reaches 100 on failure', async () => {
    ocr.recognize.mockImplementation(async () => {
      ocr.logger?.({ status: 'recognizing text', progress: 0.42 })
      return { data: { text: 'TOKO ABC\nTotal: 50,000.00\n12/03/2024', confidence: 88 } }
    })
    const { result } = renderHook(() => useReceiptOcr())

    const { value, thrown } = await run(result.current.recognizeReceipt)

    expect(thrown).toBeNull()
    expect(value.merchant).toBe('Toko Abc')
    expect(value.text).toContain('TOKO ABC')
    expect(value.total).toBe(5_000_000)
    expect(value.date).toBe('2024-03-12')
    expect(value.confidence).toBe(88)
    // Hook menutup progres ke 100 setelah parsing selesai (setProgress(100) di useReceiptOcr.ts,
    // ditambahkan di bdd9c21 setelah tes ini ditulis). Nilai 42 dari logger hanya perantara.
    expect(result.current.progress).toBe(100)
    expect(result.current.error).toBeNull()
    expect(result.current.isProcessing).toBe(false)
  })

  const totalCases: Array<[string, number]> = [
    // Indonesian dot-thousands (used to parse as Rp50 / Rp1,23 via parseFloat)
    ['Total: 50.000', 5_000_000],
    ['Grand Total: Rp 1.234.567', 123_456_700],
    ['TOTAL 45,900', 4_590_000],
    ['Amount Due: 50,000.00', 5_000_000],
    ['Total: 30.60', 3_060],
  ]

  for (const [line, expected] of totalCases) {
    it(`parses receipt total "${line}" -> ${expected} cents`, async () => {
      ocr.recognize.mockResolvedValue({ data: { text: `TOKO ABC\n${line}`, confidence: 90 } })
      const { result } = renderHook(() => useReceiptOcr())

      const { value } = await run(result.current.recognizeReceipt)

      expect(value.total).toBe(expected)
    })
  }
})

describe('useReceiptOcr — OCR setup', () => {
  it("memuat 'ind+eng' lebih dulu", async () => {
    ocr.recognize.mockResolvedValue({ data: { text: 'TOKO ABC', confidence: 90 } })
    const { result } = renderHook(() => useReceiptOcr())

    await run(result.current.recognizeReceipt)

    expect(ocr.createWorker.mock.calls[0][0]).toBe('ind+eng')
  })

  it("bila 'ind' gagal dimuat, fallback ke 'eng' dan tetap menghasilkan teks", async () => {
    ocr.createWorker.mockImplementationOnce(async () => {
      throw new Error('traineddata ind tidak tersedia')
    })
    ocr.recognize.mockResolvedValue({ data: { text: 'TOKO ABC\nTotal 10.000', confidence: 80 } })
    const { result } = renderHook(() => useReceiptOcr())

    const { value, thrown } = await run(result.current.recognizeReceipt)

    expect(thrown).toBeNull()
    expect(ocr.createWorker.mock.calls[1][0]).toBe('eng')
    expect(value.total).toBe(1_000_000)
  })
})

describe('useReceiptOcr — merchant dan AI', () => {
  it('merchant null bila tidak ada baris yang layak sebagai nama toko', async () => {
    ocr.recognize.mockResolvedValue({ data: { text: '12345\nTotal 5.000', confidence: 70 } })
    const { result } = renderHook(() => useReceiptOcr())

    const { value } = await run(result.current.recognizeReceipt)

    expect(value.merchant).toBeNull()
    expect(value.total).toBe(500_000)
  })

  it('AI tidak dipanggil ketika OCR lokal sudah menemukan total', async () => {
    ocr.recognize.mockResolvedValue({ data: { text: 'TOKO ABC\nTotal 10.000', confidence: 80 } })
    const { result } = renderHook(() => useReceiptOcr())

    await run(result.current.recognizeReceipt)

    expect(parseReceiptWithAI).not.toHaveBeenCalled()
  })
})

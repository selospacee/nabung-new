import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('tesseract.js', () => ({
  default: { recognize: vi.fn() },
}))

import Tesseract from 'tesseract.js'
import { useReceiptOcr } from './useReceiptOcr'

const recognize = Tesseract.recognize as unknown as ReturnType<typeof vi.fn>

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

describe('useReceiptOcr — error path (#4)', () => {
  beforeEach(() => {
    recognize.mockReset()
  })

  it('rejects on OCR failure instead of resolving with an empty result', async () => {
    recognize.mockRejectedValue(new Error('tesseract boom'))
    const { result } = renderHook(() => useReceiptOcr())

    const { value, thrown } = await run(result.current.recognizeReceipt)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toBe('tesseract boom')
    // the regression: caller used to receive a parsed object and could save a blank transaction
    expect(value).toBeNull()
  })

  it('exposes the failure: error set, progress back to 0, not processing', async () => {
    recognize.mockRejectedValue(new Error('tesseract boom'))
    const { result } = renderHook(() => useReceiptOcr())

    await run(result.current.recognizeReceipt)

    expect(result.current.error).toBe('tesseract boom')
    expect(result.current.progress).toBe(0)
    expect(result.current.isProcessing).toBe(false)
  })

  it('reports logger progress on success and never hits 100 on failure', async () => {
    recognize.mockImplementation(async (_img: unknown, _lang: unknown, opts: any) => {
      opts.logger({ status: 'recognizing text', progress: 0.42 })
      return { data: { text: 'TOKO ABC\nTotal: 50,000.00\n12/03/2024', confidence: 88 } }
    })
    const { result } = renderHook(() => useReceiptOcr())

    const { value, thrown } = await run(result.current.recognizeReceipt)

    expect(thrown).toBeNull()
    expect(value.merchant).toBe('TOKO ABC')
    expect(value.total).toBe(5_000_000)
    expect(value.date).toBe('2024-03-12')
    expect(value.confidence).toBe(88)
    expect(result.current.progress).toBe(42)
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
      recognize.mockResolvedValue({ data: { text: `TOKO ABC\n${line}`, confidence: 90 } })
      const { result } = renderHook(() => useReceiptOcr())

      const { value } = await run(result.current.recognizeReceipt)

      expect(value.total).toBe(expected)
    })
  }
})

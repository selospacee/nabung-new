import { useCallback, useState } from 'react'
import Tesseract from 'tesseract.js'
import { parseReceiptWithAI, isAIAvailable } from '../lib/aiParser'
import { prepareImageForOcr } from '../utils/imagePrep'
import { pickReceiptTitle, pickReceiptTotal } from '../utils/receiptTitle'

export interface OcrResult {
  text: string
  confidence: number
  total: number | null
  date: string | null
  suggestedType: 'income' | 'expense' | 'transfer'
  suggestedCategoryId: string | null
  rawLines: string[]
  /** Nama toko dari baris atas struk. Hanya untuk tebakan kategori; UI tidak menampilkannya. */
  merchant?: string | null
}

interface CategoryPattern {
  id: string
  name: string
  merchantPatterns: string[]
  type: 'income' | 'expense' | 'transfer'
}

const OCR_LANGS = 'ind+eng'
const OCR_FALLBACK_LANG = 'eng'
const AI_TIMEOUT_MS = 6000

function findCategoryFromPatterns(categories: CategoryPattern[], merchant: string, description: string): string | null {
  const text = `${merchant} ${description}`.toLowerCase()
  let bestMatch: CategoryPattern | null = null
  let bestScore = 0

  for (const cat of categories) {
    if (cat.type === 'transfer') continue
    for (const pattern of cat.merchantPatterns) {
      if (text.includes(pattern.toLowerCase())) {
        const score = pattern.length
        if (score > bestScore) {
          bestScore = score
          bestMatch = cat
        }
      }
    }
  }

  return bestMatch?.id || null
}

/** Worker dengan bahasa Indonesia+Inggris; bila data 'ind' gagal dimuat, pakai 'eng' saja. */
async function createOcrWorker(onProgress: (pct: number) => void) {
  const logger = (m: { status: string; progress: number }) => {
    if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100))
  }
  try {
    return await Tesseract.createWorker(OCR_LANGS, 1, { logger })
  } catch (e) {
    console.warn(`[OCR] Bahasa ${OCR_LANGS} gagal dimuat, pakai ${OCR_FALLBACK_LANG}:`, e)
    return await Tesseract.createWorker(OCR_FALLBACK_LANG, 1, { logger })
  }
}

type OcrWorker = Awaited<ReturnType<typeof createOcrWorker>>

/** Mode segmentasi untuk struk: satu blok teks seragam (PSM 6). Gagal diterapkan = pakai default. */
async function applyReceiptParams(worker: OcrWorker): Promise<void> {
  try {
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK })
  } catch (e) {
    console.warn('[OCR] Parameter Tesseract tidak diterapkan, pakai default:', e)
  }
}

/**
 * Total dari AI sebagai perbaikan tambahan, hanya bila OCR lokal tidak menemukan total.
 * Mengirim gambar struk ke edge function. Hanya untuk data URL base64. Tidak pernah melempar error.
 */
async function askAiForTotal(imageSource: string | HTMLImageElement): Promise<number | null> {
  if (typeof imageSource !== 'string') return null
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(imageSource)
  if (!m) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), AI_TIMEOUT_MS)
    })
    // categories kosong: hanya total yang dipakai dari hasil AI
    const ai = await Promise.race([parseReceiptWithAI(m[2], [], m[1]), timeout])
    const total = ai?.total
    return typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.round(total) : null
  } catch (e) {
    console.warn('[OCR] Fallback AI gagal, pakai hasil lokal:', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function useReceiptOcr(categories: CategoryPattern[] = []) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recognizeReceipt = useCallback(async (imageSource: string | HTMLImageElement): Promise<OcrResult> => {
      setIsProcessing(true)
      setProgress(0)
      setError(null)
      let worker: OcrWorker | null = null

      try {
        const image = await prepareImageForOcr(imageSource)
        worker = await createOcrWorker(setProgress)
        await applyReceiptParams(worker)
        const result = await worker.recognize(image)

        const rawText = result.data.text
        const rawLines = rawText.split('\n').filter(l => l.trim().length > 0)

        const parsed = parseReceiptText(rawText, rawLines)
        const merchant = pickReceiptTitle(rawLines, categories.flatMap(c => c.merchantPatterns))

        let total = parsed.total
        if (total === null && isAIAvailable()) {
          setAiParsing(true)
          try {
            total = await askAiForTotal(imageSource)
          } finally {
            setAiParsing(false)
          }
        }

        // Merchant hanya dipakai untuk menebak kategori lewat merchantPatterns.
        const suggestedCategoryId = findCategoryFromPatterns(categories, merchant ?? '', rawText)

        setProgress(100)

        return {
          text: rawText,
          confidence: result.data.confidence,
          total,
          date: parsed.date,
          suggestedType: parsed.suggestedType,
          suggestedCategoryId,
          rawLines,
          merchant,
        }
      } catch (e: any) {
        setError(e.message || 'OCR failed')
        setProgress(0)
        throw e
      } finally {
        if (worker) await worker.terminate().catch(() => undefined)
        setIsProcessing(false)
      }
    }, [categories])

  const parseReceiptText = (text: string, lines: string[]): { total: number | null; date: string | null; suggestedType: 'income' | 'expense' | 'transfer' } => {
    const total = pickReceiptTotal(lines)

    // Find date
    const datePatterns = [
      /(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/,
      /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{2,4})?/i,
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s*(\d{4})/i,
    ]

    let date: string | null = null
    for (const pattern of datePatterns) {
      const match = text.match(pattern)
      if (match) {
        try {
          if (match[0].includes('-') || match[0].includes('/')) {
            const parts = match[0].split(/[-/]/)
            if (parts.length === 3) {
              let year = parseInt(parts[2])
              if (year < 100) year += 2000
              date = `${year}-${String(parseInt(parts[1])).padStart(2, '0')}-${String(parseInt(parts[0])).padStart(2, '0')}`
            }
          } else {
            const months: Record<string, number> = {
              january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
              july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
            }
            const monthName = match[1]?.toLowerCase()
            if (monthName && months[monthName] !== undefined) {
              const day = parseInt(match[2])
              const year = parseInt(match[3]) || new Date().getFullYear()
              const m = months[monthName]
              date = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            }
          }
        } catch {
          // continue
        }
        if (date) break
      }
    }

    return { total, date, suggestedType: 'expense' as const }
  }

  return {
      isProcessing,
      aiParsing,
      progress,
      error,
      recognizeReceipt,
    }
}

export type UseReceiptOcrReturn = ReturnType<typeof useReceiptOcr>

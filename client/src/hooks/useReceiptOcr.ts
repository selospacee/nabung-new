import { useCallback, useState } from 'react'
import Tesseract from 'tesseract.js'
import { displayToCents } from '../utils/currency'

export interface OcrResult {
  text: string
  confidence: number
  merchant: string | null
  total: number | null
  date: string | null
  rawLines: string[]
}

export function useReceiptOcr() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recognizeReceipt = useCallback(async (imageSource: string | HTMLImageElement): Promise<OcrResult> => {
    setIsProcessing(true)
    setProgress(0)
    setError(null)

    try {
      const result = await Tesseract.recognize(imageSource, 'eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round((m.progress as number) * 100))
          }
        },
      })

      const rawText = result.data.text
      const rawLines = rawText.split('\n').filter(l => l.trim().length > 0)

      // Parse merchant, total, date
      const parsed = parseReceiptText(rawText, rawLines)

      return {
        text: rawText,
        confidence: result.data.confidence,
        ...parsed,
        rawLines,
      }
    } catch (e: any) {
      setError(e.message || 'OCR failed')
      setProgress(0)
      throw e
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const parseReceiptText = (text: string, lines: string[]): { merchant: string | null; total: number | null; date: string | null } => {
    const lower = text.toLowerCase()

    // Find total: look for "Total", "Grand Total", "Amount Due", "Amount" near bottom
    const totalPatterns = [
      /(?:grand\s+)?total[:\s]*(?:rp\s*)?([\d][\d.,]*)/i,
      /(?:amount\s+due|amount\s+payable|total\s+amount)[:\s]*(?:rp\s*)?([\d][\d.,]*)/i,
      /(?:total|grand\s+total)[:\s]*(?:rp\s*)?([\d][\d.,]*)/i,
    ]

    let total: number | null = null

    for (const pattern of totalPatterns) {
      const match = lower.match(pattern)
      if (match) {
        // displayToCents handles both "50.000" (ID thousands) and "50,000.00"
        total = displayToCents(match[1])
        break
      }
    }

    // If no total found, look at last few lines for a number
    if (!total && lines.length > 0) {
      const lastLines = lines.slice(-5).join(' ').toLowerCase()
      const lastNumMatch = lastLines.match(/([\d,]+\.\d{2})/)
      if (lastNumMatch) {
        total = Math.round(parseFloat(lastNumMatch[1].replace(/,/g, '')) * 100)
      }
    }

    // Find merchant: first non-empty line (usually store name)
    let merchant: string | null = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length > 2 && !trimmed.match(/^\d/) && !trimmed.match(/^(total|grand|amount|date|receipt|invoice|no\.?|nomor)/i)) {
        merchant = trimmed
        break
      }
    }

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

    return { merchant, total, date }
  }

  return {
    isProcessing,
    progress,
    error,
    recognizeReceipt,
  }
}

export type UseReceiptOcrReturn = ReturnType<typeof useReceiptOcr>

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Category } from '../types'
import { parseISO, startOfDay } from 'date-fns'
import { toISODate } from '../utils/dates'
import { ID_DATE_PHRASES, DATE_PATTERNS } from '../utils/parsers'
import { parseIDRAmount } from '../utils/currency'
import { parseVoiceWithAI, isAIAvailable } from '../lib/aiParser'
import { useSupabaseAuth } from '../auth/SupabaseAuthContext'

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  [index: number]: { transcript: string }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: (event: SpeechRecognitionEvent) => void
  onerror: (event: { error: string }) => void
  onend: () => void
}

declare global {
  interface Window {
    SpeechRecognition: { new(): SpeechRecognition }
    webkitSpeechRecognition: { new(): SpeechRecognition }
  }
}

export interface ParsedTransaction {
  amount: number | null
  date: string | null
  merchant: string
  description: string
  suggestedCategoryId: string | null
  suggestedType: 'income' | 'expense' | 'transfer'
  location: string | null
  latitude: number | null
  longitude: number | null
}

export interface SpeechToTextResult {
  transcript: string
  isFinal: boolean
  parsed: ParsedTransaction
}

export function useSpeechToText(categories: Category[]) {
  const { user } = useSupabaseAuth()
  const currency = user?.currency || 'IDR'
  const [isListening, setIsListening] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [parsed, setParsed] = useState<ParsedTransaction>({
    amount: null,
    date: null,
    merchant: '',
    description: '',
    suggestedCategoryId: null,
    suggestedType: 'expense',
    location: null,
    latitude: null,
    longitude: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [selectedLang, setSelectedLang] = useState<'id-ID' | 'en-US'>(currency === 'IDR' ? 'id-ID' : 'en-US')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcriptRef = useRef('')

  // Stop the microphone when the component using this hook unmounts.
  useEffect(() => () => {
    try { recognitionRef.current?.stop() } catch {}
    recognitionRef.current = null
  }, [])

  const parseTranscript = useCallback((text: string): ParsedTransaction => {
    const lower = text.toLowerCase().trim()
    let remaining = text.trim()

    // Extract amount — use parseIDRAmount for Rp prefix + multi-group thousands
    let amount: number | null = parseIDRAmount(text)
    if (amount !== null) {
      remaining = remaining.replace(/(?:Rp|[$€£])\s*[\d.,]+|[\d.,]+/g, '').trim()
    }

    // Extract date
    let date: string | null = null
    // Relative date phrases (Indonesian)
    for (const [phrase, days] of Object.entries(ID_DATE_PHRASES)) {
      if (lower.includes(phrase)) {
        const d = new Date(startOfDay(new Date()).getTime() + days * 86400000)
        date = toISODate(d)
        remaining = remaining.replace(phrase, '').trim()
        break
      }
    }

    if (!date) {
      // English relative dates
      if (/\btoday\b/i.test(lower)) {
        date = toISODate(new Date())
        remaining = remaining.replace(/today/gi, '').trim()
      } else if (/\byesterday\b/i.test(lower)) {
        const d = new Date(startOfDay(new Date()).getTime() - 86400000)
        date = toISODate(d)
        remaining = remaining.replace(/yesterday/gi, '').trim()
      } else if (/\btomorrow\b/i.test(lower)) {
        const d = new Date(startOfDay(new Date()).getTime() + 86400000)
        date = toISODate(d)
        remaining = remaining.replace(/tomorrow/gi, '').trim()
      }
    }

    if (!date) {
      // Explicit date patterns
      for (const pattern of DATE_PATTERNS) {
        const match = lower.match(pattern)
        if (match) {
          // Try to parse the match
          date = tryParseDate(match)
          if (date) {
            remaining = remaining.replace(match[0], '').trim()
            break
          }
        }
      }
    }

    // Default to today
    if (!date) {
      date = toISODate(new Date())
    }

    // Extract merchant and description from remaining text
    const words = remaining.split(/\s+/).filter(w => w.length > 0)
    const merchant = words.slice(0, 3).join(' ')
    const description = words.slice(3).join(' ')

    // Auto-suggest category
    const suggestedCategoryId = findCategory(categories, merchant, description)

    return { amount, date, merchant, description, suggestedCategoryId, suggestedType: 'expense' as const, location: null, latitude: null, longitude: null }
  }, [categories])

  const findCategory = (cats: Category[], merchant: string, desc: string): string | null => {
    const text = `${merchant} ${desc}`.toLowerCase()
    let bestMatch: Category | null = null
    let bestScore = 0

    for (const cat of cats) {
      if (cat.type === 'transfer') continue
      for (const pattern of cat.merchantPatterns) {
        if (text.includes(pattern)) {
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

  const tryParseDate = (match: RegExpMatchArray): string | null => {
    try {
      if (match[0].includes('-')) {
        // ISO format: 2024-03-05
        const d = parseISO(match[0])
        if (!isNaN(d.getTime())) return toISODate(d)
      }
      if (match[0].includes('/')) {
        // MM/DD/YYYY
        const parts = match[0].split('/')
        if (parts.length === 3) {
          let year = parseInt(parts[2])
          if (year < 100) year += 2000
          const d = new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1]))
          if (!isNaN(d.getTime())) return toISODate(d)
        }
      }
      if (match[3] && match[2]) {
        // "5 March 2024" format
        const months = ['january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december']
        const monthIdx = months.findIndex(m => match[2].toLowerCase().includes(m))
        if (monthIdx >= 0) {
          let year = parseInt(match[3]) || new Date().getFullYear()
          if (year < 100) year += 2000
          const d = new Date(year, monthIdx, parseInt(match[1]))
          if (!isNaN(d.getTime())) return toISODate(d)
        }
      }
    } catch {
      return null
    }
    return null
  }

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      setError('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    const recognition = new SpeechRecognitionAPI()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = selectedLang

    recognitionRef.current = recognition
    setIsListening(true)
    setError(null)
    setTranscript('')
    transcriptRef.current = ''

    recognition.onresult = (event: any) => {
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        }
      }
      if (final) {
        transcriptRef.current = final
        setTranscript(final)
        setParsed(parseTranscript(final))
      }
    }

    recognition.onerror = (event: any) => {
      setError(`Speech recognition error: ${event.error}`)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      if (transcriptRef.current) {
        setTranscript(transcriptRef.current)
        setParsed(parseTranscript(transcriptRef.current))
      }
    }

    try {
      recognition.start()
    } catch (e: any) {
      setError(`Failed to start: ${e.message}`)
      setIsListening(false)
    }
  }, [parseTranscript])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {}
      recognitionRef.current = null
    }
    setIsListening(false)
  }, [])

  const clearTranscript = useCallback(() => {
      setTranscript('')
      setParsed({ amount: null, date: null, merchant: '', description: '', suggestedCategoryId: null, suggestedType: 'expense', location: null, latitude: null, longitude: null })
      transcriptRef.current = ''
    }, [])

    return {
      isListening,
      aiParsing,
            transcript,
            parsed,
            error,
            startListening,
            stopListening,
            clearTranscript,
            supportsSpeech: !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
            selectedLang,
            setSelectedLang,
          }
      }

export type UseSpeechToTextReturn = ReturnType<typeof useSpeechToText>

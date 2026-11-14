import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Hook ini memakai useSupabaseAuth hanya untuk mata uang. Modul auth menarik lib/supabase,
// yang melempar error bila env Supabase tidak ada (CI). Tes ini tidak butuh jaringan,
// jadi konteks auth di-stub dengan user kosong (currency default IDR).
vi.mock('../auth/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => ({ user: null }),
}))

import { useSpeechToText } from './useSpeechToText'

/** Minimal stand-in for the browser SpeechRecognition API. */
class FakeSpeechRecognition {
  static last: FakeSpeechRecognition | null = null
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onend: (() => void) | null = null
  start() {
    FakeSpeechRecognition.last = this
  }
  stop() {}
}

/** Build the array-like SpeechRecognitionResultList the hook iterates. */
function finalResult(transcript: string) {
  return {
    resultIndex: 0,
    results: { length: 1, 0: { isFinal: true, 0: { transcript } } },
  }
}

function speak(transcript: string) {
  act(() => {
    FakeSpeechRecognition.last!.onresult!(finalResult(transcript))
  })
}

describe('useSpeechToText — amount extraction (#3)', () => {
  beforeEach(() => {
    ;(window as any).SpeechRecognition = FakeSpeechRecognition
    FakeSpeechRecognition.last = null
  })

  afterEach(() => {
    delete (window as any).SpeechRecognition
    delete (window as any).webkitSpeechRecognition
  })

  const amountCases: Array<[string, number]> = [
    ['terima gaji 5.000.000', 500_000_000],
    ['transfer 2 item harga 50000', 5_000_000],
    ['bayar listrik Rp 250.000', 25_000_000],
    ['makan siang 30.600', 3_060_000],
    ['step 2 5000', 500_000],
  ]

  for (const [transcript, expected] of amountCases) {
    it(`parses "${transcript}" -> ${expected} cents`, () => {
      const { result } = renderHook(() => useSpeechToText([]))
      act(() => result.current.startListening())
      speak(transcript)
      expect(result.current.transcript).toBe(transcript)
      expect(result.current.parsed.amount).toBe(expected)
    })
  }

  it('leaves amount null when the transcript has no number', () => {
    const { result } = renderHook(() => useSpeechToText([]))
    act(() => result.current.startListening())
    speak('beli kopi')
    expect(result.current.parsed.amount).toBeNull()
  })

  it('re-parses on end using the last final transcript', () => {
    const { result } = renderHook(() => useSpeechToText([]))
    act(() => result.current.startListening())
    speak('bayar 1.500.000')
    act(() => {
      FakeSpeechRecognition.last!.onend!()
    })
    expect(result.current.parsed.amount).toBe(150_000_000)
    expect(result.current.isListening).toBe(false)
  })
})

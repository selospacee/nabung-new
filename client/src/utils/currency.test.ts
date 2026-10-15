import { describe, it, expect } from 'vitest'
import { displayToCents, parseIDRAmount } from './currency'

describe('displayToCents — Indonesian thousands vs Western decimal (#6)', () => {
  it('parses a single thousands group', () => {
    expect(displayToCents('30.600')).toBe(3_060_000)
    expect(displayToCents('30.000')).toBe(3_000_000)
  })

  it('parses multi-group thousands', () => {
    expect(displayToCents('1.500.000')).toBe(150_000_000)
    expect(displayToCents('12.345.678')).toBe(1_234_567_800)
  })

  it('still treats a short trailing group as a Western decimal', () => {
    expect(displayToCents('30.60')).toBe(3_060)
    expect(displayToCents('30.6')).toBe(3_060)
  })

  it('handles mixed separators (European decimal last)', () => {
    expect(displayToCents('15.000,00')).toBe(1_500_000)
    expect(displayToCents('1.500.000,50')).toBe(150_000_050)
  })

  it('handles comma-only thousands', () => {
    expect(displayToCents('1,500,000')).toBe(150_000_000)
  })

  it('returns null for non-numeric input', () => {
    expect(displayToCents('')).toBeNull()
    expect(displayToCents('abc')).toBeNull()
  })
})

describe('parseIDRAmount — speech/text IDR extraction (#3)', () => {
  it('parses bare multi-group thousands (no Rp prefix)', () => {
    expect(parseIDRAmount('terima gaji 5.000.000')).toBe(500_000_000)
    expect(parseIDRAmount('bayar 1.500.000')).toBe(150_000_000)
    expect(parseIDRAmount('12.345.678')).toBe(1_234_567_800)
  })

  it('parses with Rp prefix', () => {
    expect(parseIDRAmount('bayar listrik Rp 250.000')).toBe(25_000_000)
    expect(parseIDRAmount('Rp50.000')).toBe(5_000_000)
    expect(parseIDRAmount('rp 30.000')).toBe(3_000_000)
  })

  it('parses with foreign currency symbols', () => {
    expect(parseIDRAmount('$500')).toBe(50_000)
    expect(parseIDRAmount('€1.500')).toBe(150_000)
  })

  it('takes the largest candidate for bare numbers (stray digit regression)', () => {
    // naive first-match regex used to return Rp2 here
    expect(parseIDRAmount('transfer 2 item harga 50000')).toBe(5_000_000)
    expect(parseIDRAmount('step 2 5000')).toBe(500_000)
    expect(parseIDRAmount('beli 3 kopi 45000')).toBe(4_500_000)
  })

  it('does not treat a currency symbol letter inside a word as a prefix', () => {
    // "sharp" contains the substring "rp" — must not hijack the amount
    expect(parseIDRAmount('sharp 2 5000')).toBe(500_000)
  })

  it('returns null when no amount is present', () => {
    expect(parseIDRAmount('beli kopi')).toBeNull()
    expect(parseIDRAmount('')).toBeNull()
  })
})

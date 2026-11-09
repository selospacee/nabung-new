/** Format cents to display string */
export function centsToDisplay(cents: number, currency = 'IDR'): string {
  if (cents === 0) return 'Rp0,00'
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(cents)
  const formatted = abs / 100
  const parts = formatted.toFixed(2).split('.')
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${symbol}${intPart}.${parts[1]}`
}

/** Format with sign for income/expense */
export function centsToDisplaySigned(cents: number, currency = 'IDR'): string {
  const sign = cents >= 0 ? '+' : '-'
  return `${sign}${centsToDisplay(Math.abs(cents), currency)}`
}

/** Parse an IDR amount from speech/text — handles Rp prefix + multi-group thousands.
   For bare numbers, takes the largest candidate to avoid matching stray digits. */
export function parseIDRAmount(text: string): number | null {
  // Currency symbol prefix: "Rp 50.000", "$500", "€1.500"
  const symbolMatch = text.match(/(?:\bRp\b|[$€£])\s*([\d.,]+)/i)
  if (symbolMatch) {
    return displayToCents(symbolMatch[1])
  }
  // Bare numbers: collect all candidates, take the largest
  const re = /[\d.,]+/g
  const candidates: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = displayToCents(m[0])
    if (n !== null) candidates.push(n)
  }
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

/** Parse a display string to cents — handles Indonesian locale formats too */
export function displayToCents(str: string, currency = 'IDR'): number | null {
  const cleaned = str.replace(/[^0-9.,\-]/g, '')
  if (!cleaned) return null

  // For IDR: dots are thousands separators, comma is decimal (rare)
  // For USD/EUR/etc: comma is thousands separator, dot is decimal
  const isIDR = currency === 'IDR'
  const hasDot = cleaned.includes('.')
  const hasComma = cleaned.includes(',')

  let numStr: string
  if (hasDot && hasComma) {
    // Mixed: find which is last — comma last = European decimal (15.000,00)
    const lastDot = cleaned.lastIndexOf('.')
    const lastComma = cleaned.lastIndexOf(',')
    if (lastComma > lastDot) {
      numStr = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      numStr = cleaned.replace(/,/g, '')
    }
  } else if (hasDot && !hasComma) {
    // Only dots present
    if (isIDR) {
      // IDR: dots are thousands separators ("30.600" → 30600)
      const parts = cleaned.split('.')
      if (parts.slice(1).every(p => p.length === 3)) {
        numStr = parts.join('')
      } else {
        // Fallback: treat as decimal if groups aren't 3 digits
        numStr = cleaned
      }
    } else {
      // Other currencies: dot is decimal separator
      numStr = cleaned
    }
  } else if (hasComma && !hasDot) {
    // Only commas present
    if (isIDR) {
      // IDR rarely uses commas, but if present treat as thousands
      numStr = cleaned.replace(/,/g, '')
    } else {
      const parts = cleaned.split(',')
      if (parts.length === 2 && parts[1].length <= 2) {
        numStr = cleaned.replace(',', '.')
      } else {
        numStr = cleaned.replace(/,/g, '')
      }
    }
  } else {
    numStr = cleaned
  }

  const match = numStr.match(/^(-?\d+\.?\d*)$/)
  if (!match) return null
  const num = parseFloat(match[0])
  if (isNaN(num)) return null
  return Math.round(num * 100)
}

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', IDR: 'Rp', JPY: '¥', CNY: '¥',
    AUD: 'A$', CAD: 'C$', SGD: 'S$', MYR: 'RM', THB: '฿', PHP: '₱',
  }
  return symbols[currency] || currency
}

function getLocaleForCurrency(currency: string): string {
  const localeMap: Record<string, string> = {
    IDR: 'id-ID',
    USD: 'en-US',
    EUR: 'de-DE',
    GBP: 'en-GB',
    JPY: 'ja-JP',
    CNY: 'zh-CN',
    SGD: 'en-SG',
    MYR: 'ms-MY',
    AUD: 'en-AU',
    CAD: 'en-CA',
    THB: 'th-TH',
    PHP: 'en-PH',
  }
  return localeMap[currency] || 'en-US'
}

/** Format currency with full locale */
export function formatCurrency(cents: number, currency = 'IDR', locale?: string): string {
  const resolvedLocale = locale || getLocaleForCurrency(currency)
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

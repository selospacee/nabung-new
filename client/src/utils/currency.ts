/** Format cents to display string */
export function centsToDisplay(cents: number, currency = 'USD'): string {
  if (cents === 0) return '$0.00'
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(cents)
  const formatted = abs / 100
  const parts = formatted.toFixed(2).split('.')
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${symbol}${intPart}.${parts[1]}`
}

/** Format with sign for income/expense */
export function centsToDisplaySigned(cents: number, currency = 'USD'): string {
  const sign = cents >= 0 ? '+' : '-'
  return `${sign}${centsToDisplay(Math.abs(cents), currency)}`
}

/** Parse a display string to cents */
export function displayToCents(str: string, currency = 'USD'): number | null {
  const cleaned = str.replace(/[^0-9.,\-]/g, '')
  if (!cleaned) return null
  const match = cleaned.match(/^-?[\d,]+\.?\d*$/)
  if (!match) return null
  const num = parseFloat(match[0].replace(/,/g, ''))
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

/** Format currency with full locale */
export function formatCurrency(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

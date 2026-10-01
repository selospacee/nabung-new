// Shared regex patterns for parsing amounts, dates, and text

/** Match currency amounts like $4.50, 4.50, USD 4.50, Rp 15.000 */
export const AMOUNT_PATTERNS = [
  /\$[\s]*([\d,]+\.?\d{0,2})/i,                    // $4.50
  /(?:USD|EUR|GBP|IDR|JPY)\s*[\s]*([\d,]+\.?\d{0,2})/i, // USD 4.50
  /([\d,]+\.\d{2})/,                                 // 4.50
  /Rp\s*[\s]*([\d,]+\.?\d{0,2})/i,                  // Rp 15.000
]

/** Match dates: explicit dates, relative dates */
export const DATE_PATTERNS = [
  /(\d{4})-(\d{2})-(\d{2})/,           // 2024-03-05
  /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,   // 3/5/2024 or 03/05/24
  /(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*(\d{2,4})?/i,
  /(today|yesterday|tomorrow)/i,
  /(last|this)\s+(day|week|month|year)/i,
  /(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
]

/** Indonesian date phrases */
export const ID_DATE_PHRASES: Record<string, number> = {
  'hari ini': 0,        // today
  'besok': 1,           // tomorrow
  'kemarin': -1,        // yesterday
  'lusa': -2,           // day before yesterday
}

/** Known merchant keywords for auto-categorization */
export const MERCHANT_KEYWORDS: Record<string, string[]> = {
  'mile': ['flight', 'airline', 'airplane', 'maskapai', 'garuda', 'lion', 'airasia'],
  'ride': ['uber', 'grab', 'gojek', 'taxi', 'transport'],
  'fuel': ['bensin', 'gas', 'pertamax', 'fuel', 'spbu'],
  'meal': ['restaurant', 'food', 'cafe', 'coffee', 'makan', 'kuliner', 'warung', 'kafe'],
  'shop': ['shop', 'mall', 'store', 'belanja', 'tokopedia', 'shopee', 'laravel'],
  'bill': ['electric', 'water', 'internet', 'phone', 'tagihan', 'pln', 'pulsa', 'bpjs'],
}

/** Number word mapping for voice parsing */
export const NUMBER_WORDS: Record<string, number> = {
  'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
  'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
  'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
  'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
  'hundred': 100, 'thousand': 1000,
}

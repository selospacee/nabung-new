import type { Category } from '../types'

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

export interface ReceiptParsedData {
  merchant: string | null
  total: number | null
  date: string | null
  suggestedType: 'income' | 'expense' | 'transfer'
  suggestedCategoryId: string | null
  description: string | null
  notes: string | null
  location: string | null
  latitude: number | null
  longitude: number | null
}

const AI_PARSER_PROMPT = `You are a transaction parser for a personal finance app. Parse the input text and extract transaction details.

Return ONLY a JSON object with these fields:
{
  "amount": number (in cents, e.g. 30600 for 306.00), 
  "date": "YYYY-MM-DD" or null,
  "merchant": "string",
  "description": "string",
  "suggestedType": "income" | "expense" | "transfer",
  "suggestedCategoryId": "string" | null,
  "location": "string" | null,
  "latitude": number | null,
  "longitude": number | null
}

Rules:
- Amount: convert to cents (multiply by 100). Handle formats like "30.600" (IDR) = 3060000 cents, "30.60" = 3060 cents
- Date: today if not mentioned. Format YYYY-MM-DD
- Merchant: business/store name. Look for @handles, business names
- Description: what was purchased
- Type: "income" for salary, refund, cashback, deposit; "expense" for purchases, bills; "transfer" for transfers
- Category: match to one of the provided categories by name/patterns
- Location: address or place name if mentioned
- Coordinates: only if explicitly mentioned

Categories available:
{categories}

Current date: {currentDate}`

const RECEIPT_AI_PROMPT = `You are a receipt parser for a personal finance app. Analyze the receipt image and extract transaction details.

Return ONLY a JSON object with these fields:
{
  "merchant": "string" | null,
  "total": number (in cents),
  "date": "YYYY-MM-DD" | null,
  "suggestedType": "income" | "expense" | "transfer",
  "suggestedCategoryId": "string" | null,
  "description": "string" | null,
  "notes": "string" | null,
  "location": "string" | null,
  "latitude": number | null,
  "longitude": number | null
}

Rules:
- Total: convert to cents. Handle IDR format "30.600" = 3060000 cents
- Merchant: store name. Look for @handles, business names. Skip headers like "TANGGAL WAKTU", "NO. STRUK", etc.
- Date: from receipt. Format YYYY-MM-DD
- Type: "income" for refund/return/cashback receipts; "expense" for purchases
- Category: match to one of the provided categories
- Description: what was purchased (items from receipt)
- Notes: any additional info (payment method, discounts, etc.)
- Location: address/place from receipt
- Coordinates: only if explicitly mentioned

Categories available:
{categories}

Current date: {currentDate}`

function buildCategoryList(categories: Category[], max = 30): string {
  const filtered = categories.filter(c => c.type !== 'transfer')
  return filtered
    .slice(0, max)
    .map(c => `- ${c.name} (id: ${c.id}, type: ${c.type}, patterns: ${c.merchantPatterns.join(', ')})`)
    .join('\n') + (filtered.length > max ? `\n... and ${filtered.length - max} more categories` : '')
}

const EDGE_FUNCTION_URL = 'https://lyhemujxjphuyohyckvw.supabase.co/functions/v1/ai-proxy'
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function callEdgeFunction(provider: 'gemini' | 'nim', prompt: string, imageBase64?: string, mimeType?: string): Promise<string> {
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      provider,
      prompt,
      imageBase64,
      mimeType,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Edge function error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  
  if (data.error) {
    throw new Error(data.error)
  }
  
  return data.result
}

export async function parseVoiceWithAI(
  transcript: string,
  categories: Category[],
): Promise<ParsedTransaction> {
  const prompt = AI_PARSER_PROMPT
    .replace('{categories}', buildCategoryList(categories))
    .replace('{currentDate}', new Date().toISOString().split('T')[0])
    .replace('{transcript}', transcript)

  console.log('[AI Parser] Calling Edge Function (Gemini) for voice...')
  const response = await callEdgeFunction('gemini', prompt)
  console.log('[AI Parser] Raw response:', response)

  try {
    const parsed = JSON.parse(response)
    console.log('[AI Parser] Parsed voice:', parsed)
    return {
      amount: parsed.amount ?? null,
      date: parsed.date ?? new Date().toISOString().split('T')[0],
      merchant: parsed.merchant ?? '',
      description: parsed.description ?? '',
      suggestedCategoryId: parsed.suggestedCategoryId ?? null,
      suggestedType: parsed.suggestedType ?? 'expense',
      location: parsed.location ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
    }
  } catch (error) {
    console.error('[AI Parser] Failed to parse response:', error, 'Response:', response)
    throw new Error('AI voice parsing failed')
  }
}

export async function parseReceiptWithAI(
  imageBase64: string,
  categories: Category[],
  mimeType: string = 'image/jpeg'
): Promise<ReceiptParsedData> {
  const prompt = RECEIPT_AI_PROMPT
    .replace('{categories}', buildCategoryList(categories))
    .replace('{currentDate}', new Date().toISOString().split('T')[0])

  // Try Google Gemini first
  let response: string
  try {
    console.log('[AI Parser] Calling Edge Function (Gemini) with image for receipt...')
    response = await callEdgeFunction('gemini', prompt, imageBase64, mimeType)
    console.log('[AI Parser] Raw Gemini response:', response)
  } catch (geminiError) {
    console.warn('[AI Parser] Gemini failed, trying NIM fallback:', geminiError)
    
    // Fallback to NVIDIA NIM via Edge Function
    console.log('[AI Parser] Calling Edge Function (NIM) with image for receipt...')
    response = await callEdgeFunction('nim', prompt, imageBase64)
    console.log('[AI Parser] Raw NIM response:', response)
  }

  try {
    const parsed = JSON.parse(response)
    console.log('[AI Parser] Parsed receipt:', parsed)
    return {
      merchant: parsed.merchant ?? null,
      total: parsed.total ?? null,
      date: parsed.date ?? null,
      suggestedType: parsed.suggestedType ?? 'expense',
      suggestedCategoryId: parsed.suggestedCategoryId ?? null,
      description: parsed.description ?? null,
      notes: parsed.notes ?? null,
      location: parsed.location ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
    }
  } catch (error) {
    console.error('[AI Parser] Failed to parse AI response:', error, 'Response:', response)
    throw new Error('AI receipt parsing failed')
  }
}

export function isAIAvailable(): boolean {
  return !!import.meta.env.VITE_SUPABASE_ANON_KEY
}

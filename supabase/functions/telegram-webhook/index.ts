import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
}
const AI_PROXY_URL = Deno.env.get('AI_PROXY_URL') || 'https://lyhemujxjphuyohyckvw.supabase.co/functions/v1/ai-proxy'
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from: {
      id: number
      is_bot: boolean
      first_name: string
      username?: string
    }
    chat: {
      id: number
      type: string
    }
    date: number
    text?: string
  }
  callback_query?: {
    id: string
    from: {
      id: number
      is_bot: boolean
      first_name: string
      username?: string
    }
    message?: {
      message_id: number
      from: {
        id: number
        is_bot: boolean
        first_name: string
        username?: string
      }
      chat: {
        id: number
        type: string
      }
      date: number
      text?: string
    }
    data?: string
  }
}

async function sendMessage(chatId: number, text: string, parseMode?: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  const body: any = { chat_id: chatId, text }
  if (parseMode) body.parse_mode = parseMode
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return response.json()
}

async function callAIProxy(prompt: string, provider: 'gemini' | 'nim' = 'gemini'): Promise<string> {
  if (!ANON_KEY) {
    throw new Error('SUPABASE_ANON_KEY not configured')
  }
  
  const response = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({
      provider,
      prompt: prompt + '\n\nIMPORTANT: Return ONLY the response text. No JSON, no markdown, no extra formatting.',
      temperature: 0.7,
      max_tokens: 1000,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI Proxy error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  if (data.error) {
    throw new Error(data.error)
  }
  
  return data.result
}

function getSystemPrompt(): string {
  return `Anda adalah "Si Paling Teknikal", asisten keuangan pribadi yang ahli analisis teknikal pasar saham & crypto Indonesia. 

Karakter:
- Nama: Si Paling Teknikal
- Gaya: Teknis, berbasis data, singkat, pakai istilah trading (EMA, RSI, MACD, volume, support/resistance, trend)
- Bahasa: Indonesia casual tapi profesional
- Fokus: Analisis teknikal US stock market & crypto

Aturan:
1. Jawab singkat (2-4 kalimat max)
2. Gunakan istilah teknikal: EMA 9/21, RSI, MACD, volume, breakout, pullback, support/resistance
3. Jangan beri nasihat keuangan (disclaimer implisit)
4. Bisa bantu analisis chart, setup trade, screening ide
5. Kalau user nanya fundamental/berita -> arahkan ke "Si Paling Fundamental"
6. Kalau user nanya FOMO/emosi -> arahkan ke "Si Paling FOMO"
7. Kalau user cuma ngobrol santai -> jawab santai tapi tetap teknikal

Contoh gaya:
- "BTC di daily EMA 21 ngas support, RSI 45 - masih bullish structure. Watch 98k breakout."
- "AAPL pullback ke EMA 9 daily, volume kering. Kalau hold 220 bisa lanjut trend naik."
- "Gak usah FOMO, tunggu confirmasi breakout volume dulu. Setup belum jelas."`
}

async function handleNaturalChat(chatId: number, userMessage: string) {
  try {
    await sendMessage(chatId, "🤔 *Si Paling Teknikal sedang menganalisis...*", "Markdown")
    
    const systemPrompt = getSystemPrompt()
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}\n\nSi Paling Teknikal:`
    
    const aiResponse = await callAIProxy(fullPrompt, 'gemini')
    
    await sendMessage(chatId, aiResponse, "Markdown")
  } catch (error) {
    console.error('AI chat error:', error)
    await sendMessage(chatId, "❌ Gagal memproses chat. Coba lagi nanti atau gunakan /help untuk perintah.")
  }
}

async function handleUpdate(update: TelegramUpdate) {
  if (update.message) {
    const chatId = update.message.chat.id
    const text = update.message.text || ''
    
    // Handle commands
    if (text.startsWith('/start')) {
      await sendMessage(chatId, "🤖 *Si Paling Teknikal* aktif!\n\nKamu bisa:\n• Chat natural: tanya analisis teknikal apa aja\n• /help - Lihat perintah\n• /status - Cek status bot\n• /price [symbol] - Cek harga crypto\n\nContoh chat: \"BTC gimana nih? Masih bullish?\"", "Markdown")
    } else if (text.startsWith('/help')) {
      await sendMessage(chatId,
              "📋 *Daftar Perintah:*\n" +
              "/start - Mulai bot & lihat cara pakai\n" +
              "/help - Bantuan\n" +
              "/status - Cek status bot\n" +
              "/price [symbol] - Cek harga crypto (contoh: /price BTCUSDT)\n\n" +
              "💬 *Atau chat natural aja:*\n" +
              "• \"BTC chart gimana?\"\n• \"AAPL setup apa hari ini?\"\n• \"Screening saham tech yang bullish\"\n• \"RSI ETH overbought gak?\"",
              "Markdown"
            )
    } else if (text.startsWith('/status')) {
      await sendMessage(chatId, "✅ Bot berjalan normal\n🟢 Webhook terhubung\n⚡ AI chat aktif\n📊 Analisis teknikal siap", "Markdown")
    } else if (text.startsWith('/price')) {
      const parts = text.split(' ')
      const symbol = parts[1]?.toUpperCase() || 'BTCUSDT'
      
      try {
        const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`)
        const data = await response.json()
        if (data.price) {
          await sendMessage(chatId, `💰 *${symbol}*: $${parseFloat(data.price).toLocaleString()}`, "Markdown")
        } else {
          await sendMessage(chatId, `❌ Symbol ${symbol} tidak ditemukan`)
        }
      } catch {
        await sendMessage(chatId, "❌ Gagal mengambil harga")
      }
    } else if (text.trim() !== '') {
      // Natural language chat - route to AI
      await handleNaturalChat(chatId, text)
    }
  }
  
  if (update.callback_query) {
    const chatId = update.callback_query.message?.chat.id
    const data = update.callback_query.data
    
    if (chatId && data) {
      await sendMessage(chatId, `Callback: ${data}`)
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const update = await req.json() as TelegramUpdate
    await handleUpdate(update)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  )
})

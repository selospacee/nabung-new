import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RequestBody {
  provider: 'gemini' | 'nim'
  prompt: string
  imageBase64?: string
  mimeType?: string
  temperature?: number
  max_tokens?: number
  force_json?: boolean
}

function extractJSON(text: string): string {
  // Try to parse directly first
  try {
    JSON.parse(text)
    return text
  } catch {
    // Try to extract JSON from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    if (codeBlockMatch) {
      try {
        JSON.parse(codeBlockMatch[1])
        return codeBlockMatch[1]
      } catch {}
    }
    // Try to find the first complete JSON object
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1)
      try {
        JSON.parse(candidate)
        return candidate
      } catch {}
    }
    // Return original - will fail downstream with clear error
    return text
  }
}

async function callGemini(prompt: string, imageBase64?: string, mimeType?: string, temperature: number = 0.1, maxTokens: number = 500, forceJson: boolean = true): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`
  
  const parts: any[] = [{ text: prompt }]
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: imageBase64
      }
    })
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: forceJson ? 'application/json' : 'text/plain',
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return forceJson ? extractJSON(text) : text
}

async function callNIM(prompt: string, imageBase64?: string, temperature: number = 0.1, maxTokens: number = 500, forceJson: boolean = true): Promise<string> {
  const apiKey = Deno.env.get('NVIDIA_API_KEY')
  if (!apiKey) throw new Error('NVIDIA_API_KEY not configured')

  const messages: any = { role: 'user', content: [] }
  if (forceJson) {
    messages.content.push({ type: 'text', text: prompt + '\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no extra text, no trailing commas.' })
  } else {
    messages.content.push({ type: 'text', text: prompt })
  }
  
  if (imageBase64) {
    messages.content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
    })
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      messages: [messages],
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ''
  return forceJson ? extractJSON(text) : text
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { provider, prompt, imageBase64, mimeType, temperature = 0.1, max_tokens = 500, force_json = true } = await req.json() as RequestBody

    let result: string
    if (provider === 'gemini') {
      result = await callGemini(prompt, imageBase64, mimeType, temperature, max_tokens, force_json)
    } else if (provider === 'nim') {
      result = await callNIM(prompt, imageBase64, temperature, max_tokens, force_json)
    } else {
      throw new Error('Invalid provider')
    }

    // Final validation only if force_json
    if (force_json) {
      JSON.parse(result)
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

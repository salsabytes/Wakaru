// Poolside directly — OpenAI-compatible, fetch only (no extra deps)
import { cfg } from './config.ts'

export type ChatMsg = { role: string; content: string }

const BASE = (process.env.POOLSIDE_BASE_URL || cfg('poolsideBaseUrl', 'https://inference.poolside.ai/v1')).replace(/\/$/, '')
const MODEL = process.env.POOLSIDE_MODEL || cfg('poolsideModel', 'poolside/laguna-xs-2.1')

// Opsi 2 (clone-and-use): taruh shared Poolside API key di sini sebagai fallback.
// Ambil di https://platform.poolside.ai/ → API Keys. KOSONGKAN jika mau wajibkan user isi sendiri.
// SECURITY WARNING: Key yang di-hardcode di file ini akan terekspos di git. Siapapun bisa pakai dan menghabiskan quota/billing kamu.
// Jika repo public, pertimbangkan pakai OpenRouter :free sebagai gantinya.
const FALLBACK_KEY = 'sky_RxrZbyiA.j4ietAqQfUIp9rdXbWZg4WY9VCd52yFm'

function apiKey(): string {
  return process.env.POOLSIDE_API_KEY || cfg('poolsideApiKey', '') || cfg('POOLSIDE_API_KEY', '') || FALLBACK_KEY
}

export async function askLLM(messages: ChatMsg[]): Promise<string> {
  const key = apiKey()
  if (!key) throw new Error('POOLSIDE_API_KEY not set — isi FALLBACK_KEY di src/lib/llm.ts atau env POOLSIDE_API_KEY / config.json { "poolsideApiKey": "..." } (https://platform.poolside.ai/ → API Keys)')
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: messages
        .filter((m) => m.content?.trim())
        .map((m) => ({
          role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content.trim(),
        })),
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`poolside ${res.status} ${txt.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const out = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!out) throw new Error('poolside: empty response')
  return out
}

// kept for compat — previously parsed askgpt5 SSE; Poolside uses plain JSON
export function sseLine(_line: string, text: string): string {
  return text
}

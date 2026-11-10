import { cfg } from './config.ts'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

// File payload for AI (base64 + optional name/mime)
export type AiFileInput = { data: string; name?: string; mime?: string }
// Chat message shape; may include attached files for multimodal prompts
export type ChatMsg = { role: string; content: string; files?: AiFileInput[] }

// gpt-6 is GPT-6 on the anonymous catalog. Override with env/config.
const AI_MODEL = process.env.WAKARU_AI_MODEL || cfg('aiModel', 'gpt-6')
const TIMEOUT = 120_000

// Lazy-load Wakafy AI backend (sibling repo ../wakafy/ai-chat) as the main .ai engine
let wakafyAsk: ((input: any) => Promise<{ text?: string }>) | null = null
const getWakafyAsk = async () => {
  if (wakafyAsk) return wakafyAsk
  const modPath = join(import.meta.dirname, '..', '..', '..', 'wakafy', 'ai-chat', 'index.js')
  const mod = await import(pathToFileURL(modPath).href)
  wakafyAsk = (mod.default ?? mod) as any
  return wakafyAsk!
}

const cleanMessages = (messages: ChatMsg[]): { role: string; content: string }[] =>
  messages
    .filter((m) => m.content?.trim() || m.files?.length)
    .map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: (m.content || '').trim() || (m.files?.length ? 'Tolong analisis file ini.' : ''),
    }))

// Convert our file payloads to data URLs/objects wakafy can read
const toWakafyFiles = (files: AiFileInput[]): any[] =>
  files.map((f) => {
    const data = String(f.data || '')
    const mime = f.mime || 'application/octet-stream'
    const url = data.startsWith('data:') || /^https?:\/\//i.test(data) ? data : `data:${mime};base64,${data}`
    return { name: f.name, mime, url }
  })

// Collect files: explicit arg + any files attached to messages (current/history)
const collectFiles = (messages: ChatMsg[], files: AiFileInput[] = []): AiFileInput[] => {
  const out = [...files]
  for (const m of messages) if (m.files?.length) out.push(...m.files)
  // de-dupe by data ref loosely and cap
  const seen = new Set<string>()
  const uniq: AiFileInput[] = []
  for (const f of out) {
    const k = `${f.name || ''}|${String(f.data).slice(0, 64)}|${String(f.data).length}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(f)
  }
  return uniq.slice(0, 4)
}

async function gptChat(messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> {
  const msgs = cleanMessages(messages)
  const allFiles = collectFiles(messages, files)
  if (!msgs.length && !allFiles.length) throw new Error('gptanon: empty prompt')
  const ask = await getWakafyAsk()
  const payload: any = { messages: msgs, model: AI_MODEL }
  if (allFiles.length) payload.files = toWakafyFiles(allFiles)
  const res: any = await Promise.race([
    ask(payload),
    new Promise((_, rej) => setTimeout(() => rej(new Error('gptanon: timeout')), TIMEOUT)),
  ])
  const text = String(res?.text || '').trim()
  if (!text) throw new Error('gptanon: empty response')
  return text
}

// Transient hiccups deserve one more shot before giving up — poolside fallback stays as last resort for text-only.
const gptTransient = (msg: string): boolean =>
  /HTTP 5\d\d|429|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|Unusual activity|sentinel|conversation/i.test(msg) &&
  !/empty prompt|no such/i.test(msg)

const POOL_BASE = (process.env.POOLSIDE_BASE_URL || cfg('poolsideBaseUrl', 'https://inference.poolside.ai/v1')).replace(/\/$/, '')
const POOL_MODEL = process.env.POOLSIDE_MODEL || cfg('poolsideModel', 'poolside/laguna-s-2.1')
const FALLBACK_KEY = 'sky_RxrZbyiA.j4ietAqQfUIp9rdXbWZg4WY9VCd52yFm'

const poolKey = (): string =>
  process.env.POOLSIDE_API_KEY || cfg('poolsideApiKey', '') || cfg('POOLSIDE_API_KEY', '') || FALLBACK_KEY

async function poolChat(messages: ChatMsg[]): Promise<string> {
  const res = await fetch(`${POOL_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${poolKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: POOL_MODEL,
      messages: cleanMessages(messages),
    }),
    signal: AbortSignal.timeout(TIMEOUT),
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

// Main entry: try wakafy/ai-chat (anon backend), retry once on hiccup, then Poolside for text-only.
// Note: file-based prompts skip Poolside fallback (it doesn't support our file payload).
export async function askLLM(messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> {
  const hasFiles = collectFiles(messages, files).length > 0
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await gptChat(messages, files)
    } catch (e) {
      lastErr = e
      const msg = (e as Error).message
      if (attempt === 0 && gptTransient(msg)) {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
      break
    }
  }
  if (!poolKey() || hasFiles) throw lastErr
  return await poolChat(messages)
}

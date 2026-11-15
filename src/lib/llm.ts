import { cfg } from './config.ts'
import { wakafy } from './wakafy.ts'

// File payload for AI (base64 + optional name/mime)
export type AiFileInput = { data: string; name?: string; mime?: string }
// Chat message shape; may include attached files for multimodal prompts
export type ChatMsg = { role: string; content: string; files?: AiFileInput[] }

// GPT-6 through the public Wakafy AI plugin (same API/key as the downloaders).
// No sibling repo needed — override the endpoint with WAKAFY_AI_PATH.
const AI_PATH = process.env.WAKAFY_AI_PATH || '/v1/ext/salsabytes/gpt-6'
// gpt-6 is GPT-6 on the anonymous catalog. Override with env/config.
const AI_MODEL = process.env.WAKARU_AI_MODEL || cfg('aiModel', 'gpt-6')
const TIMEOUT = 120_000
// The public ext endpoint rejects request bodies over 256 KB; keep a margin.
const API_BODY_MAX = 250_000

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

// Collect files oldest-first (history, then this request) so a size trim drops
// old media before the photo the user just sent. De-duped and capped at 4.
const collectFiles = (messages: ChatMsg[], files: AiFileInput[] = []): AiFileInput[] => {
  const out: AiFileInput[] = []
  for (const m of messages) if (m.files?.length) out.push(...m.files)
  out.push(...files)
  const seen = new Set<string>()
  const uniq: AiFileInput[] = []
  for (const f of out) {
    const k = `${f.name || ''}|${String(f.data).slice(0, 64)}|${String(f.data).length}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(f)
  }
  return uniq.slice(-4)
}

async function gptChat(messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> {
  const msgs = cleanMessages(messages)
  if (!msgs.length) throw new Error('ai: empty prompt')
  let allFiles = collectFiles(messages, files)
  const payload: any = { messages: msgs, model: AI_MODEL }
  if (allFiles.length) payload.files = toWakafyFiles(allFiles)
  // Drop the oldest attachments first until the request fits the API limit.
  let dropped = 0
  while (allFiles.length && Buffer.byteLength(JSON.stringify(payload)) > API_BODY_MAX) {
    allFiles = allFiles.slice(1)
    dropped++
    if (allFiles.length) payload.files = toWakafyFiles(allFiles)
    else delete payload.files
  }
  if (dropped) {
    const last = payload.messages[payload.messages.length - 1]
    if (last?.role === 'user') last.content += `\n\n[${dropped} lampiran tidak terkirim: melebihi batas ukuran API]`
  }
  if (Buffer.byteLength(JSON.stringify(payload)) > API_BODY_MAX) {
    throw new Error('ai: pesan/lampiran kegedean buat API (maks ~250KB)')
  }
  const res = await wakafy.jsonPost<{ text?: string }>(AI_PATH, payload, { timeout: TIMEOUT })
  const text = String(res?.text || '').trim()
  if (!text) throw new Error('ai: empty response')
  return text
}

// Transient hiccups deserve one more shot before giving up.
const gptTransient = (msg: string): boolean =>
  /HTTP 5\d\d|429|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|Unusual activity|sentinel|conversation/i.test(msg) &&
  !/empty prompt|no such/i.test(msg)

// Main entry: the Wakafy API only. No silent switch to a different/free model —
// if GPT is down the real error is surfaced instead.
export async function askLLM(messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await gptChat(messages, files)
    } catch (e) {
      lastErr = e
      if (attempt === 0 && gptTransient((e as Error).message)) {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
      break
    }
  }
  throw lastErr
}

import { cfg } from './config.ts'
import { wakafy } from './wakafy.ts'

// One file for the AI: base64 data, plus name/mime when we know them.
export type AiFileInput = { data: string; name?: string; mime?: string }
// One chat message. `files` only when we attach media.
export type ChatMsg = { role: string; content: string; files?: AiFileInput[] }

// GPT-6 via the public Wakafy AI plugin.
// Same API key as the downloaders. Override the path with WAKAFY_AI_PATH.
const AI_PATH = process.env.WAKAFY_AI_PATH || '/v1/ext/salsabytes/gpt-6'
// gpt-6 is GPT-6 on the anonymous catalog. Override with env/config.
const AI_MODEL = process.env.WAKARU_AI_MODEL || cfg('aiModel', 'gpt-6')
const TIMEOUT = 120_000
// The endpoint rejects bodies over 256 KB. Stay a little under.
const API_BODY_MAX = 250_000

// The endpoint rejects messages over 32k chars total.
// Budget under it: keep the system prompt and the newest turn, drop old ones.
const MESSAGES_CHAR_MAX = 28_000
const MSG_CLIP = 12_000 // per-message cap before we start dropping turns

export type FlatMsg = { role: string; content: string }

// Keep both ends of a long message.
// Start = the instructions. End = the tool output the model must act on.
const clipMiddle = (content: string, keep: number): string => {
  if (content.length <= keep) return content
  const head = Math.round(keep * 0.75)
  const tail = keep - head
  return `${content.slice(0, head)}\n\n[... ${content.length - keep} karakter dipotong karena batas ukuran pesan ...]\n\n${content.slice(-tail)}`
}

/** Trim a conversation until it fits the API's total characters limit. */
export const fitMessages = (messages: FlatMsg[], max = MESSAGES_CHAR_MAX): FlatMsg[] => {
  const total = (list: FlatMsg[]): number => list.reduce((n, m) => n + m.content.length, 0)
  if (total(messages) <= max) return messages
  // 1) clip any single message that is too long
  let out = messages.map((m) => (m.content.length > MSG_CLIP ? { ...m, content: clipMiddle(m.content, MSG_CLIP) } : m))
  // 2) drop the oldest turns. Never the system prompt. Never the newest message.
  while (total(out) > max && out.length > 2) {
    const start = out[0]?.role === 'system' ? 1 : 0
    if (out.length - start <= 1) break
    out = [...out.slice(0, start), ...out.slice(start + 1)]
  }
  // 3) still too big? shrink the biggest message until it fits.
  while (total(out) > max && out.length) {
    const biggest = out.reduce((a, b) => (b.content.length > a.content.length ? b : a))
    const target = Math.max(500, biggest.content.length - Math.ceil((total(out) - max) / 2))
    const next = clipMiddle(biggest.content, target)
    if (next === biggest.content) break
    out = out.map((m) => (m === biggest ? { ...m, content: next } : m))
  }
  return out
}

const cleanMessages = (messages: ChatMsg[]): FlatMsg[] =>
  messages
    .filter((m) => m.content?.trim() || m.files?.length)
    .map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: (m.content || '').trim() || (m.files?.length ? 'Tolong analisis file ini.' : ''),
    }))

// Turn our file payloads into what wakafy can read (data URL or plain object).
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
  const msgs = fitMessages(cleanMessages(messages))
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

// Blips get one retry before we give up.
const gptTransient = (msg: string): boolean =>
  /HTTP 5\d\d|429|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|Unusual activity|sentinel|conversation/i.test(msg) &&
  !/empty prompt|no such/i.test(msg)

// Main entry. One backend only: the Wakafy API.
// If GPT is down we surface the real error. No silent model swap.
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

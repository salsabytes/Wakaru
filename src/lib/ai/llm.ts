import { wakafy, type WakafyStreamEvent } from '../api/wakafy.ts'
import { botAiApiKey, botAiBaseUrl, botAiModel, botAiPath, botAiProvider } from './aiConfig.ts'

// One file for the AI: base64 data, plus name/mime when we know them.
export type AiFileInput = { data: string; name?: string; mime?: string }
// One chat message. `files` only when we attach media.
export type ChatMsg = { role: string; content: string; files?: AiFileInput[] }
export type FlatMsg = { role: string; content: string }

// --- provider abstraction (groundwork, behavior-preserving default: wakafy) ---
export interface LLMProvider {
  name: string
  ask(messages: ChatMsg[], files?: AiFileInput[], onDelta?: (full: string) => void, signal?: AbortSignal): Promise<string>
}

const TIMEOUT = 120_000
const API_BODY_MAX = 250_000
const MESSAGES_CHAR_MAX = 28_000
const MSG_CLIP = 12_000

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
  let out = messages.map((m) => (m.content.length > MSG_CLIP ? { ...m, content: clipMiddle(m.content, MSG_CLIP) } : m))
  while (total(out) > max && out.length > 2) {
    const start = out[0]?.role === 'system' ? 1 : 0
    if (out.length - start <= 1) break
    out = [...out.slice(0, start), ...out.slice(start + 1)]
  }
  while (total(out) > max && out.length) {
    const biggest = out.reduce((a, b) => (b.content.length > a.content.length ? b : a))
    const target = Math.max(500, biggest.content.length - Math.ceil((total(out) - max) / 2))
    const next = clipMiddle(biggest.content, target)
    if (next === biggest.content) break
    out = out.map((m) => (m === biggest ? { ...m, content: next } : m))
  }
  return out
}

// Deadline for one call must win over the 120s default and stay cancellable, or a
// caller-side race leaves the request alive and it keeps occupying the backend.
const callSignal = (timeout: number, signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)

const cleanMessages = (messages: ChatMsg[]): FlatMsg[] =>
  messages
    .filter((m) => m.content?.trim() || m.files?.length)
    .map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: (m.content || '').trim() || (m.files?.length ? 'Tolong analisis file ini.' : ''),
    }))

const toWakafyFiles = (files: AiFileInput[]): any[] =>
  files.map((f) => {
    const data = String(f.data || '')
    const mime = f.mime || 'application/octet-stream'
    const url = data.startsWith('data:') || /^https?:\/\//i.test(data) ? data : `data:${mime};base64,${data}`
    return { name: f.name, mime, url }
  })

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

const toDataUrl = (f: AiFileInput): string => {
  const data = String(f.data || '')
  if (data.startsWith('data:') || /^https?:\/\//i.test(data)) return data
  return `data:${f.mime || 'application/octet-stream'};base64,${data}`
}

// The upstream model emits a private ":::writing" directive + private-use
// markers before the real answer. Strip them from the live preview.
const cleanPreview = (s: string): string => {
  let out = String(s).replace(/\ue200[\s\S]*?\ue201/g, '')
  out = out
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return t !== ':::' && !t.startsWith(':::writing')
    })
    .join('\n')
  return [...out].filter((ch) => {
    const c = ch.codePointAt(0) ?? 0
    return c < 0xe000 || c > 0xf8ff
  }).join('').trimStart()
}

const wakafyProvider: LLMProvider = {
  name: 'wakafy',
  async ask(messages, files = [], onDelta, signal) {
    const AI_PATH = botAiPath() || '/v1/ext/salsabytes/gpt-6'
    const AI_MODEL = botAiModel() || 'gpt-6'
    const msgs = fitMessages(cleanMessages(messages))
    if (!msgs.length) throw new Error('ai: empty prompt')
    let allFiles = collectFiles(messages, files)
    const payload: any = { messages: msgs, model: AI_MODEL }
    if (allFiles.length) payload.files = toWakafyFiles(allFiles)
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
    if (!onDelta) {
      const res = await wakafy.jsonPost<{ text?: string }>(AI_PATH, payload, { timeout: TIMEOUT, signal })
      const text = String(res?.text || '').trim()
      if (!text) throw new Error('ai: empty response')
      return text
    }
    payload.live = true
    let acc = ''
    const emit = (ev: WakafyStreamEvent): void => {
      if (typeof ev.reset === 'string') acc = ev.reset
      else if (typeof ev.delta === 'string') acc += ev.delta
      if (ev.done && typeof ev.text === 'string') acc = ev.text
      if (ev.delta !== undefined || ev.reset !== undefined || ev.done) onDelta(cleanPreview(acc))
    }
    const res = await wakafy.streamPost(AI_PATH, payload, { timeout: TIMEOUT, onEvent: emit, signal })
    const text = String(res?.text || '').trim()
    if (!text) throw new Error('ai: empty response')
    return text
  },
}

// Optional OpenAI-compatible chat completions backend (groundwork).
const openaiCompatProvider: LLMProvider = {
  name: 'openai-compatible',
  async ask(messages, files = [], _onDelta, signal) {
    const baseUrl = botAiBaseUrl().replace(/\/+$/, '')
    if (!baseUrl) throw new Error('ai: missing aiBaseUrl/WAKARU_AI_BASE_URL for openai-compatible provider')
    const model = botAiModel() || 'gpt-4o-mini'
    const apiKey = botAiApiKey()
    const allFiles = collectFiles(messages, files)
    const msgs = fitMessages(cleanMessages(messages)).map((m, i, arr) => {
      if (m.role === 'user' && i === arr.length - 1 && allFiles.length) {
        const parts: any[] = [{ type: 'text', text: m.content }]
        for (const f of allFiles) parts.push({ type: 'image_url', image_url: { url: toDataUrl(f) } })
        return { role: 'user', content: parts }
      }
      return { role: m.role, content: m.content }
    })
    if (!msgs.length) throw new Error('ai: empty prompt')
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages: msgs }),
      signal: callSignal(TIMEOUT, signal),
    })
    if (!res.ok) throw new Error(`ai: HTTP ${res.status}`)
    const data = await res.json().catch(() => ({})) as any
    const c = data?.choices?.[0]?.message?.content
    const text = (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x?.text || '').join('') : '').trim()
    if (!text) throw new Error('ai: empty response')
    return text
  },
}

export const getProvider = (): LLMProvider =>
  botAiProvider() === 'openai-compatible' ? openaiCompatProvider : wakafyProvider

const transient = (msg: string): boolean =>
  /HTTP 5\d\d|http 5\d\d|429|502|503|504|gateway|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|Unusual activity|sentinel|conversation|empty response|plugin error/i.test(msg) &&
  !/empty prompt|no such/i.test(msg)

const RETRIES = 3

export async function askLLM(
  messages: ChatMsg[],
  files: AiFileInput[] = [],
  onDelta?: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const provider = getProvider()
  let lastErr: unknown
  let emitted = false
  const stream = onDelta
    ? (full: string): void => {
        emitted = true
        onDelta(full)
      }
    : undefined
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await provider.ask(messages, files, stream, signal)
    } catch (e) {
      lastErr = e
      // caller gave up on this call: retrying would just burn another slot
      if (signal?.aborted) break
      if (attempt < RETRIES - 1 && !emitted && transient((e as Error).message)) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      break
    }
  }
  throw lastErr
}

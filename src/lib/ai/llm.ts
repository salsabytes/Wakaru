import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { wakafy, type WakafyStreamEvent } from '../api/wakafy.ts'
import { botAiApiKey, botAiBaseUrl, botAiModel, botAiPath, botAiProvider } from './aiConfig.ts'

const exec = promisify(execFile)

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

// The ext endpoint rejects any body over 256 KiB ("POST body must be a JSON
// object" — a body-read error, not a validation message). Base64 inflates
// bytes by 4/3, so the raw photo budget is much smaller than the body budget.
const IMAGE_B64_MAX = 180_000 // per-image ceiling, in base64 chars (~135 KB raw)
const IMAGE_B64_MIN = 24_000 // below this a photo is unreadable, so drop it instead

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

// Images are the one media type the model can actually read, so shrinking them
// beats dropping them. Everything else (pdf/audio/video) has no local resizer
// and falls through to the size-dropping path below.
const IMAGE_MIME = /^image\/(jpeg|jpg|png|webp)$/i
const SIDECAR = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

// The agent loop re-sends the same messages every round, so a shrunk photo would
// be re-encoded up to MAX_ROUNDS times. Cache by content prefix (Map + FIFO, no
// timers) — same photo, same budget, same output.
const shrinkCache = new Map<string, AiFileInput | undefined>()
const SHRINK_CACHE_MAX = 16

// `b64Budget` is in base64 characters (what the JSON body carries); the sidecar
// measures the raw JPEG, so convert down before handing it the limit.
const shrinkImage = async (f: AiFileInput, b64Budget: number): Promise<AiFileInput | undefined> => {
  if (!IMAGE_MIME.test(String(f.mime || '')) || !existsSync(SIDECAR)) return undefined
  const src = String(f.data || '')
  const base64 = src.startsWith('data:') ? src.slice(src.indexOf(',') + 1) : src
  if (!base64 || /^https?:\/\//i.test(base64)) return undefined
  const raw = Buffer.from(base64, 'base64')
  if (!raw.length) return undefined
  const cacheKey = `${b64Budget}|${base64.length}|${base64.slice(0, 64)}`
  if (shrinkCache.has(cacheKey)) return shrinkCache.get(cacheKey)
  const rawBudget = Math.max(1, Math.floor((b64Budget * 3) / 4) - 1_024)
  let out: AiFileInput | undefined
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-ai-img-'))
  try {
    const input = join(dir, 'in.bin')
    const output = join(dir, 'out.jpg')
    await writeFile(input, raw)
    await exec(SIDECAR, ['fit', input, output, String(rawBudget)], { timeout: 30_000 })
    const buf = await readFile(output)
    if (buf.length) {
      out = { data: buf.toString('base64'), mime: 'image/jpeg', name: String(f.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' }
    }
  } catch {
    out = undefined
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  if (shrinkCache.size >= SHRINK_CACHE_MAX) shrinkCache.delete(shrinkCache.keys().next().value!)
  shrinkCache.set(cacheKey, out)
  return out
}

// Keep every image that can be squeezed into its share of the body budget.
// Anything with no local resizer (pdf/audio/video) is dropped instead, which is
// what the old code did for everything.
export const fitFiles = async (files: AiFileInput[], bodyRoom: number): Promise<{ files: AiFileInput[]; dropped: number }> => {
  if (!files.length) return { files, dropped: 0 }
  const perFile = Math.min(IMAGE_B64_MAX, Math.max(IMAGE_B64_MIN, Math.floor(bodyRoom / files.length)))
  const out: AiFileInput[] = []
  let dropped = 0
  for (const f of files) {
    const data = String(f.data || '')
    if (Buffer.byteLength(data) <= perFile) {
      out.push(f)
      continue
    }
    const shrunk = await shrinkImage(f, perFile)
    if (shrunk && Buffer.byteLength(shrunk.data) <= perFile) out.push(shrunk)
    else dropped++
  }
  return { files: out, dropped }
}

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
    const payload: any = { messages: msgs, model: AI_MODEL }
    // Give images whatever body room the prompt leaves, so a normal phone photo
    // gets shrunk instead of silently dropped. The loop below is only a backstop.
    const room = API_BODY_MAX - Buffer.byteLength(JSON.stringify(payload)) - 2_000
    const fitted = await fitFiles(collectFiles(messages, files), room)
    let allFiles = fitted.files
    let dropped = fitted.dropped
    if (allFiles.length) payload.files = toWakafyFiles(allFiles)
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

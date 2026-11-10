import { cfg } from './config.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

// File payload for AI (base64 + optional name/mime)
export type AiFileInput = { data: string; name?: string; mime?: string }
// Chat message shape; may include attached files for multimodal prompts
export type ChatMsg = { role: string; content: string; files?: AiFileInput[] }

const ROOT = join(import.meta.dirname, '..', '..')
const GPT_SIDECAR = join(ROOT, 'native', 'ai', 'chatgpt-anon.py')
// gpt-6 is GPT-6 on the anonymous catalog. Override with env/config.
const AI_MODEL = process.env.WAKARU_AI_MODEL || cfg('aiModel', 'gpt-6')
const TIMEOUT = 120_000

const cleanMessages = (messages: ChatMsg[]): ChatMsg[] =>
  messages
    .filter((m) => m.content?.trim() || m.files?.length)
    .map((m) => ({
      role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
      content: (m.content || '').trim() || (m.files?.length ? 'Tolong analisis file ini.' : ''),
      ...(m.files?.length ? { files: m.files } : {}),
    }))

// --- Persistent Python sidecar (daemon) ---
// Reuses one process/token for speed; falls back to one-shot if it dies.
type Pending = { resolve: (s: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

let daemon: ChildProcess | null = null
let buffer = ''
let seq = 0
const pending = new Map<number, Pending>()

const failAll = (err: Error): void => {
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(err)
  }
  pending.clear()
  buffer = ''
  daemon = null
}

const startDaemon = (): ChildProcess => {
  const child = spawn('python3', [GPT_SIDECAR, '--serve'], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout!.setEncoding('utf8')
  child.stderr!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      let msg: { id?: number; text?: string; error?: string }
      try {
        msg = JSON.parse(line) as typeof msg
      } catch {
        continue
      }
      const p = pending.get(Number(msg.id))
      if (!p) continue
      pending.delete(Number(msg.id))
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(`gptanon: ${msg.error}`))
      else p.resolve(String(msg.text ?? ''))
    }
  })
  // drain stderr so a chatty child never blocks on a full pipe
  child.stderr!.on('data', () => {})
  child.on('error', (err) => {
    if (daemon === child) failAll(new Error(`gptanon: spawn ${err.message.slice(0, 200)}`))
  })
  child.on('close', (code) => {
    if (daemon === child) failAll(new Error(`gptanon: daemon exit ${code ?? '?'}`))
  })
  daemon = child
  return child
}

const gptDaemon = (messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> => {
  const child = daemon ?? startDaemon()
  const id = ++seq
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('gptanon: timeout'))
    }, TIMEOUT)
    pending.set(id, { resolve, reject, timer })
    const payload = JSON.stringify({ id, messages, model: AI_MODEL, files }) + '\n'
    try {
      child.stdin!.write(payload, (err) => {
        if (!err) return
        pending.delete(id)
        clearTimeout(timer)
        reject(new Error(`gptanon: stdin ${err.message.slice(0, 200)}`))
      })
    } catch (err) {
      pending.delete(id)
      clearTimeout(timer)
      reject(new Error(`gptanon: stdin ${(err as Error).message.slice(0, 200)}`))
    }
  })
}

// last-resort one-shot (daemon unavailable / crashed)
const gptOnce = (messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> => {
  const payload = JSON.stringify({ messages, model: AI_MODEL, files })
  return new Promise<string>((resolve, reject) => {
    const child = spawn('python3', [GPT_SIDECAR], { timeout: TIMEOUT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (err) => reject(new Error(`gptanon: spawn ${err.message.slice(0, 200)}`)))
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`gptanon: exit ${code} — ${stderr.trim().slice(0, 300) || 'no stderr'}`))
      else resolve(stdout)
    })
    child.stdin.end(payload)
  })
}

const daemonDead = (msg: string): boolean => /daemon exit|spawn|stdin/i.test(msg)

async function gptChat(messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> {
  const msgs = cleanMessages(messages)
  if (!msgs.length && !files.length) throw new Error('gptanon: empty prompt')
  try {
    const text = (await gptDaemon(msgs, files)).trim()
    if (!text) throw new Error('gptanon: empty response')
    return text
  } catch (err) {
    const msg = (err as Error).message
    if (!daemonDead(msg)) throw err
    try {
      daemon?.kill()
    } catch {
      // already gone
    }
    failAll(new Error(msg))
    const text = (await gptOnce(msgs, files)).trim()
    if (!text) throw new Error('gptanon: empty response')
    return text
  }
}

process.once('exit', () => {
  try {
    daemon?.kill()
  } catch {
    // already gone
  }
})

// Transient hiccups (edge wobble, backend 5xx, timeouts) deserve one more
// shot before giving up — the poolside fallback stays as last resort.
// Structural errors (our bug, changed page format) skip straight to fallback.
const gptTransient = (msg: string): boolean =>
  /HTTP 5\d\d|429|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|Unusual activity|daemon exit|spawn/i.test(msg) &&
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

// Main entry: try local sidecar (with small retry), then Poolside fallback.
// Note: file-based prompts skip Poolside fallback (it doesn't support our file payload).
export async function askLLM(messages: ChatMsg[], files: AiFileInput[] = []): Promise<string> {
  const hasFiles = files.length > 0 || messages.some((m) => (m.files?.length ?? 0) > 0)
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await gptChat(messages, files)
    } catch (e) {
      lastErr = e
      const msg = (e as Error).message
      // one more shot for hiccups (500ms breather to dodge rate limits),
      // structural errors drop straight to fallback
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

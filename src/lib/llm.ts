import { cfg } from './config.ts'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export type ChatMsg = { role: string; content: string }

// Flatten the exchange into one prompt — the anon backend has no memory,
// history lives on our side and rides along as plain text.
const flatten = (messages: ChatMsg[]): string =>
  messages
    .map((m) => {
      const body = m.content.trim()
      if (!body) return ''
      const role = m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user'
      return `${role}: ${body}`
    })
    .filter(Boolean)
    .join('\n\n')

const ROOT = join(import.meta.dirname, '..', '..')
const GPT_SIDECAR = join(ROOT, 'native', 'ai', 'chatgpt-anon.py')

// Primary backend: anonymous chatgpt.com via the python sidecar.
// Prompt goes in through stdin so long chats never hit argv limits.
async function gptChat(messages: ChatMsg[]): Promise<string> {
  const prompt = flatten(messages)
  if (!prompt) throw new Error('gptanon: empty prompt')
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn('python3', [GPT_SIDECAR], { timeout: 70_000 })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += String(d) })
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => reject(new Error(`gptanon: spawn ${err.message.slice(0, 200)}`)))
    child.on('close', (code) => {
      // exit 10 = our bug (empty prompt), 11-12 = edge/landing, 13-16 = backend stages
      if (code !== 0) reject(new Error(`gptanon: exit ${code} — ${stderr.trim().slice(0, 300) || 'no stderr'}`))
      else resolve(stdout)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
  const text = out.trim()
  if (!text) throw new Error('gptanon: exit 0 empty response')
  return text
}

// Transient hiccups (edge wobble, backend 5xx, timeouts) deserve one more
// shot before giving up — the poolside fallback stays as last resort.
// Structural errors (our bug, changed page format) skip straight to fallback.
const gptTransient = (msg: string): boolean =>
  /exit 1[1-7]|HTTP 5\d\d|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|conduit|Unusual activity|429/i.test(msg) &&
  !/empty prompt|no data-build/.test(msg)

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

// Chain: sidecar first (one retry for hiccups), poolside pool last.
export async function askLLM(messages: ChatMsg[]): Promise<string> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await gptChat(messages)
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
  if (!poolKey()) throw lastErr
  return await poolChat(messages)
}

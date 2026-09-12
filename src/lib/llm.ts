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
    const child = spawn('python3', [GPT_SIDECAR], { timeout: 180_000 })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += String(d) })
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => reject(new Error(`gptanon: ${err.message.slice(0, 200)}`)))
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`gptanon: ${stderr.trim().slice(0, 200) || `exit ${code}`}`))
      else resolve(stdout)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
  const text = out.trim()
  if (!text) throw new Error('gptanon: empty response')
  return text
}

const ASK_API = 'https://loadbalancer.askgpt5.app/api'
const ASK_UA = 'okhttp/4.10.0'
const ASK_MODEL = 'qwen3.5-397b-a17b'

const randHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('')

const askAuth = (token: string) => ({ authorization: `bearer ${token}` })

async function newGuest(): Promise<{ token: string; chatId: string }> {
  const salt = randHex(4)
  const reg = await fetch(`${ASK_API}/auth/register`, {
    method: 'POST',
    headers: { 'User-Agent': ASK_UA, 'Content-Type': 'application/json', newversion: 'true' },
    body: JSON.stringify({ email: `guest${salt}@mail.com`, password: `Pwd${salt}A1!`, name: `Guest${salt}` }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!reg.ok) throw new Error(`askgpt5 register HTTP ${reg.status}`)
  const data = (await reg.json()) as Record<string, any>
  const token = data?.access_token || data?.token || data?.data?.token || data?.result?.token || ''
  if (!token) throw new Error(`askgpt5: no token in register response`)
  const room = await fetch(`${ASK_API}/chats/`, {
    method: 'POST',
    headers: { 'User-Agent': ASK_UA, ...askAuth(token), 'Content-Type': 'application/json', newversion: 'true' },
    body: JSON.stringify({ title: 'New Chat' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!room.ok) throw new Error(`askgpt5 room HTTP ${room.status}`)
  const roomData = (await room.json()) as Record<string, any>
  const chatId = String(roomData?.id || roomData?.chat_id || '')
  if (!chatId) throw new Error('askgpt5: no room id')
  return { token, chatId }
}

async function askStream(token: string, chatId: string, prompt: string): Promise<string> {
  const res = await fetch(`${ASK_API}/chats/${chatId}/messages/stream`, {
    method: 'POST',
    headers: {
      'User-Agent': ASK_UA,
      ...askAuth(token),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'cache-control': 'no-cache',
      newversion: 'true',
    },
    body: JSON.stringify({
      content: prompt,
      client_message_id: randHex(5),
      web_search: true,
      model: ASK_MODEL,
      persona: { name: 'User', role: '', info: '', tags: ['friendly'], personality: 'default' },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`askgpt5 stream HTTP ${res.status}`)
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buffer = ''
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += dec.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) text = sseLine(line, text)
  }
  text = sseLine(buffer, text)
  const out = text.trim()
  if (!out) throw new Error('askgpt5: empty response')
  return out
}

// Second string: throwaway guest account, new identity every call.
async function askChat(messages: ChatMsg[]): Promise<string> {
  const prompt = flatten(messages)
  const attempt = async () => {
    const g = await newGuest()
    return await askStream(g.token, g.chatId, prompt)
  }
  // One retry — the first guest sometimes comes back stale.
  try {
    return await attempt()
  } catch {
    return await attempt()
  }
}

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

// Chain: sidecar first, throwaway guest next, paid-ish pool last.
export async function askLLM(messages: ChatMsg[]): Promise<string> {
  try {
    return await gptChat(messages)
  } catch {
    try {
      return await askChat(messages)
    } catch (askErr) {
      if (!poolKey()) throw askErr
      return poolChat(messages)
    }
  }
}

export function sseLine(line: string, text: string): string {
  const t = line.trim()
  if (!t.startsWith('data:')) return text
  const raw = t.slice(5).trim()
  if (!raw || raw === '[DONE]') return text
  try {
    const json = JSON.parse(raw) as { chunk?: string; full_content?: string }
    if (json.chunk) return json.full_content || text + json.chunk
  } catch {
  }
  return text
}

if (process.env.LLM_SELFTEST) {
  let text = ''
  text = sseLine('data: {"chunk":"Hel","full_content":"Hello"}', text)
  text = sseLine('data: {"chunk":"lo"}', text)
  text = sseLine('data: [DONE]', text)
  text = sseLine('data: {"chunk":" world","full_content":"Hello world"}', text)
  if (text !== 'Hello world') throw new Error(`sseLine = ${JSON.stringify(text)}`)
  console.log('llm self-check ok')
  process.exit(0)
}

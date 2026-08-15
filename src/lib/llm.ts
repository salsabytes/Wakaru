// Chat via askgpt5.app — anonymous, free, no API key, no login, no cookies.
// Inspired by @AyGemuy askgpt5.js (https://github.com/AyGemuy/api-wudysoft);
// rewritten for this bot: one flat in-process session, no base64 state juggling.
export type ChatMsg = { role: string; content: string }

const API = 'https://loadbalancer.askgpt5.app/api'
const UA = 'okhttp/4.10.0'
const MODEL = 'gpt-4o-mini' // fastest verified on askgpt5 (~6s vs ~12s); gpt-4o/deepseek-chat also work
const TTL = 24 * 60 * 60 * 1000

// one session per process — a random guest account + its chat room, valid 24h
let token = ''
let chatId = ''
let expiresAt = 0

const randHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('')

// register a fresh guest account, then open its chat room (the room id falls back to a
// fixed value the API tolerates when the response omits it)
async function ensureSession(): Promise<void> {
  if (token && Date.now() < expiresAt) return
  const salt = randHex(4)
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', newversion: 'true' },
    body: JSON.stringify({ email: `guest${salt}@mail.com`, password: `Pwd${salt}A1!`, name: `Guest${salt}` }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!reg.ok) throw new Error(`askgpt5 register HTTP ${reg.status}`)
  const data = (await reg.json()) as Record<string, any>
  token = data?.access_token || data?.token || data?.data?.token || data?.result?.token
  if (!token) throw new Error(`askgpt5: no token in register response: ${JSON.stringify(data).slice(0, 200)}`)

  const room = await fetch(`${API}/chats/`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      newversion: 'true',
    },
    body: JSON.stringify({ title: 'New Chat' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!room.ok) throw new Error(`askgpt5 room HTTP ${room.status}`)
  const roomData = (await room.json()) as Record<string, any>
  chatId = roomData?.id || roomData?.chat_id || '150903'
  expiresAt = Date.now() + TTL
}

export async function askLLM(messages: ChatMsg[]): Promise<string> {
  const prompt = messages
    .map((m) => {
      const body = m.content.trim()
      if (!body) return ''
      const role = m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user'
      return `${role}: ${body}`
    })
    .filter(Boolean)
    .join('\n\n')
  await ensureSession()
  return stream(prompt)
}

async function stream(prompt: string): Promise<string> {
  const res = await fetch(`${API}/chats/${chatId}/messages/stream`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'cache-control': 'no-cache',
      newversion: 'true',
    },
    body: JSON.stringify({
      content: prompt,
      client_message_id: randHex(5),
      web_search: true,
      model: MODEL,
      persona: { name: 'User', role: '', info: '', tags: ['friendly'], personality: 'default' },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  // anti-block: auth/rate-limit codes and empty bodies mean this guest session is toast —
  // drop it so the caller's retry registers a fresh account instead of replaying a dead token
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 429) token = ''
    throw new Error(`askgpt5 stream HTTP ${res.status}`)
  }

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
  text = sseLine(buffer, text) // last line may arrive without a trailing newline
  const out = text.trim()
  if (!out) {
    token = '' // empty stream = throttled/blocked session; retry gets a fresh one
    throw new Error('askgpt5: empty response')
  }
  return out
}

// fold one SSE "data:" line into the running text — full_content is cumulative and
// replaces, otherwise the chunk appends. Exported for the self-check.
export function sseLine(line: string, text: string): string {
  const t = line.trim()
  if (!t.startsWith('data:')) return text
  const raw = t.slice(5).trim()
  if (!raw || raw === '[DONE]') return text
  try {
    const json = JSON.parse(raw) as { chunk?: string; full_content?: string }
    if (json.chunk) return json.full_content || text + json.chunk
  } catch {
    /* broken/partial json — skip */
  }
  return text
}

if (process.env.GEMINI_SELFTEST) {
  let text = ''
  text = sseLine('data: {"chunk":"Hel","full_content":"Hello"}', text)
  text = sseLine('data: {"chunk":"lo"}', text)
  text = sseLine('data: [DONE]', text)
  text = sseLine('data: {"chunk":" world","full_content":"Hello world"}', text)
  if (text !== 'Hello world') throw new Error(`sseLine = ${JSON.stringify(text)}`)
  console.log('llm self-check ok')
  process.exit(0)
}

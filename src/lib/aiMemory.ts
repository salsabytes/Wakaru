import type { WAMessage } from 'baileys'
import { getContentType, normalizeMessageContent } from 'baileys'
import { readJson, register, saveJson } from './disk.ts'

// --- Per-user memory (summary + facts) ---
// Key: `${chat}:${sender}` same as AI history scope.

const SUMMARY_MAX = 600
const FACTS_MAX = 10
const FACT_MAX = 160

type Mem = { summary: string; facts: string[]; updatedAt: number }

const mem = new Map<string, Mem>()

const trim = (s: string, max: number): string => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

const normFact = (s: string): string => trim(s.replace(/^[-*•\d.\s]+/, ''), FACT_MAX)

const load = (): void => {
  const raw = readJson<Record<string, Mem>>('ai-memory.json', {})
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue
    const summary = typeof v.summary === 'string' ? trim(v.summary, SUMMARY_MAX) : ''
    const facts = Array.isArray(v.facts)
      ? v.facts.map((f) => normFact(String(f))).filter(Boolean).slice(-FACTS_MAX)
      : []
    mem.set(k, { summary, facts, updatedAt: Number(v.updatedAt) || Date.now() })
  }
}

load()
register('ai-memory.json', () => Object.fromEntries(mem.entries()))

export const getMemory = (key: string): Mem => mem.get(key) ?? { summary: '', facts: [], updatedAt: 0 }

export function addFacts(key: string, facts: string[]): void {
  const cur = getMemory(key)
  const set = new Set(cur.facts.map((f) => f.toLowerCase()))
  const nextFacts = [...cur.facts]
  for (const f of facts.map(normFact).filter(Boolean)) {
    const k = f.toLowerCase()
    if (set.has(k)) continue
    set.add(k)
    nextFacts.push(f)
  }
  mem.set(key, { summary: cur.summary, facts: nextFacts.slice(-FACTS_MAX), updatedAt: Date.now() })
  saveJson('ai-memory.json')
}

export function setSummary(key: string, summary: string): void {
  const cur = getMemory(key)
  mem.set(key, { summary: trim(summary, SUMMARY_MAX), facts: cur.facts, updatedAt: Date.now() })
  saveJson('ai-memory.json')
}

export function clearMemory(key: string): void {
  mem.delete(key)
  saveJson('ai-memory.json')
}

// Render memory for the system prompt (small & safe)
export function formatMemory(key: string): string {
  const m = getMemory(key)
  if (!m.summary && !m.facts.length) return ''
  const lines: string[] = []
  if (m.summary) lines.push(`summary: ${m.summary}`)
  if (m.facts.length) lines.push(`facts:\n${m.facts.map((f) => `- ${f}`).join('\n')}`)
  return lines.join('\n')
}

// --- Explicit remember/forget intents (natural language, id/en) ---
export function handleMemoryIntent(key: string, text: string): 'remembered' | 'forgot' | null {
  const t = String(text || '').trim()
  if (!t) return null

  // forget/clear
  if (/\b(lupa(?:kan)?\s+(semua\s+)?(ingatan|memori)|hapus\s+(semua\s+)?(ingatan|memori)|clear\s+(my\s+)?memory|forget\s+(everything|all|my\s+memory))\b/i.test(t)) {
    clearMemory(key)
    return 'forgot'
  }

  // remember that...
  const m = t.match(/^(?:tolong\s+)?(?:ingat(?:kan)?(?:\s+(?:ya|dong))?(?:\s+bahwa)?|remember(?:\s+that)?)\s*[:,-]?\s+(.+)$/i)
  if (m?.[1]) {
    const fact = normFact(m[1])
    if (fact) {
      addFacts(key, [fact])
      return 'remembered'
    }
  }
  return null
}

// --- Helpers for richer chat context (used by prompt) ---
const clip = (s: string, n: number): string => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

const msgBody = (msg: WAMessage): [string, any] => {
  const message = normalizeMessageContent(msg.message as any)
  const mtype = getContentType(message) ?? ''
  return [mtype, (message as any)?.[mtype] ?? {}]
}

const typeLabel = (mtype: string): string => {
  const map: Record<string, string> = {
    imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker',
    documentMessage: 'document', contactMessage: 'contact', contactsArrayMessage: 'contacts',
    locationMessage: 'location', liveLocationMessage: 'live location', pollCreationMessage: 'poll',
  }
  return map[mtype] || (mtype ? mtype.replace(/Message$/, '') : 'message')
}

// Short, text-only description of a stored message for AI context
export function describeMessage(msg: WAMessage, max = 180): string {
  const [mtype, c] = msgBody(msg)
  const text = clip(String(c?.text || c?.caption || msg.message?.conversation || ''), max)
  if (!mtype || mtype === 'conversation' || mtype === 'extendedTextMessage') return text
  const label = typeLabel(mtype)
  const name = typeof c?.fileName === 'string' ? `: ${c.fileName}` : ''
  if (text) return `[${label}${name}] ${text}`
  return `[${label}${name}]`
}
import type { ChatMsg } from './llm.ts'

// --- Async memory refresh (non-blocking, best-effort) ---
// After chats, ask the LLM to produce a short summary + durable facts.
// Runs in background so replies stay fast; throttled to avoid extra cost.

let refreshing = false
let lastRefreshAt = 0
const REFRESH_EVERY_MS = 3 * 60 * 1000 // min gap between refresh runs

const tryParse = (text: string): { summary?: string; facts?: string[] } | null => {
  // Try to extract a JSON object from the model reply
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

export function scheduleMemoryRefresh(
  key: string,
  history: ChatMsg[],
  ask: (msgs: ChatMsg[]) => Promise<string>,
): void {
  const now = Date.now()
  // Skip if busy, too soon, or not enough history to summarize
  if (refreshing || now - lastRefreshAt < REFRESH_EVERY_MS || history.length < 6) return
  refreshing = true
  lastRefreshAt = now

  void (async () => {
    try {
      const recent = history.slice(-12).map((m) => `${m.role}: ${String(m.content || '').slice(0, 400)}`).join('\n')
      const prompt: ChatMsg[] = [
        {
          role: 'system',
          content:
            'Extract durable memory about the USER from this chat. Return ONLY JSON: {"summary":"1-2 short sentences","facts":["short fact",...]}. ' +
            'Facts must be stable/useful (preferences, name, goals). No secrets, no one-off requests. Keep summary < 300 chars, max 5 facts.',
        },
        { role: 'user', content: recent },
      ]
      const out = await ask(prompt)
      const data = tryParse(out)
      if (!data) return
      if (typeof data.summary === 'string' && data.summary.trim()) setSummary(key, data.summary)
      if (Array.isArray(data.facts)) addFacts(key, data.facts.map(String))
    } catch {
      // best-effort: ignore summarization failures
    } finally {
      refreshing = false
    }
  })()
}

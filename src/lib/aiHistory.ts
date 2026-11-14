import NodeCache from '@cacheable/node-cache'
import type { AiFileInput, ChatMsg } from './llm.ts'
import { readJson, register, saveJson } from './disk.ts'

const HISTORY_MAX = 40 // keep last N messages (20 user+assistant pairs)
const HISTORY_TEXT_MAX = 24000 // rough text budget to avoid huge prompts
const HISTORY_KEEP_RECENT = 6 // newest messages kept verbatim, older code gets compacted
const CODE_FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g
export const FILE_MEMORY_MAX = 4 // max files remembered across history/pending
const SESSION_TTL = 6 * 60 * 60 * 1000 // 6h session TTL (also persisted)
const PENDING_TTL = 30 * 60 * 1000 // media kept for a later .ai question
const PENDING_MAX_KEYS = 500
export const FILE_MEMORY_MAX_BYTES = 24 * 1024 * 1024 // in-memory media budget per session

const history = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600, maxKeys: 2000 }) as {
  get(k: string): ChatMsg[] | undefined
  set(k: string, v: ChatMsg[]): boolean
  has(k: string): boolean
  keys(): string[]
}

const touched = new Map<string, number>()
// Media waiting for the next .ai prompt; memory only, bounded by TTL and caps.
type PendingFiles = { files: AiFileInput[]; at: number }
const pending = new Map<string, PendingFiles>()

const prunePending = (now = Date.now()): void => {
  for (const [k, p] of pending) if (now - p.at > PENDING_TTL) pending.delete(k)
  while (pending.size > PENDING_MAX_KEYS) pending.delete(pending.keys().next().value!)
}

const pruneTouched = (): void => {
  for (const k of touched.keys()) if (!history.has(k)) touched.delete(k)
}

const fileBytes = (f: AiFileInput): number => String(f.data || '').length

const stripFiles = (m: ChatMsg): ChatMsg => ({ role: m.role, content: m.content })

const limitFiles = (msgs: ChatMsg[], max = FILE_MEMORY_MAX, maxBytes = FILE_MEMORY_MAX_BYTES): ChatMsg[] => {
  let kept = 0
  let bytes = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const f = msgs[i].files
    if (!f?.length) continue
    const room = max - kept
    if (room <= 0) {
      delete msgs[i].files
      continue
    }
    const take = f.slice(f.length - Math.min(f.length, room))
    while (take.length && bytes + fileBytes(take[0]) > maxBytes) take.shift()
    if (!take.length) {
      delete msgs[i].files
      continue
    }
    msgs[i].files = take
    kept += take.length
    bytes += take.reduce((n, x) => n + fileBytes(x), 0)
  }
  return msgs
}

// Older versions persisted media; drop it and rewrite the file once.
let legacyMedia = false
for (const [key, [msgs, at]] of Object.entries(readJson<Record<string, [ChatMsg[], number]>>('ai-history.json', {}))) {
  if (Date.now() - at > SESSION_TTL) continue
  if (msgs.some((m) => m.files?.length)) legacyMedia = true
  history.set(key, msgs.map(stripFiles))
  touched.set(key, Date.now())
}
register('ai-history.json', () => {
  pruneTouched()
  return Object.fromEntries(
    history.keys().map((k) => [k, [(history.get(k) ?? []).map(stripFiles), touched.get(k) ?? Date.now()]]),
  )
})
if (legacyMedia) saveJson('ai-history.json')

export const aiHasHistory = (key: string): boolean => history.has(key)

export const getAiHistory = (key: string): ChatMsg[] => history.get(key) ?? []

// Copy the messages, keep at most `budget` files newest-first within the byte cap.
export const trimFilesToBudget = (msgs: ChatMsg[], budget: number): ChatMsg[] => {
  const copy = msgs.map((m) => (m.files?.length ? { ...m, files: [...m.files] } : m))
  return limitFiles(copy, Math.max(0, budget))
}

export const getPendingAiFiles = (key: string): AiFileInput[] => {
  const p = pending.get(key)
  if (!p) return []
  if (Date.now() - p.at > PENDING_TTL) {
    pending.delete(key)
    return []
  }
  return p.files
}

// How long ago the pending media was stashed (undefined = none).
export const pendingAiFilesAge = (key: string): number | undefined => {
  const p = pending.get(key)
  if (!p) return undefined
  return Date.now() - p.at
}

export function addPendingAiFiles(key: string, files: AiFileInput[]): void {
  if (!files.length) return
  prunePending()
  const next = [...(pending.get(key)?.files ?? []), ...files].slice(-FILE_MEMORY_MAX)
  pending.delete(key)
  pending.set(key, { files: next, at: Date.now() })
  prunePending()
  touched.set(key, Date.now())
}

export function clearPendingAiFiles(key: string): void {
  pending.delete(key)
}

// Code/HTML replies can be tens of KB; keep old ones as a short marker so the
// text budget doesn't wipe the conversation (and the bot stays on-topic).
const compactCode = (content: string): string =>
  content.replace(CODE_FENCE_RE, (all: string, body: string) =>
    body.length > 800 ? `[kode ${body.length} karakter — dipadatkan di history]` : all,
  )

export function saveAiHistory(key: string, query: string, finalText: string, files: AiFileInput[] = []): void {
  const prev = getAiHistory(key)
  const old = prev.map((m, i) =>
    i < prev.length - HISTORY_KEEP_RECENT ? { ...m, content: compactCode(m.content) } : m,
  )
  let next: ChatMsg[] = [
    ...old,
    { role: 'user', content: query, ...(files.length ? { files } : {}) },
    { role: 'assistant', content: finalText },
  ]
  next = next.slice(-HISTORY_MAX)
  while (next.reduce((n, m) => n + m.content.length, 0) > HISTORY_TEXT_MAX && next.length > 4) next = next.slice(2)
  limitFiles(next)
  history.set(key, next)
  touched.set(key, Date.now())
  pruneTouched()
  saveJson('ai-history.json')
}

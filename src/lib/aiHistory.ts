import NodeCache from '@cacheable/node-cache'
import type { AiFileInput, ChatMsg } from './llm.ts'
import { readJson, register, saveJson } from './disk.ts'

const HISTORY_MAX = 20 // keep last N messages (user+assistant pairs)
const HISTORY_TEXT_MAX = 12000 // rough text budget to avoid huge prompts
export const FILE_MEMORY_MAX = 4 // max files remembered across history/pending
const SESSION_TTL = 6 * 60 * 60 * 1000 // 6h session TTL (also persisted)
const PENDING_TTL = 30 * 60 * 1000 // media kept for a later .ai question
const PENDING_MAX_KEYS = 500

const history = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600, maxKeys: 2000 }) as {
  get(k: string): ChatMsg[] | undefined
  set(k: string, v: ChatMsg[]): boolean
  has(k: string): boolean
  keys(): string[]
}

const touched = new Map<string, number>()
// Media sent before an AI prompt (image first, ".ai question" later).
// TTL + cap stop old base64 files piling up.
type PendingFiles = { files: AiFileInput[]; at: number }
const pending = new Map<string, PendingFiles>()

const prunePending = (now = Date.now()): void => {
  for (const [k, p] of pending) if (now - p.at > PENDING_TTL) pending.delete(k)
  while (pending.size > PENDING_MAX_KEYS) pending.delete(pending.keys().next().value!)
}

const pruneTouched = (): void => {
  for (const k of touched.keys()) if (!history.has(k)) touched.delete(k)
}

const limitFiles = (msgs: ChatMsg[], max = FILE_MEMORY_MAX): ChatMsg[] => {
  let kept = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const f = msgs[i].files
    if (!f?.length) continue
    const room = max - kept
    if (room <= 0) {
      delete msgs[i].files
      continue
    }
    if (f.length > room) msgs[i].files = f.slice(f.length - room)
    kept += msgs[i].files!.length
  }
  return msgs
}

for (const [key, [msgs, at]] of Object.entries(readJson<Record<string, [ChatMsg[], number]>>('ai-history.json', {}))) {
  if (Date.now() - at > SESSION_TTL) continue
  history.set(key, limitFiles(msgs))
  touched.set(key, Date.now())
}
register('ai-history.json', () => {
  pruneTouched()
  return Object.fromEntries(history.keys().map((k) => [k, [history.get(k) ?? [], touched.get(k) ?? Date.now()]]))
})

export const aiHasHistory = (key: string): boolean => history.has(key)

export const getAiHistory = (key: string): ChatMsg[] => history.get(key) ?? []

// Keep at most `budget` files across the given messages, newest first, without
// touching the cached history objects.
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

export function saveAiHistory(key: string, query: string, finalText: string, files: AiFileInput[] = []): void {
  let next: ChatMsg[] = [
    ...getAiHistory(key),
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

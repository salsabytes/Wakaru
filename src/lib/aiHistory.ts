import NodeCache from '@cacheable/node-cache'
import type { ChatMsg } from './llm.ts'
import { readJson, register, saveJson } from './disk.ts'

const HISTORY_MAX = 20
const HISTORY_CHAR_MAX = 8000
const SESSION_TTL = 6 * 60 * 60 * 1000

const history = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600, maxKeys: 2000 }) as {
  get(k: string): ChatMsg[] | undefined
  set(k: string, v: ChatMsg[]): boolean
  has(k: string): boolean
  keys(): string[]
}

// last real activity per key — persisted with the msgs so the 6h TTL survives restarts
const touched = new Map<string, number>()

// restore on boot: same chat:sender keeps its history after a restart (fresh TTL from now)
for (const [key, [msgs, at]] of Object.entries(readJson<Record<string, [ChatMsg[], number]>>('ai-history.json', {}))) {
  if (Date.now() - at > SESSION_TTL) continue
  history.set(key, msgs)
  touched.set(key, Date.now()) // restore resets the in-memory TTL — persist the new expiry basis
}
register('ai-history.json', () =>
  Object.fromEntries(history.keys().map((k) => [k, [history.get(k) ?? [], touched.get(k) ?? Date.now()]])),
)

export const aiHasHistory = (key: string): boolean => history.has(key)

export const getAiHistory = (key: string): ChatMsg[] => history.get(key) ?? []

export function saveAiHistory(key: string, query: string, finalText: string): void {
  let next = [...getAiHistory(key), { role: 'user', content: query }, { role: 'assistant', content: finalText }]
  next = next.slice(-HISTORY_MAX)
  while (next.reduce((n, m) => n + m.content.length, 0) > HISTORY_CHAR_MAX && next.length > 4) next = next.slice(2)
  history.set(key, next)
  touched.set(key, Date.now())
  saveJson('ai-history.json')
}

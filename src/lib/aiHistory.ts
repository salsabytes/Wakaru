import NodeCache from '@cacheable/node-cache'
import type { ChatMsg } from './llm.ts'

const HISTORY_MAX = 20
const HISTORY_CHAR_MAX = 8000
// TTL + cap so per-chat:sender history can't accumulate forever on a long-running session
const history = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600, maxKeys: 2000 }) as {
  get(k: string): ChatMsg[] | undefined
  set(k: string, v: ChatMsg[]): boolean
  has(k: string): boolean
}

export const aiHasHistory = (key: string): boolean => history.has(key)

export const getAiHistory = (key: string): ChatMsg[] => history.get(key) ?? []

export function saveAiHistory(key: string, query: string, finalText: string): void {
  let next = [...getAiHistory(key), { role: 'user', content: query }, { role: 'assistant', content: finalText }]
  next = next.slice(-HISTORY_MAX)
  while (next.reduce((n, m) => n + m.content.length, 0) > HISTORY_CHAR_MAX && next.length > 4) next = next.slice(2)
  history.set(key, next)
}

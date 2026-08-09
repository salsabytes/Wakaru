import type { ChatMsg } from './llm.ts'

const HISTORY_MAX = 20
const HISTORY_CHAR_MAX = 8000
const history = new Map<string, ChatMsg[]>()

export const aiHasHistory = (key: string): boolean => history.has(key)

export const getAiHistory = (key: string): ChatMsg[] => history.get(key) ?? []

export function saveAiHistory(key: string, query: string, finalText: string): void {
  let next = [...(history.get(key) ?? []), { role: 'user', content: query }, { role: 'assistant', content: finalText }]
  next = next.slice(-HISTORY_MAX)
  while (next.reduce((n, m) => n + m.content.length, 0) > HISTORY_CHAR_MAX && next.length > 4) next = next.slice(2)
  history.set(key, next)
}

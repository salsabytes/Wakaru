import type { WAMessage, WAMessageContent, WAMessageKey } from 'baileys'
import { readJson, register, saveJson } from './disk.ts'

const MAX = 500
const PER_CHAT_MAX = 50
const CHAT_MAX = 500
const store = new Map<string, WAMessage>()
const byChat = new Map<string, WAMessage[]>()

// The global cap evicts messages across every chat, which used to starve the AI
// context in busy groups. Keep a small window per chat (LRU-capped) as well.
const remember = (msg: WAMessage): void => {
  const id = msg.key?.id
  if (!id) return
  store.set(id, msg)
  if (store.size > MAX) store.delete(store.keys().next().value!)

  const chat = msg.key?.remoteJid
  if (!chat) return
  const list = byChat.get(chat) ?? []
  const dup = list.findIndex((x) => x.key?.id === id)
  if (dup !== -1) list.splice(dup, 1)
  list.push(msg)
  if (list.length > PER_CHAT_MAX) list.splice(0, list.length - PER_CHAT_MAX)
  byChat.delete(chat)
  byChat.set(chat, list)
  if (byChat.size > CHAT_MAX) byChat.delete(byChat.keys().next().value!)
}

export const messageStore = {
  set(id: string, msg: WAMessage): void {
    remember(msg)
    saveJson('messages.json') // throttled — boot restores the recent window across restarts
  },
  get(id: string): WAMessage | undefined {
    return store.get(id)
  },
}

// raw WAMessages are metadata-only (no media bytes), ~1KB each → 500-msg file stays small
for (const msg of readJson<WAMessage[]>('messages.json', [])) remember(msg)
register('messages.json', () => [...store.values()])

const recentByChat = (chat: string, limit = 15): WAMessage[] =>
  (byChat.get(chat) ?? []).slice(-limit)

export { recentByChat }

export async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
  return messageStore.get(key.id!)?.message ?? undefined
}
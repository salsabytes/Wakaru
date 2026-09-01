import type { WAMessage, WAMessageContent, WAMessageKey } from 'baileys'
import { readJson, register, saveJson } from './disk.ts'

const MAX = 500
const store = new Map<string, WAMessage>()

export const messageStore = {
  set(id: string, msg: WAMessage): void {
    store.set(id, msg)
    if (store.size > MAX) store.delete(store.keys().next().value!)
    saveJson('messages.json') // throttled — boot restores the recent window across restarts
  },
  get(id: string): WAMessage | undefined {
    return store.get(id)
  },
}

// raw WAMessages are metadata-only (no media bytes), ~1KB each → 500-msg file stays small
for (const msg of readJson<WAMessage[]>('messages.json', [])) {
  if (msg.key?.id) store.set(msg.key.id, msg)
}
register('messages.json', () => [...store.values()])

const recentByChat = (chat: string, limit = 15): WAMessage[] => {
  const out: WAMessage[] = []
  for (const msg of store.values()) if (msg.key?.remoteJid === chat) out.push(msg)
  return out.slice(-limit)
}

export { recentByChat }

export async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
  return messageStore.get(key.id!)?.message ?? undefined
}
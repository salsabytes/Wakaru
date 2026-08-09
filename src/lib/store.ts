import type { WAMessage, WAMessageContent, WAMessageKey } from 'baileys'

const MAX = 500
const store = new Map<string, WAMessage>()

export const messageStore = {
  set(id: string, msg: WAMessage): void {
    store.set(id, msg)
    if (store.size > MAX) store.delete(store.keys().next().value!)
  },
  get(id: string): WAMessage | undefined {
    return store.get(id)
  },
}

const recentByChat = (chat: string, limit = 15): WAMessage[] => {
  const out: WAMessage[] = []
  for (const msg of store.values()) if (msg.key?.remoteJid === chat) out.push(msg)
  return out.slice(-limit)
}

export { recentByChat }

export async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
  return messageStore.get(key.id!)?.message ?? undefined
}
import type { WAMessage, WAMessageContent, WAMessageKey } from 'baileys'

export const messageStore = new Map<string, WAMessage>()

export async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
  return messageStore.get(key.id!)?.message ?? undefined
}
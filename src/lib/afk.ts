import { readJson, register, saveJsonNow } from './disk.ts'

export interface AfkInfo {
  reason: string
  since: number // epoch ms
}

const FILE = 'afk.json'
const store = readJson<Record<string, AfkInfo>>(FILE, {})
register(FILE, () => store)

// Cooldown so we don't spam when same person gets mentioned repeatedly.
const lastNotify = new Map<string, number>()
const NOTIFY_TTL = 60_000

const persist = (): void => {
  void saveJsonNow(FILE)
}

export const setAfk = (jid: string, reason = ''): AfkInfo => {
  const info: AfkInfo = { reason: String(reason || '').trim(), since: Date.now() }
  store[jid] = info
  persist()
  return info
}

export const getAfk = (jid: string): AfkInfo | undefined => store[jid]

export const clearAfk = (jid: string): boolean => {
  if (!(jid in store)) return false
  delete store[jid]
  persist()
  return true
}

// Rate limit: same target in same chat notified once per minute.
export const shouldNotifyAfk = (chat: string, targetJid: string): boolean => {
  const key = `${chat}:${targetJid}`
  const now = Date.now()
  const last = lastNotify.get(key) ?? 0
  if (now - last < NOTIFY_TTL) return false
  lastNotify.set(key, now)
  if (lastNotify.size > 2000) lastNotify.clear()
  return true
}

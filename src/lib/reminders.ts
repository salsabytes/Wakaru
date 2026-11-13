import { readJson } from './disk.ts'
import { logger } from './logger.ts'

export interface Reminder {
  id: number
  chat: string
  sender: string
  text: string
  dueAt: number // epoch ms
  createdAt: number
  attempts?: number // failed send attempts (retried before giving up)
}

const FILE = 'reminders.json'
const state: Reminder[] = readJson<Reminder[]>(FILE, [])

let nextId = state.reduce((m, r) => Math.max(m, r.id), 0) + 1

export const listReminders = (filter?: Partial<Pick<Reminder, 'chat' | 'sender'>>): Reminder[] => {
  let out = state.slice()
  if (filter?.chat) out = out.filter((r) => r.chat === filter.chat)
  if (filter?.sender) out = out.filter((r) => r.sender === filter.sender)
  return out.sort((a, b) => a.dueAt - b.dueAt)
}

export const addReminder = (r: Omit<Reminder, 'id' | 'createdAt'>): Reminder => {
  const rem: Reminder = {
    ...r,
    id: nextId++,
    createdAt: Date.now(),
  }
  state.push(rem)
  persist()
  return rem
}

export const removeReminder = (id: number, filter?: Partial<Pick<Reminder, 'chat' | 'sender'>>): boolean => {
  const idx = state.findIndex((r) => {
    if (r.id !== id) return false
    if (filter?.chat && r.chat !== filter.chat) return false
    if (filter?.sender && r.sender !== filter.sender) return false
    return true
  })
  if (idx === -1) return false
  state.splice(idx, 1)
  persist()
  return true
}

// Peek only — the reminder leaves the store after the send succeeds, so a
// failed send (offline, rate limit) gets retried instead of disappearing.
export const getDueReminders = (now = Date.now()): Reminder[] =>
  state.filter((r) => r.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)

export const completeReminder = (id: number): void => {
  const idx = state.findIndex((r) => r.id === id)
  if (idx === -1) return
  state.splice(idx, 1)
  persist()
}

export const rescheduleReminder = (id: number, dueAt: number, attempts: number): void => {
  const r = state.find((x) => x.id === id)
  if (!r) return
  r.dueAt = dueAt
  r.attempts = attempts
  persist()
}

const persist = async () => {
  try {
    const { DATA_DIR } = await import('./disk.ts')
    const { mkdir, writeFile, rename } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(DATA_DIR, { recursive: true })
    const tmp = join(DATA_DIR, `${FILE}.tmp`)
    await writeFile(tmp, JSON.stringify(state))
    await rename(tmp, join(DATA_DIR, FILE))
  } catch (e) {
    logger.warn('reminders: persist failed', e)
  }
}

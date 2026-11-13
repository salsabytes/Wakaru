import { readJson } from './disk.ts'
import { logger } from './logger.ts'

export interface Reminder {
  id: number
  chat: string
  sender: string
  text: string
  dueAt: number // epoch ms
  createdAt: number
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

export const getDueReminders = (now = Date.now()): Reminder[] => {
  const out: Reminder[] = []
  for (let i = state.length - 1; i >= 0; i--) {
    const r = state[i]
    if (r.dueAt <= now) {
      out.push(r)
      state.splice(i, 1)
    }
  }
  if (out.length) persist()
  return out
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

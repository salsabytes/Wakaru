import { logger } from './logger.ts'

const chatQueues = new Map<string, Promise<void>>()
export function enqueueChat(chat: string, task: () => Promise<void>): void {
  const prev = chatQueues.get(chat) ?? Promise.resolve()
  const next = prev.then(task).catch((err) => logger.error('queue task error:', err))
  chatQueues.set(chat, next)
  void next.finally(() => {
    if (chatQueues.get(chat) === next) chatQueues.delete(chat)
  })
}

const SLOT_LIMITS = { light: 3, heavy: 2 } as const
const running = { light: 0, heavy: 0 }
const waiters: (() => void)[] = []
export async function withSlot(weight: 'light' | 'heavy', fn: () => Promise<void>): Promise<void> {
  while (running[weight] >= SLOT_LIMITS[weight]) {
    await new Promise<void>((r) => waiters.push(r))
  }
  running[weight]++
  try {
    await fn()
  } finally {
    running[weight]--
    waiters.shift()?.()
  }
}

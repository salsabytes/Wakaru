import NodeCache from '@cacheable/node-cache'

// per-user rate limit for heavy commands; returns seconds remaining (0 = clear, key recorded)
const cooldowns = new NodeCache({ checkperiod: 60 }) as {
  get(k: string): number | undefined
  set(k: string, v: number, ttl: number): boolean
}
export const cooldownLeft = (key: string, sec: number): number => {
  const last = cooldowns.get(key)
  if (last === undefined) {
    cooldowns.set(key, Date.now(), sec)
    return 0
  }
  return Math.max(1, Math.ceil((last + sec * 1000 - Date.now()) / 1000))
}

// one global slot pool — worst case ≈300MB RAM at N=4 concurrent downloads; split pools if it spikes
const SLOT_LIMIT = 4
let running = 0
const waiters: (() => void)[] = []
export async function withSlot(fn: () => Promise<void>): Promise<void> {
  while (running >= SLOT_LIMIT) {
    await new Promise<void>((r) => waiters.push(r))
  }
  running++
  try {
    await fn()
  } finally {
    running--
    waiters.shift()?.()
  }
}

// Minimal JSON persistence for in-memory stores: read at boot, throttled save on change, flush on exit.
// One process writes these files (the bot), so plain writeFileSync + rename is enough — no locking.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DATA_DIR = join(import.meta.dirname, '..', '..', 'data')

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T
  } catch {
    return fallback // missing/corrupt file = fresh start, never crash the bot
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const getters = new Map<string, () => unknown>()

const write = (file: string): void => {
  const get = getters.get(file)
  if (!get) return
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = join(DATA_DIR, `${file}.tmp`)
    writeFileSync(tmp, JSON.stringify(get()))
    renameSync(tmp, join(DATA_DIR, file)) // atomic-ish: readers never see a half-written file
  } catch (err) {
    console.warn(`disk: failed to save ${file}:`, (err as Error).message)
  }
}

// get is called on every save — pass a closure over the live store
export function register(file: string, get: () => unknown): void {
  getters.set(file, get)
}

export function saveJson(file: string, delay = 5000): void {
  if (timers.has(file)) return // throttle (not debounce): busy chats still flush every `delay`
  timers.set(file, setTimeout(() => { timers.delete(file); write(file) }, delay))
}

export function flushAll(): void {
  for (const [file, t] of timers) {
    clearTimeout(t)
    write(file)
  }
  timers.clear()
}

// Minimal JSON persistence for in-memory stores: read at boot, throttled save on change, flush on exit.
// One process writes these files (the bot), so simple writes are enough — no locking.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DATA_DIR = process.env.WAKARU_DATA_DIR ?? join(import.meta.dirname, '..', '..', 'data')

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T
  } catch {
    return fallback // missing/corrupt file = fresh start, never crash the bot
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const getters = new Map<string, () => unknown>()
// Tracks in-flight async writes so we never write the same file concurrently.
const writing = new Set<string>()
// Files changed while a write was in-flight; re-write once with the latest state.
const pending = new Set<string>()

// Async write keeps large JSON saves from blocking the event loop.
const writeAsync = async (file: string): Promise<void> => {
  if (writing.has(file)) {
    pending.add(file) // coalesce: pick up the latest snapshot after this write finishes
    return
  }
  const get = getters.get(file)
  if (!get) return
  writing.add(file)
  try {
    await mkdir(DATA_DIR, { recursive: true })
    const tmp = join(DATA_DIR, `${file}.tmp`)
    await writeFile(tmp, JSON.stringify(get()))
    await rename(tmp, join(DATA_DIR, file)) // atomic-ish: readers never see a half-written file
  } catch (err) {
    console.warn(`disk: failed to save ${file}:`, (err as Error).message)
  } finally {
    writing.delete(file)
    if (pending.delete(file)) void writeAsync(file)
  }
}

// Sync write is used on shutdown so data is flushed before the process exits.
const writeSync = (file: string): void => {
  const get = getters.get(file)
  if (!get) return
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = join(DATA_DIR, `${file}.tmp`)
    writeFileSync(tmp, JSON.stringify(get()))
    renameSync(tmp, join(DATA_DIR, file))
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
  timers.set(file, setTimeout(() => {
    timers.delete(file)
    void writeAsync(file)
  }, delay))
}

// Skip the save throttle — for stores that must survive a crash.
export function saveJsonNow(file: string): Promise<void> {
  const timer = timers.get(file)
  if (timer) {
    clearTimeout(timer)
    timers.delete(file)
  }
  return writeAsync(file)
}

// Wait for in-flight writes (shutdown/tests).
export async function whenIdle(): Promise<void> {
  while (writing.size) await new Promise((r) => setTimeout(r, 10))
}

// Force-persist all pending saves (called during shutdown).
export function flushAll(): void {
  for (const [file, t] of timers) {
    clearTimeout(t)
    writeSync(file)
  }
  timers.clear()
  pending.clear()
}

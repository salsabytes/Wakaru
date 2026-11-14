import { readJson, register, saveJsonNow } from '../disk.ts'

export interface CachedDownload {
  url: string
  directUrl?: string
  title?: string
  platform?: string
  ts: number
}

const CACHE_FILE = 'dl-cache.json'
const DEFAULT_TTL = 6 * 60 * 60 * 1000 // 6 hours
const MAX_ENTRIES = 500

const cache = new Map<string, CachedDownload>()
let loaded = false

const keyOf = (url: string): string => url.trim()

const load = (): void => {
  if (loaded) return
  loaded = true
  const now = Date.now()
  const rows = Object.entries(readJson<Record<string, CachedDownload>>(CACHE_FILE, {}))
    .filter(([, v]) => v && typeof v.ts === 'number' && now - v.ts <= DEFAULT_TTL)
    .sort((a, b) => a[1].ts - b[1].ts)
    .slice(-MAX_ENTRIES)
  for (const [k, v] of rows) cache.set(k, v)
}

register(CACHE_FILE, () => Object.fromEntries(cache))

const trim = (): void => {
  if (cache.size <= MAX_ENTRIES) return
  const rows = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)
  for (const [k] of rows.slice(0, cache.size - MAX_ENTRIES)) cache.delete(k)
}

export const getCachedDownload = (url: string, ttl = DEFAULT_TTL): CachedDownload | undefined => {
  load()
  const k = keyOf(url)
  const v = cache.get(k)
  if (!v) return undefined
  if (Date.now() - v.ts > ttl) {
    cache.delete(k)
    return undefined
  }
  return v
}

export const setCachedDownload = (url: string, v: Partial<CachedDownload>): void => {
  load()
  const k = keyOf(url)
  const existing = cache.get(k)
  cache.set(k, { url: k, ts: Date.now(), ...existing, ...v })
  trim()
  void saveJsonNow(CACHE_FILE)
}

export const clearDownloadCache = (): void => {
  load()
  cache.clear()
  void saveJsonNow(CACHE_FILE)
}

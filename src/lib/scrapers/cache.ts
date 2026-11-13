import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export interface CachedDownload {
  url: string
  directUrl?: string
  title?: string
  platform?: string
  ts: number
}

const CACHE_FILE = 'dl-cache.json'
const DEFAULT_TTL = 6 * 60 * 60 * 1000 // 6 hours

const DATA_DIR = join(import.meta.dirname, '..', '..', 'data')
const cache = new Map<string, CachedDownload>()

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T
  } catch {
    return fallback
  }
}

function load() {
  if (cache.size) return
  const data = readJson<Record<string, CachedDownload>>(CACHE_FILE, {})
  for (const [k, v] of Object.entries(data)) {
    if (v) cache.set(k, v)
  }
}

const keyOf = (url: string) => url.trim()

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

export const setCachedDownload = (url: string, v: Partial<CachedDownload>) => {
  load()
  const k = keyOf(url)
  const existing = cache.get(k)
  cache.set(k, {
    url: k,
    ts: Date.now(),
    ...existing,
    ...v,
  })
  // save in background
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = join(DATA_DIR, `${CACHE_FILE}.tmp`)
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache)))
    renameSync(tmp, join(DATA_DIR, CACHE_FILE))
  } catch {}
}

export const clearDownloadCache = () => {
  cache.clear()
}

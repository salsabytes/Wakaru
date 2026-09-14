

import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

try {
  if (!existsSync(join(ROOT, 'config.json'))) {
    const example = join(ROOT, 'config.example.json')
    if (existsSync(example)) copyFileSync(example, join(ROOT, 'config.json'))
    else writeFileSync(join(ROOT, 'config.json'), JSON.stringify({ owners: [] }, null, 2) + '\n')
  }
} catch {
  // missing config just means defaults
}

export const OWNERS = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) as { owners?: unknown }
    return Array.isArray(cfg.owners)
      ? cfg.owners.filter((o): o is string => typeof o === 'string').map((o) => o.split(/[@:]/)[0])
      : []
  } catch {
    return []
  }
})()

export const isOwner = (sender: string) => OWNERS.includes(sender.split(/[@:]/)[0])

// parsed once per process — restart to pick up config.json edits
let cfgCache: Record<string, string> | undefined

export type Mode = 'public' | 'self' | 'private'

let mode: Mode = (() => {
  try {
    const m = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')).mode
    return m === 'self' || m === 'private' ? m : 'public'
  } catch {
    return 'public'
  }
})()

export const botMode = (): Mode => mode

const cleanPrefixes = (src: unknown): string[] =>
  (Array.isArray(src) ? src : [src])
    .filter((p): p is string => typeof p === 'string' && p.length > 0 && !/\s/.test(p))
    .slice(0, 5)

let prefixes: string[] = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) as { prefixes?: unknown; prefix?: unknown }
    return cleanPrefixes(Array.isArray(cfg.prefixes) ? cfg.prefixes : cfg.prefix !== undefined ? cfg.prefix : '.')
  } catch {
    return ['.']
  }
})()

export const botPrefixes = (): string[] => prefixes

const patchCfg = (mut: (cfg: Record<string, unknown>) => void): void => {
  try {
    const path = join(ROOT, 'config.json')
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    mut(cfg)
    writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
  } catch {
    // keep in-memory change
  }
}

export const setPrefixes = (next: unknown): string[] => {
  prefixes = cleanPrefixes(next)
  patchCfg((cfg) => {
    cfg.prefixes = prefixes
  })
  return prefixes
}

// body after the (longest-match) prefix; undefined = no prefix used.
// empty prefix list = bare mode: whole text is the body.
export const prefixBody = (text: string): string | undefined => {
  if (!prefixes.length) return text.trim()
  const hit = prefixes
    .filter((p) => text.startsWith(p))
    .sort((a, b) => b.length - a.length)[0]
  return hit === undefined ? undefined : text.slice(hit.length).trim()
}

// bare mode never counts as prefixed (so .play picks still work there)
export const usedPrefix = (text: string): boolean => prefixes.length > 0 && prefixes.some((p) => text.startsWith(p))

export const setMode = (next: Mode): Mode => {
  mode = next
  patchCfg((cfg) => {
    cfg.mode = mode
  })
  return mode
}

export const MAX_MB_MIN = 10
export const MAX_MB_MAX = 2048
export const MAX_MB_DEFAULT = 100

const clampMb = (n: unknown): number => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return MAX_MB_DEFAULT
  return Math.min(MAX_MB_MAX, Math.max(MAX_MB_MIN, v))
}

let maxDownloadMB: number = (() => {
  try {
    const v = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')).maxDownloadMB
    return v === undefined ? MAX_MB_DEFAULT : clampMb(v)
  } catch {
    return MAX_MB_DEFAULT
  }
})()

export const botMaxDownloadMB = (): number => maxDownloadMB

export const setMaxDownloadMB = (next: unknown): number => {
  maxDownloadMB = clampMb(next)
  patchCfg((cfg) => {
    cfg.maxDownloadMB = maxDownloadMB
  })
  return maxDownloadMB
}

// generic config.json string getter with a fallback (used for sticker pack/author etc.)
export const cfg = (key: string, fallback: string): string => {
  if (!cfgCache) {
    try {
      cfgCache = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'))
    } catch {
      cfgCache = {}
    }
  }
  const v = cfgCache?.[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}
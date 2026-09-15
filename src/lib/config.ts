

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

export const BARE_TOKENS = ['none', 'off', 'bare']

const cleanPrefixes = (src: unknown): string[] => [
  ...new Set(
    (Array.isArray(src) ? src : [src])
      .filter((p): p is string => typeof p === 'string' && p.length > 0 && !/\s/.test(p))
      .filter((p) => !BARE_TOKENS.includes(p.toLowerCase()))
      .slice(0, 5),
  ),
]

let prefixes: string[] = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) as { prefixes?: unknown; prefix?: unknown }
    return cleanPrefixes(Array.isArray(cfg.prefixes) ? cfg.prefixes : cfg.prefix !== undefined ? cfg.prefix : '.')
  } catch {
    return ['.']
  }
})()

export const botPrefixes = (): string[] => prefixes

let bare: boolean = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) as { bare?: unknown; prefixes?: unknown; prefix?: unknown }
    if (typeof cfg.bare === 'boolean') return cfg.bare
    const raw = Array.isArray(cfg.prefixes) ? cfg.prefixes : cfg.prefix !== undefined ? cfg.prefix : '.'
    if (Array.isArray(raw) && raw.some((p) => typeof p === 'string' && BARE_TOKENS.includes(p.toLowerCase()))) return true
    return cleanPrefixes(raw).length === 0
  } catch {
    return false
  }
})()

export const botBare = (): boolean => bare

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

export const setPrefixes = (next: unknown, allowBare?: boolean): string[] => {
  prefixes = cleanPrefixes(next)
  bare = allowBare ?? prefixes.length === 0
  patchCfg((cfg) => {
    cfg.prefixes = prefixes
    cfg.bare = bare
  })
  return prefixes
}

// body after the (longest-match) prefix; undefined = no prefix used.
// bare mode (empty list or bare flag): whole text is the body.
export const prefixBody = (text: string): string | undefined => {
  const hit = prefixes
    .filter((p) => text.startsWith(p))
    .sort((a, b) => b.length - a.length)[0]
  if (hit !== undefined) return text.slice(hit.length).trim()
  return bare || !prefixes.length ? text.trim() : undefined
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

// false = bot tampil offline, notif HP tetap bunyi (nomor utama).
// default true biar perilaku upstream gak berubah. restart buat apply.
let markOnline: boolean = (() => {
  try {
    const v = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')).markOnline
    return v === undefined ? true : !!v
  } catch {
    return true
  }
})()

export const botMarkOnline = (): boolean => markOnline

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
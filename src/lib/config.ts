

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

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

export const setMode = (next: Mode): Mode => {
  mode = next
  try {
    const path = join(ROOT, 'config.json')
    const cfg = JSON.parse(readFileSync(path, 'utf8'))
    cfg.mode = mode
    writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
  } catch {
    // keep in-memory change
  }
  return mode
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
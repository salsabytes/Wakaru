

import { readFileSync } from 'node:fs'
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

// generic config.json string getter with a fallback (used for sticker pack/author etc.)
// ponytail: parsed ONCE per process — restart the bot to pick up config.json edits
// (OWNERS already behaves this way, so this only aligns cfg() with it).
let cfgCache: Record<string, string> | undefined
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
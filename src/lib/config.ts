

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
export const cfg = (key: string, fallback: string): string => {
  try {
    const v = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'))[key]
    return typeof v === 'string' && v.length > 0 ? v : fallback
  } catch {
    return fallback
  }
}
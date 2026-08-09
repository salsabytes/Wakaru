import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { logger } from '../lib/logger.ts'

export const PREFIX = '.'

type Registered = Command & { category: string }

const commands = new Map<string, Registered>()
const resolve = new Map<string, string>()

export async function loadCommands(): Promise<void> {
  for (const category of readdirSync(import.meta.dirname, { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    const categoryDir = join(import.meta.dirname, category.name)
    for (const file of readdirSync(categoryDir)) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts') || file.startsWith('.')) continue
      try {

        const url = pathToFileURL(join(categoryDir, file)).href
        const mod = await import(url)
        const cmd = mod.default as Command | undefined
        if (!cmd?.name || typeof cmd.run !== 'function') continue
        const canonical = cmd.name.toLowerCase()
        commands.set(canonical, { ...cmd, name: canonical, category: category.name })
        for (const alias of cmd.aliases ?? []) resolve.set(alias.toLowerCase(), canonical)
      } catch (err) {

        logger.error(`failed to load command ${file}:`, err)
      }
    }
  }
}

export function getCommand(name: string): Registered | undefined {
  const canonical = resolve.get(name.toLowerCase()) ?? name.toLowerCase()
  return commands.get(canonical)
}

export function listCommands(): { name: string; category: string; desc?: string }[] {
  return [...commands.values()]
    .map(({ name, category, desc }) => ({ name, category, desc }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}
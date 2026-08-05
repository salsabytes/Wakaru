import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PREFIX = '.'

type Registered = Command & { category: string }

const commands = new Map<string, Registered>()
const resolve = new Map<string, string>()

export async function loadCommands(): Promise<void> {
  for (const category of readdirSync(import.meta.dirname, { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    const categoryDir = join(import.meta.dirname, category.name)
    for (const file of readdirSync(categoryDir)) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue
      const mod = await import(pathToFileURL(join(categoryDir, file)).href)
      const cmd = mod.default as Command | undefined
      if (!cmd?.name || typeof cmd.run !== 'function') continue
      const canonical = cmd.name.toLowerCase()
      commands.set(canonical, { ...cmd, name: canonical, category: category.name })
      resolve.set(canonical, canonical)
      for (const alias of cmd.aliases ?? []) resolve.set(alias.toLowerCase(), canonical)
    }
  }
}

export function getCommand(name: string): Registered | undefined {
  const canonical = resolve.get(name.toLowerCase())
  return canonical ? commands.get(canonical) : undefined
}

export function listCommands(): { name: string; category: string; desc?: string }[] {
  return [...commands.values()]
    .map(({ name, category, desc }) => ({ name, category, desc }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}
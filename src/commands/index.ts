import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PREFIX = '.'

type Registered = Command & { category: string }

const commands = new Map<string, Registered>()

export async function loadCommands(): Promise<void> {
  for (const category of readdirSync(import.meta.dirname, { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    const categoryDir = join(import.meta.dirname, category.name)
    for (const file of readdirSync(categoryDir)) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue
      const mod = await import(pathToFileURL(join(categoryDir, file)).href)
      const cmd = mod.default as Command | undefined
      if (cmd?.name && typeof cmd.run === 'function') {
        commands.set(cmd.name, { ...cmd, category: category.name })
      }
    }
  }
}

export function getCommand(name: string): Registered | undefined {
  return commands.get(name)
}

export function listCommands(): { name: string; category: string; desc?: string }[] {
  return [...commands.values()]
    .map(({ name, category, desc }) => ({ name, category, desc }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}
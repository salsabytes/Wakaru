import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export const PREFIX = '.'

type Registered = Command & { category: string }

const commands = new Map<string, Registered>()
const resolve = new Map<string, string>()
let ready: Promise<void> | undefined

const ROOT = import.meta.dirname

function walk(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(full))
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

// registered lazily on first use (getCommand/listCommands) — a command file used
// directly as an entry point (e.g. the ai selftest) can't deadlock on registration.
// category is the first path segment (group/kick.ts -> 'group', main/ai/index.ts -> 'main').
const load = async (): Promise<void> => {
  for (const file of walk(ROOT)) {
    if (file === join(ROOT, 'index.ts')) continue
    const mod = (await import(file)) as { default?: Command }
    const cmd = mod.default
    if (!cmd?.name || typeof cmd.run !== 'function') continue // helpers (prompt.ts, tools.ts) auto-skip
    const canonical = cmd.name.toLowerCase()
    commands.set(canonical, { ...cmd, name: canonical, category: relative(ROOT, file).split(/[\\/]/)[0] })
    for (const alias of cmd.aliases ?? []) resolve.set(alias.toLowerCase(), canonical)
  }
}

const ensure = (): Promise<void> => (ready ??= load())

export async function getCommand(name: string): Promise<Registered | undefined> {
  await ensure()
  const canonical = resolve.get(name.toLowerCase()) ?? name.toLowerCase()
  return commands.get(canonical)
}

export async function listCommands(): Promise<{ name: string; category: string; desc?: string }[]> {
  await ensure()
  return [...commands.values()]
    .map(({ name, category, desc }) => ({ name, category, desc }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

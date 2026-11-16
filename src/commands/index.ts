import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { logger } from '../lib/logger.ts'

type Registered = Command & { category: string }

const commands = new Map<string, Registered>()
const resolve = new Map<string, string>()
let ready: Promise<void> | undefined
let generation = 0

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

// lazy registration — a command file used directly as an entry (e.g. ai selftest) can't deadlock;
// category = first path segment (group/kick.ts -> 'group')
const load = async (): Promise<void> => {
  const gen = ++generation
  const next = new Map<string, Registered>()
  const nextResolve = new Map<string, string>()
  for (const file of walk(ROOT)) {
    if (file === join(ROOT, 'index.ts')) continue
    // Cache-bust so a reload sees edited files (mtime alone can be too coarse).
    const url = pathToFileURL(file)
    url.searchParams.set('v', `${gen}-${statSync(file).mtimeMs}`)
    let mod: { default?: Command }
    try {
      mod = (await import(url.href)) as { default?: Command }
    } catch (err) {
      // One broken command must not take the whole registry down.
      logger.warn(`command load failed: ${relative(ROOT, file)}`, err)
      continue
    }
    const cmd = mod.default
    if (!cmd?.name || typeof cmd.run !== 'function') continue // helpers (prompt.ts, tools.ts) auto-skip
    const canonical = cmd.name.toLowerCase()
    next.set(canonical, { ...cmd, name: canonical, category: relative(ROOT, file).split(/[\\/]/)[0] })
    for (const alias of cmd.aliases ?? []) nextResolve.set(alias.toLowerCase(), canonical)
  }
  // Swap only after every file loaded, so a running bot never sees half a list.
  commands.clear()
  resolve.clear()
  for (const [k, v] of next) commands.set(k, v)
  for (const [k, v] of nextResolve) resolve.set(k, v)
}

const ensure = (): Promise<void> => (ready ??= load())

// Re-scan the folder after the AI edits src/commands (add/remove/update).
export async function reloadCommands(): Promise<void> {
  ready = load()
  try {
    await ready
  } catch (err) {
    ready = undefined
    throw err
  }
}

export async function getCommand(name: string): Promise<Registered | undefined> {
  await ensure()
  const canonical = resolve.get(name.toLowerCase()) ?? name.toLowerCase()
  return commands.get(canonical)
}

export async function listCommands(): Promise<{ name: string; category: string; desc?: string; ownerOnly?: boolean }[]> {
  await ensure()
  return [...commands.values()]
    .map(({ name, category, desc, ownerOnly }) => ({ name, category, desc, ownerOnly }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

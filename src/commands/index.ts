import sticker from './converter/sticker.ts'
import ytmp3 from './downloader/ytmp3.ts'
import ytmp4 from './downloader/ytmp4.ts'
import play from './downloader/play.ts'
import tiktok from './downloader/tiktok.ts'
import instagram from './downloader/instagram.ts'
import facebook from './downloader/facebook.ts'
import pinterest from './downloader/pinterest.ts'
import ai from './main/ai/index.ts'
import menu from './main/menu.ts'

export const PREFIX = '.'

type Registered = Command & { category: string }

const commands = new Map<string, Registered>()
const resolve = new Map<string, string>()
let ready = false

function ensure(): void {
  if (ready) return
  ready = true
  const entries: { cmd: Command; category: string }[] = [
    { cmd: sticker, category: 'converter' },
    { cmd: ytmp3, category: 'downloader' },
    { cmd: ytmp4, category: 'downloader' },
    { cmd: play, category: 'downloader' },
    { cmd: tiktok, category: 'downloader' },
    { cmd: instagram, category: 'downloader' },
    { cmd: facebook, category: 'downloader' },
    { cmd: pinterest, category: 'downloader' },
    { cmd: ai, category: 'main' },
    { cmd: menu, category: 'main' },
  ]
  for (const { cmd, category } of entries) {
    if (!cmd?.name || typeof cmd.run !== 'function') continue
    const canonical = cmd.name.toLowerCase()
    commands.set(canonical, { ...cmd, name: canonical, category })
    for (const alias of cmd.aliases ?? []) resolve.set(alias.toLowerCase(), canonical)
  }
}

export function getCommand(name: string): Registered | undefined {
  ensure()
  const canonical = resolve.get(name.toLowerCase()) ?? name.toLowerCase()
  return commands.get(canonical)
}

export function listCommands(): { name: string; category: string; desc?: string }[] {
  ensure()
  return [...commands.values()]
    .map(({ name, category, desc }) => ({ name, category, desc }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

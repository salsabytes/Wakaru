import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listCommands } from '../index.ts'
import { isOwner } from '../../lib/config.ts'
import { language, t, type Lang } from '../../lib/lang.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')

const META: { name: string; version: string } = (() => {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name?: string; version?: string }
    return { name: (j.name ?? 'wakaru').toUpperCase(), version: j.version ?? '' }
  } catch {
    return { name: 'WAKARU', version: '' }
  }
})()

const CATEGORY_LABEL: Record<string, string> = {
  main: '✦ MAIN',
  downloader: '◈ DOWNLOADER',
  group: '✤ GROUP',
  converter: '✤ CONVERTER',
}
const CATEGORY_ORDER = ['main', 'downloader', 'group', 'converter']
const catLabel = (cat: string): string => CATEGORY_LABEL[cat] ?? cat.toUpperCase()
const catOrder = (cat: string): number => {
  const i = CATEGORY_ORDER.indexOf(cat)
  return i === -1 ? CATEGORY_ORDER.length : i
}

const GREET: Record<Lang, string[]> = {
  id: ['Selamat pagi', 'Selamat siang', 'Selamat sore', 'Selamat malam'],
  en: ['Good morning', 'Good afternoon', 'Good evening', 'Good night'],
}
const greeting = (): string => {
  const h = new Date().getHours()
  return GREET[language()][h < 11 ? 0 : h < 15 ? 1 : h < 18 ? 2 : 3]
}

// soft horizontal rules, no box corners/rails — sent inside a ``` block so
// WhatsApp renders monospace; 24 wide so it fits a phone screen on one line
const RULE = 24
const rule = (label = ''): string =>
  label ? `── ${label} ${'─'.repeat(Math.max(0, RULE - label.length - 4))}` : '─'.repeat(RULE)

interface MenuCommand {
  name: string
  category: string
}

interface MenuData {
  pushName?: string
  prefix: string
  isOwner: boolean
  elapsedMs: number
  commands: MenuCommand[]
}

export function renderMenu(d: MenuData): string {
  const now = new Date()
  const day = now.toLocaleDateString('id-ID', { weekday: 'short' })
  const date = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replaceAll('.', ':')

  const grouped = new Map<string, string[]>()
  for (const { name, category } of d.commands) {
    const items = grouped.get(category) ?? []
    items.push(`   ✧ ${d.prefix}${name}`)
    grouped.set(category, items)
  }

  const who = d.pushName || (d.isOwner ? 'Owner' : 'Kak')
  const role = d.isOwner ? '👑 Owner' : '👤 User'
  const categories = [...grouped.entries()].sort((a, b) => catOrder(a[0]) - catOrder(b[0]))

  const body = [
    `✦ ${META.name} · v${META.version}`,
    `👋 ${greeting()}, ${who}!`,
    `🕐 ${day}, ${date} · ${time}`,
    `${role} · prefix: ${d.prefix}`,
    '',
    ...categories.flatMap(([category, items]) => [rule(catLabel(category)), ...items]),
    '',
    t('menuStats', { n: d.commands.length, ms: d.elapsedMs }),
    t('menuFooter', { prefix: d.prefix }),
  ].join('\n')

  return '```\n' + body + '\n```'
}

export default {
  name: 'menu',
  desc: 'list all commands',
  aliases: ['help'],
  run: async (ctx: CommandContext) => {
    // performance.now is monotonic — Date.now can jump on NTP sync
    const t0 = performance.now()
    const commands = await listCommands()
    await ctx.reply(
      renderMenu({
        pushName: ctx.pushName,
        prefix: ctx.prefix,
        isOwner: isOwner(ctx.sender),
        elapsedMs: Math.round(performance.now() - t0),
        commands,
      }),
    )
  },
} satisfies Command

if (process.env.MENU_SELFTEST) {
  const m = renderMenu({
    pushName: 'Test',
    prefix: '.',
    isOwner: true,
    elapsedMs: 42,
    commands: [
      { name: 'menu', category: 'main' },
      { name: 'ytmp3', category: 'downloader' },
    ],
  })
  const ok =
    m.startsWith('```\n✦ WAKARU') &&
    m.trimEnd().endsWith('```') &&
    m.includes('── ✦ MAIN ') &&
    m.includes('── ◈ DOWNLOADER ') &&
    m.includes('✧ .ytmp3') &&
    m.includes('42ms')
  if (!ok) throw new Error('menu render fail')
  console.log('menu self-check ok')
  process.exit(0)
}

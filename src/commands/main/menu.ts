import { listCommands } from '../index.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'menu',
  desc: 'list all commands',
  aliases: ['help'],
  run: async (ctx: CommandContext) => {
    const byCategory = new Map<string, string[]>()
    for (const { name, category, desc } of listCommands()) {
      const line = `   ✧ ${ctx.prefix}${name}${desc ? ` — ${desc}` : ''}`
      const items = byCategory.get(category) ?? []
      items.push(line)
      byCategory.set(category, items)
    }

    const body = [...byCategory.entries()]
      .map(([category, items]) => `📂 ${category}\n${items.join('\n')}`)
      .join('\n\n')

    await ctx.reply(`✨ WAKARU MENU ✨\n\n${body}\n\n${t('menuFooter', { prefix: ctx.prefix })}`)
  },
} satisfies Command
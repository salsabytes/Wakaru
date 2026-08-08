import { getCommand, listCommands } from '../index.ts'

export default {
  name: 'menu',
  desc: 'list all commands',
  aliases: ['help'],
  run: async (ctx: CommandContext) => {
    const byCategory = new Map<string, string[]>()
    for (const { name, category } of listCommands()) {
      const desc = getCommand(name)?.desc
      const line = `   ✧ ${ctx.prefix}${name}${desc ? ` — ${desc}` : ''}`
      const items = byCategory.get(category) ?? []
      items.push(line)
      byCategory.set(category, items)
    }

    const body = [...byCategory.entries()]
      .map(([category, items]) => `📂 ${category}\n${items.join('\n')}`)
      .join('\n\n')

    await ctx.reply(`✨ WAKARU MENU ✨\n\n${body}\n\nType ${ctx.prefix}menu to show this again`)
  },
} satisfies Command
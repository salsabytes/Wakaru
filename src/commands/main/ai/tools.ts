import { getCommand } from '../../index.ts'
import { isOwner } from '../../../lib/config.ts'

export const parseRuns = (text: string) =>
  [...text.matchAll(/@run:([a-z][a-z0-9_-]*)(?:\s+([^\n]*))?/gi)].map((m) => ({
    name: m[1].toLowerCase(),
    args: (m[2] ?? '').trim(),
  }))

export const runTool = async (r: { name: string; args: string }, ctx: CommandContext): Promise<string> => {
  if (r.name === 'ai') return '[ai] denied — no self-recursion'
  const cmd = getCommand(r.name)
  if (!cmd) return `[${r.name}] no such command`
  if (cmd.ownerOnly && !isOwner(ctx.sender)) return `[${r.name}] denied — owner only`
  try {
    const captured: string[] = []
    const sub: CommandContext = {
      ...ctx,
      text: r.args,
      args: r.args ? r.args.split(/\s+/) : [],
      reply: async (t) => { captured.push(t) },
    }
    await cmd.run(sub)
    return `[${r.name}]${captured.length ? ' ' + captured.join(' | ') : ' (ok)'}`
  } catch (err) {
    return `[${r.name}] errored: ${(err as Error).message}`
  }
}

import { getCommand } from '../../index.ts'
import { isOwner } from '../../../lib/config.ts'
import { fmtBytes, mediaDuration } from '../../../lib/media.ts'

const mediaMeta = (label: string, buf: Buffer): string => {
  const parts = [label]
  const dur = mediaDuration(buf)
  if (dur) parts.push(dur)
  parts.push(fmtBytes(buf.length))
  return parts.join(' · ')
}

export const parseRuns = (text: string) =>
  [...text.matchAll(/@run:([a-z][a-z0-9_-]*)(?:\s+([^\n]*))?/gi)].map((m) => ({
    name: m[1].toLowerCase(),
    args: (m[2] ?? '').trim(),
  }))

export const runTool = async (r: { name: string; args: string }, ctx: CommandContext): Promise<string> => {
  if (r.name === 'ai') return '[ai] denied — no self-recursion'
  const cmd = await getCommand(r.name)
  if (!cmd) return `[${r.name}] no such command`
  if (cmd.ownerOnly && !isOwner(ctx.sender)) return `[${r.name}] denied — owner only`
  try {
    const captured: string[] = []
    const sub: CommandContext = {
      ...ctx,
      text: r.args,
      args: r.args ? r.args.split(/\s+/) : [],
      reply: async (t) => { captured.push(t) },
      // capture real output so the AI can report actual titles/results instead of "(ok)"
      sendList: async (o) => {
        captured.push(`${o.text} ${o.sections.flatMap((s) => s.rows.map((r) => (r.header ? r.header + '. ' : '') + r.title)).join(' | ')}`)
        await ctx.sendList(o)
      },
      sendButtons: async (buttons, text, footer) => {
        captured.push(text)
        await ctx.sendButtons(buttons, text, footer)
      },
      sendImage: async (b, c) => { captured.push(mediaMeta(c || 'image', b)); await ctx.sendImage(b, c) },
      sendVideo: async (b, c) => { captured.push(mediaMeta(c || 'video', b)); await ctx.sendVideo(b, c) },
      sendAudio: async (b, t) => { captured.push(mediaMeta(t || 'audio', b)); await ctx.sendAudio(b) },
      sendSticker: async (b) => { captured.push(mediaMeta('sticker', b)); await ctx.sendSticker(b) },
    }
    await cmd.run(sub)
    return `[${r.name}]${captured.length ? ' ' + captured.join(' | ') : ' (ok)'}`
  } catch (err) {
    return `[${r.name}] errored: ${(err as Error).message}`
  }
}

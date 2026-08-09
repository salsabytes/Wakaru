

import { askLLM, type ChatMsg } from '../../lib/llm.ts'
import { getCommand, listCommands } from '../index.ts'
import { isOwner } from '../../lib/config.ts'

const HISTORY_MAX = 20

const HISTORY_CHAR_MAX = 8000
const PARTICIPANT_MAX = 40
const history = new Map<string, ChatMsg[]>()

const parseRuns = (text: string) =>
  [...text.matchAll(/@run:([a-z][a-z0-9_-]*)(?:\s+([^\n]*))?/gi)].map((m) => ({
    name: m[1].toLowerCase(),
    args: (m[2] ?? '').trim(),
  }))

async function buildContext(ctx: CommandContext): Promise<string> {
  const lines = [`chat: ${ctx.chat}`, `sender: ${ctx.sender}`, ctx.isGroup ? 'chat type: group' : 'chat type: private']
  if (ctx.mtype !== 'conversation') lines.push(`user's message has media (${ctx.mtype}) — media commands like sticker can use it`)
  if (ctx.quoted?.text) lines.push(`user is replying to: "${ctx.quoted.text.slice(0, 200)}"`)
  if (ctx.isGroup) {
    try {
      const meta = await ctx.sock.groupMetadata(ctx.chat)
      const members = meta.participants
        .slice(0, PARTICIPANT_MAX)
        .map((p) => `${p.notify || p.id.split('@')[0]} -> ${p.id}`)
        .join('\n')
      if (members) lines.push(`group members (name -> jid, for kick/promote/etc):\n${members}`)
    } catch {

    }
  }
  return lines.join('\n')
}

export default {
  name: 'ai',
  desc: 'chat or DO things: .ai <msg> — can run any command, remembers the chat',
  run: async (ctx: CommandContext) => {
    const query = ctx.text.trim()
    if (!query) return ctx.reply(`usage: ${ctx.prefix}ai <message> — e.g. "sticker", "kick budi", or just chat`)
    ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {})

    let finalText = ''
    try {
      const context = await buildContext(ctx)

      const system: ChatMsg = {
        role: 'system',
        content: [
          'You are Wakaru\'s agent, a WhatsApp bot. Reply in the same language the user writes (Indonesian slang is fine). Be concise.',
          '',
          'YOU CAN DO THINGS: run any command below by emitting marker lines, ONE per command:',
          '@run:<command> <args>',
          'Match the user\'s request to a command (e.g. "sticker" -> @run:sticker, "kick budi" -> @run:kick <budis-jid-from-context>).',
          'You may emit MULTIPLE markers at once; the bot executes them and sends back the results, then you summarize in ONE short message.',
          'NEVER invent results — report exactly what came back; if a command errored, tell the user the real error.',
          'If you lack info a command needs (a jid, a link, a name), ask the user — do NOT guess or fabricate.',
          'If no command fits, just answer directly.',
          '',
          'CONTEXT:',
          context,
          '',
          'AVAILABLE COMMANDS (name — description):',
          listCommands()
            .filter((c) => c.name !== 'ai')
            .map((c) => `- ${c.name}${c.desc ? ' — ' + c.desc : ''}`)
            .join('\n'),
        ].join('\n'),
      }

      const h = history.get(ctx.chat) ?? []
      const msgs: ChatMsg[] = [system, ...h, { role: 'user', content: query }]

      for (let round = 0; round < 2; round++) {
        let reply: string
        try {
          reply = (await askLLM(msgs, 0.5)).trim()
        } catch (err) {

          if (round === 0) reply = (await askLLM(msgs, 0.5)).trim()
          else throw err
        }
        const runs = parseRuns(reply)
        if (!runs.length) {
          finalText = reply
          break
        }
        const results: string[] = []
        for (const r of runs) {
          if (r.name === 'ai') {
            results.push('[ai] denied — no self-recursion')
            continue
          }
          const cmd = getCommand(r.name)
          if (!cmd) {
            results.push(`[${r.name}] no such command`)
            continue
          }
          if (cmd.ownerOnly && !isOwner(ctx.sender)) {
            results.push(`[${r.name}] denied — owner only`)
            continue
          }
          try {
            const captured: string[] = []
            const sub: CommandContext = {
              ...ctx,
              text: r.args,
              args: r.args ? r.args.split(/\s+/) : [],
              reply: async (t) => { captured.push(t) },
            }
            await cmd.run(sub)
            results.push(`[${r.name}]${captured.length ? ' ' + captured.join(' | ') : ' (ok)'}`)
          } catch (err) {
            results.push(`[${r.name}] errored: ${(err as Error).message}`)
          }
        }
        msgs.push({ role: 'assistant', content: reply })
        msgs.push({ role: 'user', content: `tool results:\n${results.join('\n')}\nReply to the user in ONE short message.` })
        if (round === 1) finalText = results.join('\n')
      }
    } catch (err) {
      finalText = `❌ ${(err as Error).message}`
    }

    let next = [...(history.get(ctx.chat) ?? []), { role: 'user', content: query }, { role: 'assistant', content: finalText }]
    next = next.slice(-HISTORY_MAX)
    while (next.reduce((n, m) => n + m.content.length, 0) > HISTORY_CHAR_MAX && next.length > 4) next = next.slice(2)
    history.set(ctx.chat, next)
    await ctx.reply(finalText)
  },
}

if (process.env.AI_SELFTEST) {
  const cases: [string, number][] = [
    ['@run:sticker', 1],
    ['@run:kick 628123@x\n@run:promote 628123@x', 2],
    ['just chatting, no markers', 0],
    ['do it: @run:join https://chat.whatsapp.com/ABC and tell me', 1],
    ['@run:ai hello', 1],
  ]
  for (const [text, want] of cases) {
    const got = parseRuns(text).length
    if (got !== want) throw new Error(`parseRuns(${JSON.stringify(text)}) = ${got}, want ${want}`)
  }
  console.log('ai self-check ok')
  process.exit(0)
}
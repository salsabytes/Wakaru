import { askLLM, type ChatMsg } from '../../../lib/llm.ts'
import { t } from '../../../lib/lang.ts'
import { getAiHistory, saveAiHistory } from '../../../lib/aiHistory.ts'
import { buildSystem } from './prompt.ts'
import { parseRuns, runTool } from './tools.ts'

const runExchange = async (msgs: ChatMsg[], ctx: CommandContext): Promise<string> => {
  for (let round = 0; round < 2; round++) {
    let reply: string
    try {
      reply = (await askLLM(msgs)).trim()
    } catch (err) {
      if (round === 0) {

        await new Promise((r) => setTimeout(r, 1500))
        reply = (await askLLM(msgs)).trim()
      } else throw err
    }
    const runs = parseRuns(reply)
    if (!runs.length) return reply
    const results: string[] = []
    for (const r of runs) results.push(await runTool(r, ctx))
    msgs.push({ role: 'assistant', content: reply })
    msgs.push({ role: 'user', content: `tool results:\n${results.join('\n')}\nReply to the user in ONE short message.` })
    if (round === 1) return results.join('\n')
  }
  return ''
}

export default {
  name: 'ai',
  desc: 'chat or DO things: .ai <msg> — can run any command, remembers each sender',
  run: async (ctx: CommandContext) => {
    const query = ctx.text.trim()
    if (!query) return ctx.reply(t('aiUsage', { prefix: ctx.prefix }))
    ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {})

    let finalText = ''

    const histKey = `${ctx.chat}:${ctx.sender}`
    try {
      const system = await buildSystem(ctx)
      const msgs: ChatMsg[] = [system, ...getAiHistory(histKey), { role: 'user', content: query }]
      finalText = await runExchange(msgs, ctx)
    } catch (err) {
      finalText = `❌ ${(err as Error).message}`
    }

    saveAiHistory(histKey, query, finalText)
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

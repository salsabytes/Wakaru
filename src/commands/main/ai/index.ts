import { askLLM, type ChatMsg } from '../../../lib/llm.ts'
import { tx } from '../../../lib/lang.ts'
import { logger } from '../../../lib/logger.ts'
import { sendRichParts } from '../../../lib/richmsg.ts'
import { getAiHistory, saveAiHistory } from '../../../lib/aiHistory.ts'
import { AI_FREE, buildSystem } from './prompt.ts'
import { hasRich, parseRich, richToText, waText } from './rich.ts'
import { parseRuns, runTool } from './tools.ts'

const MAX_ROUNDS = AI_FREE ? 5 : 2

const runExchange = async (msgs: ChatMsg[], ctx: CommandContext): Promise<string> => {
  for (let round = 0; round < MAX_ROUNDS; round++) {
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
    let sent = false
    let failed = false
    for (const r of runs) {
      const out = await runTool(r, ctx)
      results.push(out.text)
      sent ||= out.sent
      failed ||= out.failed
    }
    // a command already replied in the chat (e.g. play's number picker) — any AI text
    // now would be a second copy of the same thing, so stop here and say nothing.
    if (sent && !failed) return ''
    msgs.push({ role: 'assistant', content: reply })
    const resultPrompt = AI_FREE
      ? `tool results:\n${results.join('\n')}\nReply to the user naturally.`
      : `tool results:\n${results.join('\n')}\nReply to the user in ONE short message.`
    msgs.push({ role: 'user', content: resultPrompt })
    if (round === MAX_ROUNDS - 1) return results.join('\n')
  }
  return ''
}

export default {
  name: 'ai',
  desc: 'chat or DO things: .ai <msg> — can run any command, remembers each sender',
  run: async (ctx: CommandContext) => {
    const query = ctx.text.trim()
    if (!query) return ctx.reply(await tx('aiUsage', { prefix: ctx.prefix }))
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

    // LLMs always emit Markdown **bold** — WhatsApp only renders *single*,
    // so double stars show up as literal asterisks. Same for [text](url) links.
    // parseRich does that normalisation itself, on text and table cells only: a
    // code block has to reach the card byte-for-byte, so it takes the RAW reply.
    const waSafe = waText(finalText)
    if (!waSafe.trim()) return

    // A table or a fenced code block becomes ONE native rich message (markdown
    // text + GenATableUXPrimitive / GenAICodeUXPrimitive): Android, Web and
    // iPhone render it from a single relay. Plain answers stay a chat bubble.
    const parts = parseRich(finalText)
    if (hasRich(parts)) {
      try {
        await sendRichParts(ctx.sock, ctx.chat, parts, { title: 'Wakaru' })
        return
      } catch (err) {
        logger.warn('ai rich send failed, plain fallback:', err)
        await ctx.reply(richToText(parts))
        return
      }
    }
    await ctx.reply(waSafe)
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

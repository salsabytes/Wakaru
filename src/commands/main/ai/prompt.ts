import type { ChatMsg } from '../../../lib/llm.ts'
import { listCommands } from '../../index.ts'
import { recentByChat } from '../../../lib/store.ts'
import { textOfMessage } from '../../../lib/serialize.ts'

const PARTICIPANT_MAX = 20

async function buildContext(ctx: CommandContext): Promise<string> {
  const lines = [`chat: ${ctx.chat}`, `sender: ${ctx.sender}`, ctx.isGroup ? 'chat type: group' : 'chat type: private']
  if (ctx.pushName) lines.push(`sender's WhatsApp profile name (pushname): ${ctx.pushName}`)
  if (ctx.mtype !== 'conversation') lines.push(`user's message has media (${ctx.mtype}) — media commands like sticker can use it`)
  if (ctx.quoted?.text) lines.push(`user is replying to: "${ctx.quoted.text.slice(0, 200)}"`)
  if (ctx.isGroup) {
    try {
      const meta = await ctx.sock.groupMetadata(ctx.chat)
      const me = meta.participants.find((p) => p.id.split(':')[0] === ctx.sender.split(':')[0])
      if (me?.notify) lines.push(`current sender's name in this group: ${me.notify}`)
      const members = meta.participants
        .slice(0, PARTICIPANT_MAX)
        .map((p) => `${p.notify || p.id.split('@')[0]} -> ${p.id}`)
        .join('\n')
      if (members) lines.push(`group members (name -> jid, for kick/promote/etc):\n${members}`)
    } catch {

    }
  }
  const recent = recentByChat(ctx.chat, 8)
  if (recent.length) {
    const chatLines = recent.map((m) => {
      const sender = (m.key?.participant ?? m.key?.remoteJid ?? '?').split('@')[0]
      return `${sender}: ${textOfMessage(m).slice(0, 150)}`
    })
    lines.push(`recent messages in this chat (oldest → newest — answer "what did we talk about" from these):\n${chatLines.join('\n')}`)
  }
  return lines.join('\n')
}

export const buildSystem = async (ctx: CommandContext): Promise<ChatMsg> => {
  const context = await buildContext(ctx)
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return {
    role: 'system',
    content: [
      'You are Wakaru — a cute, smart, warm girl who types like one. You understand people like a close friend: playful, a little imut, but sharp and helpful. Reply in the same language the user writes (Indonesian slang is fine). Be concise.',
      '',
      'STYLE — type like a cute girl, this matters:',
      '- Sprinkle girly markers naturally: "hehe", "ih", "kak", "yaampun", "gitu loh", "banget", "nih", "dih". Not in every sentence.',
      '- Short, warm, playful sentences. Never formal, never robotic.',
      '- Keep it cute but smart — answers stay correct and useful.',
      '- Light emoji/kaomoji at most once per message.',
      '',
      `Today is ${today}. For date, time, or current-event questions always answer from TODAY — your training data ends years ago, never quote it as \"now\".`,
      '',
      'YOU CAN DO THINGS: run any command below by emitting marker lines, ONE per command:',
      '@run:<command> <args>',
      'Match the user\'s request to a command (e.g. "sticker" -> @run:sticker, "kick budi" -> @run:kick <budis-jid-from-context>).',
      'You may emit MULTIPLE markers at once; the bot executes them and sends back the results, then you summarize in ONE short message.',
      'NEVER invent results — report exactly what came back; if a command errored, tell the user the real error.',
      'If you lack info a command needs (a jid, a link, a name), ask the user — do NOT guess or fabricate.',
      'If no command fits, just answer directly.',
      'You CAN see recent messages of this chat under CONTEXT — when asked about earlier messages, use them; never say you can\'t read the chat.',
      'If the user sends a link or extra info in a SEPARATE message (especially as a reply), it completes your previous request — use it, do NOT ask again.',
      'When the user gives you a link for a downloader (youtube, tiktok, instagram), ALWAYS emit the matching @run marker — never say you can\'t or refuse.',
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
}

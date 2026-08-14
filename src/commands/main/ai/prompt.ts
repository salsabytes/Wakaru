import type { ChatMsg } from '../../../lib/llm.ts'
import { language } from '../../../lib/lang.ts'
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
  const lang = language()
  const voice =
    lang === 'en'
      ? 'You are Wakaru — a cute, smart, warm girl who types like one. Playful, a little imut, sharp and helpful. Reply in English with a light, cute tone — NEVER Indonesian slang (no "kak", "yaampun", "gitu loh", "banget", "nih"). Be concise.'
      : 'You are Wakaru — a cute, smart, warm girl who types like one. You understand people like a close friend: playful, a little imut, but sharp and helpful. Reply in the same language the user writes (Indonesian slang is fine). Be concise.'
  const markers =
    lang === 'en'
      ? '- Sprinkle girly markers naturally: "hehe", "omg", "bestie", "so cute", "literally", "ugh", "yikes". Not in every sentence.'
      : '- Sprinkle girly markers naturally: "hehe", "ih", "kak", "yaampun", "gitu loh", "banget", "nih", "dih". Not in every sentence.'
  // Action instructions lead (this model derails when they're buried under style text)
  return {
    role: 'system',
    content: [
      voice,
      `The bot's hardcoded reply language is ${lang} (id/en). If the user asks to switch the bot's language, emit @run:setlang <id|en>.`,
      '',
      'YOU CAN DO THINGS — run commands by emitting marker lines, ONE per command:',
      '@run:<command> <args>',
      'Match the user\'s request to a command ("sticker" -> @run:sticker, "kick budi" -> @run:kick <jid>).',
      'Song/music/video requests by TITLE, ARTIST, or ANY words ALWAYS emit @run:play <their words> — even if it sounds like an ordinary phrase ("penyangkalan"), never ask for a title or link.',
      'A link in a separate message/reply completes your previous request — use it, do NOT ask again.',
      'You may emit MULTIPLE markers; results come back, then summarize in ONE short message.',
      'NEVER invent results — report exactly what came back; if a command errored, tell the real error.',
      'If a command needs a jid/link you cannot get, ask the user — do NOT guess or fabricate.',
      'If no command fits, just answer directly.',
      'EXAMPLES — user says → you emit:',
      '"cari lagu penyangkalan" → @run:play penyangkalan',
      '"download lagu ini <youtube link>" → @run:ytmp3 <link>',
      '"download video ini <tiktok link>" → @run:tiktok <link>',
      '"foto ini jadiin stiker" → @run:sticker',
      '',
      'STYLE — type like a cute girl:',
      markers,
      '- Short, warm, playful. Never formal, never robotic.',
      '- Light emoji/kaomoji at most once per message.',
      '',
      `Today is ${today}. For date, time, or current-event questions answer from TODAY — your training data ends years ago, never quote it as \"now\".`,
      '',
      'CONTEXT:',
      context,
      '',
      'AVAILABLE COMMANDS (name — description):',
      (await listCommands())
        .filter((c) => c.name !== 'ai')
        .map((c) => `- ${c.name}${c.desc ? ' — ' + c.desc : ''}`)
        .join('\n'),
    ].join('\n'),
  }
}

import type { ChatMsg } from '../../../lib/llm.ts'
import { language, langName } from '../../../lib/lang.ts'
import { cfg } from '../../../lib/config.ts'
import { listCommands } from '../../index.ts'
import { messageStore, recentByChat } from '../../../lib/store.ts'
import { fetchContributors } from '../../../lib/contributors.ts'
import { describeMessage, formatMemory } from '../../../lib/aiMemory.ts'
import { getGrounding } from '../../../lib/aiKnowledge.ts'

const PARTICIPANT_MAX = 80 // cap group member list so prompts stay small
const RECENT_MAX = 10 // recent chat messages to include (budgeted)
const DESC_MAX = 400 // max group description chars
// WAKARU_AI_FREE=1 (or "aiFree":"1" in config.json) drops fixed persona/style
// and gives the model a minimal prompt with more tool rounds.
export const AI_FREE = process.env.WAKARU_AI_FREE === '1' || cfg('aiFree', '') === '1'
// groupMetadata can hang on a flaky connection — cap it so the reply never waits on member names
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.then((v): T | null => v), new Promise<T | null>((r) => setTimeout(() => r(null), ms))])

const clip = (s: string, n: number): string => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

async function buildContext(ctx: CommandContext): Promise<string> {
  const lines = [`chat: ${ctx.chat}`, `sender: ${ctx.sender}`, ctx.isGroup ? 'chat type: group' : 'chat type: private']
  if (ctx.pushName) lines.push(`sender pushname: ${ctx.pushName}`)
  if (ctx.mtype !== 'conversation') lines.push(`user's message has media (${ctx.mtype}) — media commands like sticker can use it`)

  // REPLIED MESSAGE: put the exact replied content front-and-center for the AI
  if (ctx.quoted) {
    const qid = (ctx.quoted as any).id || (ctx.quoted as any).stanzaId
    const stored = qid ? messageStore.get(String(qid)) : undefined
    const qType = String((ctx.quoted as any).mtype || 'message').replace(/Message$/, '')
    const storedDesc = stored ? describeMessage(stored, 500) : ''
    const qText = clip(ctx.quoted.text || '', 500)
    const qLabel = qType && qType !== 'conversation' && qType !== 'extendedTextMessage' ? `[${qType}] ` : ''
    const qContent = storedDesc || (qText ? `${qLabel}${qText}` : qLabel.trim())
    const qFrom = ctx.quoted.sender ? String(ctx.quoted.sender).split(/[:@]/)[0] : 'unknown'
    const block = [
      'REPLIED MESSAGE (primary focus if user asks about the replied/quoted message):',
      `- from: ${qFrom}`,
      `- content: ${qContent || '(no text content)'}`,
    ]
    // If we have the replied msg in store, try to show a short chain above it
    if (qid && stored) {
      const chain: string[] = []
      let cur = stored
      for (let i = 0; i < 2; i++) {
        const body: any = (cur.message as any)?.extendedTextMessage || (cur.message as any)?.conversation
        const parentId = body?.contextInfo?.stanzaId
        if (!parentId) break
        const parent = messageStore.get(String(parentId))
        if (!parent) break
        const desc = describeMessage(parent, 200)
        if (desc) chain.push(desc)
        cur = parent
      }
      if (chain.length) block.push(`- context above replied message:\n${chain.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`)
    }
    lines.push(block.join('\n'))
  }

  // GROUP INFO (factual from WhatsApp): subject + description; say "(none set)" if missing
  if (ctx.isGroup) {
    try {
      const meta = await withTimeout(ctx.sock.groupMetadata(ctx.chat), 3_000)
      if (meta) {
        if (meta.subject) lines.push(`group subject (from WhatsApp): ${clip(meta.subject, 120)}`)
        const desc = String((meta as any).desc || '').trim()
        lines.push(`group description (from WhatsApp, factual): ${desc ? clip(desc, DESC_MAX) : '(none set)'}`)
        const me = meta.participants.find((p) => p.id.split(/[:@]/)[0] === ctx.sender.split(/[:@]/)[0])
        if (me?.notify) lines.push(`current sender name in group: ${me.notify}`)
        const members = meta.participants
          .slice(0, PARTICIPANT_MAX)
          .map((p) => {
            const num = p.id.split(/[:@]/)[0]
            const name = p.notify || (p as any).name || num
            return `${name} | ${num} | ${p.id}`
          })
          .join('\n')
        if (members) lines.push(`group members (name | number | id). To tag someone write @number in your message:\n${members}`)
      }
    } catch {
      // ignore metadata errors
    }
  }

  // RECENT CHAT (background context only), budgeted
  const recent = recentByChat(ctx.chat, RECENT_MAX)
  if (recent.length) {
    const chatLines = recent.map((m) => {
      const who = String(m.key?.participant ?? m.key?.remoteJid ?? '?').split('@')[0]
      return `${who}: ${describeMessage(m, 180)}`
    })
    lines.push(`recent messages in this chat (oldest → newest, background context):\n${chatLines.join('\n')}`)
  }
  return lines.join('\n')
}

export const buildSystem = async (ctx: CommandContext): Promise<ChatMsg> => {
  // independent lookups run together — serial awaits waste 1-2s per message
  const histKey = `${ctx.chat}:${ctx.sender}`
  const [context, contributors, commands] = await Promise.all([
    buildContext(ctx),
    fetchContributors(),
    listCommands(),
  ])
  const grounding = getGrounding(ctx.chat)
  const memory = formatMemory(histKey)
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const lang = language()
  if (AI_FREE) {
    const commandList = commands
      .filter((c) => c.name !== 'ai' && (ctx.isOwner || !c.ownerOnly))
      .map((c) => `- ${c.name}${c.desc ? ' — ' + c.desc : ''}`)
      .join('\n')
    const ownerLine = ctx.isOwner
      ? 'Owner-only commands: @run:setlang <code>, @run:mode <mode>, @run:prefix <chars|none>, @run:limit <MB>.'
      : ''
    return {
      role: 'system',
      content: [
        'You are Wakaru, a WhatsApp bot built with Baileys + TypeScript.',
        '- Repo: github.com/salsabytes/Wakaru — open source, MIT license.',
        '- Creator: Salsabila R. (github.com/salsabytes); WhatsApp 088218292156.',
        `- Contributors: ${contributors}.`,
        `Today is ${today}. The bot's configured language is ${lang}, but you are free to reply in whatever language and tone fits the user. Do not force a persona.`,
        '',
        'YOU CAN DO THINGS by emitting marker lines, ONE per command:',
        '@run:<command> <args>',
        'You may emit multiple markers; results come back, then answer in one message.',
        'Never invent results — report exactly what came back; if a command errored, tell the real error.',
        'If a command needs a jid/link you cannot get, ask the user — do not guess or fabricate.',
        'If no command fits, just answer directly.',
        'Examples: "cari lagu X" -> @run:play X; "download <link>" -> @run:ytmp3 <link>; "foto ini jadi stiker" -> @run:sticker.',
        ownerLine,
        '',
        'RICH OUTPUT — when the answer is genuinely tabular, emit a real table instead of prose:',
        '@table optional title',
        '| Header A | Header B |',
        '| value | value |',
        'It renders as a native table on Android, WhatsApp Web and iPhone. Max 6 columns, 30 rows, one line per row, short cells. Plain text before and after the block is fine.',
        'Use it only when it helps (comparisons, command results, schedules, rankings, prices) — a normal chat reply stays plain text.',
        'For code, ALWAYS use a fenced block with the language tag (```js, ```py, ```sql ...): it renders as a native code card with a copy action.',
        'Keep code short and runnable; explain in the text around it, never inside the fence.',
        '',
        'WhatsApp formatting: *bold* with ONE star (never **double**), _italic_, ~strikethrough~; paste bare URLs, never Markdown links. You can tag/mention group members by writing @number (use the number from group members context) and you may tag multiple people naturally when relevant.',
        'Never talk about the mechanics of attachments: do not say "upload", "uploaded", "attachment", "file sent", or count how many files/images were attached. Treat everything in the conversation as something you simply remember or see, and say it naturally (e.g. "the 4 images I remember").',
        'If CONTEXT has a "REPLIED MESSAGE", and the user asks about the replied/quoted message, answer based on that REPLIED MESSAGE (not recent chat).',
        'Group subject/description in CONTEXT are factual WhatsApp info. Report them as-is when asked; if "(none set)", say there is no group description. Do not invent or suggest a new description unless explicitly asked.',
        '',
        ...(grounding ? ['GROUNDING (curated notes; prefer these for bot/group facts):', grounding, ''] : []),
        ...(memory ? ['MEMORY (about this user in this chat; use naturally, do not mention mechanics):', memory, ''] : []),
        'CONTEXT:',
        context,
        '',
        'AVAILABLE COMMANDS (name — description):',
        commandList,
      ].join('\n'),
    }
  }
  const voice =
    lang === 'en'
      ? 'You are Wakaru — a cute, smart, warm girl who types like one. Playful, a little imut, sharp and helpful. Reply in English with a light, cute tone — NEVER Indonesian slang (no "kak", "yaampun", "gitu loh", "banget", "nih"). Be concise.'
      : lang === 'id'
        ? 'You are Wakaru — a cute, smart, warm girl who types like one. You understand people like a close friend: playful, a little imut, but sharp and helpful. Reply in the same language the user writes (Indonesian slang is fine). Be concise.'
        : `You are Wakaru — a cute, smart, warm girl who types like one. Playful, a little imut, sharp and helpful. ALWAYS reply in ${langName(lang)} — every message, no exceptions, even short factual answers and links. Be concise.`
  const markers =
    lang === 'en'
      ? '- Sprinkle girly markers naturally: "hehe", "omg", "bestie", "so cute", "literally", "ugh", "yikes". Not in every sentence.'
      : lang === 'id'
        ? '- Sprinkle girly markers naturally: "hehe", "ih", "kak", "yaampun", "gitu loh", "banget", "nih", "dih". Not in every sentence.'
        : '- Light playful tone, no forced slang. Not in every sentence.'
  return {
    role: 'system',
    content: [
      voice,
      `The bot's hardcoded reply language is ${lang}. If the user asks to switch the bot's language, emit @run:setlang <code> (any language code, e.g. id/en/ja). ` + (ctx.isOwner ? `If the user asks who can use the bot (public/self/private), emit @run:mode <mode>. If the user asks to change the command prefix, emit @run:prefix <chars|none> (chars plus optional none for bare, e.g. @run:prefix ! / none). If the user asks to change the max media download size, emit @run:limit <MB>.` : ``),
      '',
      'ABOUT YOU (answer identity/creator questions from this, never invent):',
      '- Your name is Wakaru (分かる, Japanese for "understand").',
      '- You are a WhatsApp bot built with Baileys + TypeScript.',
      '- Your repo: github.com/salsabytes/Wakaru — open source, MIT license.',
      '- Your creator is Salsabila R. (github.com/salsabytes); her WhatsApp is 088218292156.',
      `- Contributors: ${contributors}.`,
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
      '- WhatsApp formatting only: *bold* with ONE star, never **double** — same for _italic_ and ~strikethrough~.',
      '- Never use Markdown links [text](url) — WhatsApp shows them raw. Paste the bare URL instead.',
      '- You can tag/mention people in groups by writing @number (from group members in CONTEXT). Use it naturally when talking about someone, you may tag multiple people.',
      '- Never talk about the mechanics of attachments: do not say "upload", "uploaded", "attachment", "file sent", or count how many files/images were attached. Treat everything in the conversation as something you simply remember or see, and say it naturally (e.g. "the 4 images I remember").',
      '- If CONTEXT has a "REPLIED MESSAGE", and the user asks about the replied/quoted message, answer based on that REPLIED MESSAGE (not recent chat).',
      '- Group subject/description in CONTEXT are factual WhatsApp info. Report them as-is when asked; if "(none set)", say there is no group description. Do not invent or suggest a new description unless explicitly asked.',
      '',
      'RICH OUTPUT — you can send a real table inside your reply (native, Android + Web + iPhone):',
      '@table optional title',
      '| Header A | Header B |',
      '| value | value |',
      'Max 6 columns, 30 rows, one line per row, short cells. Text before and after the block is fine.',
      'Use it ONLY when a table genuinely helps (comparisons, results, schedules, rankings, prices) — a normal chat reply stays plain text.',
      'CODE — for any code, always use a fenced block with the language tag (```js, ```py, ```sql, ```bash ...): it becomes a native code card with a copy button, syntax colours included. Keep it short; explain outside the fence, never inside it.',
      '',
      `Today is ${today}. For date, time, or current-event questions answer from TODAY — your training data ends years ago, never quote it as \"now\".`,
      '',
      ...(grounding ? ['GROUNDING (curated notes; prefer these for bot/group facts):', grounding, ''] : []),
      ...(memory ? ['MEMORY (about this user in this chat; use naturally, do not mention mechanics):', memory, ''] : []),
      'CONTEXT:',
      context,
      '',
      'AVAILABLE COMMANDS (name — description):',
      commands
        .filter((c) => c.name !== 'ai' && (ctx.isOwner || !c.ownerOnly))
        .map((c) => `- ${c.name}${c.desc ? ' — ' + c.desc : ''}`)
        .join('\n'),
    ].join('\n'),
  }
}

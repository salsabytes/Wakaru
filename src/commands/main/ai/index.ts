import { askLLM, type AiFileInput, type ChatMsg } from '../../../lib/llm.ts'
import { fileMime, fileNameOf } from '../../../lib/fileinfo.ts'
import { tx } from '../../../lib/lang.ts'
import { logger } from '../../../lib/logger.ts'
import { sendRichParts } from '../../../lib/richmsg.ts'
import { clearPendingAiFiles, getAiHistory, getPendingAiFiles, pendingAiFilesAge, saveAiHistory, trimFilesToBudget } from '../../../lib/aiHistory.ts'
import { handleMemoryIntent, scheduleMemoryRefresh } from '../../../lib/aiMemory.ts'
import { AI_FREE, buildSystem } from './prompt.ts'
import { hasRich, parseRich, richToText, waText } from './rich.ts'
import { parseRuns, runTool } from './tools.ts'
import { autoChecks, checkLabel, extractChecks, runChecks } from './checks.ts'

const MAX_ROUNDS = AI_FREE ? 6 : 4 // how many tool/AI/check back-and-forth rounds
const MAX_AI_FILES = 4 // max files we attach per AI request (keeps it light)
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024 // 20MB cap per file

// Read code/text documents straight into the prompt.
// Why: the AI API may treat an octet-stream attachment as an opaque blob.
// Inline text always works.
const TEXT_LIKE = /^(text\/|application\/(json|xml|yaml|x-yaml)|image\/svg)/
const INLINE_TEXT_MAX = 16_000

const splitTextFiles = (files: AiFileInput[]): { attach: AiFileInput[]; inline: string[] } => {
  const attach: AiFileInput[] = []
  const inline: string[] = []
  const seen = new Set<string>()
  for (const f of files) {
    const key = `${f.name || ''}|${String(f.data || '').slice(0, 64)}|${String(f.data || '').length}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!TEXT_LIKE.test(String(f.mime || ''))) {
      attach.push(f)
      continue
    }
    try {
      const text = Buffer.from(String(f.data || ''), 'base64').toString('utf8')
      if (!text.trim()) {
        attach.push(f)
        continue
      }
      const clipped = text.length > INLINE_TEXT_MAX ? text.slice(0, INLINE_TEXT_MAX) + '\n[... terpotong]' : text
      inline.push(`--- ${f.name || 'file'} ---\n${clipped}`)
    } catch {
      attach.push(f)
    }
  }
  return { attach, inline }
}

// Media types the AI flow knows how to collect
const MEDIA_TYPES = new Set(['imageMessage', 'documentMessage', 'videoMessage', 'audioMessage', 'stickerMessage'])

// Remembered media should only ride along when the user actually asks about it.
// Otherwise every later question drags the old image back into the prompt and
// the model keeps talking about that image.
const ASKS_MEDIA =
  /(gambar|foto|image|photo|picture|sticker|stiker|video|audio|suara|voice|dokumen|document|pdf|file|lampiran|attachment|screenshot|ss\b|selfie|wajah|muka|orang|baju|warna|objek|tulisan|teks\s+di|apa\s+ini|ini\s+apa|siapa|liat|lihat|baca|analisis|jelasin|jelaskan|deskripsi|describe|read\s+(this|the)|what.+?(this|image|photo|picture)|who.+?(this|that))/i

const asksAboutMedia = (text: string): boolean => ASKS_MEDIA.test(String(text || ''))

// Only show the live progress bubble for coding-ish requests (or once a code
// check actually runs) — normal chats should just get a reply.
const ASKS_CODE =
  /(kode|code|ngoding|coding|program|script|javascript|typescript|\bjs\b|\bts\b|html|css|python|php|java|c\+\+|sql|react|node|npm|api|fungsi|function|bug|error|debug|fix|perbaiki|benerin|bikin(?:in|kan)?\s+(web|situs|game|aplikasi|app|bot|script|tools?)|buat(?:in|kan)?\s+(web|situs|game|aplikasi|app|bot|script|tools?)|website|landing|komponen|component|syntax|compile|build)/i

// Models sometimes answer a build request with "login to enable visual creation"
// instead of the code. Detect that excuse on round one and force a real answer.
const REFUSAL =
  /(harus|perlu|butuh).{0,40}(login|log in|sign in|sign up|akun|account|langganan|subscribe|upgrade|premium)|fitur.{0,30}(pembuatan visual|visual|dibuat|diaktifkan|tersedia)|(login|sign in).{0,30}(untuk|to).{0,20}(mengaktifkan|enable)/i

// Download attached/replied media into base64 files for the AI (with size checks)
const collectAiFiles = async (ctx: CommandContext): Promise<{ files: AiFileInput[]; notes: string[] }> => {
  const sources: Array<{ mtype?: string; mimetype?: string; fileName?: string; download: () => Promise<Buffer> }> = []
  if (ctx.quoted && MEDIA_TYPES.has(ctx.quoted.mtype)) sources.push(ctx.quoted)
  if (MEDIA_TYPES.has(ctx.mtype) && ctx.download) {
    sources.push({ mtype: ctx.mtype, mimetype: ctx.mimetype, fileName: ctx.fileName, download: ctx.download })
  }
  const files: AiFileInput[] = []
  const notes: string[] = []
  for (const src of sources.slice(0, MAX_AI_FILES)) {
    try {
      const buf = await src.download()
      if (!buf?.length) { notes.push('file kosong'); continue }
      if (buf.length > MAX_AI_FILE_BYTES) { notes.push(`file terlalu besar (> ${MAX_AI_FILE_BYTES >> 20}MB)`); continue }
      const mime = fileMime(src.mtype, src.mimetype, src.fileName)
      files.push({ data: buf.toString('base64'), mime, name: fileNameOf(src.mtype, mime, src.fileName) })
    } catch (e) {
      notes.push(`gagal baca file: ${(e as Error).message}`)
    }
  }
  return { files, notes }
}

// Live "agentic process" bubble: sent once, then edited in place each round.
interface AiProgress {
  update: (text: string) => Promise<void>
}

const startProgress = async (ctx: CommandContext, text: string): Promise<AiProgress> => {
  let key: any
  try {
    const sent = await ctx.sock.sendMessage(ctx.chat, { text })
    key = sent?.key
  } catch {
    key = undefined
  }
  return {
    update: async (t: string) => {
      if (!key) return
      try {
        await ctx.sock.sendMessage(ctx.chat, { text: t, edit: key })
      } catch {
        key = undefined // editing unsupported — keep the first bubble, don't spam
      }
    },
  }
}

// Run AI + optional @run tool loop. Returns the text to send, or null when a
// tool already posted visible output (so we don't double-reply).
const runExchange = async (msgs: ChatMsg[], ctx: CommandContext, showProcess = false): Promise<string | null> => {
  const title = await tx('aiProcessTitle')
  let progress: AiProgress | undefined
  let lines: string[] = []
  const ensure = async (): Promise<AiProgress> => {
    if (!progress) progress = await startProgress(ctx, `${title}\n${await tx('aiThinking')}`)
    return progress
  }
  const show = async (status: string): Promise<void> => {
    const p = await ensure()
    await p.update([title, ...lines, status].join('\n'))
  }
  const done = async (): Promise<void> => {
    if (progress) await show(lines.length ? await tx('aiCheckDone') : await tx('aiDone'))
  }
  if (showProcess) await ensure()
  let refusalFixed = false
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
    // No login/account exists for this bot: if the model stalls on that excuse
    // for a build request, hand it back with the only acceptable answer shape.
    const asked = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
    if (!refusalFixed && round === 0 && ASKS_CODE.test(asked) && REFUSAL.test(reply) && !reply.includes('```')) {
      refusalFixed = true
      await ensure()
      msgs.push({ role: 'assistant', content: reply })
      msgs.push({
        role: 'user',
        content:
          'No login, account, subscription or upgrade is needed — you can build this entirely in a self-contained HTML file. ' +
          'Output the complete working code now in ONE ```html fence, with a short intro before it.',
      })
      continue
    }
    // Agentic verification: explicit ```check-* blocks, or — since some models
    // ignore the instruction — auto-check any JS/HTML fence in the reply. The
    // real result goes back to the model so it can fix its own code.
    const parsed = extractChecks(reply)
    const clean = parsed.checks.length ? parsed.clean : reply
    const checks = parsed.checks.length ? parsed.checks : autoChecks(reply)
    if (checks.length) {
      await ensure()
      const checked = await runChecks(checks)
      lines = checked.map((r) => `${r.ok ? '✅' : '❌'} ${checkLabel(r.kind)}`)
      if (round === MAX_ROUNDS - 1) {
        await done()
        return clean || checked.map((r) => r.text).join('\n')
      }
      if (!checked.every((r) => r.ok)) {
        await show(await tx('aiCheckFixing'))
        msgs.push({ role: 'assistant', content: reply })
        msgs.push({
          role: 'user',
          content:
            `code check results:\n${checked.map((r) => r.text).join('\n')}\n\n` +
            'Fix the real error and send the final version (re-check if needed). ' +
            'Check blocks are invisible to the user — always include the final working code in your reply.',
        })
        continue
      }
      await done()
    }
    const runs = parseRuns(clean)
    if (!runs.length) {
      await done()
      return clean || reply
    }
    if (progress) await show(await tx('aiTools', { name: runs.map((r) => r.name).join(', ') }))
    const results: string[] = []
    let sent = false
    let failed = false
    for (const r of runs) {
      const out = await runTool(r, ctx)
      results.push(out.text)
      sent ||= out.sent
      failed ||= out.failed
    }
    if (sent && !failed) {
      await done()
      return null
    }
    msgs.push({ role: 'assistant', content: reply })
    const resultPrompt = AI_FREE
      ? `tool results:\n${results.join('\n')}\nReply to the user naturally.`
      : `tool results:\n${results.join('\n')}\nReply to the user in ONE short message.`
    msgs.push({ role: 'user', content: resultPrompt })
    if (round === MAX_ROUNDS - 1) {
      await done()
      return results.join('\n')
    }
  }
  await done()
  return ''
}

export default {
  name: 'ai',
  desc: 'chat or DO things: .ai <msg> - can run any command, read attached/replied files (best-effort), remembers each sender',
  run: async (ctx: CommandContext) => {
    // 1) Read user text and collect any files (current msg / reply / pending)
    let query = ctx.text.trim()
    ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {})
    const { files: directFiles, notes } = await collectAiFiles(ctx)
    const histKey = `${ctx.chat}:${ctx.sender}`
    // Media the user just sent (say, a photo then ".ai keren ga?") still counts,
    // so the natural flow works without requiring media keywords.
    const mediaAge = pendingAiFilesAge(histKey)
    const wantsMedia = asksAboutMedia(query) || (mediaAge !== undefined && mediaAge < 3 * 60_000)
    const pendingFiles = directFiles.length || !wantsMedia ? [] : getPendingAiFiles(histKey)
    const { attach: files, inline } = splitTextFiles([...pendingFiles, ...directFiles].slice(-MAX_AI_FILES))
    if (!query && (files.length || inline.length)) query = 'Tolong analisis file ini.'
    if (!query) return ctx.reply(await tx('aiUsage', { prefix: ctx.prefix }))

    // 1b) Explicit memory intent: "remember ..." / "forget my memory" (fast, deterministic)
    const memIntent = handleMemoryIntent(histKey, query)
    if (memIntent) {
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      const msg = memIntent === 'forgot'
        ? 'Oke, ingatan aku soal kamu di chat ini sudah aku hapus ya.'
        : 'Oke, aku ingat itu ya.'
      return ctx.reply(msg)
    }

    // 2) Build prompt: system + history + this message (+ files), then ask AI
    let finalText: string | null = ''
    // If the user replied to a message, put it directly in the prompt.
    // Why: ensures the AI sees the exact replied content (even if it's old/missing from store).
    let quotedBlock = ''
    if (ctx.quoted) {
      const qRawType = String((ctx.quoted as any).mtype || '')
      const qType = qRawType.replace(/Message$/, '')
      const qText = String(ctx.quoted.text || '').trim()
      const qFrom = ctx.quoted.sender ? String(ctx.quoted.sender).split(/[:@]/)[0] : ''
      const isText = qRawType === 'conversation' || qRawType === 'extendedTextMessage'
      const label = qType && !isText ? `[${qType}] ` : ''
      const content = qText ? `${label}${qText}` : (qType && !isText ? `[${qType}${ctx.quoted.fileName ? ': ' + ctx.quoted.fileName : ''}]` : '')
      if (content) {
        quotedBlock = `[Replied message${qFrom ? ` from ${qFrom}` : ''}]\n${content.slice(0, 1200)}\n\n`
      }
    }
    const baseText = quotedBlock ? `${quotedBlock}${query}` : query
    const extra = [
      notes.length ? `[catatan file: ${notes.join('; ')}]` : '',
      inline.length ? `[isi file]\n${inline.join('\n\n')}` : '',
    ].filter(Boolean)
    const userText = extra.length ? `${baseText}\n\n${extra.join('\n\n')}` : baseText
    try {
      const system = await buildSystem(ctx)
      // Old media in history is only re-sent when the user asks about media;
      // budget 0 strips it so unrelated chats don't keep seeing the image.
      const history = trimFilesToBudget(
        getAiHistory(histKey),
        wantsMedia ? MAX_AI_FILES - files.length : 0,
      )
      const msgs: ChatMsg[] = [
        system,
        ...history,
        { role: 'user', content: userText, ...(files.length ? { files } : {}) },
      ]
      finalText = await runExchange(msgs, ctx, ASKS_CODE.test(userText))
    } catch (err) {
      finalText = `x ${(err as Error).message}`
    }

    // Tool already posted output; don't duplicate it.
    if (finalText === null) return

    // 3) Save history, clear used pending files, and refresh memory in background
    if (finalText.trim()) {
      saveAiHistory(histKey, userText, finalText, files)
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      // Async (non-blocking): summarize/update durable memory when useful
      scheduleMemoryRefresh(histKey, getAiHistory(histKey), askLLM)
    } else {
      // Empty model reply: never leave a stuck typing indicator.
      finalText = await tx('aiEmpty')
    }

    // 4) Send reply (rich/table/code card if present, else plain text)
    const waSafe = waText(finalText)
    if (!waSafe.trim()) return
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

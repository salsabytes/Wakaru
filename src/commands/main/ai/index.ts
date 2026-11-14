import { askLLM, type AiFileInput, type ChatMsg } from '../../../lib/llm.ts'
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

// Pick a best-guess MIME type for a WhatsApp media message
const mimeOf = (mtype?: string, mimetype?: string, fileName?: string): string => {
  const m = String(mimetype || '').split(';')[0].trim()
  if (m) return m
  if (mtype === 'imageMessage') return 'image/jpeg'
  if (mtype === 'stickerMessage') return 'image/webp'
  if (mtype === 'videoMessage') return 'video/mp4'
  if (mtype === 'audioMessage') return 'audio/mpeg'
  if (mtype === 'documentMessage') {
    const ext = String(fileName || '').split('.').pop()?.toLowerCase() || ''
    if (ext === 'pdf') return 'application/pdf'
    if (ext === 'txt') return 'text/plain'
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  return 'application/octet-stream'
}

// Give the file a friendly name if WhatsApp didn't provide one
const nameOf = (mtype?: string, mime?: string, fileName?: string): string => {
  if (fileName) return fileName
  const ext = (mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin'
  if (mtype === 'imageMessage') return `image.${ext}`
  if (mtype === 'stickerMessage') return 'sticker.webp'
  if (mtype === 'videoMessage') return `video.${ext}`
  if (mtype === 'audioMessage') return `audio.${ext}`
  return `file.${ext}`
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
  /(kode|code|ngoding|coding|program|script|javascript|typescript|\bjs\b|\bts\b|html|css|python|php|java|c\+\+|sql|react|node|npm|api|fungsi|function|bug|error|debug|fix|perbaiki|benerin|bikin\s+(web|situs|game|aplikasi|bot|script)|website|landing|komponen|component|syntax|compile|build)/i

// Download attached/replied media into base64 files for the AI (with size checks)
const collectAiFiles = async (ctx: CommandContext): Promise<{ files: AiFileInput[]; notes: string[] }> => {
  const sources: Array<{ mtype?: string; mimetype?: string; fileName?: string; download: () => Promise<Buffer> }> = []
  if (ctx.quoted && MEDIA_TYPES.has(ctx.quoted.mtype)) sources.push(ctx.quoted)
  if (MEDIA_TYPES.has(ctx.mtype) && ctx.download) {
    sources.push({ mtype: ctx.mtype, mimetype: ctx.mimetype, download: ctx.download })
  }
  const files: AiFileInput[] = []
  const notes: string[] = []
  for (const src of sources.slice(0, MAX_AI_FILES)) {
    try {
      const buf = await src.download()
      if (!buf?.length) { notes.push('file kosong'); continue }
      if (buf.length > MAX_AI_FILE_BYTES) { notes.push(`file terlalu besar (> ${MAX_AI_FILE_BYTES >> 20}MB)`); continue }
      const mime = mimeOf(src.mtype, src.mimetype, src.fileName)
      files.push({ data: buf.toString('base64'), mime, name: nameOf(src.mtype, mime, src.fileName) })
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

// Run AI + optional @run tool loop; returns final text to send (or '' if tool replied)
const runExchange = async (msgs: ChatMsg[], ctx: CommandContext, showProcess = false): Promise<string> => {
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
      return ''
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
    const files = [...pendingFiles, ...directFiles].slice(-MAX_AI_FILES)
    if (!query && files.length) query = 'Tolong analisis file ini.'
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
    let finalText = ''
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
    const userText = notes.length ? `${baseText}\n\n[catatan file: ${notes.join('; ')}]` : baseText
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

    // 3) Save history, clear used pending files, and refresh memory in background
    if (finalText.trim()) {
      saveAiHistory(histKey, userText, finalText, files)
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      // Async (non-blocking): summarize/update durable memory when useful
      scheduleMemoryRefresh(histKey, getAiHistory(histKey), askLLM)
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

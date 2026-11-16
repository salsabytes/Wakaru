import { askLLM, type AiFileInput, type ChatMsg } from '../../../lib/llm.ts'
import { asksForListing, createFileTools, ensureListingShown, parseAgentActions, repoNudge, runAgentAction, wantsCodeChange, REPO_ROOT, type FileTools } from '../../../lib/agentFiles.ts'
import { sendRepoPath } from '../../../lib/agentSend.ts'
import { fileMime, fileNameOf } from '../../../lib/fileinfo.ts'
import { tx } from '../../../lib/lang.ts'
import { logger } from '../../../lib/logger.ts'
import { sendRichParts } from '../../../lib/richmsg.ts'
import { clearPendingAiFiles, getAiHistory, getPendingAiFiles, pendingAiFilesAge, saveAiHistory, trimFilesToBudget } from '../../../lib/aiHistory.ts'
import { handleMemoryIntent, scheduleMemoryRefresh } from '../../../lib/aiMemory.ts'
import { AI_FREE, buildRepoSystem, buildSystem } from './prompt.ts'
import { REPO_TASK, classifyIntent, routeText, takeModeOverride, type AiRoute } from '../../../lib/aiRoute.ts'
import { setAiBusy } from '../../../lib/aiStatus.ts'
import { hasRich, parseRich, richToText, waText } from './rich.ts'
import { parseRuns, runTool } from './tools.ts'
import { autoChecks, checkLabel, extractChecks, runChecks } from './checks.ts'

const MAX_ROUNDS = AI_FREE ? 6 : 4 // how many tool/AI/check back-and-forth rounds
const MAX_AI_FILES = 4 // max files we attach per AI request (keeps it light)
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024 // 20MB cap per file

// Inline text files straight into the prompt.
// Why: the AI API may see an octet-stream attachment as an opaque blob.
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

// Old media only rides along when the user actually asks about it.
// Otherwise every later question drags the old image back in,
// and the model keeps talking about that image.
const ASKS_MEDIA =
  /(gambar|foto|image|photo|picture|sticker|stiker|video|audio|suara|voice|dokumen|document|pdf|file|lampiran|attachment|screenshot|ss\b|selfie|wajah|muka|orang|baju|warna|objek|tulisan|teks\s+di|apa\s+ini|ini\s+apa|siapa|liat|lihat|baca|analisis|jelasin|jelaskan|deskripsi|describe|read\s+(this|the)|what.+?(this|image|photo|picture)|who.+?(this|that))/i

const asksAboutMedia = (text: string): boolean => ASKS_MEDIA.test(String(text || ''))

// Show the live progress bubble only for coding-ish asks.
// Normal chat just gets a reply.
const ASKS_CODE =
  /(kode|code|ngoding|coding|program|script|javascript|typescript|\bjs\b|\bts\b|html|css|python|php|java|c\+\+|sql|react|node|npm|api|fungsi|function|bug|error|debug|fix|perbaiki|benerin|bikin(?:in|kan)?\s+(web|situs|game|aplikasi|app|bot|script|tools?)|buat(?:in|kan)?\s+(web|situs|game|aplikasi|app|bot|script|tools?)|website|landing|komponen|component|syntax|compile|build)/i

// Some models answer a build request with "login to enable visual creation"
// instead of code. Catch that excuse on round one and force a real answer.
const REFUSAL =
  /(harus|perlu|butuh).{0,40}(login|log in|sign in|sign up|akun|account|langganan|subscribe|upgrade|premium)|fitur.{0,30}(pembuatan visual|visual|dibuat|diaktifkan|tersedia)|(login|sign in).{0,30}(untuk|to).{0,20}(mengaktifkan|enable)/i

// "Siap, sudah aku hapus" with zero tool calls is a lie. A listing answer is not.
// That check lives in repoNudge() so it can see how many tools ran.

// Download attached/replied media into base64 for the AI, with size checks.
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

// Live "agentic process" bubble: sent once, then edited in place every round.
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

// Owner-only repo access. One tool session per `.ai` call, made on first use.
interface RepoSession {
  tools?: FileTools
}

const ensureTools = async (repo: RepoSession): Promise<FileTools> => {
  repo.tools ??= await createFileTools(REPO_ROOT)
  return repo.tools
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + '\n[...]' : s)

// Nothing ships unless typecheck AND tests pass. Otherwise roll back.
const verifyChanges = async (tools: FileTools): Promise<string> => {
  const touched = tools.written()
  if (!touched.length) return ''
  try {
    const check = await tools.typecheck()
    if (!check.ok) {
      const restored = await tools.rollback()
      return `[!] typecheck failed - rolled back ${restored.length} file(s), repo untouched.\n${clip(check.text, 1500)}`
    }
    const tests = await tools.test()
    if (!tests.ok) {
      const restored = await tools.rollback()
      return `[!] tests failed - rolled back ${restored.length} file(s), repo untouched.\n${clip(tests.text, 1500)}`
    }
    return `[ok] typecheck ok - tests ok - changed: ${touched.join(', ')}`
  } catch (err) {
    return `[!] verification error: ${(err as Error).message}`
  }
}

// Run the AI + @run tool loop.
// Returns the text to send, or null if a tool already posted something visible
// (so we don't double-reply).
const runExchange = async (
  msgs: ChatMsg[],
  ctx: CommandContext,
  showProcess = false,
  repo?: RepoSession,
): Promise<string | null> => {
  const title = await tx('aiProcessTitle')
  const maxRounds = repo ? 8 : MAX_ROUNDS
  const lastRound = maxRounds - 1
  let progress: AiProgress | undefined
  let lines: string[] = []
  let toolsRun = 0 // executed tool calls, including read-only @ls/@read
  // Raw @ls output. Kept so a "semua folder sudah dicek" summary can't hide the
  // structure the user asked for. The model's text is never our only source.
  const lsSeen = new Map<string, string>()
  const firstUserText = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  const wantsListing = !!repo && asksForListing(firstUserText)
  const wantsChange = !!repo && wantsCodeChange(firstUserText)
  const finish = (text: string): string => (wantsListing ? ensureListingShown(text, [...lsSeen.values()]) : text)

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
  // One progress line per tool step so the user sees what's happening.
  const stepLabel = (tool: string, arg: string): string => {
    if (tool === 'ls') return `📂 ls ${arg || '.'}`
    if (tool === 'read') return `📄 read ${arg}`
    if (tool === 'grep') return `🔍 grep ${arg}`
    if (tool === 'search') return `🌐 searching: ${arg}`
    if (tool === 'fetch') return `🌐 reading: ${arg}`
    if (tool === 'write') return `✏️ write ${arg}`
    if (tool === 'rm') return `🗑️ rm ${arg}`
    if (tool === 'send') return `📤 send ${arg}`
    if (tool === 'typecheck') return '🧪 typecheck'
    if (tool === 'test') return `🧪 test ${arg}`.trim()
    return `▶ ${tool} ${arg}`.trim()
  }
  const logStep = (line: string): void => {
    lines.push(line)
    // phone-readable: keep only the latest steps
    while (lines.length > 12) lines.shift()
  }
  if (showProcess) await ensure()
  let refusalFixed = false
  let nudges = 0
  // True once a file is written/removed in this run.
  let wrote = false
  for (let round = 0; round < maxRounds; round++) {
    let reply: string
    try {
      reply = (await askLLM(msgs)).trim()
    } catch (err) {
      if (round === 0) {
        await new Promise((r) => setTimeout(r, 1500))
        reply = (await askLLM(msgs)).trim()
      } else throw err
    }
    // This bot has no login/account. If the model stalls on that excuse
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
    // Owner repo tools: read/search/edit files, then see real tsc/test errors.
    if (repo) {
      const agent = parseAgentActions(reply)
      // No tool calls in the reply? Nudge the model to keep working (not stall/chatter).
      if (!agent.actions.length && nudges < 2) {
        const nudge = repoNudge(reply, toolsRun, wantsChange && !wrote)
        if (nudge) {
          nudges++
          msgs.push({ role: 'assistant', content: reply })
          msgs.push({
            role: 'user',
            content: nudge === 'stall'
              ? 'You DO have repo access in this session: the bot runs every @tool line you send ' +
                'and replies with the real output. Do not describe a plan and never say access is ' +
                'unavailable. Start now with tool lines (for example: @ls src, then @read <file>).'
              : nudge === 'listing'
                ? 'You have not listed anything yet, so you have no real paths. Run the tool now: ' +
                  '@ls -r . (one call for the whole subtree), then answer with the paths exactly ' +
                  'as the tool returned them (a ```txt tree). Do not invent directories.'
                : nudge === 'continue'
                  ? 'Reading was only the first step and you have not changed anything yet. Do not ' +
                    'send progress chatter ("sebentar", "aku lanjutkan", "udah aman") and do not wait ' +
                    'for the user. Now @write the new or changed file with its full content, run ' +
                    '@typecheck and @test, then finish with @done in this same turn.'
                  : 'You have not run any tool yet, so nothing changed. Do the work now: @read the ' +
                    'relevant file, then @rm to delete or @write to change it, then @typecheck and ' +
                    '@test, and finish with @done.',
          })
          continue
        }
      }
      if (agent.actions.length) {
        const tools = await ensureTools(repo)
        await ensure()
        const results: string[] = []
        let doneText: string | undefined
        let failed = false
        for (const action of agent.actions.slice(0, 6)) {
          const running = action.tool !== 'done'
          if (running) await show(`⏳ ${stepLabel(action.tool, action.arg)}`)
          // @send is the one tool with a visible side effect: it posts the file itself.
          const out = action.tool === 'send'
            ? await sendRepoPath(ctx, tools.root, action.arg)
            : await runAgentAction(tools, action)
          results.push(out)
          if (action.tool === 'ls') lsSeen.set(action.arg, out)
          const bad = /^\[(?:typecheck|test)\] FAILED/m.test(out) || /^\[\w+\] error:/m.test(out)
          if (bad) failed = true
          if (running) {
            toolsRun++
            wrote ||= action.tool === 'write' || action.tool === 'rm'
            logStep(`${bad ? '❌' : '✅'} ${stepLabel(action.tool, action.arg)}`)
          }
          if (action.tool === 'done') {
            // Never accept "done" while the last check still failed.
            if (!failed) doneText = action.arg
            break
          }
        }
        if (doneText !== undefined) {
          await done()
          return finish(doneText)
        }
        if (round === lastRound) {
          await done()
          return clip(results.join('\n\n'), 3500)
        }
        // every step is logged with ✅/❌. Next round the model thinks again.
        await show(await tx('aiThinking'))
        msgs.push({ role: 'assistant', content: reply })
        msgs.push({
          role: 'user',
          content:
            `Tool results:\n${clip(results.join('\n\n'), 12_000)}\n\n` +
            'Continue. Use @done when finished.',
        })
        continue
      }
    }
    // Verification: explicit ```check-* blocks, plus auto-checks on any JS/HTML
    // fence (some models ignore the instruction).
    // The real result goes back to the model so it can fix its own code.
    const parsed = extractChecks(reply)
    const clean = parsed.checks.length ? parsed.clean : reply
    const checks = parsed.checks.length ? parsed.checks : autoChecks(reply)
    if (checks.length) {
      await ensure()
      const checked = await runChecks(checks)
      lines = checked.map((r) => `${r.ok ? '✅' : '❌'} ${checkLabel(r.kind)}`)
      if (round === lastRound) {
        await done()
        return finish(clean || checked.map((r) => r.text).join('\n'))
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
      return finish(clean || reply)
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
    if (round === lastRound) {
      await done()
      return results.join('\n')
    }
  }
  await done()
  return ''
}

export default {
  name: 'ai',
  desc: 'chat or DO things: .ai <msg> - runs commands, reads files, and (owner) reads/edits the repo with typecheck+test rollback; @repo/@chat force a mode',
  aliases: ['agent'],
  run: async (ctx: CommandContext) => {
    // 1) Read the text, collect files (this msg / replied / pending).
    // Owner can force a mode with "@repo ..." or "@chat ...".
    const { text: typed, forced } = takeModeOverride(ctx.text.trim(), ctx.isOwner)
    let query = typed
    ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {})
    const { files: directFiles, notes } = await collectAiFiles(ctx)
    const histKey = `${ctx.chat}:${ctx.sender}`
    // Media the user just sent (photo, then ".ai keren ga?") still counts.
    // So the natural flow works without media keywords.
    const mediaAge = pendingAiFilesAge(histKey)
    const wantsMedia = asksAboutMedia(query) || (mediaAge !== undefined && mediaAge < 3 * 60_000)
    const pendingFiles = directFiles.length || !wantsMedia ? [] : getPendingAiFiles(histKey)
    const { attach: files, inline } = splitTextFiles([...pendingFiles, ...directFiles].slice(-MAX_AI_FILES))
    if (!query && (files.length || inline.length)) query = 'Tolong analisis file ini.'
    if (!query) return ctx.reply(await tx('aiUsage', { prefix: ctx.prefix }))

    // 1b) Memory intent: "remember ..." / "forget my memory". Fast and deterministic.
    const memIntent = handleMemoryIntent(histKey, query)
    if (memIntent) {
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      const msg = memIntent === 'forgot'
        ? 'Oke, ingatan aku soal kamu di chat ini sudah aku hapus ya.'
        : 'Oke, aku ingat itu ya.'
      return ctx.reply(msg)
    }

    // 2) Build the prompt: system + history + this message (+ files), then ask.
    let finalText: string | null = ''
    // If the user replied to a message, put it straight in the prompt.
    // Why: the AI then sees the exact replied content, even when it is old or
    // missing from the store.
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
    // Route on what the user typed, not on file contents.
    // Sending a document must not flip an owner into repo mode.
    const routeTextNow = routeText(query, ctx.quoted?.text)
    let route: AiRoute
    if (!ctx.isOwner) {
      route = { mode: 'chat', why: 'not owner' }
    } else if (forced) {
      route = { mode: forced, why: 'manual override' }
    } else if (REPO_TASK.test(routeTextNow)) {
      route = { mode: 'repo', why: 'repo intent' }
    } else {
      route = { mode: await classifyIntent(routeTextNow), why: 'ai intent' }
    }
    const repo: RepoSession | undefined = ctx.isOwner && route.mode === 'repo' ? {} : undefined
    if (ctx.isOwner) logger.info(`ai mode: ${route.mode} (${route.why})`)
    try {
      const system = repo ? await buildRepoSystem(ctx) : await buildSystem(ctx)
      // Old media in history is only re-sent when the user asks about media.
      // Budget 0 strips it, so unrelated chats stop seeing the image.
      const history = trimFilesToBudget(
        getAiHistory(histKey),
        wantsMedia ? MAX_AI_FILES - files.length : 0,
      )
      const msgs: ChatMsg[] = [
        system,
        ...history,
        { role: 'user', content: userText, ...(files.length ? { files } : {}) },
      ]
      setAiBusy(true)
      try {
        // Progress bubble is for repo/agent work; plain chat replies stay clean.
        finalText = await runExchange(msgs, ctx, !!repo, repo)
      } catch (err) {
        finalText = `x ${(err as Error).message}`
      } finally {
        setAiBusy(false)
      }
    } catch (err) {
      finalText = `x ${(err as Error).message}`
    }

    // Owner edits are kept only when typecheck AND tests pass. Else rollback.
    if (repo?.tools) {
      try {
        const changed = repo.tools.written()
        if (changed.length) {
          const verified = await verifyChanges(repo.tools)
          finalText = finalText === null ? verified : `${finalText}\n\n${verified}`
          // Commands are cached at startup. Drop the old map so a deleted or
          // rewritten command works without a restart.
          if (verified.startsWith('[ok]') && changed.some((p) => p.startsWith('src/commands/'))) {
            const { reloadCommands } = await import('../../index.ts')
            await reloadCommands().catch((err) => logger.warn('command reload failed:', err))
          }
        }
      } finally {
        await repo.tools.dispose()
      }
    }

    // Tool already posted output; don't duplicate it.
    if (finalText === null) return

    // 3) Save history, clear used pending files, refresh memory in background.
    if (finalText.trim()) {
      saveAiHistory(histKey, userText, finalText, files)
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      // Async, non-blocking: update durable memory when it is worth it.
      scheduleMemoryRefresh(histKey, getAiHistory(histKey), askLLM)
    } else {
      // Empty model reply: never leave the typing indicator stuck.
      finalText = await tx('aiEmpty')
    }

    // 4) Send it: rich card if present, else plain text.
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

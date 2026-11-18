import { askLLM, type AiFileInput, type ChatMsg } from '../../../lib/llm.ts'
import { asksForListing, createFileTools, ensureListingShown, parseAgentActions, repoNudge, runAgentAction, wantsCodeChange, REPO_ROOT, type FileTools } from '../../../lib/agentFiles.ts'
import { sendRepoPath } from '../../../lib/agentSend.ts'
import { codegenFiles } from '../../../lib/aiCodegen.ts'
import { fileMime, fileNameOf } from '../../../lib/fileinfo.ts'
import { tx } from '../../../lib/lang.ts'
import { logger } from '../../../lib/logger.ts'
import { sendRichParts } from '../../../lib/richmsg.ts'
import { clearPendingAiFiles, getAiHistory, getPendingAiFiles, pendingAiFilesAge, saveAiHistory, trimFilesToBudget } from '../../../lib/aiHistory.ts'
import { handleMemoryIntent, scheduleMemoryRefresh, formatMemory } from '../../../lib/aiMemory.ts'
import { AI_FREE, buildAgentSystem } from './prompt.ts'
import { CONTINUE_HINT, heuristicIntent, intentToMode, routeText, smartDecide, takeModeOverride, TOPIC_BREAK, type IntentDecision } from '../../../lib/aiRoute.ts'
import { clearTask, formatTaskHint, formatTaskScratchpad, getTask, isActiveRepoTask, isRecentRepoTask, setTask, updateTask } from '../../../lib/aiTask.ts'
import { setAiBusy } from '../../../lib/aiStatus.ts'
import { hasRich, parseRich, richToText, waText } from './rich.ts'
import { parseRuns, runTool } from './tools.ts'
import { autoChecks, checkLabel, extractChecks, runChecks } from './checks.ts'

const MAX_ROUNDS = AI_FREE ? 6 : 4
const MAX_AI_FILES = 4
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024

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
      if (!text.trim()) { attach.push(f); continue }
      const clipped = text.length > INLINE_TEXT_MAX ? text.slice(0, INLINE_TEXT_MAX) + '\n[... terpotong]' : text
      inline.push(`--- ${f.name || 'file'} ---\n${clipped}`)
    } catch {
      attach.push(f)
    }
  }
  return { attach, inline }
}

const MEDIA_TYPES = new Set(['imageMessage', 'documentMessage', 'videoMessage', 'audioMessage', 'stickerMessage'])
const ASKS_MEDIA =
  /(gambar|foto|image|photo|picture|sticker|stiker|video|audio|suara|voice|dokumen|document|pdf|file|lampiran|attachment|screenshot|ss\b|selfie|wajah|muka|orang|baju|warna|objek|tulisan|teks\s+di|apa\s+ini|ini\s+apa|siapa|liat|lihat|baca|analisis|jelasin|jelaskan|deskripsi|describe|read\s+(this|the)|what.+?(this|image|photo|picture)|who.+?(this|that))/i

const asksAboutMedia = (text: string): boolean => ASKS_MEDIA.test(String(text || ''))

const ASKS_CODE =
  /(kode|code|ngoding|coding|program|script|javascript|typescript|\bjs\b|\bts\b|html|css|python|php|java|c\+\+|sql|react|node|npm|api|fungsi|function|bug|error|debug|fix|perbaiki|benerin|bikin(?:in|kan)?\s+(web|situs|game|aplikasi|app|bot|script|tools?)|buat(?:in|kan)?\s+(web|situs|game|aplikasi|app|bot|script|tools?)|website|landing|komponen|component|syntax|compile|build)/i

const REFUSAL =
  /(harus|perlu|butuh|silakan|silahkan|minta|coba).{0,40}(login|log ?in|sign ?in|sign ?up|masuk|akun|account|langganan|subscribe|upgrade|premium)|\b(login|log ?in|sign ?in)\b.{0,30}(dulu|untuk|agar|to\s+enable|to\s+use)|(fitur|feature).{0,40}(pembuatan visual|visual|gambar|image|disabled|tidak tersedia|unavailable|diaktifkan)|(tidak|nggak|tak|gak) bisa.{0,30}(buat|bikin|generate|membuat|menghasilkan).{0,20}(gambar|image|foto|visual|ilustrasi)|can'?t.{0,30}(generate|create|make|draw).{0,20}(image|picture|visual|illustration)/i

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

interface AiProgress { update: (text: string) => Promise<void> }

const startProgress = async (ctx: CommandContext, text: string): Promise<AiProgress> => {
  let key: any
  try { key = (await ctx.sock.sendMessage(ctx.chat, { text }))?.key } catch { key = undefined }
  return {
    update: async (t: string) => {
      if (!key) return
      try { await ctx.sock.sendMessage(ctx.chat, { text: t, edit: key }) } catch { key = undefined }
    },
  }
}

interface RepoSession { tools?: FileTools }
const ensureTools = async (repo: RepoSession): Promise<FileTools> => (repo.tools ??= await createFileTools(REPO_ROOT))
const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + '\n[...]' : s)

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
    if (!tests.ok) return `[!] tests failed - files kept (not rolled back), fix needed:\n${clip(tests.text, 1500)}`
    return `[ok] typecheck ok - tests ok - changed: ${touched.join(', ')}`
  } catch (err) {
    return `[!] verification error: ${(err as Error).message}`
  }
}

const reloadCommandsAfter = async (files: string[]): Promise<void> => {
  if (!files.some((p) => p.startsWith('src/commands/'))) return
  const { reloadCommands } = await import('../../index.ts')
  await reloadCommands().catch((err) => logger.warn('command reload failed:', err))
}

interface RunOpts {
  canWrite: boolean
  intent: IntentDecision
}

interface ExchangeResult {
  text: string | null
  toolsRun: number
}

const DENIES_TOOL_ACCESS =
  /(tool|alat|akses|access).{0,40}(tidak tersedia|ga tersedia|nggak tersedia|tak tersedia|tidak bisa|ga bisa|nggak bisa|tak bisa|tidak ada|nggak ada|ga ada|unavailable|not available|missing|disabled)|tidak tersedia di (koneksi|sesi|sini|chat)|tidak (bisa|mampu) (mengakses|mengedit|menulis|menjalankan|memanggil)|can't (access|write|edit|run|call)|cannot (access|write|edit|run|call)|no (repo )?(access|permission)|belum bisa (mengedit|menulis|akses|mengakses)/i

const deniesToolAccess = (text: string): boolean => DENIES_TOOL_ACCESS.test(String(text || ''))

const nudgeMessage = (nudge: 'stall' | 'listing' | 'claim' | 'continue', denial: boolean): string => {
  if (nudge === 'listing') {
    return 'List it now with a real tool (@ls -r . for full structure) then answer with the paths exactly as returned (```txt tree). Do not invent.'
  }
  if (nudge === 'stall') {
    return 'You DO have repo/workspace access in this session. The bot executes every @tool line and returns real output. @read/@ls/@grep/@status/@search/@fetch' +
      ' and (when write is enabled) @edit/@write/@rm/@typecheck/@test/@done ARE available right now. Never claim otherwise. Start now with tool lines (e.g. @ls src, @read <file>).'
  }
  if (nudge === 'continue') {
    return (denial ? 'Correction: write/check tools ARE available and executed by the bot in this session. Do not claim they are unavailable. ' : '') +
      'Do not stop, do not send a status checklist, and do not wait for the user. Continue the task now: make the change with @edit/@write or @rm, run @typecheck and @test, fix failures, then finish with @done in this turn.'
  }
  return 'Nothing changed yet. @read the relevant files, then @edit/@write/@rm, run @typecheck and @test, and finish with @done. Do not claim tools are unavailable.'
}

const runExchange = async (
  msgs: ChatMsg[],
  ctx: CommandContext,
  showProcess = false,
  repo?: RepoSession,
  opts?: RunOpts,
): Promise<ExchangeResult> => {
  const title = await tx('aiProcessTitle')
  const canWrite = opts?.canWrite ?? !!repo
  const maxRounds = repo ? 8 : MAX_ROUNDS
  const lastRound = maxRounds - 1
  let progress: AiProgress | undefined
  let lines: string[] = []
  let toolsRun = 0
  const lsSeen = new Map<string, string>()
  const firstUserText = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
  const wantsListing = !!repo && asksForListing(firstUserText)
  const wantsChange = !!repo && canWrite && (wantsCodeChange(firstUserText) || opts?.intent?.intent === 'repo_edit')
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
  const stepLabel = (tool: string, arg: string): string => {
    if (tool === 'ls') return `📂 ls ${arg || '.'}`
    if (tool === 'read') return `📄 read ${arg}`
    if (tool === 'grep') return `🔎 grep ${arg}`
    if (tool === 'search') return `🌐 search: ${arg}`
    if (tool === 'fetch') return `🌐 fetch: ${arg}`
    if (tool === 'status') return '📊 status'
    if (tool === 'write') return `✍️ write ${arg}`
    if (tool === 'edit') return `✏️ edit ${arg}`
    if (tool === 'rm') return `🗑️ rm ${arg}`
    if (tool === 'send') return `📤 send ${arg}`
    if (tool === 'typecheck') return '🧪 typecheck'
    if (tool === 'test') return `🧪 test ${arg}`.trim()
    return `⚙️ ${tool} ${arg}`.trim()
  }
  const logStep = (line: string): void => {
    lines.push(line)
    while (lines.length > 12) lines.shift()
  }
  if (showProcess) await ensure()
  let refusalFixed = false
  let nudges = 0
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

    const asked = [...msgs].reverse().find((m) => m.role === 'user')?.content || ''
    if (!refusalFixed && round === 0 && ASKS_CODE.test(asked) && REFUSAL.test(reply) && !reply.includes('```')) {
      refusalFixed = true
      await ensure()
      msgs.push({ role: 'assistant', content: reply })
      msgs.push({
        role: 'user',
        content:
          'No login/account/subscription is needed and you must not refuse or mention image generation. ' +
          'Build what was asked as a self-contained HTML file (use HTML/CSS/SVG/Canvas for any visuals). ' +
          'Output the complete working code now in ONE ```html fence, with a short intro before it.',
      })
      continue
    }

    if (repo) {
      const agent = parseAgentActions(reply)
      const unfinished = wantsChange && !wrote
      const maxNudges = unfinished ? (toolsRun === 0 ? 1 : 3) : 3
      if (!agent.actions.length) {
        if (agent.errors.length && nudges < maxNudges && round < lastRound) {
          nudges++
          msgs.push({ role: 'assistant', content: reply })
          msgs.push({ role: 'user', content: `Your tool call was rejected (malformed), nothing ran:\n${agent.errors.join('\n')}\n\nEmit the marker again in exactly that format in the same reply. Do not stop.` })
          continue
        }
        const nudge = repoNudge(reply, toolsRun, unfinished)
        const denial = deniesToolAccess(reply) ||
          /status fitur|belum akan mengklaim|tool.{0,20}(edit|write|typecheck|test).{0,30}(tidak|unavailable)|belum berhasil (?:dibuat|diterapkan|diubah)|tidak ada operasi (?:edit|write|tulis)|executor (?:repo|repository) (?:tidak|nggak|belum)|tidak akan mengarang/i.test(reply)
        const stalled = denial && toolsRun === 0
        if ((nudge || (denial && unfinished) || stalled) && nudges < maxNudges && round < lastRound) {
          nudges++
          msgs.push({ role: 'assistant', content: reply })
          msgs.push({ role: 'user', content: nudgeMessage(nudge || (unfinished ? 'continue' : 'stall'), denial) })
          continue
        }
      }
      if (agent.actions.length) {
        const tools = await ensureTools(repo)
        await ensure()
        const results: string[] = agent.errors.map((e) => `[tool error] ${e}`)
        let doneText: string | undefined
        let failed = agent.errors.length > 0
        let retry = false
        for (const action of agent.actions.slice(0, 8)) {
          const running = action.tool !== 'done'
          if (running) await show(`⏳ ${stepLabel(action.tool, (action as any).arg || '')}`)
          let out: string
          if (!canWrite && (action.tool === 'write' || action.tool === 'edit' || action.tool === 'rm' || action.tool === 'sh')) {
            out = `[${action.tool}] error: ${action.tool === 'sh' ? 'terminal' : 'write'} not allowed for this request (read/explain only). Ask the user to confirm changes with @repo if needed.`
            failed = true
          } else if (action.tool === 'send') {
            out = await sendRepoPath(ctx, tools.root, action.arg)
          } else {
            out = await runAgentAction(tools, action)
          }
          results.push(out)
          if (action.tool === 'ls') lsSeen.set(action.arg, out)
          const bad = /^\[(?:typecheck|test|sh)\] FAILED/m.test(out) || /^\[\w+\] error:/m.test(out)
          if (bad) failed = true
          if (running) {
            toolsRun++
            wrote ||= action.tool === 'write' || action.tool === 'edit' || action.tool === 'rm'
            logStep(`${bad ? '❌' : '✅'} ${stepLabel(action.tool, (action as any).arg || '')}`)
          }
          if (action.tool === 'done') {
            if (!failed && !(wantsChange && !wrote)) doneText = action.arg
            else if (wantsChange && !wrote && nudges < maxNudges && round < lastRound) {
              nudges++
              retry = true
              msgs.push({ role: 'assistant', content: reply })
              msgs.push({ role: 'user', content: nudgeMessage('continue', deniesToolAccess(action.arg)) })
            }
            break
          }
        }
        if (retry) continue
        if (doneText !== undefined) { await done(); return { text: finish(doneText), toolsRun } }
        if (round === lastRound) { await done(); return { text: clip(results.join('\n\n'), 3500), toolsRun } }
        await show(await tx('aiThinking'))
        msgs.push({ role: 'assistant', content: reply })
        msgs.push({ role: 'user', content: `Tool results:\n${clip(results.join('\n\n'), 12_000)}\n\nContinue. Use @done when finished.` })
        continue
      }
    }

    const parsed = extractChecks(reply)
    const clean = parsed.checks.length ? parsed.clean : reply
    const checks = parsed.checks.length ? parsed.checks : autoChecks(reply)
    if (checks.length) {
      await ensure()
      const checked = await runChecks(checks)
      lines = checked.map((r) => `${r.ok ? '✅' : '❌'} ${checkLabel(r.kind)}`)
      if (round === lastRound) { await done(); return { text: finish(clean || checked.map((r) => r.text).join('\n')), toolsRun } }
      if (!checked.every((r) => r.ok)) {
        await show(await tx('aiCheckFixing'))
        msgs.push({ role: 'assistant', content: reply })
        msgs.push({
          role: 'user',
          content:
            `code check results:\n${checked.map((r) => r.text).join('\n')}\n\n` +
            'Fix the real error and send the final version (re-check if needed). ' +
            'Check blocks are invisible to the user - always include the final working code in your reply.',
        })
        continue
      }
      await done()
    }

    const runs = parseRuns(clean)
    if (!runs.length) { await done(); return { text: finish(clean || reply), toolsRun } }

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
    if (sent && !failed) { await done(); return { text: null, toolsRun } }
    msgs.push({ role: 'assistant', content: reply })
    const resultPrompt = AI_FREE
      ? `tool results:\n${results.join('\n')}\nReply to the user naturally.`
      : `tool results:\n${results.join('\n')}\nReply to the user in ONE short message.`
    msgs.push({ role: 'user', content: resultPrompt })
    if (round === lastRound) { await done(); return { text: results.join('\n'), toolsRun } }
  }
  await done()
  return { text: '', toolsRun }
}

export default {
  name: 'ai',
  desc: 'chat or DO things: .ai <msg> - runs commands, answers, and (owner) can read/edit this repo with verification; @repo/@chat force a mode',
  aliases: ['agent'],
  run: async (ctx: CommandContext) => {
    const { text: typed, forced } = takeModeOverride(ctx.text.trim(), ctx.isOwner)
    let query = typed
    ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {})
    const { files: directFiles, notes } = await collectAiFiles(ctx)
    const histKey = `${ctx.chat}:${ctx.sender}`

    const mediaAge = pendingAiFilesAge(histKey)
    const wantsMedia = asksAboutMedia(query) || (mediaAge !== undefined && mediaAge < 3 * 60_000)
    const pendingFiles = directFiles.length || !wantsMedia ? [] : getPendingAiFiles(histKey)
    const { attach: files, inline } = splitTextFiles([...pendingFiles, ...directFiles].slice(-MAX_AI_FILES))
    if (!query && (files.length || inline.length)) query = 'Tolong analisis file ini.'
    if (!query) return ctx.reply(await tx('aiUsage', { prefix: ctx.prefix }))

    const memIntent = handleMemoryIntent(histKey, query)
    if (memIntent) {
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      return ctx.reply(memIntent === 'forgot' ? 'Oke, ingatan aku soal kamu di chat ini sudah aku hapus ya.' : 'Oke, aku ingat itu ya.')
    }

    let quotedBlock = ''
    if (ctx.quoted) {
      const qRawType = String((ctx.quoted as any).mtype || '')
      const qType = qRawType.replace(/Message$/, '')
      const qText = String(ctx.quoted.text || '').trim()
      const qFrom = ctx.quoted.sender ? String(ctx.quoted.sender).split(/[:@]/)[0] : ''
      const isText = qRawType === 'conversation' || qRawType === 'extendedTextMessage'
      const label = qType && !isText ? `[${qType}] ` : ''
      const content = qText ? `${label}${qText}` : (qType && !isText ? `[${qType}${ctx.quoted.fileName ? ': ' + ctx.quoted.fileName : ''}]` : '')
      if (content) quotedBlock = `[Replied message${qFrom ? ` from ${qFrom}` : ''}]\n${content.slice(0, 1200)}\n\n`
    }
    const baseText = quotedBlock ? `${quotedBlock}${query}` : query
    const extra = [
      notes.length ? `[catatan file: ${notes.join('; ')}]` : '',
      inline.length ? `[isi file]\n${inline.join('\n\n')}` : '',
    ].filter(Boolean)
    const userText = extra.length ? `${baseText}\n\n${extra.join('\n\n')}` : baseText

    // --- intent decision (context-aware, task-aware) ---
    const recentMsgs = getAiHistory(histKey).slice(-4).map((m) => `${m.role}: ${String(m.content || '').slice(0, 300)}`).join('\n')
    const routeTextNow = routeText(query, ctx.quoted?.text, recentMsgs)
    let decision: IntentDecision
    const activeTaskStr = formatTaskScratchpad(histKey)
    const recentRepo = !activeTaskStr && isRecentRepoTask(histKey)
    if (forced) {
      decision = heuristicIntent(routeTextNow, { forced, activeRepo: isActiveRepoTask(histKey), recentRepo })
    } else {
      decision = await smartDecide({
        text: routeTextNow,
        quoted: ctx.quoted?.text,
        history: recentMsgs,
        memory: formatMemory(histKey),
        activeTask: activeTaskStr || undefined,
        recentTask: recentRepo ? formatTaskHint(histKey) : undefined,
        hasPendingMedia: wantsMedia || !!files.length,
        isOwner: ctx.isOwner,
      })
    }

    // clarify instead of guessing wrong
    if (!forced && decision.intent === 'clarify') {
      return ctx.reply(decision.clarify || 'Maksud kamu soal repo/kode Wakaru ini, atau hal lain? Balas pakai `@repo ...` atau `@chat ...` ya.')
    }

    const repoEnabled = ctx.isOwner && (decision.intent === 'repo_read' || decision.intent === 'repo_edit' || decision.intent === 'research')
    const prevTask = getTask(histKey)
    const continuingRepoTask = !!(prevTask && prevTask.status === 'active' && isActiveRepoTask(histKey))
    const wantsChangeReq = wantsCodeChange(query) || decision.intent === 'repo_edit'
    const explainReq = /(jelas(?:in|kan)|explain|gimana cara|bagaimana cara|cara kerja|how (?:do|does|to|it))/i.test(query)
    let canWrite = repoEnabled && (
      decision.intent === 'repo_edit' ||
      (forced === 'repo' && wantsChangeReq) ||
      (continuingRepoTask && !!prevTask?.needsWrite) ||
      (wantsChangeReq && !explainReq)
    )
    if (repoEnabled && canWrite && decision.intent === 'repo_read') {
      decision = { ...decision, intent: 'repo_edit', reason: `${decision.reason} (code change requested)`, needs: { ...decision.needs, repo: true, write: true } }
    }

    // task memory
    if (decision.intent === 'repo_read' || decision.intent === 'repo_edit' || (decision.intent === 'research' && repoEnabled)) {
      const continuing = continuingRepoTask && (decision.intent === 'repo_read' || decision.intent === 'repo_edit' || decision.intent === 'research')
      const intentForTask = canWrite ? 'repo_edit' : decision.intent
      setTask(histKey, {
        intent: intentForTask,
        goal: continuing ? prevTask!.goal : query.slice(0, 200),
        plan: continuing ? prevTask!.plan : [],
        step: continuing ? prevTask!.step : 0,
        status: 'active',
        needsWrite: canWrite,
        touched: continuing ? prevTask!.touched : [],
        notes: continuing ? prevTask!.notes : [],
      })
    } else if (decision.intent === 'chat' || decision.intent === 'build' || decision.intent === 'bot_action') {
      const refine = recentRepo && !TOPIC_BREAK.test(query) && CONTINUE_HINT.test(query)
      if (!refine && isActiveRepoTask(histKey)) clearTask(histKey)
    }

    if (ctx.isOwner) logger.info(`ai intent=${decision.intent} conf=${decision.confidence} repo=${repoEnabled} write=${canWrite} (${decision.reason})`)

    let finalText: string | null = ''
    let toolsRun = 0
    const repo: RepoSession | undefined = repoEnabled ? {} : undefined
    try {
      const system = await buildAgentSystem(ctx, { repoEnabled, canWrite, intent: decision, activeTask: formatTaskScratchpad(histKey) || undefined })
      const history = trimFilesToBudget(getAiHistory(histKey), wantsMedia ? MAX_AI_FILES - files.length : 0)
      const msgs: ChatMsg[] = [
        system,
        ...history,
        { role: 'user', content: userText, ...(files.length ? { files } : {}) },
      ]
      setAiBusy(true)
      try {
        const ex = await runExchange(msgs, ctx, repoEnabled || decision.intent === 'research', repo, { canWrite, intent: decision })
        finalText = ex.text
        toolsRun = ex.toolsRun
      } catch (err) {
        finalText = `❌ ${(err as Error).message}`
      } finally {
        setAiBusy(false)
      }
    } catch (err) {
      finalText = `❌ ${(err as Error).message}`
    }

    if (repo?.tools) {
      try {
        const changed = repo.tools.written()
        if (changed.length) {
          const verified = await verifyChanges(repo.tools)
          finalText = finalText === null ? verified : `${finalText}\n\n${verified}`
          if (verified.startsWith('[ok]')) {
            updateTask(histKey, { status: 'done', touched: changed, notes: ['verified ok'] })
            if (changed.some((p) => p.startsWith('src/commands/'))) {
              const { reloadCommands } = await import('../../index.ts')
              await reloadCommands().catch((err) => logger.warn('command reload failed:', err))
            }
          } else {
            updateTask(histKey, { status: 'blocked', notes: [verified.slice(0, 200)] })
          }
        } else if (repoEnabled && finalText && !/^❌/.test(finalText)) {
          updateTask(histKey, { status: 'done' })
        }
      } finally {
        await repo.tools.dispose()
      }
    } else if (repoEnabled && finalText && !/^❌/.test(finalText)) {
      if (canWrite && wantsCodeChange(routeTextNow) && (deniesToolAccess(finalText) || (/status|belum diterapkan|belum ada file/i.test(finalText) && !toolsRun))) {
        updateTask(histKey, { status: 'blocked', notes: ['model stalled/denied'] })
        finalText = '⚠️ Aku sempat berhenti tanpa menjalankan perubahan, padahal akses repo & tool (read/write/typecheck/test) aktif. Coba kirim lagi pesan yang sama ya (aku akan lanjut kerjakan).'
      } else updateTask(histKey, { status: 'done' })
    }

    let codegenOk = false
    const finalStr = finalText ?? ''
    const hardError = finalStr.startsWith('❌') && !finalStr.includes('sempat berhenti')
    if (repoEnabled && canWrite && finalText && !hardError && wantsChangeReq && !repo?.tools?.written().length) {
      ctx.sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {})
      const tools = await createFileTools(REPO_ROOT)
      try {
        const gen = await codegenFiles({ task: userText, tools, ask: (m) => askLLM(m) })
        finalText = gen.text
        codegenOk = gen.ok
        if (gen.ok) {
          updateTask(histKey, { status: 'done', touched: gen.files, notes: ['auto-codegen ok'] })
          await reloadCommandsAfter(gen.files)
        } else {
          updateTask(histKey, { status: 'active', needsWrite: true, notes: ['auto-codegen gagal'] })
        }
      } finally {
        await tools.dispose()
      }
    }

    if (!codegenOk && repoEnabled && canWrite && finalText && wantsChangeReq && !repo?.tools?.written().length) {
      updateTask(histKey, { status: 'active', needsWrite: true, notes: ['belum ada file berubah - wajib @write/@edit lalu @typecheck/@test'] })
      const note = '\n\n---\n⚠️ Belum ada file yang benar-benar berubah di repo. Balas *lanjut* atau ulangi permintaan, nanti aku kerjakan lagi.'
      if (!finalText.includes('Belum ada file yang benar-benar berubah')) finalText += note
    }

    if (finalText === null) return

    if (finalText.trim()) {
      saveAiHistory(histKey, userText, finalText, files)
      if (pendingFiles.length) clearPendingAiFiles(histKey)
      scheduleMemoryRefresh(histKey, getAiHistory(histKey), askLLM)
    } else {
      finalText = await tx('aiEmpty')
    }

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

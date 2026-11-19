import { askLLM } from './llm.ts'
import type { ChatMsg } from './llm.ts'
import type { TaskIntent } from './aiTask.ts'

export type AiMode = 'repo' | 'chat'
export type Confidence = 'high' | 'medium' | 'low'

export interface AiRoute {
  mode: AiMode
  why: string
}

export interface IntentDecision {
  intent: TaskIntent
  confidence: Confidence
  reason: string
  clarify?: string
  needs: { repo: boolean; web: boolean; bot: boolean; write: boolean }
}

// Strong = clearly about this Wakaru workspace. Weak = generic words, need context.
export const STRONG_REPO =
  /\b(src\/|test\/|package\.json|AGENTS\.md|README|tsconfig|tsc|typecheck|typescript|codebase|source code|wakaru|repo(?:nya|mu|ku)?|handler(?:nya|mu|ku)?|kode(?:nya|mu|ku)?\s+(?:bot|wakaru|repo|command|handler))\b|\b(?:src|test)\/[\w./-]+|\/[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|md|rs|toml|ya?ml)\b|\.(?:ts|tsx|js|mjs|cjs)\b|(?<!\w)\.[a-z][a-z0-9_-]{1,}\b/i

export const WEAK_REPO =
  /\b(fitur(?:nya|mu|ku)?|feature|bug|error|folder(?:nya|mu|ku)?|direktori(?:nya|mu|ku)?|directory|struktur(?:nya|mu|ku)?|tree|file(?:nya|mu|ku)?|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?)\b/i

// Back-compat broad detector (kept for existing callers/tests).
export const REPO_TASK =
  /\b(repo(?:nya|mu|ku)?|codebase|source code|kode(?:nya|mu|ku)?|src\/|typescript|typecheck|refactor|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?|feature|bug|error|handler|implement|benerin|perbaiki|direktori(?:nya|mu|ku)?|directory|folder(?:nya|mu|ku)?|struktur(?:nya|mu|ku)?|tree)\b|baca file|read file|daftar file|list file|isi folder|isi direktori|(?:kirim(?:in|kan)?|send)\b[^\n]{0,25}\b(?:file(?:nya|mu|ku)?|folder(?:nya|mu|ku)?|zip|isi\s+(?:folder|repo))|(?:hapus|delete|remove|buang|bikin(?:in|kan)?|buat(?:in|kan)?|tambah(?:in|kan)?)\b[^\n]{0,40}\b(?:file(?:nya|mu|ku)?|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?|feature|handler|test|tes(?:nya)?)\b/i

const STANDALONE_BUILD =
  /\b(?:bikin(?:in|kan)?|buat(?:in|kan)?|tolong\s+(?:bikin(?:in|kan)?|buat(?:in|kan)?))\b\s+(?:aku\s+|saya\s+|kan\s+|dong\s+|coba\s+)?(?:sebuah\s+|satu\s+)?(?:file\s+)?(?:html|game|website|web|app|aplikasi|halaman|landing\s*page|page|script|kalkulator|calculator|animasi|animation|chart|grafik|component|komponen|kode|snippet|css|svg|canvas)\b/i

const EXPLAIN_REPO =
  /(jelas(?:in|kan)|explain|gimana|bagaimana|cara kerja|how (?:do|does|it|this|to)|kenapa|mengapa|why|apa itu|kok bisa)/i

const DELETE_MSG = /\b(hapus|delete)\s+(pesan|chat|message|riwayat|history)\b/i
const READ_WORD = /\b(baca|read|liat|lihat|show|tunjuk(?:in|kan)?|tampil(?:in|kan)?|isi|cek|check|periksa|list|daftar|kirim(?:in|kan)?|send|cari|grep|search)\b/i
const WRITE_WORD = /\b(bikin(?:in|kan)?|buat(?:in|kan)?|tambah(?:in|kan)?|hapus|delete|remove|buang|ubah|ganti|rename|pindah(?:in|kan)?|move|refactor|perbaiki|benerin|fix|implement(?:asikan)?|update|tulis(?:in)?|write|patch|edit)\b/i
const OUTSIDE_HINT = /\b(hp|handphone|laptop|pc|komputer|android|iphone|galeri|kamera|foto(?:ku|mu)?|drive|icloud|gdrive|windows explorer|finder|file manager)\b/i
export const TOPIC_BREAK = /\b(ganti topik|ngobrol aja|ngobrol lain|cerita|curhat|puisi|jokes|lelucon|lupakan|abaikan|udah deh|cukup|makasih|terima kasih|thanks|bye|dadah|ngomongin lain)\b/i
export const CONTINUE_HINT =
  /\b(stylenya|style|desain(?:nya)?|design|warnanya|warna|tampilan(?:nya)?|layout|ui|font|teksnya|judulnya|posisi(?:nya)?|geser|jangan gitu|gitu ja|kayak tadi|yang tadi|edit ulang|ulang(?:i|in)?|revisi|kurang pas|belum pas|masih salah|terlalu|agak|sedikit|tambahin|kurangin)\b/i
const BOT_ACTION_HINT = /\b(sticker|stiker|download|unduh|ytmp3|ytmp4|play|lagu|musik|tiktok|instagram|ig\b|facebook|fb\b|pinterest|soundcloud|spotify|twitter|kick|promote|demote|hidetag|tagall|antilink|antidelete|remind|ingetin|hd\b|upscale|brat|toimg|toaudio|menu|wiki)\b/i

export const isStandaloneBuild = (text: string): boolean => STANDALONE_BUILD.test(String(text ?? ''))

// Manual override: "@repo <task>" or "@chat <msg>" (owner only).
export const MODE_OVERRIDE = /^\s*@(repo|chat)\b\s*/i

interface TakenOverride {
  text: string
  forced?: AiMode
}

export const takeModeOverride = (text: string, allowed: boolean): TakenOverride => {
  const raw = String(text ?? '')
  if (!allowed) return { text: raw }
  const m = MODE_OVERRIDE.exec(raw)
  if (!m) return { text: raw }
  return { text: raw.slice(m[0].length).trim(), forced: m[1].toLowerCase() as AiMode }
}

const FOLLOWUP = /\b(hapus|delete|remove|benerin|perbaiki|ubah|ganti|bikinin|buat(?:in|kan)?|tambah(?:in|kan)?|fix|lanjut|lanjutin|continue|terus|lagi|coba lagi|ulangi|itu|tadi|yang barusan)\b/i

export const routeText = (query: string, quoted = '', recent = ''): string => {
  const q = String(query ?? '').trim()
  const extra = String(quoted || recent || '').slice(0, 800)
  return FOLLOWUP.test(q) && q.length <= 160 && extra ? `${q}\n[context]\n${extra}` : q
}

const INTENT_SYS: ChatMsg = {
  role: 'system',
  content: [
    'Classify a Wakaru WhatsApp bot message. Reply ONLY JSON: {"intent":"...","confidence":"high|medium|low","needs":{"repo":bool,"web":bool,"bot":bool,"write":bool},"reason":"short","clarify":""}.',
    'intent:',
    '- repo_read: read/list/search/inspect or explain how THIS bot/repo works or its files/commands/handlers (needs source).',
    '- repo_edit: add/change/delete/fix/test files/commands in THIS repo/workspace.',
    '- build: create/generate standalone content to send back (HTML/CSS/JS/game/page/script/snippet/story/code), NOT saved in this repo.',
    '- bot_action: do a WhatsApp/bot action (sticker, download, play/send media, group/admin) via bot command.',
    '- research: needs current/web info not in repo/chat.',
    '- chat: normal conversation, general knowledge, opinion, small talk.',
    '- clarify: genuinely ambiguous between chat and repo (e.g. "hapus ini", "bug/folder/struktur" with no context, or could mean outside device).',
    'Rules/examples:',
    '- USE recent_conversation (and active_repo_task) to resolve references like "itu", "tadi", "yang barusan", "edit yang tadi", "ganti warnanya". Decide from what was actually produced earlier.',
    '- EDIT/REFINE a previous output: if the earlier output was standalone HTML/code sent in chat -> build; if it was a file/command change in this repo -> repo_edit. The word "edit" alone NEVER means repo_edit.',
    '- "bikinin html/game/website/script" to send = build. "tambah/ubah/hapus command/handler/src di Wakaru" = repo_edit. "jelasin cara kerja agent/handler/command repo ini" = repo_read.',
    '- "hapus pesan/chat ini" = chat/bot_action, NEVER repo_edit. "bug di HP/laptop umum" = chat, "bug di .play/handler/command" = repo_read or repo_edit.',
    '- "fiturnya apa aja" / "bisa apa aja" / "list command" / "what can you do" = chat: answer from the available-commands list already in context, NEVER repo_read. Only a named target ("fitur .stats", "command stats error", "kode/handler ...", "src/...") makes it repo_read/repo_edit.',
    '- Recent context is evidence, not intent: only treat it as the topic when the message actually continues it. A brand-new question is a new topic.',
    '- "struktur folder" about repo/workspace = repo_read; "struktur folder HP/drive" = chat/clarify. Generic "benerin error" with no repo context = clarify.',
    '- active_repo_task yes + short follow-up/continuation ("lanjut", "fix lagi", "hapus command tadi") => repo_read/repo_edit. If clearly new topic, choose that topic.',
    '- If mode_override=repo: intent MUST be repo_read or repo_edit (needs.write=true when the user wants a change). If mode_override=chat: NEVER choose repo_read/repo_edit.',
    '- Use clarify with ONE short helpful question when the referent or scope is genuinely unclear (e.g. "edit yang tadi" with no earlier output). Bias: when unsure, prefer chat over repo_edit; prefer repo_read over repo_edit if user just wants to see/explain.',
  ].join('\n'),
}

const safeJson = (s: string): any => {
  const m = /\{[\s\S]*\}/.exec(String(s || ''))
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

const norm = (d: any): IntentDecision => {
  const allowed: TaskIntent[] = ['chat', 'build', 'bot_action', 'repo_read', 'repo_edit', 'research', 'clarify']
  const intent = allowed.includes(d?.intent) ? (d.intent as TaskIntent) : 'chat'
  const confidence = d?.confidence === 'high' || d?.confidence === 'medium' ? d.confidence : 'low'
  const needs = d?.needs || {}
  return {
    intent,
    confidence,
    reason: String(d?.reason || '').slice(0, 160),
    clarify: String(d?.clarify || '').slice(0, 220),
    needs: { repo: !!needs.repo, web: !!needs.web, bot: !!needs.bot, write: !!needs.write },
  }
}

export interface DecideInput {
  text: string
  quoted?: string
  history?: string
  memory?: string
  activeTask?: string
  recentTask?: string
  hasPendingMedia?: boolean
  isOwner?: boolean
  forced?: AiMode
}

export const decideIntent = async (input: DecideInput): Promise<IntentDecision> => {
  const user = [
    `owner: ${input.isOwner ? 'yes' : 'no'}`,
    input.forced ? `mode_override: ${input.forced} (user explicitly typed @${input.forced}; respect it)` : '',
    input.activeTask ? `active_repo_task: yes (continue it on follow-ups)\n${input.activeTask}` : 'active_repo_task: no',
    input.recentTask ? `recent_repo_change: yes (just finished; style/refine follow-ups may belong to it)\n${input.recentTask}` : '',
    input.hasPendingMedia ? 'has_media: yes' : 'has_media: no',
    input.history ? `recent_conversation (oldest -> newest; use it to resolve "itu/tadi/yang barusan"):\n${String(input.history).slice(-2400)}` : '',
    input.memory ? `memory:\n${String(input.memory).slice(0, 500)}` : '',
    input.quoted ? `quoted_message (user is replying to this):\n${String(input.quoted).slice(0, 600)}` : '',
    `message:\n${String(input.text || '').slice(0, 1200)}`,
  ].filter(Boolean).join('\n\n')
  const reply = await askLLM([INTENT_SYS, { role: 'user', content: user }])
  const data = safeJson(reply)
  if (!data || !data.intent) throw new Error('unclassified intent')
  return norm(data)
}

const isWriteIntentText = (raw: string): boolean => WRITE_WORD.test(raw)
const looksLikeRepoQuestion = (raw: string): boolean =>
  READ_WORD.test(raw) || EXPLAIN_REPO.test(raw) || /\b(list|daftar|struktur|tree|isi|cari|grep)\b/i.test(raw)

const REPO_NOUN = /\b(struktur(?:nya|mu|ku)?|folder(?:nya|mu|ku)?|direktori(?:nya|mu|ku)?|file(?:nya|mu|ku)?|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?)\b/i

const clarifyRepo = (reason: string): IntentDecision => ({
  intent: 'clarify',
  confidence: 'low',
  reason,
  clarify: 'Maksudnya soal repo/kode Wakaru ini, atau hal lain? Balas `@repo ...` kalau soal repo, atau `@chat ...` kalau bukan ya.',
  needs: { repo: false, web: false, bot: false, write: false },
})

// Heuristic fallback: safe-by-default (prefer chat/clarify over unsafe repo actions).
export const heuristicIntent = (
  text: string,
  opts?: { activeRepo?: boolean; recentRepo?: boolean; forced?: AiMode },
): IntentDecision => {
  const raw = String(text ?? '')

  if (opts?.forced === 'repo') {
    const w = isWriteIntentText(raw)
    return { intent: w ? 'repo_edit' : 'repo_read', confidence: 'high', reason: 'manual override', needs: { repo: true, web: false, bot: false, write: w } }
  }
  if (opts?.forced === 'chat') return { intent: 'chat', confidence: 'high', reason: 'manual override', needs: { repo: false, web: false, bot: false, write: false } }

  if (DELETE_MSG.test(raw)) return { intent: 'chat', confidence: 'high', reason: 'delete message/chat', needs: { repo: false, web: false, bot: false, write: false } }
  if (isStandaloneBuild(raw)) return { intent: 'build', confidence: 'high', reason: 'standalone build', needs: { repo: false, web: false, bot: false, write: false } }

  const strong = STRONG_REPO.test(raw)
  const weak = WEAK_REPO.test(raw)

  // Active repo task: continue on short follow-ups unless topic clearly changes.
  if (opts?.activeRepo && !TOPIC_BREAK.test(raw) && (FOLLOWUP.test(raw) || raw.trim().length <= 60)) {
    const w = isWriteIntentText(raw)
    return { intent: w ? 'repo_edit' : 'repo_read', confidence: 'medium', reason: 'follow-up to active repo task', needs: { repo: true, web: false, bot: false, write: w } }
  }

  // Recently finished repo change: styling/refinement follow-ups stay in repo mode.
  if (opts?.recentRepo && !TOPIC_BREAK.test(raw) && CONTINUE_HINT.test(raw)) {
    return { intent: 'repo_edit', confidence: 'medium', reason: 'refining the recent repo change', needs: { repo: true, web: false, bot: false, write: true } }
  }

  if (strong) {
    const w = isWriteIntentText(raw)
    const readish = looksLikeRepoQuestion(raw)
    const explain = EXPLAIN_REPO.test(raw)
    // "bikin/ubah/hapus/tambah command|fitur|file..." = change request => edit, unless user is asking to explain.
    const intent: TaskIntent = w && !explain ? 'repo_edit' : readish || explain ? 'repo_read' : 'repo_read'
    return { intent, confidence: 'high', reason: 'strong repo signal', needs: { repo: true, web: false, bot: false, write: intent === 'repo_edit' } }
  }

  if (weak) {
    if (OUTSIDE_HINT.test(raw)) return clarifyRepo('ambiguous (outside device?)')
    const w = isWriteIntentText(raw)
    const readish = looksLikeRepoQuestion(raw) || REPO_NOUN.test(raw)
    if (w && !readish) return clarifyRepo('ambiguous change request')
    if (readish) {
      const intent: TaskIntent = w ? 'repo_edit' : 'repo_read'
      return { intent, confidence: 'medium', reason: 'weak repo-like request', needs: { repo: true, web: false, bot: false, write: w } }
    }
    return clarifyRepo('ambiguous repo-like words')
  }

  if (/\b(cari di (internet|web|google)|berita|terkini|latest|harga sekarang|cuaca|versi terbaru|who won|current events?)\b/i.test(raw)) {
    return { intent: 'research', confidence: 'medium', reason: 'current/web info', needs: { repo: false, web: true, bot: false, write: false } }
  }

  if (BOT_ACTION_HINT.test(raw)) {
    return { intent: 'bot_action', confidence: 'medium', reason: 'bot action hint', needs: { repo: false, web: false, bot: true, write: false } }
  }

  return { intent: 'chat', confidence: 'medium', reason: 'chat intent', needs: { repo: false, web: false, bot: false, write: false } }
}

// Smart decision: ALWAYS let the AI classifier decide (it reads the conversation,
// memory, quoted message and active task). Regex is only the last-resort fallback
// when the classifier is unavailable, so a wrong regex can never override the AI.
export const smartDecide = async (
  input: DecideInput,
  classify: (input: DecideInput) => Promise<IntentDecision> = decideIntent,
): Promise<IntentDecision> => {
  try {
    const d = await classify(input)
    const repoIntent = d.intent === 'repo_read' || d.intent === 'repo_edit'
    if (input.forced === 'chat' && repoIntent) {
      return { ...d, intent: 'chat', reason: 'forced chat', needs: { ...d.needs, repo: false, write: false } }
    }
    if (input.forced === 'repo' && !repoIntent) {
      const intent: TaskIntent = d.needs.write ? 'repo_edit' : 'repo_read'
      return { ...d, intent, reason: 'forced repo', needs: { ...d.needs, repo: true, write: intent === 'repo_edit' } }
    }
    if (!input.isOwner && repoIntent) {
      return { ...d, intent: 'chat', reason: 'not owner', needs: { ...d.needs, repo: false, write: false } }
    }
    return d
  } catch {
    return heuristicIntent(String(input.text || ''), {
      activeRepo: !!input.activeTask,
      recentRepo: !!input.recentTask,
      forced: input.forced,
    })
  }
}

// Back-compat router used by existing tests/callers.
export const routeMode = (text: string, forced?: AiMode): AiRoute => {
  if (forced) return { mode: forced, why: 'manual override' }
  const raw = String(text ?? '')
  if (isStandaloneBuild(raw)) return { mode: 'chat', why: 'standalone build' }
  if (REPO_TASK.test(raw)) return { mode: 'repo', why: 'repo intent' }
  return { mode: 'chat', why: 'chat intent' }
}

export const intentToMode = (d: IntentDecision): AiMode =>
  d.intent === 'repo_read' || d.intent === 'repo_edit' ? 'repo' : 'chat'

// Back-compat alias (old signature returned AiMode string).
export const classifyIntent = async (text: string): Promise<AiMode> => intentToMode(await decideIntent({ text }))

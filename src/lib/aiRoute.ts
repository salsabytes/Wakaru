import { askLLM } from './llm.ts'
import type { ChatMsg } from './llm.ts'

export type AiMode = 'repo' | 'chat'

export interface AiRoute {
  mode: AiMode
  why: string
}

// Repo-work keywords (heuristic fallback). Needs a repo/code noun so casual requests stay in chat.
// Unsure? Owner can force with @repo. Indonesian possessives (-nya/-mu/-ku) are attached.
export const REPO_TASK =
  /\b(repo(?:nya|mu|ku)?|codebase|source code|kode(?:nya|mu|ku)?|src\/|typescript|typecheck|refactor|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?|feature|bug|error|handler|implement|benerin|perbaiki|direktori(?:nya|mu|ku)?|directory|folder(?:nya|mu|ku)?|struktur(?:nya|mu|ku)?|tree)\b|baca file|read file|daftar file|list file|isi folder|isi direktori|(?:kirim(?:in|kan)?|send)\b[^\n]{0,25}\b(?:file(?:nya|mu|ku)?|folder(?:nya|mu|ku)?|zip|isi\s+(?:folder|repo))|(?:hapus|delete|remove|buang|bikin(?:in|kan)?|buat(?:in|kan)?|tambah(?:in|kan)?)\b[^\n]{0,40}\b(?:file(?:nya|mu|ku)?|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?|feature|handler|test|tes(?:nya)?)\b/i

// "Build/make X" requests (e.g. an HTML game) -> deliver content in chat, not a repo edit.
const STANDALONE_BUILD =
  /\b(?:bikin(?:in|kan)?|buat(?:in|kan)?|tolong\s+(?:bikin(?:in|kan)?|buat(?:in|kan)?))\b\s+(?:aku\s+|saya\s+|kan\s+|dong\s+|coba\s+)?(?:sebuah\s+|satu\s+)?(?:file\s+)?(?:html|game|website|web|app|aplikasi|halaman|landing\s*page|page|script|kalkulator|calculator|animasi|animation|chart|grafik)/i

const isStandaloneBuild = (text: string): boolean => STANDALONE_BUILD.test(String(text ?? ''))

// Manual override: "@repo <task>" or "@chat <msg>" (owner only).
export const MODE_OVERRIDE = /^\s*@(repo|chat)\b\s*/i

interface TakenOverride {
  text: string
  forced?: AiMode
}

// Strip a leading @repo/@chat. Ignored for non-owners.
export const takeModeOverride = (text: string, allowed: boolean): TakenOverride => {
  const raw = String(text ?? '')
  if (!allowed) return { text: raw }
  const m = MODE_OVERRIDE.exec(raw)
  if (!m) return { text: raw }
  return { text: raw.slice(m[0].length).trim(), forced: m[1].toLowerCase() as AiMode }
}

// Short follow-ups borrow context from the replied message for routing.
const FOLLOWUP = /\b(hapus|delete|remove|benerin|perbaiki|ubah|ganti|bikinin|buat(?:in|kan)?|tambah(?:in|kan)?|fix)\b/i

export const routeText = (query: string, quoted = ''): string => {
  const q = String(query ?? '').trim()
  return FOLLOWUP.test(q) && q.length <= 120 && quoted ? `${q}\n${String(quoted).slice(0, 500)}` : q
}

const INTENT_SYS: ChatMsg = {
  role: 'system',
  content:
    'Classify a message for Wakaru (WhatsApp bot). Reply ONLY with JSON: {"mode":"repo"} or {"mode":"chat"}.\n' +
    '"repo" = read/list/search/inspect, add, change, delete, fix, or test files/commands in THIS bot repo, or explain how this repo\'s own code works (needs source).\n' +
    '"chat" = normal conversation, general questions, or create/generate standalone content to send back (HTML/CSS/JS game, page, script, snippet, story) NOT meant to be saved in this repo — even if it contains code.\n' +
    'Examples: "bikinin html game flappy bird" -> {"mode":"chat"}, "buatkan landing page" -> {"mode":"chat"}, "tambahkan command jodoh di src/commands" -> {"mode":"repo"}, "fix bug di handler pesan" -> {"mode":"repo"}, "jelasin cara kerja agent ai di repo ini" -> {"mode":"repo"}.\n' +
    'If unsure, choose "chat".',
}

// Primary (LLM) classifier. Throws on failure so the caller can use heuristics.
export const classifyIntent = async (text: string): Promise<AiMode> => {
  const reply = await askLLM([
    INTENT_SYS,
    { role: 'user', content: String(text ?? '').slice(0, 1200) },
  ])
  const m = /"mode"\s*:\s*"(repo|chat)"/i.exec(String(reply ?? ''))
  if (!m) throw new Error('unclassified intent')
  return m[1].toLowerCase() as AiMode
}

// Heuristic fallback router. The model never grants itself permissions.
export const routeMode = (text: string, forced?: AiMode): AiRoute => {
  if (forced) return { mode: forced, why: 'manual override' }
  const raw = String(text ?? '')
  if (isStandaloneBuild(raw)) return { mode: 'chat', why: 'standalone build' }
  if (REPO_TASK.test(raw)) return { mode: 'repo', why: 'repo intent' }
  return { mode: 'chat', why: 'chat intent' }
}

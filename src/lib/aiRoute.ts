import { askLLM } from './llm.ts'
import type { ChatMsg } from './llm.ts'

export type AiMode = 'repo' | 'chat'

export interface AiRoute {
  mode: AiMode
  why: string
}

// Owner repo work. Needs a code-ish noun, so "buat puisi" stays plain chat.
// Not sure? Force it with @repo.
// Indonesian possessives are glued to the word ("foldermu"), so nouns take -nya/-mu/-ku.
export const REPO_TASK =
  /\b(repo(?:nya|mu|ku)?|codebase|source code|kode(?:nya|mu|ku)?|src\/|typescript|typecheck|refactor|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?|feature|bug|error|handler|implement|benerin|perbaiki|direktori(?:nya|mu|ku)?|directory|folder(?:nya|mu|ku)?|struktur(?:nya|mu|ku)?|tree)\b|baca file|read file|daftar file|list file|isi folder|isi direktori|(?:kirim(?:in|kan)?|send)\b[^\n]{0,25}\b(?:file(?:nya|mu|ku)?|folder(?:nya|mu|ku)?|zip|isi\s+(?:folder|repo))|(?:hapus|delete|remove|buang|bikin(?:in|kan)?|buat(?:in|kan)?|tambah(?:in|kan)?)\b[^\n]{0,40}\b(?:file(?:nya|mu|ku)?|command(?:nya|mu|ku)?|perintah(?:nya|mu|ku)?|fitur(?:nya|mu|ku)?|feature|handler|test|tes(?:nya)?)\b/i

// Escape hatch: "@repo <task>" or "@chat <msg>". Owner only.
export const MODE_OVERRIDE = /^\s*@(repo|chat)\b\s*/i

interface TakenOverride {
  text: string
  forced?: AiMode
}

// Strip a leading @repo/@chat. Ignored for non-owners, so nobody else can force it.
export const takeModeOverride = (text: string, allowed: boolean): TakenOverride => {
  const raw = String(text ?? '')
  if (!allowed) return { text: raw }
  const m = MODE_OVERRIDE.exec(raw)
  if (!m) return { text: raw }
  return { text: raw.slice(m[0].length).trim(), forced: m[1].toLowerCase() as AiMode }
}

// Short follow-ups ("hapus aja", "benerin itu") borrow context from the replied message.
const FOLLOWUP = /\b(hapus|delete|remove|benerin|perbaiki|ubah|ganti|bikinin|buat(?:in|kan)?|tambah(?:in|kan)?|fix)\b/i

export const routeText = (query: string, quoted = ''): string => {
  const q = String(query ?? '').trim()
  return FOLLOWUP.test(q) && q.length <= 120 && quoted ? `${q}\n${String(quoted).slice(0, 500)}` : q
}

const INTENT_SYS: ChatMsg = {
  role: 'system',
  content:
    'You are the intent classifier for Wakaru, a WhatsApp bot. Reply only with JSON, nothing else, like {"mode":"repo"} or {"mode":"chat"}. repo means the user wants to add, modify, delete, fix or test code/files/commands, or run repo checks. chat means a normal conversation.',
}

// Fallback when no keyword matched: let the model pick the mode.
// Only used when repo work is phrased in a way we did not whitelist.
export const classifyIntent = async (text: string): Promise<AiMode> => {
  try {
    const reply = await askLLM([
      INTENT_SYS,
      { role: 'user', content: String(text ?? '').slice(0, 1200) },
    ])
    const m = /"mode"\s*:\s*"(repo|chat)"/.exec(String(reply ?? ''))
    return m && m[1] === 'repo' ? 'repo' : 'chat'
  } catch {
    return 'chat'
  }
}

// Heuristic router. The model never grants itself permissions.
export const routeMode = (text: string, forced?: AiMode): AiRoute => {
  if (forced) return { mode: forced, why: 'manual override' }
  if (REPO_TASK.test(String(text ?? ''))) return { mode: 'repo', why: 'repo intent' }
  return { mode: 'chat', why: 'chat intent' }
}

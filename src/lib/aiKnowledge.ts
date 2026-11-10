import { readJson, register, saveJson } from './disk.ts'

// --- Grounded knowledge (RAG-lite, curated/local) ---
// Simple, file-based "notes" the AI can trust for facts:
// - Global:  data/ai-knowledge.json  -> { "text": "..." } or string/sections
// - Per chat: data/ai-notes.json     -> { "<chatJid>": "..." } (owner-editable v1)

type Notes = Record<string, string>

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

const loadNotes = (): Notes => {
  const raw = readJson<Record<string, unknown>>('ai-notes.json', {})
  const out: Notes = {}
  for (const [k, v] of Object.entries(raw)) {
    const t = typeof v === 'object' && v && 'text' in (v as any) ? clean((v as any).text) : clean(v)
    if (t) out[k] = t
  }
  return out
}

let notes: Notes = loadNotes()

const loadGlobal = (): string => {
  const raw = readJson<any>('ai-knowledge.json', '')
  if (typeof raw === 'string') return clean(raw)
  if (raw && typeof raw === 'object') {
    if (typeof raw.text === 'string') return clean(raw.text)
    // allow { sections: ["...", "..."] } or { items: [...] }
    const arr = Array.isArray(raw.sections) ? raw.sections : Array.isArray(raw.items) ? raw.items : []
    return arr.map((x: unknown) => clean(x)).filter(Boolean).join('\n')
  }
  return ''
}

let globalText = loadGlobal()

register('ai-notes.json', () => notes)
register('ai-knowledge.json', () => (globalText ? { text: globalText } : {}))

// Reload from disk (cheap) so manual edits are picked up without restart
export function refreshKnowledge(): void {
  notes = loadNotes()
  globalText = loadGlobal()
}

export function setChatNote(chat: string, text: string): void {
  const t = clean(text)
  if (t) notes[chat] = t
  else delete notes[chat]
  saveJson('ai-notes.json')
}

export function getChatNote(chat: string): string {
  return notes[chat] || ''
}

export function clearChatNote(chat: string): void {
  delete notes[chat]
  saveJson('ai-notes.json')
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// Build a small grounding block for the system prompt
export function getGrounding(chat: string): string {
  refreshKnowledge()
  const parts: string[] = []
  if (globalText) parts.push(`global notes:\n${clip(globalText, 800)}`)
  const note = notes[chat]
  if (note) parts.push(`notes for this chat:\n${clip(note, 800)}`)
  if (!parts.length) return ''
  return parts.join('\n\n')
}

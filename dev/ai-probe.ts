import { askLLM } from '../src/lib/llm.ts'

// Quick smoke test for the .ai backend chain — primary first,
// fallbacks only kick in when the one above throws.
const probes = [
  'jawab singkat: 1+1 berapa?',
  'jawab singkat: tanggal hari ini? format YYYY-MM-DD',
  'jawab singkat 1 kalimat: siapa presiden Indonesia saat ini?',
]

for (const q of probes) {
  const t0 = Date.now()
  try {
    const a = await askLLM([{ role: 'user', content: q }])
    console.log('Q:', q, `\nA (${Date.now() - t0}ms):`, a.slice(0, 500), '\n---')
  } catch (e) {
    console.log('Q:', q, `\nERR (${Date.now() - t0}ms):`, (e as Error).message, '\n---')
  }
}

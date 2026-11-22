import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// Regression cover for the Family 100 judge:
//  - the local prefilter may only say YES; anything unsure must reach the AI
//  - a judge that gives no verdict (timeout/error) must NOT stamp the guess as
//    a permanent miss, otherwise a correct answer stays buried for the round

type Reaction = { chat: string; text: string; msgId: string }

const reactions: Reaction[] = []
const replies: string[] = []
let aiMode: 'ok' | 'fail' = 'ok'
const judgePrompts: string[] = []

const QUESTION = 'Sebutkan makanan khas Indonesia'
const ANSWERS = ['bakso', 'sate ayam', 'rendang', 'gado gado', 'es teh']

const body = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => resolve(raw))
  })

// Minimum viable stand-in for wakafy: question source + the ext AI endpoint the
// judge/quality/curate calls all hit.
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const json = (code: number, data: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  if (req.method === 'GET' && url.pathname.endsWith('/family100')) {
    return json(200, { ok: true, total: 1, id: 1, soal: QUESTION, jawaban: ANSWERS })
  }
  if (req.method !== 'POST') return json(200, {})
  const payload = JSON.parse((await body(req)) || '{}') as { messages?: { content?: string }[] }
  const prompt = String(payload.messages?.at(-1)?.content ?? '')
  // openai-compatible provider shape, not wakafy's {text}
  const answer = (text: string): void => json(200, { choices: [{ message: { content: text } }] })
  if (prompt.includes('Nilai apakah soal ini')) return answer('{"ok":true}')
  // empty list fails the length check on purpose → question stays as-is
  if (prompt.includes('Kamu kurator')) return answer('{"jawaban":[]}')
  if (prompt.includes('Kamu juri')) {
    judgePrompts.push(prompt)
    if (aiMode === 'fail') return json(400, { error: 'judge down' })
    const said = prompt.match(/Tebakan pemain: (.*)/)?.[1]?.trim() ?? ''
    return answer(said === 'rend angg' || said === 'rendang' ? '{"index":3}' : '{"index":0}')
  }
  return answer('{}')
})

await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const port = (server.address() as { port: number }).port
// must be set before the module reads them
process.env.WAKAFY_BASE = `http://127.0.0.1:${port}`
process.env.WAKARU_AI_PROVIDER = 'openai-compatible'
process.env.WAKARU_AI_BASE_URL = `http://127.0.0.1:${port}`

const { startF100, handleF100Answer, stopF100 } = await import('../../src/lib/f100.ts')

const sock = {
  user: { id: '628000000000:1@s.whatsapp.net' },
  relayMessage: async () => 'RICHID',
  sendMessage: async (chat: string, content: any) => {
    if (content?.react) reactions.push({ chat, text: String(content.react.text ?? ''), msgId: String(content.react.key?.id ?? '') })
    return { key: { id: 'SENT' } }
  },
}

let seq = 0
const startGame = async (): Promise<string> => {
  const chat = `6281110000${++seq}@g.us`
  await startF100({
    sock,
    chat,
    reply: async (t: string) => { replies.push(t) },
    react: async () => {},
  } as any)
  return chat
}

const guess = async (chat: string, text: string): Promise<void> => {
  const id = `m${++seq}`
  await handleF100Answer(
    { sock, chat, reply: async (t: string) => { replies.push(t) }, msgKey: { id, remoteJid: chat } } as any,
    '628999@s.whatsapp.net',
    text,
    'Tester',
  )
}

const lastReaction = (chat: string): string =>
  [...reactions].reverse().find((r) => r.chat === chat)?.text ?? ''

const fresh = (chat: string): Reaction[] => reactions.filter((r) => r.chat === chat)

test('exact answer opens the board without asking the AI', async () => {
  const chat = await startGame()
  const before = judgePrompts.length
  await guess(chat, 'bakso')
  assert.equal(lastReaction(chat), '✅')
  assert.equal(judgePrompts.length, before, 'exact match should not spend an AI call')
})

test('typo on a single long word is accepted locally', async () => {
  const chat = await startGame()
  const before = judgePrompts.length
  await guess(chat, 'rendng')
  assert.equal(lastReaction(chat), '✅')
  assert.equal(judgePrompts.length, before, 'one-edit typo should resolve locally')
})

test('answer word inside a longer sentence is accepted', async () => {
  const chat = await startGame()
  await guess(chat, 'makan bakso enak')
  assert.equal(lastReaction(chat), '✅')
})

test('the local prefilter never rejects: unsure guesses still reach the AI', async () => {
  const chat = await startGame()
  const before = judgePrompts.length
  await guess(chat, 'bakwan')
  assert.equal(judgePrompts.length, before + 1, 'unclear guess must be judged by the AI, not dropped locally')
  assert.equal(lastReaction(chat), '❌')
})

test('AI miss is cached, so the same guess costs nothing the second time', async () => {
  const chat = await startGame()
  await guess(chat, 'bakwan')
  const before = judgePrompts.length
  await guess(chat, 'bakwan')
  assert.equal(judgePrompts.length, before)
  assert.equal(lastReaction(chat), '❌')
})

test('replaying an already-open answer is a recycle, not a miss', async () => {
  const chat = await startGame()
  await guess(chat, 'bakso')
  await guess(chat, 'bakso')
  assert.equal(lastReaction(chat), '♻️')
})

test('judge outage leaves no verdict: no cross, nothing cached, retry still works', async () => {
  const chat = await startGame()
  aiMode = 'fail'
  // "rendang" spelled in a way the local prefilter cannot resolve → must go to AI
  await guess(chat, 'rend angg')
  assert.notEqual(lastReaction(chat), '❌', 'a judge failure must never be shown as a wrong answer')
  assert.ok(fresh(chat).every((r) => r.text !== '❌'))
  assert.equal(lastReaction(chat), '⏳')
  assert.ok(
    replies.some((t) => t.includes('belum dinilai') && t.includes('coba kirim lagi nanti')),
    `expected a "not judged yet" notice, got: ${JSON.stringify(replies.slice(-3))}`,
  )

  aiMode = 'ok'
  await guess(chat, 'rend angg') // same guess: proves the failure was not cached
  assert.equal(lastReaction(chat), '✅')
})

test('garbage from the judge counts as no verdict, not as a miss', async () => {
  const chat = await startGame()
  aiMode = 'fail'
  await guess(chat, 'gado gadoan')
  assert.ok(fresh(chat).every((r) => r.text !== '❌'))
  aiMode = 'ok'
})

test('stopping the round cleans up', async () => {
  const chat = await startGame()
  await stopF100({ sock, chat, reply: async (t: string) => { replies.push(t) }, react: async () => {} } as any)
  await guess(chat, 'bakso')
  // no game left → handleF100Answer returns false and reacts to nothing
  assert.ok(fresh(chat).every((r) => r.msgId === '' || r.text !== '✅'))
})

test('teardown', async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

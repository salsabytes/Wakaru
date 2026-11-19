import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPO_TASK, heuristicIntent, routeMode, routeText, smartDecide, takeModeOverride, type IntentDecision } from '../../../src/lib/ai/aiRoute.ts'

const classifyAs = (intent: IntentDecision['intent']) => async (): Promise<IntentDecision> => ({
  intent,
  confidence: 'high',
  reason: 'test classifier',
  needs: { repo: intent === 'repo_read' || intent === 'repo_edit', web: false, bot: false, write: intent === 'repo_edit' },
})

test('repo tasks route to repo mode', () => {
  const tasks = [
    'bikinin fitur baru dong, buat test aja, nama commandnya test',
    'benerin bug di .play',
    'refactor handler messages',
    'tambahin command test',
    'cek src/commands/index.ts',
    'baca file package.json',
    'hapus file src/commands/main/test.ts',
    'delete fitur test',
    'hapus command test',
    'delete fiturnya.. tes doang',
    'hapus filenya',
    'kasi direktori kamu dong',
    'struktur project-nya gimana',
    'list file di src',
    'tunjukin struktur foldermu',
    'liat folder src dong',
    'isi direktorinya apa aja',
    'strukturnya kayak apa',
  ]
  for (const t of tasks) assert.equal(routeMode(t).mode, 'repo', t)
})

test('plain chat stays in chat mode', () => {
  const chats = ['halo apa kabar', 'buat puisi tentang hujan', 'jelasin fotosintesis', 'test', 'hapus pesan ini']
  for (const t of chats) assert.equal(routeMode(t).mode, 'chat', t)
})

test('manual override wins in both directions', () => {
  assert.deepEqual(routeMode('halo', 'repo'), { mode: 'repo', why: 'manual override' })
  assert.deepEqual(routeMode('benerin bug', 'chat'), { mode: 'chat', why: 'manual override' })
})

test('takeModeOverride strips @repo/@chat for owners only', () => {
  assert.deepEqual(takeModeOverride('@repo benerin bug', true), { text: 'benerin bug', forced: 'repo' })
  assert.deepEqual(takeModeOverride('@chat benerin bug', true), { text: 'benerin bug', forced: 'chat' })
  assert.deepEqual(takeModeOverride('@repo benerin bug', false), { text: '@repo benerin bug' })
  assert.deepEqual(takeModeOverride('halo', true), { text: 'halo' })
})

test('REPO_TASK needs a code-ish noun', () => {
  assert.equal(REPO_TASK.test('buat puisi'), false)
  assert.equal(REPO_TASK.test('fix bug login'), true)
})

test('short follow-ups inherit the quoted repo context', () => {
  const quoted = 'Fitur .test sudah dibuat di src/commands/main/test.ts'
  assert.equal(routeMode(routeText('hapus aja', quoted)).mode, 'repo')
  assert.equal(routeMode(routeText('ini apa?', quoted)).mode, 'chat')
  assert.equal(routeMode(routeText('hapus aja', '')).mode, 'chat')
})

test('heuristicIntent prefers safe clarification/chat for ambiguous cases', () => {
  assert.equal(heuristicIntent('hapus pesan ini').intent, 'chat')
  assert.equal(heuristicIntent('buat puisi hujan').intent, 'chat')
  assert.equal(heuristicIntent('bikinin game html ular').intent, 'build')
  assert.equal(heuristicIntent('cek src/commands/index.ts').intent, 'repo_read')
  assert.equal(heuristicIntent('benerin bug di .play').intent, 'repo_edit')
  assert.equal(heuristicIntent('struktur folder hp aku gimana').intent, 'clarify')
  assert.equal(heuristicIntent('bikinin fitur stats buat liat spek server').intent, 'repo_edit')
  assert.equal(heuristicIntent('tambahin command stats').intent, 'repo_edit')
  assert.equal(heuristicIntent('strukturnya kayak apa').intent, 'repo_read')
})

test('AI classifier decides repo vs chat (regex no longer overrides it)', async () => {
  // "fitur" makes the regex suggest repo, but the classifier knows it is a capability question.
  const chat = await smartDecide({ text: 'fiturnya apa aja nie?', isOwner: true }, classifyAs('chat'))
  assert.equal(chat.intent, 'chat')
  assert.equal(chat.needs.repo, false)

  // The classifier can also grant repo access for a repo-ish request.
  const repo = await smartDecide({ text: 'fitur stats apaan', isOwner: true }, classifyAs('repo_read'))
  assert.equal(repo.intent, 'repo_read')

  // Non-owner never gets repo even if the classifier says so.
  const guest = await smartDecide({ text: 'fiturnya apa aja', isOwner: false }, classifyAs('repo_read'))
  assert.equal(guest.intent, 'chat')
  assert.equal(guest.needs.repo, false)
})

test('AI classifier follows a new topic during an active repo task', async () => {
  const d = await smartDecide({ text: 'fiturnya apa aja nie?', activeTask: 'goal: tambah command stats', isOwner: true }, classifyAs('chat'))
  assert.equal(d.intent, 'chat')
})

test('AI classifier receives history so edit follow-ups are understood', async () => {
  let seen: any
  const history = 'user: bikin landing page\nassistant: [html reply] <!doctype html><html>...'
  const d = await smartDecide({ text: 'edit yang tadi dong', history, isOwner: true }, async (input) => {
    seen = input
    return { intent: 'build', confidence: 'high', reason: 'refine earlier html', needs: { repo: false, web: false, bot: false, write: false } }
  })
  assert.equal(d.intent, 'build')
  assert.equal(seen?.text, 'edit yang tadi dong')
  assert.match(String(seen?.history), /\[html reply\]/)
})

test('forced @repo/@chat still lets the classifier pick read vs write', async () => {
  const repo = await smartDecide({ text: 'tambah command halo', isOwner: true, forced: 'repo' }, async () => ({
    intent: 'build',
    confidence: 'high',
    reason: 'test',
    needs: { repo: false, web: false, bot: false, write: true },
  }))
  assert.equal(repo.intent, 'repo_edit')
  assert.equal(repo.needs.repo, true)

  const chat = await smartDecide({ text: 'lihat src/x.ts', isOwner: true, forced: 'chat' }, classifyAs('repo_read'))
  assert.equal(chat.intent, 'chat')
  assert.equal(chat.needs.repo, false)
})

test('AI classifier is always consulted (regex never short-circuits it)', async () => {
  let called = false
  const d = await smartDecide({ text: 'hapus pesan ini', isOwner: true }, async () => {
    called = true
    return { intent: 'chat', confidence: 'high', reason: 'delete chat', needs: { repo: false, web: false, bot: false, write: false } }
  })
  assert.equal(called, true)
  assert.equal(d.intent, 'chat')
})

test('regex is only the fallback when the classifier is unavailable', async () => {
  const d = await smartDecide({ text: 'fiturnya apa aja nie?', isOwner: true }, async () => {
    throw new Error('classifier down')
  })
  assert.ok(d.intent === 'repo_read' || d.intent === 'chat')
})

test('heuristicIntent continues active repo task on short follow-up', () => {
  const d = heuristicIntent('lanjut dong', { activeRepo: true })
  assert.ok(d.intent === 'repo_read' || d.intent === 'repo_edit')
})

test('heuristicIntent keeps style/refine follow-ups on the recent repo change', () => {
  for (const text of ['Stylenya jangan gitu', 'Iya gitu ja, edit ulang', 'warnanya kurang pas', 'tampilannya terlalu kecil']) {
    const d = heuristicIntent(text, { recentRepo: true })
    assert.equal(d.intent, 'repo_edit', text)
    assert.equal(d.needs.write, true, text)
  }
  assert.equal(heuristicIntent('gas aja', { recentRepo: true }).intent, 'chat')
  assert.equal(heuristicIntent('makasih ya', { recentRepo: true }).intent, 'chat')
})

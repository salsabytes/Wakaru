import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPO_TASK, heuristicIntent, routeMode, routeText, takeModeOverride } from '../src/lib/aiRoute.ts'

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

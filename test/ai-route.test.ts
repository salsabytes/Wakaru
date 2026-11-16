import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPO_TASK, routeMode, routeText, takeModeOverride } from '../src/lib/aiRoute.ts'

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

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-reminders-'))
process.env.WAKARU_DATA_DIR = dir
const rem = await import('../src/lib/reminders.ts')
const disk = await import('../src/lib/disk.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

test('add and list reminders in due order', () => {
  const later = rem.addReminder({ chat: 'c1', sender: 's1', text: 'later', dueAt: 2_000 })
  rem.addReminder({ chat: 'c1', sender: 's2', text: 'soon', dueAt: 1_000 })
  assert.deepEqual(rem.listReminders({ chat: 'c1' }).map((r) => r.text), ['soon', 'later'])

  assert.equal(rem.removeReminder(later.id, { chat: 'other' }), false)
  assert.equal(rem.removeReminder(later.id, { chat: 'c1' }), true)
  assert.deepEqual(rem.listReminders({ chat: 'c1' }).map((r) => r.text), ['soon'])
})

test('due reminders are peeked, then removed only when completed', () => {
  const r = rem.addReminder({ chat: 'c2', sender: 's1', text: 'ping', dueAt: 10 })
  assert.deepEqual(rem.getDueReminders(100).map((x) => x.id), [r.id])
  assert.equal(rem.listReminders({ chat: 'c2' }).length, 1)
  rem.completeReminder(r.id)
  assert.equal(rem.listReminders({ chat: 'c2' }).length, 0)
})

test('reschedule keeps the retry counter', () => {
  const r = rem.addReminder({ chat: 'c3', sender: 's1', text: 'retry', dueAt: 10 })
  rem.rescheduleReminder(r.id, 5_000, 2)
  const got = rem.listReminders({ chat: 'c3' })[0]
  assert.equal(got.dueAt, 5_000)
  assert.equal(got.attempts, 2)
  rem.completeReminder(r.id)
})

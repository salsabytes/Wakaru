import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-task-'))
process.env.WAKARU_DATA_DIR = dir
const task = await import('../../../src/lib/ai/aiTask.ts')
const disk = await import('../../../src/lib/disk.ts')

test('aiTask stores and clears active repo task', () => {
  task.setTask('c:s', { intent: 'repo_edit', goal: 'tambah command', plan: ['read', 'write'], step: 1, status: 'active', needsWrite: true, touched: ['src/a.ts'], notes: [] })
  assert.equal(task.isActiveRepoTask('c:s'), true)
  assert.match(task.formatTaskScratchpad('c:s') || '', /tambah command/)
  task.clearTask('c:s')
  assert.equal(task.getTask('c:s'), undefined)
})

test('isRecentRepoTask keeps finished changes available for follow-ups', () => {
  task.setTask('c:s', { intent: 'repo_edit', goal: 'bikin .stats', plan: [], step: 0, status: 'done', needsWrite: true, touched: ['src/commands/main/stats.ts'], notes: [] })
  assert.equal(task.isRecentRepoTask('c:s'), true)
  assert.match(task.formatTaskHint('c:s'), /stats\.ts/)
  assert.equal(task.isRecentRepoTask('c:s', -1), false)
})

test.after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

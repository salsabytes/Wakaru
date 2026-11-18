import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codegenFiles, parseDeletes, parseFileBlocks, resolveDeletePath } from '../src/lib/aiCodegen.ts'
import type { FileTools } from '../src/lib/agentFiles.ts'

const stub = (over: Partial<FileTools> = {}): FileTools => ({
  root: '.',
  list: async () => '',
  read: async () => '',
  grep: async () => '',
  write: async () => 'wrote',
  edit: async () => 'edited',
  remove: async () => 'deleted',
  gitStatus: async () => '',
  typecheck: async () => ({ ok: true, text: 'ok' }),
  test: async () => ({ ok: true, text: 'ok' }),
  sh: async () => ({ ok: true, text: 'ok' }),
  written: () => [],
  rollback: async () => [],
  dispose: async () => {},
  ...over,
})

test('parseFileBlocks reads path= fenced files and dedupes', () => {
  const text = [
    'Here you go.',
    '```ts path=src/a.ts',
    'export const a = 1',
    '```',
    '```ts path="src/b.ts"',
    'export const b = 2',
    '```',
    '```ts path=src/a.ts',
    'export const a = 3',
    '```',
    '```js',
    'ignored()',
    '```',
  ].join('\n')
  assert.deepEqual(parseFileBlocks(text), [
    { path: 'src/a.ts', content: 'export const a = 3' },
    { path: 'src/b.ts', content: 'export const b = 2' },
  ])
})

test('parseDeletes reads DELETE lines and skips prose', () => {
  const text = [
    'DELETE path=src/commands/main/stats.ts',
    '- HAPUS src/commands/main/a.ts',
    'Remove the stale file when done.',
    'DELETE the stale test',
  ].join('\n')
  assert.deepEqual(parseDeletes(text), ['src/commands/main/stats.ts', 'src/commands/main/a.ts'])
})

test('resolveDeletePath fixes a guessed parent folder', () => {
  const files = ['src/commands/owner/test.ts', 'src/commands/main/menu.ts']
  assert.equal(resolveDeletePath(files, 'src/commands/main/test.ts'), 'src/commands/owner/test.ts')
  assert.equal(resolveDeletePath(files, 'src/commands/main/menu.ts'), 'src/commands/main/menu.ts')
  assert.equal(resolveDeletePath(files, 'src/commands/main/nope.ts'), null)
})

test('resolveDeletePath refuses ambiguous names', () => {
  const files = ['src/a/test.ts', 'src/b/test.ts']
  assert.equal(resolveDeletePath(files, 'src/c/test.ts'), null)
})

test('codegenFiles deletes a feature file instead of emptying it', async () => {
  const removed: string[] = []
  const gen = await codegenFiles({
    task: 'hapus command .stats',
    tools: stub({
      list: async (rel) => (rel === 'src' ? 'f src/commands/main/stats.ts' : ''),
      remove: async (rel) => {
        removed.push(rel)
        return `deleted ${rel}`
      },
    }),
    ask: async () => 'DELETE path=src/commands/main/stats.ts',
  })
  assert.equal(gen.ok, true)
  assert.deepEqual(removed, ['src/commands/main/stats.ts'])
  assert.deepEqual(gen.files, ['src/commands/main/stats.ts'])
  assert.match(gen.text, /deleted/)
  assert.doesNotMatch(gen.text, /Coba/)
})

test('codegenFiles resolves a guessed delete path by basename', async () => {
  const removed: string[] = []
  const gen = await codegenFiles({
    task: 'hapus fitur test',
    tools: stub({
      list: async (rel) => (rel === 'src' ? 'f src/commands/owner/test.ts' : ''),
      remove: async (rel) => {
        removed.push(rel)
        return `deleted ${rel}`
      },
    }),
    ask: async () => 'DELETE path=src/commands/main/test.ts',
  })
  assert.equal(gen.ok, true)
  assert.deepEqual(removed, ['src/commands/owner/test.ts'])
})

test('codegenFiles writes generated blocks and verifies', async () => {
  const writes: Array<[string, string]> = []
  const tools = stub({
    write: async (rel, content) => {
      writes.push([rel, content])
      return `wrote ${rel}`
    },
  })
  const gen = await codegenFiles({
    task: 'bikin command stats',
    tools,
    ask: async () => '```ts path=src/commands/main/stats.ts\nexport const x = 1\n```',
  })
  assert.equal(gen.ok, true)
  assert.deepEqual(gen.files, ['src/commands/main/stats.ts'])
  assert.deepEqual(writes, [['src/commands/main/stats.ts', 'export const x = 1']])
  assert.match(gen.text, /typecheck ok/)
})

test('codegenFiles rolls back and reports after empty replies', async () => {
  let rollbacks = 0
  const gen = await codegenFiles({
    task: 'bikin command stats',
    tools: stub({ rollback: async () => { rollbacks++; return [] } }),
    ask: async () => 'Maaf, aku tidak punya akses repository.',
  })
  assert.equal(gen.ok, false)
  assert.equal(rollbacks, 1)
  assert.match(gen.text, /masih gagal/)
})

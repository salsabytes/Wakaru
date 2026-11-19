import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  asksForListing,
  createFileTools,
  ensureListingShown,
  parseAgentActions,
  renderTree,
  repoNudge,
  runAgentAction,
  wantsCodeChange,
} from '../../../src/lib/ai/agentFiles.ts'

const withRepo = async (fn: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'wakaru-agent-test-'))
  try {
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'test'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
    await writeFile(join(root, 'README.md'), '# repo\n', 'utf8')
    await writeFile(join(root, 'config.json'), '{}\n', 'utf8')
    await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('list and read stay inside the repo and hide blocked dirs', async () => {
  await withRepo(async (root) => {
    await mkdir(join(root, 'sessions'), { recursive: true })
    const tools = await createFileTools(root)
    try {
      const rootList = await tools.list('')
      assert.match(rootList, /src/)
      assert.doesNotMatch(rootList, /sessions/)
      assert.equal(await tools.read('src/a.ts'), 'export const a = 1\n')
      await assert.rejects(() => tools.read('../outside.txt'), /escapes the repo/)
      await assert.rejects(() => tools.read('sessions/x.json'), /blocked path/)
      await assert.rejects(() => tools.read('config.json'), /blocked path/)
    } finally {
      await tools.dispose()
    }
  })
})

test('write is limited to src/test/docs', async () => {
  await withRepo(async (root) => {
    const tools = await createFileTools(root)
    try {
      await assert.rejects(() => tools.write('native/x.rs', 'x'), /write not allowed/)
      await assert.rejects(() => tools.write('config.json', '{}'), /blocked path/)
      assert.match(await tools.write('src/a.ts', 'export const a = 2\n'), /wrote src\/a\.ts/)
      assert.match(await tools.write('README.md', '# new\n'), /wrote README\.md/)
    } finally {
      await tools.dispose()
    }
  })
})

test('rollback restores edited files and removes new ones', async () => {
  await withRepo(async (root) => {
    const tools = await createFileTools(root)
    try {
      await tools.write('src/a.ts', 'broken(\n')
      await tools.write('test/new.test.ts', '// new\n')
      assert.equal(tools.written().length, 2)
      const restored = await tools.rollback()
      assert.deepEqual(restored.sort(), ['src/a.ts', 'test/new.test.ts'])
      assert.equal(await readFile(join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 1\n')
      await assert.rejects(() => readFile(join(root, 'test', 'new.test.ts'), 'utf8'))
      assert.deepEqual(tools.written(), [])
    } finally {
      await tools.dispose()
    }
  })
})

test('grep finds matches and skips blocked paths', async () => {
  await withRepo(async (root) => {
    await mkdir(join(root, 'sessions'), { recursive: true })
    await writeFile(join(root, 'sessions', 'x.json'), 'needle\n', 'utf8')
    await writeFile(join(root, 'src', 'b.ts'), 'const needle = 1\n', 'utf8')
    const tools = await createFileTools(root)
    try {
      const out = await tools.grep('needle')
      assert.match(out, /src\/b\.ts:1/)
      assert.doesNotMatch(out, /sessions/)
    } finally {
      await tools.dispose()
    }
  })
})

test('parseAgentActions reads tools and fenced write bodies', () => {
  const reply = [
    'Let me check the file first.',
    '@read src/a.ts',
    '@write src/a.ts',
    '```ts',
    'export const a = 2',
    '```',
    '@typecheck',
    '@done patched it',
  ].join('\n')
  const { actions, prose } = parseAgentActions(reply)
  assert.equal(prose, 'Let me check the file first.')
  assert.deepEqual(
    actions.map((a) => a.tool),
    ['read', 'write', 'typecheck', 'done'],
  )
  assert.equal(actions[1].tool === 'write' && actions[1].content, 'export const a = 2')
  assert.equal(actions[3].arg, 'patched it')
})

test('parseAgentActions accepts a fence after a short intro line', () => {
  const { actions, errors } = parseAgentActions('@write src/a.ts\nBerikut kodenya:\n```ts\nexport const a = 2\n```')
  assert.deepEqual(errors, [])
  assert.deepEqual(actions.map((a) => [a.tool, a.arg]), [['write', 'src/a.ts']])
  assert.equal(actions[0].tool === 'write' && actions[0].content, 'export const a = 2')
})

test('parseAgentActions reports a write without a fence instead of dropping it', () => {
  const { actions, errors } = parseAgentActions('@write src/a.ts\nno fence here')
  assert.equal(actions.length, 0)
  assert.match(errors[0], /missing fenced code block/)
})

test('parseAgentActions keeps shell commands intact', () => {
  const { actions } = parseAgentActions('@sh git log --oneline -5 # terakhir\n@bash npm test')
  assert.deepEqual(actions.map((a) => [a.tool, a.arg]), [
    ['sh', 'git log --oneline -5 # terakhir'],
    ['sh', 'npm test'],
  ])
})

test('sh runs a real command and blocks dangerous ones', async () => {
  await withRepo(async (root) => {
    const tools = await createFileTools(root)
    try {
      const ok = await tools.sh('node --version')
      assert.equal(ok.ok, true)
      assert.match(ok.text, /^v\d+/)
      await assert.rejects(() => tools.sh('npm install left-pad'), /blocked for safety/)
      await assert.rejects(() => tools.sh('rm -rf /'), /blocked for safety/)
    } finally {
      await tools.dispose()
    }
  })
})

test('sh streams output chunks while running', async () => {
  await withRepo(async (root) => {
    const tools = await createFileTools(root)
    try {
      const chunks: string[] = []
      const ok = await tools.sh(
        "node -e \"console.log('one');setTimeout(()=>console.log('two'),150)\"",
        (chunk) => chunks.push(chunk),
      )
      assert.equal(ok.ok, true)
      assert.match(ok.text, /one/)
      assert.match(ok.text, /two/)
      assert.match(chunks.join(''), /one/)
      assert.ok(chunks.length >= 1)
    } finally {
      await tools.dispose()
    }
  })
})

test('parseAgentActions tolerates markdown wrapped markers', () => {
  const { actions, prose } = parseAgentActions(['Boleh kak.', '', '- `@ls src`', '> **@read src/a.ts**', '2. @typecheck'].join('\n'))
  assert.equal(prose, 'Boleh kak.')
  assert.deepEqual(actions.map((a) => [a.tool, a.arg]), [
    ['ls', 'src'],
    ['read', 'src/a.ts'],
    ['typecheck', ''],
  ])
})

test('parseAgentActions strips trailing notes from tool args', () => {
  const reply = [
    '@read src/commands/index.ts — membaca handler dan sistem registrasi command.',
    '@ls -r src (struktur folder)',
    '@grep handleMessage src — cari handler',
    '@rm src/a.ts # hapus file',
  ].join('\n')
  const { actions } = parseAgentActions(reply)
  assert.deepEqual(actions.map((a) => [a.tool, a.arg]), [
    ['read', 'src/commands/index.ts'],
    ['ls', '-r src'],
    ['grep', 'handleMessage src'],
    ['rm', 'src/a.ts'],
  ])
})

test('remove deletes a file and rollback restores it', async () => {
  await withRepo(async (root) => {
    const tools = await createFileTools(root)
    try {
      await assert.rejects(() => tools.remove('native/x.rs'), /delete not allowed/)
      await assert.rejects(() => tools.remove('config.json'), /blocked path/)
      await assert.rejects(() => tools.remove('src/nope.ts'), /not found/)
      assert.match(await tools.remove('src/a.ts'), /deleted src\/a\.ts/)
      await assert.rejects(() => readFile(join(root, 'src', 'a.ts'), 'utf8'))
      assert.deepEqual(tools.written(), ['src/a.ts'])
      await tools.rollback()
      assert.equal(await readFile(join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 1\n')
    } finally {
      await tools.dispose()
    }
  })
})

test('parseAgentActions understands rm and delete', () => {
  const { actions } = parseAgentActions('@rm src/a.ts\n@delete src/b.ts')
  assert.deepEqual(actions, [
    { tool: 'rm', arg: 'src/a.ts' },
    { tool: 'rm', arg: 'src/b.ts' },
  ])
})

test('a listing answer is not a false claim once tools ran', () => {
  const listed = 'Inventarisasi ulang selesai. Seluruh 15 direktori repository Wakaru telah diperiksa.'
  // no tool yet: the model is claiming work it never did
  assert.equal(repoNudge(listed, 0), 'listing')
  assert.equal(repoNudge('Sudah aku cek semua folder', 0), 'listing')
  // @ls already returned real paths: the prose is the answer, not a lie
  assert.equal(repoNudge(listed, 1), null)
  assert.equal(repoNudge('Sudah aku cek semua folder', 1), null)
  // a real lie about a write is still caught before any tool runs
  assert.equal(repoNudge('Sudah aku hapus file itu', 0), 'claim')
  assert.equal(repoNudge('Aku tidak punya akses repo di sini', 0), 'stall')
})

test('a change request is not finished by reading or chatting', () => {
  assert.equal(wantsCodeChange('tolong buatin fitur test'), true)
  assert.equal(wantsCodeChange('hapus command lama'), true)
  assert.equal(wantsCodeChange('benerin bug play'), true)
  assert.equal(wantsCodeChange('tunjukin struktur foldermu'), false)
  assert.equal(wantsCodeChange('jelasin cara kerja handler'), false)
  assert.equal(wantsCodeChange('baca file src/index.ts'), false)
  // before any tool ran: must start with a tool
  assert.equal(repoNudge('sebentar ya~', 0, true), 'stall')
  // after @ls only: keep going instead of accepting filler
  assert.equal(repoNudge('Aku lanjutkan pembuatan fitur setelah memastikan struktur.', 1, true), 'continue')
  // already wrote: a normal summary is fine
  assert.equal(repoNudge('Fitur test sudah jadi, typecheck dan test lolos.', 2, false), null)
})

test('a listing summary never hides the real structure', () => {
  const ls = ['[ls .]', 'd src', 'f package.json', 'd test', '[ls src]', 'f src/index.ts'].join('\n')
  const summary = 'Inventarisasi struktur repository selesai. Semua direktori telah diperiksa.'
  const out = ensureListingShown(summary, [ls])
  // rendered as a nested tree, never a raw d/f dump
  assert.doesNotMatch(out, /^d src/m)
  assert.match(out, /├── src\/ \(1 file\)\n│   └── index\.ts/)
  assert.match(out, /├── test\/ \(0 file\)/)
  assert.match(out, /└── package\.json/)
  // a real tree already in the reply is left untouched
  const tree = 'Struktur repo:\n```txt\nsrc\ntest\npackage.json\n```'
  assert.equal(ensureListingShown(tree, [ls]), tree)
  // no ls output: nothing to append
  assert.equal(ensureListingShown(summary, []), summary)
  assert.equal(asksForListing('cek foldernya ulang'), true)
  assert.equal(asksForListing('tunjukin struktur foldermu'), true)
  assert.equal(asksForListing('liat isi folder src'), true)
  assert.equal(asksForListing('benerin bug play'), false)
  // an explanation question mentions a folder but wants prose, not a tree
  assert.equal(
    asksForListing('coba kamu cek folder yang ngatur agentic kamu, kok bisa ngubah file? jelasin dong'),
    false,
  )
  assert.equal(asksForListing('jelasin cara kerja folder src/lib'), false)
})

test('renderTree nests dirs before files and dedupes ls output', () => {
  const entries = [
    { path: 'src', dir: true },
    { path: 'src/commands', dir: true },
    { path: 'src/commands/ai.ts', dir: false },
    { path: 'src/index.ts', dir: false },
    { path: 'README.md', dir: false },
  ]
  assert.equal(
    renderTree(entries),
    [
      '├── src/ (2 file)',
      '│   ├── commands/ (1 file)',
      '│   │   └── ai.ts',
      '│   └── index.ts',
      '└── README.md',
    ].join('\n'),
  )
  const dup = ensureListingShown('x', ['[ls src]\nd src/a\nd src/a\nf src/a/x.ts'])
  assert.equal(dup.match(/a\/ \(1 file\)/g)?.length, 1)
})

test('recursive ls returns the whole subtree in one call', async () => {
  await withRepo(async (root) => {
    await mkdir(join(root, 'src', 'lib'), { recursive: true })
    await writeFile(join(root, 'src', 'lib', 'b.ts'), 'export const b = 2\n', 'utf8')
    await mkdir(join(root, 'sessions'), { recursive: true })
    await writeFile(join(root, 'sessions', 'x.json'), '{}\n', 'utf8')
    const tools = await createFileTools(root)
    try {
      assert.doesNotMatch(await tools.list(''), /src\/lib/)
      const out = (await runAgentAction(tools, { tool: 'ls', arg: '-r .' })).split('\n')
      assert.equal(out[0], '[ls -r .]')
      assert.ok(out.includes('d src/lib'))
      assert.ok(out.includes('f src/lib/b.ts'))
      assert.ok(out.includes('f src/a.ts'))
      // blocked dirs stay hidden, folders sort before files at each level
      assert.ok(!out.some((l) => l.includes('sessions')))
      assert.ok(out.indexOf('d src') < out.indexOf('f README.md'))
    } finally {
      await tools.dispose()
    }
  })
})

test('write refuses to empty a file by accident', async () => {
  await withRepo(async (root) => {
    const tools = await createFileTools(root)
    try {
      await assert.rejects(() => tools.write('src/a.ts', '   '), /use @rm to delete/)
      assert.equal(await readFile(join(root, 'src', 'a.ts'), 'utf8'), 'export const a = 1\n')
    } finally {
      await tools.dispose()
    }
  })
})

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-groups-'))
process.env.WAKARU_DATA_DIR = dir
const gs = await import('../src/lib/groupSettings.ts')
const disk = await import('../src/lib/disk.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

const readGroups = async (): Promise<Record<string, unknown>> => {
  for (let i = 0; i < 50; i++) {
    try {
      return JSON.parse(await readFile(join(dir, 'groups.json'), 'utf8'))
    } catch {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  throw new Error('groups.json was not written')
}

test('antilink defaults and clamping', () => {
  assert.deepEqual(gs.antilinkConfig('g1'), { on: false, kick: true, maxWarn: 3 })
  assert.equal(gs.setAntilinkMaxWarn('g1', 0), gs.ANTILINK_MAX_WARN_MIN)
  assert.equal(gs.setAntilinkMaxWarn('g1', 99), gs.ANTILINK_MAX_WARN_MAX)
  assert.equal(gs.setAntilinkMaxWarn('g1', 'nope'), gs.ANTILINK_DEFAULT_MAX_WARN)
})

test('disabling antilink clears strikes', () => {
  gs.toggleAntilink('g2', true)
  gs.addAntilinkWarn('g2', '6281')
  assert.equal(gs.getGroupSettings('g2').warns?.['6281'], 1)
  gs.toggleAntilink('g2', false)
  assert.equal(gs.getGroupSettings('g2').warns, undefined)
})

test('warn reset only clears one member', () => {
  gs.addAntilinkWarn('g3', 'a')
  gs.addAntilinkWarn('g3', 'b')
  gs.resetAntilinkWarns('g3', 'a')
  assert.equal(gs.getGroupSettings('g3').warns?.['a'], undefined)
  assert.equal(gs.getGroupSettings('g3').warns?.['b'], 1)
})

test('settings are registered with the disk flusher', async () => {
  gs.toggleAntilink('g4', true)
  const saved = await readGroups()
  assert.equal((saved.g4 as { antilink?: boolean }).antilink, true)
})

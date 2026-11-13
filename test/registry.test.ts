import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCommand, listCommands } from '../src/commands/index.ts'

test('command registry has unique lowercase names', async () => {
  const cmds = await listCommands()
  assert.ok(cmds.length >= 10)
  const seen = new Set<string>()
  for (const c of cmds) {
    assert.match(c.name, /^[a-z][a-z0-9_-]*$/)
    assert.ok(!seen.has(c.name), `duplicate command: ${c.name}`)
    seen.add(c.name)
  }
})

test('aliases resolve to their canonical command', async () => {
  assert.equal((await getCommand('help'))?.name, 'menu')
  assert.equal((await getCommand('f100'))?.name, 'family100')
  assert.equal((await getCommand('reminder'))?.name, 'remind')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMenu } from '../src/commands/main/menu.ts'

const base = {
  pushName: 'Test',
  prefix: '.',
  isOwner: false,
  elapsedMs: 42,
}

test('renderMenu groups commands and includes stats', async () => {
  const m = await renderMenu({
    ...base,
    commands: [
      { name: 'menu', category: 'main' },
      { name: 'ytmp3', category: 'downloader' },
    ],
  })
  assert.ok(m.startsWith('```\n✦ WAKARU'))
  assert.ok(m.trimEnd().endsWith('```'))
  assert.ok(m.includes('── ✦ MAIN '))
  assert.ok(m.includes('── ◈ DOWNLOADER '))
  assert.ok(m.includes('✧ .ytmp3'))
  assert.ok(m.includes('42ms'))
})

test('renderMenu shows the owner section only to owners', async () => {
  const commands = [
    { name: 'menu', category: 'main' },
    { name: 'mode', category: 'main', ownerOnly: true },
  ]
  const ownerView = await renderMenu({ ...base, isOwner: true, commands })
  assert.ok(ownerView.includes('OWNER '))
  assert.ok(ownerView.includes('.mode'))

  const userView = await renderMenu({ ...base, isOwner: false, commands })
  assert.ok(!userView.includes('.mode'))
  assert.ok(!userView.includes('OWNER'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAdmin, isBotAdmin } from '../src/lib/group.ts'

type Meta = Parameters<typeof isAdmin>[1]

const met = {
  participants: [
    { id: '6281@s.whatsapp.net', admin: 'admin' },
    { id: '6282@s.whatsapp.net', admin: null },
    { id: '628bot@s.whatsapp.net', admin: 'admin' },
  ],
} as unknown as Meta

const fake = (sender: string, botId?: string) =>
  ({ sender, sock: botId ? { user: { id: botId } } : {} }) as unknown as CommandContext

test('isAdmin matches only group admins', async () => {
  assert.equal(await isAdmin(fake('6281@s.whatsapp.net'), met), true)
  assert.equal(await isAdmin(fake('6282@s.whatsapp.net'), met), false)
  assert.equal(await isAdmin(fake('6289@s.whatsapp.net'), met), false)
})

test('isBotAdmin needs a known bot id with admin rights', async () => {
  assert.equal(await isBotAdmin(fake('6281@s.whatsapp.net', '628bot@s.whatsapp.net'), met), true)
  assert.equal(await isBotAdmin(fake('6281@s.whatsapp.net', '6282@s.whatsapp.net'), met), false)
  assert.equal(await isBotAdmin(fake('6281@s.whatsapp.net'), met), false)
})

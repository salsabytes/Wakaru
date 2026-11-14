import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WAMessageStubType, type BaileysEventMap, type WAMessage, type WASocket } from 'baileys'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-antidelete-'))
process.env.WAKARU_DATA_DIR = dir
const gs = await import('../src/lib/groupSettings.ts')
const store = await import('../src/lib/store.ts')
const disk = await import('../src/lib/disk.ts')
const { handleMessagesUpdate } = await import('../src/handlers/antidelete.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

const calls: { chat: string; content: any }[] = []
const sock = {
  sendMessage: async (chat: string, content: any) => {
    calls.push({ chat, content })
  },
} as unknown as WASocket

const msg = (id: string, chat: string, extra: Partial<WAMessage> = {}): WAMessage =>
  ({
    key: { remoteJid: chat, id, participant: '6281@s.whatsapp.net', fromMe: false },
    message: { conversation: 'halo' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Budi',
    ...extra,
  }) as WAMessage

const revoke = (id: string, chat: string, fromMe = false): BaileysEventMap['messages.update'] =>
  [
    {
      key: { remoteJid: chat, id, participant: '6282@s.whatsapp.net', fromMe },
      update: { message: null, messageStubType: WAMessageStubType.REVOKE },
    },
  ]

test('restores a revoked group message when enabled', async () => {
  const chat = 'on@g.us'
  gs.toggleAntidelete(chat, true)
  store.messageStore.set('ad-1', msg('ad-1', chat))
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-1', chat), sock)

  assert.equal(calls.length, 2)
  assert.match(calls[0].content.text, /Anti-delete/)
  assert.match(calls[0].content.text, /Budi/)
  assert.equal(calls[1].content.forward.key.id, 'ad-1')
})

test('stays quiet when antidelete is off', async () => {
  const chat = 'off@g.us'
  store.messageStore.set('ad-2', msg('ad-2', chat))
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-2', chat), sock)

  assert.equal(calls.length, 0)
})

test('skips deletions made by the bot itself', async () => {
  const chat = 'bot@g.us'
  gs.toggleAntidelete(chat, true)
  store.messageStore.set('ad-3', msg('ad-3', chat))
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-3', chat, true), sock)

  assert.equal(calls.length, 0)
})

test('skips view-once messages', async () => {
  const chat = 'viewonce@g.us'
  gs.toggleAntidelete(chat, true)
  store.messageStore.set(
    'ad-4',
    msg('ad-4', chat, {
      message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } },
    }),
  )
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-4', chat), sock)

  assert.equal(calls.length, 0)
})

test('skips messages sent before antidelete was enabled', async () => {
  const chat = 'old@g.us'
  gs.toggleAntidelete(chat, true)
  store.messageStore.set('ad-5', msg('ad-5', chat, { messageTimestamp: Math.floor(Date.now() / 1000) - 60 }))
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-5', chat), sock)

  assert.equal(calls.length, 0)
})

test('ignores cache misses', async () => {
  const chat = 'miss@g.us'
  gs.toggleAntidelete(chat, true)
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-6', chat), sock)

  assert.equal(calls.length, 0)
})

test('dedupes repeated revoke events', async () => {
  const chat = 'dup@g.us'
  gs.toggleAntidelete(chat, true)
  store.messageStore.set('ad-7', msg('ad-7', chat))
  calls.length = 0

  await handleMessagesUpdate(revoke('ad-7', chat), sock)
  await handleMessagesUpdate(revoke('ad-7', chat), sock)

  assert.equal(calls.length, 2)
})

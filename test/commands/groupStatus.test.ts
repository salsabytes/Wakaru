import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WAMessage, WASocket } from 'baileys'
import cmd from '../../src/commands/group/groupStatus.ts'
import * as gs from '../../src/lib/wa/groupStatus.ts'

// The command has to work three ways — caption on a photo/video, a reply to
// one, or plain text — and must fail fast on oversize media instead of hanging
// in an upload. The relay itself is exercised in test/lib/wa/groupStatus.test.ts.

interface Recorded {
  jid: string
  input: gs.GroupStatusInput
}

const ctxOf = (over: Partial<CommandContext> & { reply?: (t: string) => Promise<void> }) => {
  const replies: string[] = []
  const reactions: string[] = []
  const ctx = {
    sock: { user: { id: '628111111111:1@s.whatsapp.net' } } as unknown as WASocket,
    prefix: '.',
    args: [],
    text: '',
    chat: '120363000000000000@g.us',
    sender: '628111111111@s.whatsapp.net',
    isGroup: true,
    isAdmin: true,
    isBotAdmin: true,
    isOwner: false,
    mtype: 'conversation',
    mentionedJid: [],
    download: async () => Buffer.from(''),
    fromMe: false,
    reply: async (t: string) => {
      replies.push(t)
    },
    react: async (e: string) => {
      reactions.push(e)
    },
    ...over,
  } as unknown as CommandContext
  return { ctx, replies, reactions }
}

// These cases go through the real relay path with a stub socket and assert what
// the relay received — sendGroupStatus is imported directly, so a monkeypatch on
// the module object would not reach the binding the command already holds.

const stubSock = () => {
  const seen: { jid: string; content: any; opts: any }[] = []
  const sock = {
    user: { id: '628111111111:1@s.whatsapp.net' },
    waUploadToServer: async () => ({ mediaUrl: 'https://mmg.whatsapp.net/x', directPath: '/x' }),
    relayMessage: async (jid: string, content: any, opts: any) => {
      seen.push({ jid, content, opts })
      return opts.messageId
    },
  } as unknown as WASocket
  return { sock, seen }
}

test('text only: relays an extendedTextMessage group status', async () => {
  const { sock, seen } = stubSock()
  const { ctx, reactions } = ctxOf({ sock, text: 'rapat jam 7 ya' } as any)
  await cmd.run(ctx)

  assert.equal(seen.length, 1)
  const inner = seen[0].content.groupStatusMessageV2.message
  assert.equal(inner.extendedTextMessage.text, 'rapat jam 7 ya')
  assert.equal(inner.extendedTextMessage.contextInfo.isGroupStatus, true)
  assert.deepEqual(reactions, ['⏳', '✅'])
})

test('no caption and no media prints usage instead of sending', async () => {
  const { sock, seen } = stubSock()
  const { ctx, replies } = ctxOf({ sock, text: '   ' } as any)
  await cmd.run(ctx)

  assert.equal(seen.length, 0)
  assert.equal(replies.length, 1)
  assert.match(replies[0], /swgc/)
})

test('caption on a photo uses the photo itself', async () => {
  const { sock, seen } = stubSock()
  const { ctx } = ctxOf({ sock, text: 'liburan', mtype: 'imageMessage', mimetype: 'image/jpeg', download: async () => Buffer.from('jpeg') } as any)
  await cmd.run(ctx)

  assert.equal(seen.length, 1)
  const inner = seen[0].content.groupStatusMessageV2.message
  assert.equal(inner.imageMessage.caption, 'liburan')
  assert.equal(inner.imageMessage.contextInfo.isGroupStatus, true)
})

test('oversize media is refused before the upload starts', async () => {
  const big = Buffer.alloc(64 * 1024 * 1024 + 1)
  let downloaded = 0
  const { sock, seen } = stubSock()
  const { ctx, replies } = ctxOf({
    sock,
    text: 'x',
    mtype: 'videoMessage',
    download: async () => {
      downloaded++
      return big
    },
  } as any)
  await cmd.run(ctx)

  assert.equal(downloaded, 1)
  assert.equal(seen.length, 0)
  assert.match(replies[0], /64 MB|kegedean|too big/)
})

test('a failed download is reported, not swallowed', async () => {
  const { sock, seen } = stubSock()
  const { ctx, replies } = ctxOf({
    sock,
    text: 'x',
    mtype: 'imageMessage',
    download: async () => {
      throw Object.assign(new Error('gone'), { output: { statusCode: 404 } })
    },
  } as any)
  await cmd.run(ctx)

  assert.equal(seen.length, 0)
  assert.match(replies[0], /kedaluwarsa|expired/)
})

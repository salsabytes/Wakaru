import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtBytes, mediaDuration } from '../src/lib/media.ts'

test('mediaDuration reads mp4 mvhd v0', () => {
  const mp4 = Buffer.alloc(64)
  mp4.write('mvhd', 4)
  mp4.writeUInt32BE(1000, 4 + 16) // timescale
  mp4.writeUInt32BE(253000, 4 + 20) // duration -> 4:13
  assert.equal(mediaDuration(mp4), '4:13')
})

test('mediaDuration reads mp4 mvhd v1', () => {
  const mp4 = Buffer.alloc(64)
  mp4.write('mvhd', 4)
  mp4[8] = 1
  mp4.writeUInt32BE(1000, 4 + 24) // timescale
  mp4.writeBigUInt64BE(253000n, 4 + 28) // duration -> 4:13
  assert.equal(mediaDuration(mp4), '4:13')
})

test('mediaDuration estimates mp3 CBR duration', () => {
  const mp3 = Buffer.alloc(128000) // 128kbps CBR -> 8s
  mp3[0] = 0xff
  mp3[1] = 0xfb
  mp3[2] = 0x90
  assert.equal(mediaDuration(mp3), '0:08')
})

test('fmtBytes switches to MB past a million bytes', () => {
  assert.equal(fmtBytes(3.2e6), '3.2 MB')
  assert.equal(fmtBytes(4_000), '4 KB')
})

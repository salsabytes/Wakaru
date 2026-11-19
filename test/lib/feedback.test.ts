import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feedbackTo, formatFeedback } from '../../src/lib/feedback.ts'

test('formatFeedback includes the kind, text and sender', () => {
  const body = formatFeedback('request', 'tambahin fitur anti-spam', {
    sender: '6281234@s.whatsapp.net',
    pushName: 'Budi',
    isGroup: true,
    chat: '123@g.us',
  })
  assert.match(body, /Feature request/)
  assert.match(body, /tambahin fitur anti-spam/)
  assert.match(body, /Budi \(6281234\)/)
  assert.match(body, /group 123@g\.us/)
})

test('formatFeedback falls back to the number and private chat', () => {
  const body = formatFeedback('report', 'sticker gagal', {
    sender: '6289999:12@s.whatsapp.net',
    isGroup: false,
    chat: '6289999@s.whatsapp.net',
  })
  assert.match(body, /Bug report/)
  assert.match(body, /6289999 · private chat/)
})

test('feedback always goes to the owner number', () => {
  assert.equal(feedbackTo(), '6288218292156@s.whatsapp.net')
})

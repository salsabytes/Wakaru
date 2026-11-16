import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitMessages } from '../src/lib/llm.ts'

const total = (msgs: Array<{ content: string }>): number => msgs.reduce((n, m) => n + m.content.length, 0)

test('a prompt under the limit is passed through untouched', () => {
  const msgs = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'halo' },
  ]
  assert.equal(fitMessages(msgs), msgs)
})

test('one huge tool result is clipped but keeps both ends', () => {
  const body = `HEAD-MARK${'x'.repeat(40_000)}TAIL-MARK`
  const out = fitMessages([
    { role: 'system', content: 'rules' },
    { role: 'user', content: body },
  ])
  assert.ok(total(out) <= 28_000, `got ${total(out)}`)
  assert.match(out[1].content, /^HEAD-MARK/)
  assert.match(out[1].content, /TAIL-MARK$/)
  assert.match(out[1].content, /dipotong/)
})

test('old turns are dropped before the system prompt and the newest one', () => {
  const old = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `turn ${i} ${'y'.repeat(4000)}` }))
  const out = fitMessages([
    { role: 'system', content: 'RULES' },
    ...old,
    { role: 'user', content: 'NEWEST' },
  ])
  assert.ok(total(out) <= 28_000, `got ${total(out)}`)
  assert.equal(out[0].content, 'RULES')
  assert.equal(out.at(-1)?.content, 'NEWEST')
  assert.ok(out.length < old.length + 2)
})

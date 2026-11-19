import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOwn, pickOwn } from '../../src/commands/main/delete.ts'

const msg = (id: string, fromMe: boolean) => ({ key: { id, fromMe } })

test('isOwn only accepts the account own messages', () => {
  assert.equal(isOwn(msg('a', true)), true)
  assert.equal(isOwn(msg('a', false)), false)
  assert.equal(isOwn({}), false)
})

test('pickOwn keeps the newest own messages and skips others', () => {
  const recent = [msg('u1', false), msg('b1', true), msg('b2', true), msg('u2', false), msg('b3', true)]
  assert.deepEqual(pickOwn(recent, 2).map((m) => m.key.id), ['b2', 'b3'])
  assert.deepEqual(pickOwn(recent, 10).map((m) => m.key.id), ['b1', 'b2', 'b3'])
  assert.deepEqual(pickOwn([msg('u1', false)], 5), [])
})

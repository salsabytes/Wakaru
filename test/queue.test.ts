import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cooldownLeft, withSlot } from '../src/lib/queue.ts'

test('withSlot never exceeds the global slot limit', async () => {
  let active = 0
  let peak = 0
  const job = () =>
    withSlot(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
    })
  await Promise.all(Array.from({ length: 8 }, job))
  assert.equal(active, 0)
  assert.ok(peak >= 2, `expected some overlap, saw ${peak}`)
  assert.ok(peak <= 4, `expected at most 4 slots, saw ${peak}`)
})

test('cooldownLeft records the first use and reports the remainder', () => {
  assert.equal(cooldownLeft('queue-test:user', 10), 0)
  const left = cooldownLeft('queue-test:user', 10)
  assert.ok(left >= 9 && left <= 10, `unexpected cooldown: ${left}`)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAiBusy, setAiBusy } from '../../../src/lib/ai/aiStatus.ts'

test('ai status flag toggles', () => {
  assert.equal(isAiBusy(), false)
  setAiBusy(true)
  assert.equal(isAiBusy(), true)
  setAiBusy(false)
  assert.equal(isAiBusy(), false)
})

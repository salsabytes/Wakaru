import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration, parseDuration } from '../src/lib/time.ts'

test('parseDuration handles units and defaults', () => {
  assert.equal(parseDuration('10m'), 600_000)
  assert.equal(parseDuration('1h30m'), 5_400_000)
  assert.equal(parseDuration('2d'), 172_800_000)
  assert.equal(parseDuration('1.5h'), 5_400_000)
  assert.equal(parseDuration('90'), 5_400_000) // bare number = minutes
  assert.equal(parseDuration(''), undefined)
  assert.equal(parseDuration('abc'), undefined)
  assert.equal(parseDuration('0m'), undefined)
  assert.equal(parseDuration('10x'), undefined)
})

test('parseDuration handles HH:MM as the next occurrence', () => {
  const ms = parseDuration('09:00')
  assert.ok(ms !== undefined && ms > 0 && ms <= 24 * 3_600_000)
  assert.equal(parseDuration('25:00'), undefined)
  assert.equal(parseDuration('12:60'), undefined)
})

test('formatDuration renders day/hour/minute/second buckets', () => {
  assert.equal(formatDuration(0), '0m')
  assert.equal(formatDuration(90_000), '1m')
  assert.equal(formatDuration(3_661_000), '1j 1m')
  assert.equal(formatDuration(61_000), '1m')
  assert.equal(formatDuration(86_400_000), '1h')
  assert.equal(formatDuration(-1), '0m')
})

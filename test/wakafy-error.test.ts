import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wakafy } from '../src/lib/wakafy.ts'

test('wakafy error keeps 5xx readable and retryable', () => {
  const html = '<html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1></body></html>'
  const err = wakafy.error(504, html)
  assert.match(err.message, /http 504/)
  assert.match(err.message, /Gateway Time-out/)
  assert.doesNotMatch(err.message, /<html>/)
  assert.match(wakafy.error(503, '{"error":"busy"}').message, /http 503/)
  assert.equal(wakafy.error(401, '').message, 'wakafy: unauthorized (cek WAKAFY_API_KEY)')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScraperError, classifyError, scraperErrorKey } from '../src/lib/scrapers/errors.ts'

test('classifyError maps common failures', () => {
  assert.equal(classifyError(new Error('403 forbidden')).type, 'private')
  assert.equal(classifyError(new Error('404 not found')).type, 'notfound')
  assert.equal(classifyError(new Error('429 too many requests')).type, 'rate_limited')
  assert.equal(classifyError(new Error('blocked in your country')).type, 'blocked')
  assert.equal(classifyError(new Error('request timeout')).type, 'network')
  assert.equal(classifyError(new Error('unsupported link')).type, 'unsupported')
  assert.equal(classifyError(new Error('weird failure')).type, 'unknown')
})

test('classifyError keeps an existing ScraperError and fills the platform', () => {
  const e = new ScraperError('nope', { type: 'private' })
  const out = classifyError(e, 'tiktok')
  assert.equal(out, e)
  assert.equal(out.platform, 'tiktok')
})

test('scraperErrorKey is safe for any thrown value', () => {
  assert.equal(scraperErrorKey(new Error('403 forbidden')), 'scraperErrPrivate')
  assert.equal(scraperErrorKey(new Error('429 too many')), 'scraperErrRateLimited')
  assert.equal(scraperErrorKey(new Error('404 not found')), 'scraperErrNotFound')
  assert.equal(scraperErrorKey('something odd'), 'scraperErrUnknown')
})

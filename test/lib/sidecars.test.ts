// Stale-sidecar detection is what keeps a deployed bot off a pre-fix binary:
// `bin/` is gitignored, so a `git pull` brings new native/*/src while the old
// executable keeps running. These cases cover the timestamps that decide it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isStale } from '../../src/lib/sidecars.ts'

const dir = join(import.meta.dirname, 'tmp-sidecars')
const bin = join(dir, 'sticker')
const src = join(dir, 'src')

const setup = (binAt?: Date, srcAt?: Date): void => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(src, { recursive: true })
  if (srcAt) {
    writeFileSync(join(src, 'main.rs'), 'fn main() {}')
    utimesSync(join(src, 'main.rs'), srcAt, srcAt)
  }
  if (binAt) {
    writeFileSync(bin, 'binary')
    utimesSync(bin, binAt, binAt)
  }
}

test('a missing binary is stale (the feature is simply absent)', () => {
  setup(undefined, new Date('2026-01-01T00:00:00Z'))
  assert.equal(isStale(bin, src), true)
  rmSync(dir, { recursive: true, force: true })
})

test('a binary older than its source is stale', () => {
  setup(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'))
  assert.equal(isStale(bin, src), true)
  rmSync(dir, { recursive: true, force: true })
})

test('a binary newer than its source is fresh', () => {
  setup(new Date('2026-03-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'))
  assert.equal(isStale(bin, src), false)
  rmSync(dir, { recursive: true, force: true })
})

// installed without native/ (binary-only drop): nothing to compare, keep using it
test('no source tree means the binary is not judged stale', () => {
  setup(new Date('2026-01-01T00:00:00Z'))
  rmSync(src, { recursive: true, force: true })
  assert.equal(isStale(bin, src), false)
  rmSync(dir, { recursive: true, force: true })
})

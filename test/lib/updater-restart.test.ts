// `.update` restarts the bot. Self-spawning under pm2 would leave two bots on
// the same sessions/ dir, and WhatsApp kicks one with 440 connectionReplaced —
// so a supervised process must only exit and let pm2/systemd revive it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const probe = join(import.meta.dirname, 'supervised-probe.mjs')

// spawn a real child so the env-marker logic is exercised end to end, and check
// it prints the mode instead of launching a second bot
const mode = (env: Record<string, string>, drop: string[] = []): Promise<string> =>
  new Promise((resolve, reject) => {
    const merged: Record<string, string> = { ...(process.env as Record<string, string>), ...env }
    // an empty string is still a defined var — the markers have to be removed
    for (const k of drop) delete merged[k]
    const child = spawn(process.execPath, [probe], { cwd: ROOT, env: merged, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', () => resolve(out.trim()))
  })

test('a pm2-managed process is recognised as supervised', async () => {
  assert.equal(await mode({ pm_id: '3' }), 'supervised')
})

test('a systemd unit is recognised as supervised', async () => {
  assert.equal(await mode({ INVOCATION_ID: 'abc123' }), 'supervised')
})

test('a plain terminal start is not supervised', async () => {
  assert.equal(await mode({}, ['pm_id', 'PM2_HOME', 'INVOCATION_ID']), 'self')
})

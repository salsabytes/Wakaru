import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCode, extractResources, extractScripts, probeUrl, runCode } from '../src/lib/agentSandbox.ts'
import { autoChecks, extractChecks } from '../src/commands/main/ai/checks.ts'

test('check-js passes valid code and reports syntax errors', async () => {
  const good = await checkCode('js', 'const x = 1\nconsole.log(x)')
  assert.equal(good.ok, true)
  assert.equal(good.exitCode, 0)

  const bad = await checkCode('js', 'const x =')
  assert.equal(bad.ok, false)
  assert.match(bad.stderr, /error|Error|Unexpected/i)
})

test('check-html checks every inline script and skips external ones', async () => {
  const scripts = extractScripts('<p>x</p><script>let a=1</script><script src="x.js"></script>')
  assert.deepEqual(scripts, ['let a=1'])

  const bad = await checkCode('html', '<html><script>let a =</script></html>')
  assert.equal(bad.ok, false)
})

test('run-js actually executes the snippet', async () => {
  const r = await runCode('console.log(2 + 3)')
  assert.equal(r.ok, true)
  assert.equal(r.stdout.trim(), '5')
})

test('extractChecks strips check blocks and keeps the prose', () => {
  const text = 'aku tes dulu\n```check-js\nconst a = 1\n```\nini jawabannya'
  const { checks, clean } = extractChecks(text)
  assert.equal(checks.length, 1)
  assert.equal(checks[0].kind, 'js')
  assert.equal(checks[0].code, 'const a = 1')
  assert.equal(clean, 'aku tes dulu\nini jawabannya')
})

test('extractChecks understands run-js and check-html', () => {
  const { checks } = extractChecks(
    '```run-js\nconsole.log(1)\n```\n```check-html\n<script>let a=1</script>\n```',
  )
  assert.deepEqual(checks.map((c) => c.kind), ['run', 'html'])
})

test('check-html lists external resources so the model can probe them', async () => {
  const html = '<iframe src="https://mega.nz/embed/abc#key"></iframe><script src="https://cdn.example/x.js"></script>'
  assert.deepEqual(extractResources(html), ['https://mega.nz/embed/abc#key', 'https://cdn.example/x.js'])
  const r = await checkCode('html', html)
  assert.equal(r.ok, true)
  assert.match(r.stdout, /mega\.nz/)
})

test('probeUrl refuses private hosts and bad input', async () => {
  assert.equal((await probeUrl('not a url')).ok, false)
  const p = await probeUrl('http://127.0.0.1:8080/admin')
  assert.equal(p.ok, false)
  assert.match(p.stderr, /private|loopback|refused/i)
})

test('extractChecks understands check-url', () => {
  const { checks } = extractChecks('```check-url\nhttps://example.com\n```')
  assert.equal(checks[0]?.kind, 'url')
  assert.equal(checks[0]?.code, 'https://example.com')
})

test('autoChecks finds js/html fences without stripping them', () => {
  const text = 'ini kodenya:\n```js\nconst a = 1\nconsole.log(a)\n```\n```html\n<div>hello world</div>\n```'
  const checks = autoChecks(text)
  assert.deepEqual(checks.map((c) => c.kind), ['js', 'html'])
  assert.match(checks[0]!.code, /console\.log/)
  assert.match(checks[1]!.code, /hello world/)
})

test('autoChecks skips short fragments and non-code fences', () => {
  assert.deepEqual(autoChecks('```js\nx\n```'), [])
  assert.deepEqual(autoChecks('```py\nprint("hi")\n```'), [])
})

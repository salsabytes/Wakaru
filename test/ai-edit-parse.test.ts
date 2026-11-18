import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentActions } from '../src/lib/agentFiles.ts'

test('parseAgentActions parses @edit SEARCH/REPLACE block', () => {
  const reply = [
    '@edit src/a.ts',
    '```ts',
    '<<<<<<< SEARCH',
    'const a = 1',
    '=======',
    'const a = 2',
    '>>>>>>> REPLACE',
    '```',
  ].join('\n')
  const { actions } = parseAgentActions(reply)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].tool, 'edit')
  if (actions[0].tool === 'edit') {
    assert.equal(actions[0].arg, 'src/a.ts')
    assert.equal(actions[0].search, 'const a = 1')
    assert.equal(actions[0].replace, 'const a = 2')
  }
})

test('parseAgentActions parses @status', () => {
  const { actions } = parseAgentActions('@status\n@ls src')
  assert.deepEqual(actions.map(a => [a.tool, (a as any).arg]), [['status', ''], ['ls', 'src']])
})

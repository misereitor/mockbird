import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const script = join(process.cwd(), 'skills/design/scripts/contract-test.mjs')
test('example captures five states', () => {
  const run = spawnSync(process.execPath, [script, '--target', 'skills/design/assets/example'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})
test('missing focus indicator fails with component and state', () => {
  const run = spawnSync(process.execPath, [script, '--target', 'skills/design/scripts/fixtures/contract-no-focus'], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /no-focus.*focus.*contract/i)
})

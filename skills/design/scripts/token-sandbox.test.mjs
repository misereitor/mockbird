import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = new URL('./token-sandbox.mjs', import.meta.url).pathname
const example = new URL('../assets/example', import.meta.url).pathname
function run(args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 180000 }) }

test('invalid scale exits 2', () => {
  const r = run(['--target', example, '--var', 'invalid', '--scale', '0'])
  assert.equal(r.status, 2)
})

test('--apply without DEC exits non-zero', () => {
  const r = run(['--target', example, '--var', 'missing-dec', '--apply'])
  assert.notEqual(r.status, 0)
})

test('preview contract keeps tokens byte-identical when capture is available', { timeout: 240000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'token-sandbox-test-'))
  cpSync(example, root, { recursive: true })
  const tokenPath = join(root, 'tokens.json')
  const before = readFileSync(tokenPath)
  const r = run(['--target', root, '--var', 'test', '--palette', '#ff8844'])
  if (r.status !== 0) assert.match(`${r.stdout}\n${r.stderr}`, /browser|capture|Target page|closed/i)
  else {
    assert.deepEqual(readFileSync(tokenPath), before)
    const report = JSON.parse(readFileSync(join(root, '.visual', 'sandbox', 'test', 'sandbox-report.json')))
    assert.equal(typeof report.scoreDelta, 'number')
  }
  rmSync(root, { recursive: true, force: true })
})

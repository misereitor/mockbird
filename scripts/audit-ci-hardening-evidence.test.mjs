import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const script = new URL('./audit-ci-hardening-evidence.mjs', import.meta.url)
const fields = 'command: x\nexit code: 0\nartifact path: /tmp/a\nfailure probe: none\n'
function fixture(evidence = fields, path = 'evidence.md', manifestPath = path) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-evidence-'))
  writeFileSync(join(dir, path), evidence)
  const manifest = join(dir, 'manifest.json')
  writeFileSync(manifest, JSON.stringify({ rows: [{ task: 'fixture-row', evidencePath: manifestPath, requiredFields: ['command', 'exit code', 'artifact path', 'failure probe'] }] }))
  return { dir, manifest }
}
function run(manifest) { return spawnSync(process.execPath, [script.pathname, '--manifest', manifest], { encoding: 'utf8' }) }
test('happy fixture approves all rows', () => { const f = fixture(); try { const r = run(f.manifest); assert.equal(r.status, 0); assert.match(r.stdout, /Summary: 1 row\(s\) approved, 0 row\(s\) failed/) } finally { rmSync(f.dir, { recursive: true }) } })
test('deleted evidence names row and path', () => { const f = fixture(); rmSync(join(f.dir, 'evidence.md')); try { const r = run(f.manifest); assert.notEqual(r.status, 0); assert.match(r.stderr, /fixture-row/); assert.match(r.stderr, /evidence\.md/) } finally { rmSync(f.dir, { recursive: true }) } })
test('missing field names row and field', () => { const f = fixture(fields.replace('failure probe: none\n', '')); try { const r = run(f.manifest); assert.notEqual(r.status, 0); assert.match(r.stderr, /fixture-row/); assert.match(r.stderr, /missing field \(failure probe\)/) } finally { rmSync(f.dir, { recursive: true }) } })
test('mismatched path names requested path', () => { const f = fixture(fields, 'actual.md', 'evidence.md'); try { const r = run(f.manifest); assert.notEqual(r.status, 0); assert.match(r.stderr, /evidence\.md/) } finally { rmSync(f.dir, { recursive: true }) } })

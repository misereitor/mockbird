import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const repo = process.cwd()
const check = (dir, tag) => spawnSync(process.execPath, [join(repo, 'scripts/version-check.mjs'), dir, tag], { encoding: 'utf8' })
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), 'mockbird-version-')); cpSync(repo, dir, { recursive: true, filter: p => !p.includes('node_modules') && !p.includes('.git') }); return dir }

test('version boundaries pass with the expected release tag', () => assert.equal(check(repo, 'v1.2.0').status, 0))
for (const [name, mutate] of [
  ['root lock', p => { const f = join(p, 'package-lock.json'); const j = JSON.parse(readFileSync(f)); j.version = '0.0.0'; j.packages[''].version = '0.0.0'; writeFileSync(f, JSON.stringify(j)) }],
  ['viewer footer', p => { const f = join(p, 'skills/design/assets/viewer.html'); writeFileSync(f, readFileSync(f, 'utf8').replace('id="versionTag">v1.2.0', 'id="versionTag">v0.0.0')) }],
  ['plugin metadata', p => { const f = join(p, 'plugin/package-lock.json'); const j = JSON.parse(readFileSync(f)); j.version = '0.0.0'; j.packages[''].version = '0.0.0'; writeFileSync(f, JSON.stringify(j)) }],
  ['release tag', p => { /* supplied by the caller */ }],
]) test(`${name} mutation fails`, () => { const dir = fixture(); mutate(dir); const result = check(dir, name === 'release tag' ? 'v0.0.0' : 'v1.2.0'); assert.notEqual(result.status, 0); assert.match(result.stderr, /VERSION CHECK FAILED/) })

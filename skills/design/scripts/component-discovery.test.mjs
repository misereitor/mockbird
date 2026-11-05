import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
const script = join(process.cwd(), 'skills/design/scripts/component-discovery.mjs')
const fixture = join(process.cwd(), 'skills/design/scripts/fixtures/discovery-button.html')
function run(markup, catalog) {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-'))
  const m = join(dir, 'markup.html'), c = join(dir, 'catalog.json'), l = join(dir, 'log.json')
  writeFileSync(m, markup); writeFileSync(c, JSON.stringify(catalog))
  const result = spawnSync(process.execPath, [script, '--markup', m, '--catalog', c, '--log', l], { encoding: 'utf8' })
  const log = JSON.parse(readFileSync(l, 'utf8'))
  rmSync(dir, { recursive: true, force: true })
  return { ...result, log }
}
const catalog = { schemaVersion: 1, components: [{ id: 'button', previews: [{ variant: { size: 'md', tone: 'primary' }, html: readFileSync(fixture, 'utf8') }] }] }
test('recommends reuse for matching button', () => { const r = run(readFileSync(fixture, 'utf8'), catalog); assert.equal(r.status, 0); assert.match(r.stdout, /reuse.*button/); assert.equal(r.log.schemaVersion, 1) })
test('recommends variant for same structure with different marker args', () => { const r = run(readFileSync(fixture, 'utf8').replace('data-tone="primary"', 'data-tone="ghost"'), catalog); assert.equal(r.status, 0); assert.match(r.stdout, /variant.*button/) })
test('recommends create for distinct markup', () => { const r = run('<article class="unrelated"><h1>New</h1></article>', catalog); assert.equal(r.status, 0); assert.match(r.stdout, /create/) })
test('fails safely without catalog', () => { const dir = mkdtempSync(join(tmpdir(), 'discovery-missing-')); const r = spawnSync(process.execPath, [script, '--markup', fixture, '--catalog', join(dir, 'missing.json'), '--log', join(dir, 'log.json')], { encoding: 'utf8' }); assert.notEqual(r.status, 0); assert.match(r.stderr, /catalog dependency missing/); rmSync(dir, { recursive: true, force: true }) })

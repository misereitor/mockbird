import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = join(process.cwd(), 'scripts', 'visual-report-schema.mjs')
const sections = ['capture', 'diff', 'critic', 'score', 'a11y', 'i18n-stress', 'perf']
const report = { schemaVersion: 1, screens: [{ screen: 'login.html', ...Object.fromEntries(sections.map((key) => [key, {}])) }] }
function run(value) {
  const dir = mkdtempSync(join(tmpdir(), 'visual-report-schema-'))
  const file = join(dir, 'report.json')
  writeFileSync(file, JSON.stringify(value))
  return spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
}

test('accepts a report containing every orchestrator section', () => assert.equal(run(report).status, 0))
test('rejects a report missing an orchestrator section', () => {
  const mutation = structuredClone(report)
  delete mutation.screens[0]['i18n-stress']
  const result = run(mutation)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /i18n-stress/)
})

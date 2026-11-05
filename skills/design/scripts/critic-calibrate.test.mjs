import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

test('critic-calibrate calcula recall das linhas e aplica threshold', () => {
  execFileSync(process.execPath, ['skills/design/scripts/critic-calibrate.mjs'], { encoding: 'utf8' })
  const report = JSON.parse(readFileSync('design/.visual/critic-calibration.json', 'utf8'))
  assert.equal(report.total, 12)
  assert.ok(report.covered >= 12)
  for (const recall of Object.values(report.recall)) assert.ok(recall >= 0.8)
  assert.equal(report.rows.filter((row) => row.detected).length, report.covered)
})

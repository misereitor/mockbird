import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const target = join(process.cwd(), 'skills/design/assets/i18n-rigid')
test('diagnostics records element overflow and file-backed budget', () => {
  execFileSync(process.execPath, ['skills/design/scripts/diagnostics.mjs', '--target', target])
  const i18n = JSON.parse(readFileSync(join(target, '.visual/i18n-stress/rigid.json')))
  const perf = JSON.parse(readFileSync(join(target, '.visual/perf/rigid.json')))
  assert.ok(i18n.overflow.some((item) => item.selector === '.rigid-button' && item.deltaPx > 0))
  assert.equal(perf.limits.defaulted, false)
  assert.equal(perf.limits.domNodes, 1500)
  assert.deepEqual(Object.keys(perf.metrics).sort(), ['assetsBytes', 'domNodes', 'overflow', 'renderMs'])
  rmSync(join(target, '.visual'), { recursive: true, force: true })
})

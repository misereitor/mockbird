import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SCRIPT_CLASSIFICATION } from './ci-script-classification.mjs'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
test('every npm script has an explicit lane classification', () => {
  assert.deepEqual(Object.keys(SCRIPT_CLASSIFICATION).sort(), Object.keys(pkg.scripts).sort())
  assert.equal(pkg.scripts.ci.includes('smoke:screen') && pkg.scripts.ci.includes('test:ui'), true)
  assert.equal(pkg.scripts['ci:base'].includes('smoke:screen') || pkg.scripts['ci:base'].includes('test:ui'), false)
})

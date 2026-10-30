/**
 * Unit tests for the setup-design.mjs path/case helpers (plan todo 24 (e)).
 *
 * Windows-safety contract under test: separator normalization, rejection of
 * escaping paths and case-insensitive collision detection (the warn list).
 *
 * Run: node --test skills/design/scripts/setup-design.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectCaseCollisions, normalizeRel } from './setup-design.mjs'

test('normalizeRel maps backslashes to slashes (PowerShell input)', () => {
  assert.equal(normalizeRel('scripts\\lib\\token-groups.mjs'), 'scripts/lib/token-groups.mjs')
  assert.equal(normalizeRel('scripts\\lib/token-groups.mjs'), 'scripts/lib/token-groups.mjs')
})

test('normalizeRel strips ./ prefixes, duplicate and trailing slashes', () => {
  assert.equal(normalizeRel('./scripts//gen-tokens.mjs'), 'scripts/gen-tokens.mjs')
  assert.equal(normalizeRel('vendor/'), 'vendor')
  assert.equal(normalizeRel('/docs.html'), 'docs.html')
})

test('normalizeRel keeps plain relative paths untouched', () => {
  assert.equal(normalizeRel('validate.mjs'), 'validate.mjs')
  assert.equal(normalizeRel('components/partial.html'), 'components/partial.html')
})

test('normalizeRel rejects escaping, absolute, drive and UNC paths', () => {
  for (const bad of ['..', '../evil', 'a/../b', '.', 'a/./b', '', 'C:/proj/design', 'c:\\proj\\design', '//server/share/x', 'a//..']) {
    assert.throws(() => normalizeRel(bad), undefined, `should reject ${JSON.stringify(bad)}`)
  }
  assert.throws(() => normalizeRel(42), /non-empty string/)
})

test('detectCaseCollisions lists case-only collisions (the warn list)', () => {
  const groups = detectCaseCollisions(['validate.mjs', 'Validate.mjs', 'scripts/Sync.mjs', 'scripts/sync.mjs'])
  assert.deepEqual(groups, [['Validate.mjs', 'validate.mjs'], ['scripts/Sync.mjs', 'scripts/sync.mjs']])
})

test('detectCaseCollisions ignores exact duplicates and distinct names', () => {
  assert.deepEqual(detectCaseCollisions(['a.mjs', 'a.mjs', 'A.mjs', 'b.mjs', 'c.css']), [['A.mjs', 'a.mjs']])
  assert.deepEqual(detectCaseCollisions(['mock.css', 'mock.js', 'mock.css.new']), [])
  assert.deepEqual(detectCaseCollisions([]), [])
})

test('detectCaseCollisions is stable across separator styles', () => {
  const groups = detectCaseCollisions(['scripts\\lib\\x.mjs', 'scripts/lib/X.mjs'])
  assert.deepEqual(groups, [['scripts/lib/X.mjs', 'scripts/lib/x.mjs']])
})

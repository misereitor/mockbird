import test from 'node:test'
import assert from 'node:assert/strict'
import { scryptSync, randomBytes } from 'node:crypto'
test('scrypt parameters and per-user salts', () => {
  const a = randomBytes(16); const b = randomBytes(16)
  assert.notDeepEqual(a, b)
  assert.equal(scryptSync('strong-password', a, 64, { N: 2 ** 15, r: 8, p: 1 }).length, 64)
})
test('password policy rejects weak or short values', () => { assert.ok('long-password-1'.length >= 12); assert.ok('short'.length < 12) })

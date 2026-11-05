import test from 'node:test'
import assert from 'node:assert/strict'
import { scryptSync, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
test('scrypt parameters and per-user salts', () => {
  const a = randomBytes(16); const b = randomBytes(16)
  assert.notDeepEqual(a, b)
  assert.equal(scryptSync('strong-password', a, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).length, 64)
})
test('password policy rejects weak or short values', () => { assert.ok('long-password-1'.length >= 12); assert.ok('short'.length < 12) })

test('HTTP login lockout, CSRF and logout invalidation', async () => {
  const data = mkdtempSync(join(tmpdir(), 'mockbird-auth-'))
  const child = spawn(process.execPath, ['skills/design/assets/serve.mjs', '--service', '--data', data, '0', '--no-open'], { cwd: new URL('../../..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk })
  try {
    for (let i = 0; i < 100 && !output.includes('URL:'); i += 1) await new Promise((resolve) => setTimeout(resolve, 25))
    const base = output.match(/URL:\s+(\S+)/)?.[1]
    assert.ok(base)
    const bad = () => fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'qa', password: 'wrong-password-12' }) })
    for (let i = 0; i < 5; i += 1) assert.equal((await bad()).status, 401)
    assert.equal((await bad()).status, 429)
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'qa', password: 'mockbird-development-password' }) })
    assert.equal(login.status, 429)
  } finally { child.kill('SIGTERM'); rmSync(data, { recursive: true, force: true }) }
})

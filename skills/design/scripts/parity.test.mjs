import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve('.')
const example = resolve('skills/design/assets/example')
const parity = resolve('skills/design/scripts/parity.mjs')

function serverFor({ altered = false } = {}) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const path = req.url === '/' ? '/login/01-login.html' : req.url
      if (altered && path === '/login/01-login.html') {
        res.setHeader('content-type', 'text/html')
        res.end('<!doctype html><html><body style="font-size:31px;border-radius:19px">fixture</body></html>')
        return
      }
      try {
        res.end(readFileSync(join(example, path)))
      } catch {
        res.statusCode = 404
        res.end('not found')
      }
    }).listen(0, '127.0.0.1', () => done(server))
  })
}

function run(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [parity, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}

function cleanup() {
  rmSync(resolve('design/.visual/parity'), { recursive: true, force: true })
}

test('happy path emits five viewports and computed-style rows', async () => {
  const server = await serverFor()
  try {
    const result = await run(['--prototype', join(example, 'login'), '--app', `http://127.0.0.1:${server.address().port}`])
    assert.equal(result.code, 0, result.stderr)
    const report = JSON.parse(readFileSync(resolve('design/.visual/parity/01-login.json'), 'utf8'))
    assert.equal(report.viewports.length, 5)
    assert.ok(report.rows.length >= 25)
    assert.ok(report.rows.every((row) => 'property' in row && 'prototypePx' in row && 'appPx' in row && 'delta' in row && 'severity' in row))
  } finally { server.close(); cleanup() }
})

test('gate returns nonzero and reports numeric font-size delta', async () => {
  const server = await serverFor({ altered: true })
  try {
    const result = await run(['--prototype', join(example, 'login'), '--app', `http://127.0.0.1:${server.address().port}`, '--gate'])
    assert.notEqual(result.code, 0)
    const report = JSON.parse(readFileSync(resolve('design/.visual/parity/01-login.json'), 'utf8'))
    const row = report.rows.find((item) => item.property === 'font-size' && item.viewport === '1440x900')
    assert.equal(row.delta, 31 - parseFloat(row.prototypePx))
    assert.equal(typeof row.delta, 'number')
  } finally { server.close(); cleanup() }
})

test('rejects a screen without approval', async () => {
  const result = await run(['--prototype', join(example, 'dashboard'), '--app', 'http://127.0.0.1:1'])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /tela não aprovada: dashboard\/01-overview\.html/)
})

test('dead app URL fails with a guided error and no stack', async () => {
  const result = await run(['--prototype', join(example, 'login'), '--app', 'http://127.0.0.1:1'])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /tela não aprovada: login\/02-cadastro\.html|falha ao capturar/)
  assert.doesNotMatch(result.stderr, /at file:/)
  cleanup()
})

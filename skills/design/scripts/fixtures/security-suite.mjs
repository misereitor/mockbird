#!/usr/bin/env node
/**
 * security-suite.mjs — permanent security fixture (w4-21), run in QA gate F4.
 * Node 18+ (global fetch), ZERO dependencies, plain `node` (never a .sh).
 *
 * Reproduces the pinned security asserts of todos 17/20 as a permanent
 * regression suite. Every assert checks the HTTP code AND the `{error: code}`
 * body name. The suite exits non-zero on ANY failure.
 *
 * INVOCATION (pinned):
 *   auto (default): node skills/design/scripts/fixtures/security-suite.mjs
 *     1. mounts a QA root <tmp>/design/ = assets/example/* + the copy-list
 *        files (viewer.html serve.mjs mock.js mock.css docs.html vendor/
 *        components/ scripts/{gen-tokens,sync-components,marker-parser}.mjs
 *        validate.mjs);
 *     2. picks a FREE port via node:net;
 *     3. spawns `node design/serve.mjs <porta>` with **cwd = <tmp> — the
 *        PARENT of design/** (serve resolves ./design from cwd; NEVER
 *        cwd = design/ itself, which would serve <tmp>/design/design);
 *     4. parses `URL: <base> TOKEN: <token>` from stdout.
 *     --share assert MODE: SECOND SPAWN (pinned choice) — `node
 *     design/serve.mjs <porta2> --share` on another free port, same cwd.
 *     Its own printed token is sent and must STILL be refused (403) on
 *     /api/*. The printed share base uses 0.0.0.0; requests go to
 *     127.0.0.1:<porta2> instead.
 *   external: --url <base> [--token <tok>] — no mount/spawn; targets an
 *     EXTERNAL server (the "no-token server" regression scenario). The token
 *     gate runs FIRST: GET /api/comments WITHOUT the X-Design-Token header
 *     must answer 403 {error:"forbidden"}; anything else = the server does
 *     not require the token -> FAIL pointing MISSING TOKEN (security
 *     regression), exit 1. If it answers 403 but no --token was given ->
 *     FAIL pointing MISSING TOKEN (supply --token), exit 1. With --token the
 *     battery runs minus the --share assert (SKIP — the external server
 *     cannot be respawned with --share).
 *
 * Asserts (auto mode order; expected code + {error: code} body name):
 *   1 evil Origin https://evil.example on POST /api/comments -> 403 forbidden
 *   2 label=../../evil -> 403 traversal
 *   3 label=Foo Bar    -> 400 invalid
 *   4 body 300KB       -> 413 too-large
 *   5 request WITHOUT token -> 403 forbidden
 *   6 --share mode: /api/* -> 403 forbidden even WITH token (GET + POST)
 *   7 static route /viewer.html with a weird Host header -> 200 (static
 *     routes are NEVER intercepted; raw node:http because fetch/undici
 *     forbids a custom Host header)
 *
 * Output ends with `SECURITY-SUITE: PASS (N/N)` or `SECURITY-SUITE: FAIL
 * (k/N)`. Exit codes: 0 all asserts pass | 1 any failure | 2 bad usage.
 * Cleanup receipts: spawned servers are killed and the temp root is removed
 * on every run (auto mode is idempotent — each run starts clean).
 * Output is ASCII-only on purpose (console codepage safety).
 */
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const USAGE = 'uso: node skills/design/scripts/fixtures/security-suite.mjs [--url <base> --token <tok>]'
const SUITE = 'security-suite.mjs'

// ---------- args (unknown flags / missing values -> exit 2) ----------

const argv = process.argv.slice(2)
let externalUrl = null
let externalToken = null
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--url' || arg === '--token') {
    const value = argv[i + 1]
    if (value === undefined || value === '' || value.startsWith('--')) {
      console.error(`${USAGE}\n${SUITE}: valor ausente para ${arg}`)
      process.exit(2)
    }
    if (arg === '--url') externalUrl = value
    else externalToken = value
    i += 1
  } else {
    console.error(`${USAGE}\n${SUITE}: argumento desconhecido: ${arg}`)
    process.exit(2)
  }
}
if (externalToken !== null && externalUrl === null) {
  console.error(`${USAGE}\n${SUITE}: --token so faz sentido com --url`)
  process.exit(2)
}
if (externalUrl !== null) {
  try {
    externalUrl = new URL(externalUrl).href.replace(/\/+$/, '')
  } catch {
    console.error(`${USAGE}\n${SUITE}: --url nao e uma URL valida`)
    process.exit(2)
  }
}

// ---------- layout ----------

const pack = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const ASSETS = join(pack, 'skills', 'design', 'assets')
const SCRIPTS = join(pack, 'skills', 'design', 'scripts')
const TMP = join(tmpdir(), 'opencode', 'w4-21', 'security-suite-tmp')
const DESIGN = join(TMP, 'design')

// ---------- assert engine ----------

const results = []

function record(n, name, ok, detail) {
  results.push({ n, name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} #${n} ${name}: ${detail}`)
  return ok
}

function recordFail(n, name, detail) {
  return record(n, name, false, detail)
}

function safeError(text) {
  try {
    const body = JSON.parse(text)
    return body && typeof body.error === 'string' ? body.error : '(sem campo error)'
  } catch {
    return '(nao-JSON)'
  }
}

function summary() {
  const executed = results.length
  const passed = results.filter((r) => r.ok).length
  const ok = passed === executed && executed > 0
  console.log(`SECURITY-SUITE: ${ok ? 'PASS' : 'FAIL'} (${passed}/${executed})`)
  return ok
}

async function expectJson(n, name, response, wantCode, wantError) {
  const text = await response.text()
  const gotError = safeError(text)
  const shown = text.length > 64 ? `${text.slice(0, 64)}...` : text
  return record(
    n,
    name,
    response.status === wantCode && gotError === wantError,
    `got ${response.status} ${shown} | want ${wantCode} {"error":"${wantError}"}`,
  )
}

function api(base, path, { method = 'GET', token, origin, body } = {}) {
  const headers = {}
  if (token !== undefined && token !== null) headers['x-design-token'] = token
  if (origin !== undefined) headers.origin = origin
  const init = { method, headers }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return fetch(base + path, init)
}

/** Raw node:http GET — fetch/undici forbids a custom Host header. */
function rawGet(hostHeader, port, path) {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: hostHeader } }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => done({ status: res.statusCode, body: data }))
    })
    req.on('error', fail)
    req.end()
  })
}

// ---------- spawn helpers ----------

function mountDesign() {
  rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  mkdirSync(DESIGN, { recursive: true })
  for (const entry of readdirSync(join(ASSETS, 'example'))) {
    cpSync(join(ASSETS, 'example', entry), join(DESIGN, entry), { recursive: true })
  }
  for (const file of ['viewer.html', 'serve.mjs', 'mock.js', 'mock.css', 'docs.html']) {
    cpSync(join(ASSETS, file), join(DESIGN, file))
  }
  cpSync(join(ASSETS, 'vendor'), join(DESIGN, 'vendor'), { recursive: true })
  cpSync(join(ASSETS, 'components'), join(DESIGN, 'components'), { recursive: true })
  mkdirSync(join(DESIGN, 'scripts'), { recursive: true })
  for (const file of ['gen-tokens.mjs', 'sync-components.mjs', 'marker-parser.mjs']) {
    cpSync(join(SCRIPTS, file), join(DESIGN, 'scripts', file))
  }
  cpSync(join(SCRIPTS, 'validate.mjs'), join(DESIGN, 'validate.mjs'))
}

function freePort() {
  return new Promise((done, fail) => {
    const srv = createNetServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => done(port))
    })
    srv.on('error', fail)
  })
}

/** spawn `node design/serve.mjs ...` with cwd = TMP (the PARENT of design/). */
function startServer(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join('design', 'serve.mjs'), ...args], { cwd: TMP })
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        fail(new Error(`server start timeout: ${out}${err}`))
      }
    }, 8000)
    child.stdout.on('data', (data) => {
      out += data
      const match = out.match(/URL: (\S+) TOKEN: (\S+)/)
      if (match && !settled) {
        settled = true
        clearTimeout(timer)
        // share prints 0.0.0.0 — probe loopback instead
        const base = match[1].replace('0.0.0.0', '127.0.0.1')
        done({ child, base, token: match[2], pid: child.pid })
      }
    })
    child.stderr.on('data', (data) => {
      err += data
    })
    child.on('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        fail(error)
      }
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        fail(new Error(`server exited ${code}: ${out}${err}`))
      }
    })
  })
}

async function killServer(entry, label) {
  if (!entry) {
    console.log(`CLEANUP: ${label} serve not started`)
    return
  }
  const child = entry.child
  if (child.exitCode === null && child.signalCode === null) {
    // attach 'exit' BEFORE kill, then wait — Windows rmSync EPERM races with
    // a just-killed child that still holds handles on the temp root
    await new Promise((done) => {
      const timer = setTimeout(done, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        done()
      })
      child.kill()
    })
    console.log(`CLEANUP: killed ${label} serve (pid ${entry.pid})`)
  } else {
    console.log(`CLEANUP: ${label} serve already exited`)
  }
}

function removeTempRoot() {
  try {
    rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    console.log(`CLEANUP: removed temp root ${TMP}`)
    return true
  } catch (error) {
    console.log(`CLEANUP: FAILED to remove temp root ${TMP}: ${error.message}`)
    return false
  }
}

// ---------- battery (asserts 1-5) + helpers for 6 and 7 ----------

async function battery(base, token) {
  await expectJson(
    1,
    'evil-origin',
    await api(base, '/api/comments', {
      method: 'POST',
      token,
      origin: 'https://evil.example',
      body: { canvas: 'login', file: '01-login.html' },
    }),
    403,
    'forbidden',
  )
  await expectJson(
    2,
    'traversal',
    await api(base, '/api/snapshot', {
      method: 'POST',
      token,
      body: { canvas: 'login', label: '../../evil' },
    }),
    403,
    'traversal',
  )
  await expectJson(
    3,
    'schema',
    await api(base, '/api/snapshot', {
      method: 'POST',
      token,
      body: { canvas: 'login', label: 'Foo Bar' },
    }),
    400,
    'invalid',
  )
  await expectJson(
    4,
    'too-large',
    await api(base, '/api/comments', {
      method: 'POST',
      token,
      body: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }),
    }),
    413,
    'too-large',
  )
  await expectJson(
    5,
    'no-token',
    await api(base, '/api/comments', {
      method: 'POST',
      body: { canvas: 'login', file: '01-login.html' },
    }),
    403,
    'forbidden',
  )
}

/** assert 7: static route with a weird Host header must NOT be intercepted. */
async function staticWeirdHost(port) {
  try {
    const staticRes = await rawGet('evil.example', port, '/viewer.html')
    record(
      7,
      'static-weird-host',
      staticRes.status === 200 && staticRes.body.length > 0,
      `got ${staticRes.status} (${staticRes.body.length} bytes, Host: evil.example) | want 200 (static NOT intercepted)`,
    )
  } catch (error) {
    recordFail(7, 'static-weird-host', `request failed: ${error.message}`)
  }
}

/** assert 6: --share refuses /api/* even WITH the token (GET + POST). */
async function shareApi403(shareBase, shareToken) {
  const shareGet = await api(shareBase, '/api/comments', { token: shareToken })
  const sharePost = await api(shareBase, '/api/comments', {
    method: 'POST',
    token: shareToken,
    body: { canvas: 'login', file: '01-login.html' },
  })
  const getText = await shareGet.text()
  const postText = await sharePost.text()
  record(
    6,
    'share-api-403',
    shareGet.status === 403 &&
      sharePost.status === 403 &&
      safeError(getText) === 'forbidden' &&
      safeError(postText) === 'forbidden',
    `got GET ${shareGet.status} ${getText} + POST ${sharePost.status} ${postText} (com token) | want 403 {"error":"forbidden"} nos dois`,
  )
}

/** assert 8: /api/agent-send obeys the same guard - tokenless and --share are
 *  403 and an empty body is 400, so no probe ever reaches the agent itself. */
async function agentSendGuard(base, token, shareBase, shareToken) {
  const noToken = await api(base, '/api/agent-send', {
    method: 'POST',
    body: { text: '[Design: design/x] probe' },
  })
  const share = await api(shareBase, '/api/agent-send', {
    method: 'POST',
    token: shareToken,
    body: { text: '[Design: design/x] probe' },
  })
  const empty = await api(base, '/api/agent-send', {
    method: 'POST',
    token,
    body: {},
  })
  const noTokenText = await noToken.text()
  const shareText = await share.text()
  const emptyText = await empty.text()
  record(
    8,
    'agent-send-guard',
    noToken.status === 403 &&
      share.status === 403 &&
      empty.status === 400 &&
      safeError(noTokenText) === 'forbidden' &&
      safeError(shareText) === 'forbidden' &&
      safeError(emptyText) === 'invalid',
    `got sem-token ${noToken.status} ${safeError(noTokenText)} + share ${share.status} ${safeError(shareText)} + vazio ${empty.status} ${safeError(emptyText)} | want 403/403/400 (nada chega ao agente)`,
  )
}

/** assert 9: /api/history obeys the same guard - tokenless and --share are
 *  403 and a bad restore body is 400, so no probe can read or write history. */
async function historyGuard(base, token, shareBase, shareToken) {
  const noToken = await api(base, '/api/history?file=login/01-login.html')
  const share = await api(shareBase, '/api/history/restore', {
    method: 'POST',
    token: shareToken,
    body: { file: 'login/01-login.html', revision: '1-0' },
  })
  const bad = await api(base, '/api/history/restore', {
    method: 'POST',
    token,
    body: {},
  })
  const noTokenText = await noToken.text()
  const shareText = await share.text()
  const badText = await bad.text()
  record(
    9,
    'history-guard',
    noToken.status === 403 &&
      share.status === 403 &&
      bad.status === 400 &&
      safeError(noTokenText) === 'forbidden' &&
      safeError(shareText) === 'forbidden' &&
      safeError(badText) === 'invalid',
    `got sem-token ${noToken.status} ${safeError(noTokenText)} + share-restore ${share.status} ${safeError(shareText)} + corpo vazio ${bad.status} ${safeError(badText)} | want 403/403/400`,
  )
}

// ---------- main ----------

async function main() {
  if (externalUrl !== null) {
    console.log(`SECURITY-SUITE: w4-21 permanent fixture (mode: external ${externalUrl})`)
    const extPort = Number(new URL(externalUrl).port) || 80
    // Token gate FIRST: a server that answers anything other than 403 to a
    // tokenless /api call is the "no-token server" security regression —
    // abort pointing MISSING TOKEN before any deeper probe.
    let gate
    try {
      gate = await api(externalUrl, '/api/comments')
    } catch (error) {
      recordFail(5, 'no-token', `token-gate request failed: ${error.message}`)
      summary()
      process.exitCode = 1
      return
    }
    const gateText = await gate.text()
    const gateShown = gateText.length > 64 ? `${gateText.slice(0, 64)}...` : gateText
    if (gate.status !== 403) {
      recordFail(
        5,
        'no-token',
        `MISSING TOKEN: GET /api/comments sem X-Design-Token respondeu ${gate.status} ${gateShown} | want 403 {"error":"forbidden"} — o servidor NAO exige X-Design-Token (regressao de seguranca)`,
      )
      summary()
      process.exitCode = 1
      return
    }
    console.log(`TOKEN-GATE: GET /api/comments sem token -> 403 (servidor exige X-Design-Token)`)
    if (externalToken === null) {
      recordFail(
        0,
        'token-gate',
        'MISSING TOKEN: o servidor exige X-Design-Token mas nenhum --token foi informado — use --url <base> --token <tok>',
      )
      summary()
      process.exitCode = 1
      return
    }
    await battery(externalUrl, externalToken)
    console.log('SKIP #6 share: modo externo — o assert roda so no auto-spawn (segundo spawn --share)')
    await staticWeirdHost(extPort)
    process.exitCode = summary() ? 0 : 1
    return
  }

  console.log('SECURITY-SUITE: w4-21 permanent fixture (mode: auto-spawn)')
  let mainServer = null
  let shareServer = null
  try {
    mountDesign()
    console.log(`MOUNT: ${DESIGN} (example + copy-list files)`)
    const port1 = await freePort()
    mainServer = await startServer([String(port1)])
    console.log(`SPAWN 1: node design/serve.mjs ${port1} (cwd=${TMP}) pid ${mainServer.pid}`)
    console.log(`STARTUP 1: URL: ${mainServer.base} TOKEN: ${mainServer.token}`)
    const port2 = await freePort()
    shareServer = await startServer([String(port2), '--share'])
    console.log(`SPAWN 2: node design/serve.mjs ${port2} --share (cwd=${TMP}) pid ${shareServer.pid}`)
    console.log(`STARTUP 2: URL: ${shareServer.base} TOKEN: ${shareServer.token}`)

    await battery(mainServer.base, mainServer.token)
    await shareApi403(shareServer.base, shareServer.token)
    await agentSendGuard(mainServer.base, mainServer.token, shareServer.base, shareServer.token)
    await historyGuard(mainServer.base, mainServer.token, shareServer.base, shareServer.token)
    await staticWeirdHost(port1)
  } catch (error) {
    recordFail(0, 'harness', `infra error: ${error.message}`)
  } finally {
    await killServer(mainServer, 'main')
    await killServer(shareServer, 'share')
    if (!removeTempRoot()) recordFail(0, 'cleanup', 'temp root nao removido (EPERM?) — estado sujo')
  }
  process.exitCode = summary() ? 0 : 1
}

await main()

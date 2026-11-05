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
 *   10 xss-comment-sanitized: XSS payloads in comment text (<script>,
 *     <img onerror>, javascript: href) are SANITIZED on write (POST still
 *     answers 200) — the served comment (GET /api/comments) and the served
 *     viewer never carry them as an executable tag
 *   11 traversal-hardening: route params — encoded traversal, null bytes and
 *     broken percent-encoding never disclose files (403/400), on static AND
 *     /api routes
 *   12 csp-headers: /viewer.html and /docs.html carry an ENFORCED
 *     Content-Security-Policy (never report-only) with no 'unsafe-inline' —
 *     script-src 'self' + sha256 hashes, style-src 'self' 'unsafe-hashes' +
 *     sha256 hashes — plus X-Content-Type-Options and Referrer-Policy
 *   13 method-route-guard: wrong verb on a known /api route -> 405
 *     method-not-allowed (+Allow); .history/.backups are never served
 *     statically (404) while regular static files keep answering 200
 *   14 declared-payloads: write bodies with undeclared top-level keys, extra
 *     reply keys or non-numeric rect fields -> 400 invalid; a fully declared
 *     body still writes (200)
 *   15 iframe-sandbox: every <iframe> of every served HTML page carries
 *     sandbox flags — a bare fixture iframe gets the server-injected default
 *     and the viewer's own frames keep theirs
 *   16 config-schema-version: revert against a validate.config.json with an
 *     unknown schemaVersion -> 400 config-schema and design/.backups/ gains
 *     NOTHING (the root is untouched before the pipeline)
 *   17 backup-retention: revert writes design/.backups/<ts>/ BEFORE
 *     restore/sync (the backup holds the pre-revert file with its marker
 *     while the live one is restored), retention keeps exactly 5 entries
 *     across 7 reverts and a post-prune recheck confirms the survivors are
 *     complete
 *   18 localhost-default: the printed URL binds 127.0.0.1 and the LAN address
 *     refuses the port (no exposure beyond localhost without --share)
 *   19 rate-limit: a burst past 300 calls/minute answers 429
 *     {"error":"rate-limited"} (run LAST — it consumes the window budget)
 *
 * Output ends with `SECURITY-SUITE: PASS (N/N)` or `SECURITY-SUITE: FAIL
 * (k/N)`. Exit codes: 0 all asserts pass | 1 any failure | 2 bad usage.
 * Cleanup receipts: spawned servers are killed and the temp root is removed
 * on every run (auto mode is idempotent — each run starts clean).
 * Output is ASCII-only on purpose (console codepage safety).
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createConnection, createServer as createNetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { networkInterfaces, tmpdir } from 'node:os'
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

/** Probe fixture for assert 15: one bare <iframe> (the server must sandbox
 * it) and one that declares its own sandbox (must stay byte-untouched). Lives
 * under snapshots/ so the validate walker never sees it. */
const PROBE_HTML =
  '<!doctype html><title>probe</title>' +
  '<iframe id="bare" src="01-login.html"></iframe>' +
  '<iframe id="declared" sandbox="allow-scripts" src="02-cadastro.html"></iframe>'

function mountDesign() {
  rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  mkdirSync(DESIGN, { recursive: true })
  for (const entry of readdirSync(join(ASSETS, 'example'))) {
    cpSync(join(ASSETS, 'example', entry), join(DESIGN, entry), { recursive: true })
  }
  for (const file of ['viewer.html', 'serve.mjs', 'mock.js', 'mock.css', 'docs.html', 'validate.config.json']) {
    cpSync(join(ASSETS, file), join(DESIGN, file))
  }
  cpSync(join(ASSETS, 'vendor'), join(DESIGN, 'vendor'), { recursive: true })
  cpSync(join(ASSETS, 'components'), join(DESIGN, 'components'), { recursive: true })
  // full scripts tree (minus fixtures/): the revert pipeline runs
  // gen-tokens -> sync-components -> validate and pulls lib/ + codegen.mjs
  mkdirSync(join(DESIGN, 'scripts'), { recursive: true })
  for (const entry of readdirSync(SCRIPTS)) {
    if (entry === 'fixtures') continue
    cpSync(join(SCRIPTS, entry), join(DESIGN, 'scripts', entry), { recursive: true })
  }
  cpSync(join(SCRIPTS, 'validate.mjs'), join(DESIGN, 'validate.mjs'))
  // toolchainScripts of the mounted config resolve relative to design/ -> TMP/scripts/
  mkdirSync(join(TMP, 'scripts'), { recursive: true })
  for (const file of ['validate.mjs', 'sync-components.mjs', 'marker-parser.mjs', 'gen-tokens.mjs', 'export-tokens.mjs']) {
    cpSync(join(SCRIPTS, file), join(TMP, 'scripts', file))
  }
  mkdirSync(join(DESIGN, 'snapshots'), { recursive: true })
  writeFileSync(join(DESIGN, 'snapshots', 'security-probe.html'), PROBE_HTML)
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

/** assert 10: comment text XSS payloads are sanitized on write — the served
 *  comment (GET /api/comments) and the served viewer never carry them as an
 *  executable tag. The write itself is accepted (200): sanitization is not
 *  rejection. With sanitization removed this assert FAILS (mutation proof). */
async function xssCommentSanitized(base, token) {
  const payloads = [
    '<script>alert(1)</script>xsscanary',
    '<img src=x onerror=alert(2)>xsscanary2',
    '<a href="javascript:alert(3)">xsscanary3</a>',
  ]
  const created = await api(base, '/api/comments', {
    method: 'POST',
    token,
    body: {
      canvas: 'login',
      file: '01-login.html',
      replies: [{ text: payloads[0], createdAt: '2026-01-01T00:00:00.000Z' }],
    },
  })
  const createdText = await created.text()
  let pinId = ''
  try {
    const pin = (JSON.parse(createdText).comments ?? []).at(-1)
    if (typeof pin?.id === 'string') pinId = pin.id
  } catch { /* pinId stays empty -> the assert fails below */ }
  let updatedStatus = '(sem update)'
  if (pinId) {
    const updated = await api(base, '/api/comments', {
      method: 'POST',
      token,
      body: {
        id: pinId,
        replies: [
          { text: payloads[1], createdAt: '2026-01-01T00:00:00.000Z' },
          { text: payloads[2], createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    })
    await updated.text()
    updatedStatus = String(updated.status)
  }
  const get = await api(base, '/api/comments', { token })
  const getText = await get.text()
  const viewer = await fetch(base + '/viewer.html')
  const viewerText = await viewer.text()
  // no tag shape at all may survive in the served comment; the viewer must not
  // echo the payloads either (served HTML never contains them as executable)
  const executable = /<script|<img|<svg|<iframe|<a\s|onerror|javascript:/i
  const cleanComment = !executable.test(getText)
  const cleanViewer = !payloads.some((p) => viewerText.includes(p)) && !viewerText.includes('xsscanary')
  const canaryKept = ['xsscanary', 'xsscanary2', 'xsscanary3'].every((c) => getText.includes(c))
  record(
    10,
    'xss-comment-sanitized',
    created.status === 200 && pinId !== '' && updatedStatus === '200' && get.status === 200 && cleanComment && cleanViewer && canaryKept,
    `got POST ${created.status} + update ${updatedStatus} + GET ${get.status}, tag-no-comment=${cleanComment} tag-no-viewer=${cleanViewer} canary=${canaryKept} | want 200/200/200 e payload nunca como tag executavel`,
  )
}

/** assert 11: route params — encoded traversal, null bytes and broken
 *  percent-encoding never disclose files (403/400), on static AND /api. */
async function traversalHardening(port, base, token) {
  const probes = []
  try {
    const encoded = await rawGet('127.0.0.1', port, '/..%2f..%2f..%2fetc/passwd')
    probes.push({ name: 'encoded-traversal', ok: encoded.status === 403 && !encoded.body.includes('root:'), got: String(encoded.status) })
    const nullByte = await rawGet('127.0.0.1', port, '/%00secret')
    probes.push({ name: 'null-byte-static', ok: nullByte.status === 400 && !nullByte.body.includes('root:'), got: String(nullByte.status) })
    const broken = await rawGet('127.0.0.1', port, '/%zz')
    probes.push({ name: 'broken-percent', ok: broken.status === 400, got: String(broken.status) })
    const apiNull = await api(base, '/api/comments', {
      method: 'POST',
      token,
      body: { canvas: 'login', file: '01-login.html\u0000', replies: [] },
    })
    const apiNullText = await apiNull.text()
    probes.push({
      name: 'null-byte-api',
      ok: apiNull.status === 400 && safeError(apiNullText) === 'invalid',
      got: `${apiNull.status} ${safeError(apiNullText)}`,
    })
    const history = await api(base, '/api/history?file=../../../etc/passwd', { token })
    const historyText = await history.text()
    probes.push({
      name: 'history-traversal',
      ok: history.status === 400 && safeError(historyText) === 'invalid',
      got: `${history.status} ${safeError(historyText)}`,
    })
  } catch (error) {
    return recordFail(11, 'traversal-hardening', `probe failed: ${error.message}`)
  }
  const bad = probes.filter((p) => !p.ok)
  record(
    11,
    'traversal-hardening',
    bad.length === 0,
    `${probes.map((p) => `${p.name} ${p.got}${p.ok ? '' : ' (!)'}`).join(' + ')} | want 403/400/400/400/400 sem vazamento de arquivo`,
  )
}

/** assert 12: viewer/docs carry the hardening headers — ENFORCED CSP (never
 *  report-only) with no 'unsafe-inline': script-src 'self' + sha256 hashes for
 *  the inline runtime, style-src 'self' 'unsafe-hashes' + sha256 hashes for
 *  inline styles/attrs, nosniff, no-referrer. */
async function cspHeaders(base) {
  const checks = []
  for (const path of ['/viewer.html', '/docs.html']) {
    const res = await fetch(base + path)
    const csp = res.headers.get('content-security-policy') ?? ''
    const reportOnly = res.headers.get('content-security-policy-report-only')
    const nosniff = res.headers.get('x-content-type-options') ?? ''
    const referrer = res.headers.get('referrer-policy') ?? ''
    checks.push({
      name: path,
      ok:
        res.status === 200 &&
        reportOnly === null &&
        csp.includes("script-src 'self'") &&
        csp.includes("'sha256-") &&
        !csp.includes('unsafe-inline') &&
        csp.includes("style-src 'self' 'unsafe-hashes'") &&
        csp.includes("img-src 'self' data:") &&
        csp.includes("frame-src 'self'") &&
        csp.includes("object-src 'none'") &&
        csp.includes("base-uri 'none'") &&
        nosniff === 'nosniff' &&
        referrer === 'no-referrer',
      got: `${res.status} csp=${JSON.stringify(csp.slice(0, 120))} report-only=${reportOnly !== null} nosniff=${nosniff} referrer=${referrer}`,
    })
  }
  const bad = checks.filter((c) => !c.ok)
  record(
    12,
    'csp-headers',
    bad.length === 0,
    `${checks.map((c) => `${c.name} ${c.ok ? 'ok' : c.got}`).join(' | ')} | want CSP+nosniff+no-referrer em viewer e docs`,
  )
}

// ---------- asserts 13-19 (todo 35: rotas, payloads, iframe, config, backup) ----------

/** Sorted directory names of design/.backups/ (the persistent pre-sync
 *  backups; stray files never count). */
function listBackups() {
  const dir = join(DESIGN, '.backups')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** assert 13: wrong verb on a known /api route -> 405 method-not-allowed (+the
 *  declared verbs on Allow); .history/.backups are server state and never
 *  served (probe files placed there must answer 404) while regular static
 *  files keep working. Removing the method allow-list or the hidden-dir guard
 *  makes this assert FAIL. */
async function methodRouteGuard(base, token) {
  const probes = []
  const expect = async (name, res, wantCode, wantError) => {
    const text = await res.text()
    probes.push({
      name,
      ok: res.status === wantCode && safeError(text) === wantError,
      got: `${res.status} ${safeError(text)}`,
    })
  }
  await expect('put-comments', await api(base, '/api/comments', { method: 'PUT', token, body: { id: 'p' } }), 405, 'method-not-allowed')
  await expect('patch-snapshot', await api(base, '/api/snapshot', { method: 'PATCH', token, body: { canvas: 'login', label: 'x' } }), 405, 'method-not-allowed')
  await expect('delete-snapshot', await api(base, '/api/snapshot', { method: 'DELETE', token, body: { canvas: 'login', label: 'x' } }), 405, 'method-not-allowed')
  await expect('get-revert', await api(base, '/api/revert', { token }), 405, 'method-not-allowed')
  await expect('post-snapshots', await api(base, '/api/snapshots', { method: 'POST', token, body: {} }), 405, 'method-not-allowed')
  // hidden-state dirs: probe files with real content (404 without the guard
  // would be a fake pass — the file MUST exist to prove the guard)
  for (const [dir, name] of [['.backups', 'probe-secret.txt'], ['.history', 'probe-secret.txt']]) {
    const full = join(DESIGN, dir, name)
    mkdirSync(join(DESIGN, dir), { recursive: true })
    writeFileSync(full, 'secret-canary')
    const res = await fetch(base + `/${dir}/${name}`)
    const text = await res.text()
    probes.push({
      name: `${dir}-static`,
      ok: res.status === 404 && !text.includes('secret-canary'),
      got: `${res.status} leak=${text.includes('secret-canary')}`,
    })
    rmSync(full, { force: true })
  }
  const staticRes = await fetch(base + '/comments.json')
  probes.push({ name: 'static-alive', ok: staticRes.status === 200, got: String(staticRes.status) })
  const bad = probes.filter((p) => !p.ok)
  record(
    13,
    'method-route-guard',
    bad.length === 0,
    `${probes.map((p) => `${p.name} ${p.got}${p.ok ? '' : ' (!)'}`).join(' + ')} | want 405 method-not-allowed nas rotas de escrita + 404 sem vazamento em .history/.backups + 200 estatico`,
  )
}

/** assert 14: write bodies carry ONLY the keys their route declares — an
 *  undeclared top-level key, an undeclared reply key or a non-numeric rect
 *  field is refused 400, while a fully declared body still writes (200).
 *  Removing the whitelist makes this assert FAIL. */
async function declaredPayloads(base, token) {
  const probes = []
  const expect400 = async (name, path, body) => {
    const res = await api(base, path, { method: 'POST', token, body })
    const text = await res.text()
    probes.push({ name, ok: res.status === 400 && safeError(text) === 'invalid', got: `${res.status} ${safeError(text)}` })
  }
  await expect400('undeclared-key', '/api/comments', { canvas: 'login', file: '01-login.html', evil: 'x' })
  await expect400('rect-undeclared', '/api/comments', { canvas: 'login', file: '01-login.html', rect: { x: 1, evil: 2 } })
  await expect400('rect-nonnumeric', '/api/comments', { canvas: 'login', file: '01-login.html', rect: { x: 1, y: 2, width: 3, height: '4' } })
  await expect400('reply-undeclared', '/api/comments', { canvas: 'login', file: '01-login.html', replies: [{ text: 'ok', evil: 1 }] })
  await expect400('screen-size-undeclared', '/api/screen-size', { canvas: 'login', file: '01-login.html', width: 1234, height: 900, evil: 1 })
  const okRes = await api(base, '/api/comments', {
    method: 'POST',
    token,
    body: { canvas: 'login', file: '01-login.html', replies: [{ text: 'payload-ok' }] },
  })
  const okText = await okRes.text()
  probes.push({ name: 'declared-still-writes', ok: okRes.status === 200 && okText.includes('payload-ok'), got: `${okRes.status}` })
  const bad = probes.filter((p) => !p.ok)
  record(
    14,
    'declared-payloads',
    bad.length === 0,
    `${probes.map((p) => `${p.name} ${p.got}${p.ok ? '' : ' (!)'}`).join(' + ')} | want 400 invalid fora do payload declarado + 200 no declarado`,
  )
}

/** assert 15: every <iframe> of every served HTML page carries sandbox flags.
 *  The bare fixture iframe gets the server-injected default, the one that
 *  declares its own sandbox stays byte-untouched, and the viewer's preview
 *  frames keep theirs. Removing the sweep makes this assert FAIL. */
async function iframeSandbox(base) {
  const probes = []
  const probeRes = await fetch(base + '/snapshots/security-probe.html')
  const probeText = await probeRes.text()
  probes.push({
    name: 'bare-gains-sandbox',
    ok: probeRes.status === 200 && /<iframe id="bare"[^>]*sandbox="allow-scripts allow-same-origin allow-forms"/.test(probeText),
    got: String(probeRes.status),
  })
  probes.push({
    name: 'declared-untouched',
    ok: /<iframe id="declared" sandbox="allow-scripts" src="02-cadastro.html">/.test(probeText),
    got: String((probeText.match(/sandbox=/g) ?? []).length),
  })
  const viewerRes = await fetch(base + '/viewer.html')
  const viewerText = await viewerRes.text()
  const tags = [...viewerText.matchAll(/<iframe\b[^>]*>/gi)].map((m) => m[0])
  probes.push({
    name: 'viewer-frames',
    ok: viewerRes.status === 200 && tags.length > 0 && tags.every((tag) => /sandbox="/.test(tag)),
    got: `${tags.length} iframes, ${tags.filter((tag) => /sandbox="/.test(tag)).length} sandboxed`,
  })
  const bad = probes.filter((p) => !p.ok)
  record(
    15,
    'iframe-sandbox',
    bad.length === 0,
    `${probes.map((p) => `${p.name} ${p.got}${p.ok ? '' : ' (!)'}`).join(' + ')} | want sandbox em todo <iframe> servido`,
  )
}

/** asserts 16+17: config schemaVersion gate + pre-sync backups with retention.
 *  Removing either protection makes the matching assert FAIL. */
async function configAndBackup(base, token) {
  // prep: a snapshot to revert to (write endpoint, must be 200)
  const snap = await api(base, '/api/snapshot', { method: 'POST', token, body: { canvas: 'login', label: 'qa-b' } })
  await snap.text()
  const snapOk = snap.status === 200

  // -- assert 16: unknown config schemaVersion is refused BEFORE any write --
  const configPath = join(DESIGN, 'validate.config.json')
  const goodConfig = readFileSync(configPath, 'utf8')
  const backupsBefore = listBackups()
  writeFileSync(configPath, `${JSON.stringify({ schemaVersion: 99 }, null, 2)}\n`)
  const badRevert = await api(base, '/api/revert', { method: 'POST', token, body: { canvas: 'login', label: 'qa-b' } })
  const badText = await badRevert.text()
  const backupsAfterBad = listBackups()
  writeFileSync(configPath, goodConfig)
  record(
    16,
    'config-schema-version',
    snapOk &&
      badRevert.status === 400 &&
      safeError(badText) === 'config-schema' &&
      backupsAfterBad.length === backupsBefore.length,
    `got snapshot ${snap.status} + revert ${badRevert.status} ${safeError(badText)} + backups ${backupsBefore.length}->${backupsAfterBad.length} | want 400 {"error":"config-schema"} com .backups/ intocado`,
  )

  // -- assert 17: backup BEFORE restore/sync + N-version retention --
  // marker: the live canvas.json diverges from the snapshot BEFORE the revert
  await api(base, '/api/screen-size', {
    method: 'POST',
    token,
    body: { canvas: 'login', file: '01-login.html', width: 1234, height: 900 },
  })
  const markerIn = (dir) => {
    try {
      const manifest = JSON.parse(readFileSync(join(DESIGN, dir, 'login', 'canvas.json'), 'utf8'))
      const screen = (manifest.screens ?? []).find((s) => s && s.file === '01-login.html')
      return screen?.width === 1234
    } catch {
      return false
    }
  }
  let revertOk = true
  const revert = async () => {
    const res = await api(base, '/api/revert', { method: 'POST', token, body: { canvas: 'login', label: 'qa-b' } })
    await res.text()
    if (res.status !== 200) revertOk = false
  }
  await revert() // revert #1: the backup must hold the PRE-revert marker state
  const afterFirst = listBackups()
  const newest = afterFirst.at(-1) ?? ''
  const backupHoldsMarker = markerIn(join('.backups', newest))
  const liveRestored = !markerIn('.')
  for (let i = 0; i < 6; i++) await revert() // reverts #2-#7 -> retention must prune
  const retained = listBackups()
  const complete = retained.every((name) => {
    try {
      return (
        existsSync(join(DESIGN, '.backups', name, 'comments.json')) &&
        existsSync(join(DESIGN, '.backups', name, 'login', 'canvas.json'))
      )
    } catch {
      return false
    }
  })
  // stale-state recheck: one more revert and the count must STAY at 5, with
  // the survivors still complete (the pruned oldest is never silently missed)
  await revert()
  const rechecked = listBackups()
  record(
    17,
    'backup-retention',
    snapOk &&
      revertOk &&
      afterFirst.length >= 1 &&
      backupHoldsMarker &&
      liveRestored &&
      retained.length === 5 &&
      complete &&
      rechecked.length === 5,
    `got snapshot ${snap.status}, backups ${afterFirst.length} -> ${retained.length} -> ${rechecked.length} (recheck), marker-no-backup=${backupHoldsMarker} live-restored=${liveRestored} completos=${complete} | want backup pre-sync + 5 retidos + recheck estavel`,
  )
}

/** assert 18: localhost binding is the DEFAULT — the printed URL is
 *  127.0.0.1 and the LAN address refuses the port (only --share binds
 *  0.0.0.0). */
async function localhostDefault(base, port) {
  const urlOk = base.startsWith('http://127.0.0.1:')
  let lan = null
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        lan = entry.address
        break
      }
    }
    if (lan) break
  }
  let lanRefused = true
  let lanNote = 'sem IP externo'
  if (lan) {
    lanRefused = await new Promise((done) => {
      const probe = createConnection({ host: lan, port })
      probe.setTimeout(1500)
      probe.once('connect', () => {
        probe.destroy()
        done(false)
      })
      probe.once('error', () => {
        probe.destroy()
        done(true)
      })
      probe.once('timeout', () => {
        probe.destroy()
        done(true)
      })
    })
    lanNote = `${lan}:${port} ${lanRefused ? 'recusado' : 'ACEITO (!)'}`
  }
  record(
    18,
    'localhost-default',
    urlOk && lanRefused,
    `URL ${base} (127.0.0.1=${urlOk}) + LAN ${lanNote} | want bind 127.0.0.1 por default`,
  )
}

/** assert 19 (LAST): burst past the budget -> 429 {"error":"rate-limited"} on
 *  later calls while the first still answers 200. Removing the limiter makes
 *  this assert FAIL (nothing ever answers 429). */
async function rateLimit(base, token) {
  const burst = 340
  let first = 0
  let last = 0
  let limited = 0
  let limitedError = ''
  for (let i = 0; i < burst; i += 1) {
    const res = await api(base, '/api/comments', { token })
    const text = await res.text()
    if (i === 0) first = res.status
    if (res.status === 429) {
      limited += 1
      limitedError = safeError(text)
    }
    last = res.status
  }
  record(
    19,
    'rate-limit',
    first === 200 && limited >= 1 && limitedError === 'rate-limited' && last === 429,
    `got burst ${burst}: first ${first}, ${limited}x 429 (${limitedError || '-'}), last ${last} | want 200 no inicio e 429 {"error":"rate-limited"} no fim`,
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
    console.log('SKIP #10-#19: modo externo — XSS/traversal/CSP/rotas/payloads/iframe/config/backup/localhost/rate-limit rodam so no auto-spawn')
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
    await methodRouteGuard(mainServer.base, mainServer.token)
    await declaredPayloads(mainServer.base, mainServer.token)
    await iframeSandbox(mainServer.base)
    await configAndBackup(mainServer.base, mainServer.token)
    await localhostDefault(mainServer.base, port1)
    await xssCommentSanitized(mainServer.base, mainServer.token)
    await traversalHardening(port1, mainServer.base, mainServer.token)
    await cspHeaders(mainServer.base)
    await rateLimit(mainServer.base, mainServer.token) // LAST: consumes the window budget
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

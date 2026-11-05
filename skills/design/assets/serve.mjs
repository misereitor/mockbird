#!/usr/bin/env node
/**
 * Tiny zero-dependency local server for the design folder.
 *
 * ROOT (documented behavior change): the served root is `./design` relative to
 * the CURRENT WORKING DIRECTORY — not the folder next to this script. The same
 * root backs the write API below and the pipeline tools (gen/sync/validate all
 * point at `design/`). Run it from the project root: `node design/serve.mjs`.
 *
 * Usage: node design/serve.mjs [porta] [--share] [--open[=canvas]] [--no-open]
 *   [porta]  TCP port (default 8765; when busy, the next free one is used;
 *            0 = ephemeral — the OS picks a free port, printed in the URL line)
 *   --share  bind 0.0.0.0 for LAN preview; every /api/* then answers 403
 *            (read-only degradation — writes and API reads are refused)
 *   --open[=canvas]  force-open the default browser at the viewer (optionally
 *            straight at a canvas: --open=login). By default the browser
 *            opens only from an interactive terminal (TTY); set the BROWSER
 *            env var to pick a specific browser binary.
 *   --no-open  never open a browser, just print the URL
 *
 * On start prints ONE parseable line:
 *   URL: <base> TOKEN: <token>
 *
 * Write API (`/api/*`, errors are JSON `{error: code}`):
 *   GET  /api/comments   -> { comments: [...] }
 *   POST /api/comments   -> { comments: [...] }   create/update pin status+replies
 *   GET  /api/snapshots  -> { snapshots: [{canvas,label,date}] }
 *   POST /api/snapshot   -> { snapshot: {canvas,label,date} }
 *                          writes design/snapshots/<canvas>/<label>/{src,render,manifest.json}
 *                          src/    = whole canvas dir + design-root tokens.json
 *                                    (root wins) + FULL design-root components/
 *                          render/ = one FLAT self-contained HTML per top-level
 *                                    screen (css/js/data inline, local refs
 *                                    copied beside — zero href="../ or src="../)
 *   POST /api/revert     -> 200 {reverted:{canvas,label},
 *                          pipeline:{gen:true,sync:true,validate:true}}
 *                          restores the snapshot src/ as an integral REPLACE
 *                          (per artifact/dir of src/: screens, canvas.json,
 *                          data.json, tokens.json, components/ WHOLE — never a
 *                          merge; files outside src/ survive untouched) and
 *                          ALWAYS reruns gen-tokens -> sync-components ->
 *                          validate on the installed design/ copies; pins whose
 *                          anchors no longer resolve become "stale" (second
 *                          named writer, --mark-stale semantics)
 *
 * Hardening (ONLY on /api/* — static routes are never intercepted, so LAN
 * static serving keeps working):
 *   - Host must be localhost/127.0.0.1 (port ignored)
 *   - Origin present and cross-site -> 403 (absent Origin allowed)
 *   - X-Design-Token: per-run token, required on every /api/* call
 *   - canvas|label|id must match /^[a-z0-9-]+$/
 *   - traversal-shaped input (.., /, \) -> 403
 *   - body > 256KB -> 413
 *   - route method must be the declared one -> 405 (write routes accept only
 *     their own verb; token is required on top of that)
 *   - simple rate limit: 300 /api/* calls per minute per remote address ->
 *     429 (Retry-After carries the wait)
 *   - declared payloads only: a write body carries just the keys its route
 *     declares (plus {text,at,createdAt} reply items and numeric
 *     {x,y,width,height} rects) — undeclared keys -> 400, so design/ writes
 *     land only in declared fields
 *   - .history/ and .backups/ are server state, never served statically
 * Error taxonomy: traversal 403 | schema 400 | too large 413 | missing 404 |
 * wrong method 405 | rate-limited 429 | duplicate snapshot label 409 |
 * unsupported config schema 400 | invalid/desynced snapshot manifest 400
 * (checked BEFORE any restore, never touching the root) | write/pipeline
 * failure 500 + FULL rollback to the pre-revert state (backup taken before
 * the swap).
 *
 * Config versioning (todo 35): before the revert pipeline may run
 * gen -> sync -> validate, design/validate.config.json (validate.mjs's own
 * discovery chain) must declare a schemaVersion this server understands.
 * Absent = legacy config, still accepted; non-integer/unknown -> 400 with the
 * root untouched.
 *
 * Backups (todo 35): every revert takes design/.backups/<timestamp>/ with the
 * root as it was BEFORE restore/sync rewrote it (snapshots/, .history/ and
 * .backups/ excluded). The newest 5 survive; older entries are pruned.
 *
 * Iframe isolation (todo 35): every served HTML page gets explicit sandbox
 * flags on <iframe> tags that lack them (allow-scripts allow-same-origin
 * allow-forms — the same trio the viewer declares on its own preview frames),
 * so authored previews cannot grant themselves top navigation, popups or
 * downloads. Script/style/comment interiors are never rewritten.
 *
 * CSP (todo 16 base + todo 35): viewer/docs ship an ENFORCED policy (never
 * report-only) with no 'unsafe-inline': inline <script>/<style> blocks and
 * inline style attributes are allowed per-value via sha256 hashes computed on
 * the SERVED bytes (post-rewrite), style attributes under 'unsafe-hashes'.
 * The report-only -> enforce decision is recorded in ADR-0009.
 *
 * The viewer gets the token via in-memory response rewrite: the placeholder
 * `window.__DESIGN_TOKEN__ = null` inside viewer.html is substituted at serve
 * time. The file on disk stays intact. In --share mode the same rewrite also
 * injects `window.__DESIGN_READONLY = true` alongside the token placeholder
 * (the token value stays null there — /api refuses everything anyway), so the
 * served viewer degrades itself: write actions and every /api-fed resource
 * hide behind `data-share-hide` (syncShareDegradation) with a read-only
 * banner. Static routes keep serving normally to the LAN.
 */
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, createHmac, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {
  createReadStream,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { homedir, networkInterfaces, tmpdir } from 'node:os'
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path'
let createUserAdmin, loadUsers, inviteUser, activateUser, saveUsers, verifyUserPassword
try { ({ createAdmin: createUserAdmin, load: loadUsers, invite: inviteUser, activate: activateUser, save: saveUsers, verifyPassword: verifyUserPassword } = await import('../scripts/users.mjs')) } catch { ({ createAdmin: createUserAdmin, load: loadUsers, invite: inviteUser, activate: activateUser, save: saveUsers, verifyPassword: verifyUserPassword } = await import('./users.mjs').catch(() => ({ createAdmin:()=>{throw new Error('users store unavailable')}, load:()=>({users:[]}), invite:()=>{throw new Error('users store unavailable')}, activate:()=>{throw new Error('users store unavailable')}, save:()=>{}, verifyPassword:()=>false }))) }

const argv = process.argv.slice(2)
const service = argv.includes('--service')
const dataArgIndex = argv.indexOf('--data')
const dataDir = dataArgIndex >= 0 ? resolve(argv[dataArgIndex + 1] || '') : resolve(process.cwd(), 'data')
const authzMatrix = { '/api/projects':['viewer','commenter','editor','admin'], '/api/comments':['viewer','commenter','editor','admin'], '/api/snapshots':['viewer','editor','admin'], '/api/snapshot':['editor','admin'], '/api/revert':['editor','admin'], '/api/agent-send':['editor','admin'], '/api/history':['viewer','commenter','editor','admin'], '/api/history/restore':['editor','admin'], '/api/screen-size':['editor','admin'], '/api/admin/users':['admin'] }
if (service && argv.includes('--create-admin')) { const email=argv[argv.indexOf('--create-admin')+1]; if(!email||email.startsWith('--')) { console.error('uso: --create-admin email'); process.exit(2) } try { console.log(JSON.stringify(createUserAdmin(dataDir,email))); process.exit(0) } catch(e) { console.error(e.message); process.exit(1) } }
if (argv.includes('--backup')) { const { backup } = await import('../scripts/service-persistence.mjs'); console.log(backup(dataDir)); process.exit(0) }
if (argv.includes('--restore')) { const ri=argv.indexOf('--restore'); const { restore } = await import('../scripts/service-persistence.mjs'); restore(dataDir, resolve(argv[ri+1])); console.log('restore ok'); process.exit(0) }
if (service && (!argv[dataArgIndex + 1] || argv[dataArgIndex + 1].startsWith('--'))) {
  console.error('uso: node serve.mjs --service --data <dir> [porta]')
  process.exit(2)
}
const share = argv.includes('--share')
const noOpen = argv.includes('--no-open')
const openArg = argv.find((arg) => arg === '--open' || arg.startsWith('--open='))
const openCanvas = openArg?.startsWith('--open=') ? openArg.slice('--open='.length) : ''
const portArg = argv.find((arg, index) => !arg.startsWith('--') && (dataArgIndex < 0 || index !== dataArgIndex + 1))
const port = portArg === undefined ? 8765 : Number(portArg)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('uso: node design/serve.mjs [porta] [--share] [--open[=canvas]] [--no-open]')
  process.exit(2)
}
if (openCanvas && !/^[a-zA-Z0-9_-]+$/.test(openCanvas)) {
  console.error('canvas invalido em --open=<canvas>')
  process.exit(2)
}

const bindHost = share ? '0.0.0.0' : '127.0.0.1'
const root = resolve(process.cwd(), 'design')
const token = randomBytes(16).toString('hex')
const sessionToken = randomBytes(32).toString('hex')
const scrypt = promisify(scryptCallback)
const AUTH_N = 2 ** 15
const AUTH_R = 8
const AUTH_P = 1
const sessions = new Map()
const loginFailures = new Map()
const weakPasswords = new Set(['passwordpassword', 'changeme1234', '123456789012', 'qwertyuiop12'])
function validPassword(password) { return typeof password === 'string' && password.length >= 12 && !weakPasswords.has(password.toLowerCase()) }
async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('weak-password')
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64, { N: AUTH_N, r: AUTH_R, p: AUTH_P })
  return `scrypt$N=${AUTH_N},r=${AUTH_R},p=${AUTH_P}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}
async function verifyPassword(password, encoded) {
  const match = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(String(encoded || ''))
  if (!match) return false
  const derived = await scrypt(password, Buffer.from(match[4], 'base64url'), 64, { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) })
  const expected = Buffer.from(match[5], 'base64url')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}
function signedSession(value) { return `${value}.${createHmac('sha256', sessionToken).update(value).digest('base64url')}` }
function sessionFrom(req) {
  const raw = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('mockbird_session='))?.slice(17)
  if (!raw) return null
  const [id, sig] = raw.split('.')
  const expected = createHmac('sha256', sessionToken).update(id).digest('base64url')
  if (!id || !sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const item = sessions.get(id); if (!item) return null
  const now = Date.now(); if (now > item.expires || now - item.used > 12 * 60 * 60 * 1000) { sessions.delete(id); return null }
  item.used = now; return item
}
const projectsFile = join(dataDir, 'projects.json')
function loadProjects() {
  mkdirSync(dataDir, { recursive: true })
  try { const value = JSON.parse(readFileSync(projectsFile, 'utf8')); return Array.isArray(value.projects) ? value : { projects: [] } } catch { return { projects: [] } }
}
let projects = service ? loadProjects() : { projects: [] }
function saveProjects() {
  mkdirSync(dataDir, { recursive: true })
  const temp = `${projectsFile}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(projects, null, 2) + '\n')
  renameSync(temp, projectsFile)
}

const MAX_BODY = 256 * 1024
const SAFE_ID = /^[a-z0-9-]+$/
/** Spawn options for external processes: hidden console windows on Windows. */
const HIDDEN = { windowsHide: true }
const TOKEN_PLACEHOLDER = 'window.__DESIGN_TOKEN__ = null'
const TOKEN_INJECTED = `window.__DESIGN_TOKEN__ = "${token}"`
// share mode: the token stays null (writes are refused by /api anyway) and the
// readonly flag rides the same in-memory rewrite — disk file keeps both false.
const TOKEN_SHARE = 'window.__DESIGN_TOKEN__ = null'
const READONLY_PLACEHOLDER = 'window.__DESIGN_READONLY = false'
const READONLY_INJECTED = 'window.__DESIGN_READONLY = true'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

class ApiError extends Error {
  constructor(code, error) {
    super(error)
    this.code = code
    this.error = error
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(obj))
}

function fail(res, code, error) {
  sendJson(res, code, { error })
}

function apiFail(res, error) {
  if (error instanceof ApiError) return fail(res, error.code, error.error)
  return fail(res, 500, 'internal')
}

function isTraversal(value) {
  return value.includes('..') || value.includes('/') || value.includes('\\')
}

/** One sha256 CSP hash source for the exact text. */
function hash256(text) {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`
}

/** CSP for viewer/docs (todo 16 base, todo 35 hardening): scripts and styles
 * only from this server, plus a sha256 allow-list computed on the SERVED bytes
 * (post token-rewrite and iframe sweep) — inline <script>/<style> blocks hash
 * their text, inline style= attributes hash their value under 'unsafe-hashes'
 * (CSP3). 'unsafe-inline' is gone from both script-src and style-src. Inline
 * <style>/style attrs were previously blanket-allowed; per-value hashes keep
 * the viewer working while unlisted inline code/styles stay blocked. Images
 * may be data: (export previews). */
function cspFor(html) {
  const scripts = []
  const styles = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue
    scripts.push(hash256(match[2]))
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    styles.push(hash256(match[1]))
  }
  for (const match of html.matchAll(/(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[1] ?? match[2] ?? ''
    if (value.trim() === '') continue
    styles.push(hash256(value))
  }
  const inline = (list) => (list.length ? ` ${list.join(' ')}` : '')
  return (
    `script-src 'self'${inline(scripts)}; ` +
    `style-src 'self' 'unsafe-hashes'${inline(styles)}; ` +
    `img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'`
  )
}

/** Iframe isolation (todo 35): every <iframe> of a served HTML page that lacks
 * a sandbox attribute gains the viewer's own preview trio. Tag interiors of
 * <script>/<style>/comments are skipped so JS strings and CSS stay byte-exact. */
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms'
const IFRAME_SWEEP =
  /(<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->)|<iframe\b([^>]*?)\/?>/gi

function sandboxIframes(html) {
  return html.replace(IFRAME_SWEEP, (whole, skip, attrs) => {
    if (skip !== undefined) return skip
    if (/(?<![\w-])sandbox\s*=/.test(attrs)) return whole
    return `<iframe${attrs.replace(/\s*\/$/, '')} sandbox="${IFRAME_SANDBOX}">`
  })
}

/** Comment text sanitization (todo 16): strip HTML tags and inert-encode the
 * angle brackets left over, so persisted comments can never form an executable
 * tag in any consumer (the viewer renders text via textContent — plain text
 * stays plain). Newlines/tabs survive; other control chars are dropped. */
function sanitizeCommentText(value) {
  let out = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  for (let prev = null; prev !== out; ) {
    prev = out
    out = out.replace(/<\/?[a-zA-Z][^<>]*>/g, '') // repeat: nested masks (<scr<script>ipt>)
  }
  return out.split('<').join('&lt;').split('>').join('&gt;')
}

function hostnameOf(header) {
  const host = String(header ?? '').trim().toLowerCase()
  if (!host) return ''
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(0, end + 1)
  }
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

function isLocalHost(name) {
  return LOCAL_HOSTS.has(name)
}

/** Host/Origin/token guards — enforced on /api/* ONLY. */
function apiGuard(req) {
  if (share) return { code: 403, error: 'forbidden' }
  if (service && serviceSession(req)) return null
  if (!isLocalHost(hostnameOf(req.headers.host))) return { code: 403, error: 'forbidden' }
  const origin = req.headers.origin
  if (origin !== undefined) {
    let ok = false
    try {
      ok = isLocalHost(new URL(String(origin)).hostname)
    } catch {
      ok = false
    }
    if (!ok) return { code: 403, error: 'forbidden' }
  }
  const given = req.headers['x-design-token']
  if (typeof given !== 'string' || given !== token) return { code: 403, error: 'forbidden' }
  return null
}

function serviceSession(req) {
  if (sessionFrom(req)) return true
  const header = req.headers['x-session-token']
  const cookies = String(req.headers.cookie || '').split(';').map((x) => x.trim())
  const cookie = cookies.find((x) => x.startsWith('mockbird_session='))?.slice('mockbird_session='.length)
  return (typeof header === 'string' && header === sessionToken) || cookie === sessionToken
}

// ---------- rate limit (todo 35) ----------
/* Simple fixed window per remote address over /api/*: RATE_MAX calls per
 * RATE_WINDOW_MS, then 429 until the window rolls. Counts every /api/* hit
 * (valid or not) so token probing and write floods share one budget. */

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 300
const rateWindows = new Map() // remoteAddress -> { start, count }

/** Seconds to wait when over budget, or 0 when the call may proceed. */
function rateRetryAfter(req) {
  const address = req.socket.remoteAddress ?? '?'
  const now = Date.now()
  const win = rateWindows.get(address)
  if (!win || now - win.start >= RATE_WINDOW_MS) {
    if (rateWindows.size > 1024) {
      for (const [key, entry] of rateWindows) {
        if (now - entry.start >= RATE_WINDOW_MS) rateWindows.delete(key)
      }
    }
    rateWindows.set(address, { start: now, count: 1 })
    return 0
  }
  win.count += 1
  return win.count > RATE_MAX ? Math.max(1, Math.ceil((win.start + RATE_WINDOW_MS - now) / 1000)) : 0
}

// ---------- declared payloads + method allow-list (todo 35) ----------
/* Write bodies carry ONLY the keys their route declares: anything else is
 * refused 400 before a handler runs, so design/ writes land solely in declared
 * fields (reply items and rects get the same treatment one level down). */

const PAYLOAD_KEYS = {
  comments: ['id', 'canvas', 'file', 'selector', 'snippet', 'rect', 'status', 'replies', '_demo'],
  snapshot: ['canvas', 'label'],
  revert: ['canvas', 'label'],
  'agent-send': ['text'],
  'history-restore': ['file', 'revision'],
  'screen-size': ['canvas', 'file', 'width', 'height'],
}
const REPLY_KEYS = ['text', 'at', 'createdAt']
const RECT_KEYS = ['x', 'y', 'width', 'height']

function checkDeclaredPayload(route, body) {
  const declared = PAYLOAD_KEYS[route]
  if (!declared) return
  for (const key of Object.keys(body)) {
    if (!declared.includes(key)) throw new ApiError(400, 'invalid')
  }
  if (body.replies !== undefined) {
    if (!Array.isArray(body.replies)) throw new ApiError(400, 'invalid')
    for (const reply of body.replies) {
      if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new ApiError(400, 'invalid')
      for (const key of Object.keys(reply)) {
        if (!REPLY_KEYS.includes(key)) throw new ApiError(400, 'invalid')
      }
    }
  }
  if (body.rect !== undefined) {
    const rect = body.rect
    if (!rect || typeof rect !== 'object' || Array.isArray(rect)) throw new ApiError(400, 'invalid')
    for (const key of Object.keys(rect)) {
      if (!RECT_KEYS.includes(key) || typeof rect[key] !== 'number' || !Number.isFinite(rect[key])) {
        throw new ApiError(400, 'invalid')
      }
    }
  }
}

const ROUTE_METHODS = {
  comments: ['GET', 'POST', 'DELETE'],
  snapshots: ['GET'],
  snapshot: ['POST'],
  revert: ['POST'],
  'agent-send': ['POST'],
  history: ['GET'],
  'history-restore': ['POST'],
  'screen-size': ['POST'],
}

/** Reads the request body, discarding past MAX_BODY; resolves {text} | {error}. */
function readBody(req) {
  return new Promise((done) => {
    const chunks = []
    let size = 0
    let overflow = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        overflow = true
        chunks.length = 0
        return
      }
      if (!overflow) chunks.push(chunk)
    })
    req.on('end', () => {
      if (overflow) done({ error: 413 })
      else done({ text: Buffer.concat(chunks).toString('utf8') })
    })
    req.on('error', () => done({ error: 400 }))
  })
}

// ---------- comments.json ----------

function commentsPath() {
  return join(root, 'comments.json')
}

function loadComments() {
  const file = commentsPath()
  if (!existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new ApiError(400, 'invalid')
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.comments)) {
    throw new ApiError(400, 'invalid')
  }
  return parsed.comments
}

function saveComments(comments) {
  writeFileSync(commentsPath(), `${JSON.stringify({ comments }, null, 2)}\n`)
}

/** Replies persist as {text, createdAt} (comments.json schema); legacy "at"
 * input is accepted and folded into createdAt. Text is sanitized on write. */
function normalizeReplies(list) {
  return list.map((reply) => ({
    text: sanitizeCommentText(reply.text),
    createdAt:
      typeof reply.createdAt === 'string'
        ? reply.createdAt
        : typeof reply.at === 'string'
          ? reply.at
          : new Date().toISOString(),
  }))
}

/** DELETE /api/comments {id} - remove a pin entirely (with the others intact). */
function handleCommentsDelete(body) {
  if (!body || typeof body.id !== 'string' || !SAFE_ID.test(body.id)) {
    throw new ApiError(400, 'invalid')
  }
  const comments = loadComments()
  const next = comments.filter((pin) => pin && pin.id !== body.id)
  if (next.length === comments.length) throw new ApiError(404, 'not-found')
  saveComments(next)
  return next
}

/** POST /api/comments - create or update pin status+replies. */
function handleCommentsPost(body) {
  const comments = loadComments()
  const hasId = body.id !== undefined
  if (hasId && (typeof body.id !== 'string' || !SAFE_ID.test(body.id))) {
    throw new ApiError(400, 'invalid')
  }
  if (body.status !== undefined && body.status !== 'open' && body.status !== 'resolved') {
    // "stale" is written only by validate.mjs --mark-stale (and the revert pipeline).
    throw new ApiError(400, 'invalid')
  }
  if (body.replies !== undefined) {
    if (!Array.isArray(body.replies)) throw new ApiError(400, 'invalid')
    for (const reply of body.replies) {
      if (!reply || typeof reply !== 'object' || Array.isArray(reply) || typeof reply.text !== 'string') {
        throw new ApiError(400, 'invalid')
      }
      if (reply.at !== undefined && typeof reply.at !== 'string') throw new ApiError(400, 'invalid')
      if (reply.createdAt !== undefined && typeof reply.createdAt !== 'string') throw new ApiError(400, 'invalid')
    }
  }
  if (body.selector !== undefined && typeof body.selector !== 'string') throw new ApiError(400, 'invalid')
  if (body.snippet !== undefined && typeof body.snippet !== 'string') throw new ApiError(400, 'invalid')
  if (body.rect !== undefined && (!body.rect || typeof body.rect !== 'object' || Array.isArray(body.rect))) {
    throw new ApiError(400, 'invalid')
  }
  if (body._demo !== undefined && typeof body._demo !== 'boolean') throw new ApiError(400, 'invalid')

  const existing = hasId ? comments.find((pin) => pin && pin.id === body.id) : undefined
  if (existing) {
    if (body.status !== undefined) existing.status = body.status
    if (body.rect !== undefined) existing.rect = body.rect // w17: re-ancora ao redimensionar
    if (body.replies !== undefined) {
      if (!Array.isArray(existing.replies)) existing.replies = []
      existing.replies.push(...normalizeReplies(body.replies))
    }
    saveComments(comments)
    return comments
  }

  const { canvas, file } = body
  if (typeof canvas !== 'string' || !SAFE_ID.test(canvas)) throw new ApiError(400, 'invalid')
  if (typeof file !== 'string' || file.length === 0) throw new ApiError(400, 'invalid')
  const canvasDir = join(root, canvas)
  if (!existsSync(canvasDir) || !statSync(canvasDir).isDirectory()) throw new ApiError(404, 'not-found')
  const target = normalize(join(canvasDir, file))
  if (target !== canvasDir && !target.startsWith(canvasDir + sep)) throw new ApiError(403, 'traversal')
  if (!existsSync(target) || !statSync(target).isFile()) throw new ApiError(404, 'not-found')

  const pin = {
    id: hasId ? body.id : `p-${randomBytes(6).toString('hex')}`,
    canvas,
    file,
  }
  if (typeof body.selector === 'string') pin.selector = body.selector
  if (typeof body.snippet === 'string') pin.snippet = body.snippet
  if (body.rect !== undefined) pin.rect = body.rect
  pin.status = body.status ?? 'open'
  pin.replies = normalizeReplies(body.replies ?? [])
  pin.createdAt = new Date().toISOString()
  if (body._demo === true) pin._demo = true
  comments.push(pin)
  saveComments(comments)
  return comments
}

/** POST /api/screen-size {canvas, file, width, height} - w17: editar o
 *  tamanho da tela no manifesto (canvas.json), para responsividade dinamica.
 *  width/height null = restaurar o padrao do dispositivo (o manifesto solta
 *  o override). O poller de historico ja grava a revisao do canvas.json. */
function handleScreenSize(body) {
  if (!body || typeof body.canvas !== 'string' || !SAFE_ID.test(body.canvas)) {
    throw new ApiError(400, 'invalid')
  }
  if (typeof body.file !== 'string' || body.file.length === 0 || body.file.length > 512) {
    throw new ApiError(400, 'invalid')
  }
  const reset = body.width === null && body.height === null
  let width = 0
  let height = 0
  if (!reset) {
    width = Number(body.width)
    height = Number(body.height)
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw new ApiError(400, 'invalid')
    if (width < 100 || width > 20000 || height < 100 || height > 20000) throw new ApiError(400, 'invalid')
  }
  const canvasDir = join(root, body.canvas)
  if (!existsSync(canvasDir) || !statSync(canvasDir).isDirectory()) throw new ApiError(404, 'not-found')
  const manifestPath = normalize(join(canvasDir, 'canvas.json'))
  if (manifestPath !== canvasDir && !manifestPath.startsWith(canvasDir + sep)) throw new ApiError(403, 'traversal')
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) throw new ApiError(404, 'not-found')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new ApiError(400, 'invalid')
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.screens)) {
    throw new ApiError(400, 'invalid')
  }
  const want = String(body.file).split(/[?#]/)[0].split(/[\\/]/).pop()
  const screen = manifest.screens.find(
    (s) => s && typeof s.file === 'string' && s.file.split(/[?#]/)[0].split(/[\\/]/).pop() === want,
  )
  if (!screen) throw new ApiError(404, 'not-found')
  if (reset) {
    delete screen.width
    delete screen.height
  } else {
    screen.width = width
    screen.height = height
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { screen: { file: screen.file, width: screen.width ?? null, height: screen.height ?? null } }
}

// ---------- snapshots ----------

function snapDirFor(canvas, label) {
  return join(root, 'snapshots', canvas, label)
}

/** Files under `dir`, `{file}` relative to the SNAPSHOT DIR using the manifest
 * convention (`src/01-login.html`, `render/01-login.html`). manifest.json lives
 * at the snapshot root and is therefore never part of any inventory. */
function listFilesDeep(dir, prefix) {
  const out = []
  const walk = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name)
      const next = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, next)
      else if (entry.isFile()) out.push({ file: `${prefix}${next}`, size: statSync(abs).size })
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** tokensHash = sha256 hex of the \r-stripped bytes of tokens.json (the
 * snapshot's src/tokens.json; line endings never change the hash). */
function tokensHashOf(file) {
  const hash = createHash('sha256')
  if (existsSync(file)) {
    hash.update(readFileSync(file, 'utf8').split('\r').join(''))
  }
  return hash.digest('hex')
}

/** Reads manifest.json; schema-invalid -> 400 (ApiError). Missing -> null. */
function readManifest(snapDir) {
  const file = join(snapDir, 'manifest.json')
  if (!existsSync(file)) return null
  let manifest
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new ApiError(400, 'invalid')
  }
  const inventory = manifest && typeof manifest === 'object' ? manifest.inventory : null
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof manifest.label !== 'string' ||
    typeof manifest.date !== 'string' ||
    typeof manifest.tokensHash !== 'string' ||
    !inventory ||
    typeof inventory !== 'object' ||
    !Array.isArray(inventory.src) ||
    !Array.isArray(inventory.render)
  ) {
    throw new ApiError(400, 'invalid')
  }
  return manifest
}

/** True when the manifest no longer matches the snapshot on disk: the same
 * snapshot-dir-relative inventory convention as listFilesDeep(.., 'src/'|'render/'),
 * checked bidirectionally (manifest <-> disk), plus the tokensHash. */
function manifestDesynced(snapDir, manifest, label) {
  try {
    if (manifest.label !== label) return true
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (!eq(listFilesDeep(join(snapDir, 'src'), 'src/'), manifest.inventory.src)) return true
    if (!eq(listFilesDeep(join(snapDir, 'render'), 'render/'), manifest.inventory.render)) return true
    return tokensHashOf(join(snapDir, 'src', 'tokens.json')) !== manifest.tokensHash
  } catch {
    return true
  }
}

/** GET /api/snapshots — lists every snapshot with a readable manifest. */
function listSnapshots() {
  const base = join(root, 'snapshots')
  const out = []
  if (!existsSync(base)) return out
  for (const canvasEntry of readdirSync(base, { withFileTypes: true })) {
    if (!canvasEntry.isDirectory()) continue
    const canvasDir = join(base, canvasEntry.name)
    for (const labelEntry of readdirSync(canvasDir, { withFileTypes: true })) {
      if (!labelEntry.isDirectory()) continue
      const snapDir = join(canvasDir, labelEntry.name)
      try {
        const manifest = readManifest(snapDir)
        if (manifest && !manifestDesynced(snapDir, manifest, labelEntry.name)) {
          out.push({ canvas: canvasEntry.name, label: manifest.label, date: manifest.date })
        }
      } catch {
        // invalid manifest is skipped on listing; revert validates strictly (400)
      }
    }
  }
  out.sort((a, b) => a.canvas.localeCompare(b.canvas) || a.label.localeCompare(b.label))
  return out
}

// ---------- render/ flattening (flat, self-contained, file://-ready) ----------
//
// One output HTML per top-level screen (name-stable). Local css/js is inlined
// (`<style data-inline>` / `<script data-inline>` with `</style` -> `<\/style`,
// `</script` -> `<\/script` escapes); before an inlined mock.js a prelude ships
// data.json/canvas.json as globals plus a fetch shim so Mock.data() works on
// file://. Every other local ref (href/src, both quote styles) is copied beside
// at basename (collision -> preserved path -> numeric suffix) and rewritten;
// local HTML pulled that way is flattened too (recursive, seen-set). The whole
// render/ tree ends with ZERO `href="../` and `src="../`.

const FETCH_SHIM =
  '(function(){var of=window.fetch;window.fetch=function(i){' +
  'var u=String((i&&i.url)||i||"");var b=u.split(/[?#]/)[0].split("/").pop();' +
  'if(b==="data.json")return Promise.resolve({ok:true,json:function(){return Promise.resolve(window.__MOCK_DATA__)}});' +
  'if(b==="canvas.json")return Promise.resolve({ok:true,json:function(){return Promise.resolve(window.__MOCK_CANVAS__)}});' +
  'return of.apply(this,arguments);};})()'

const ATTR_RE = /\b(href|src)(\s*=\s*)("([^"]*)"|'([^']*)')/gi

function splitSuffix(ref) {
  const at = ref.search(/[?#]/)
  return at === -1 ? { path: ref, suffix: '' } : { path: ref.slice(0, at), suffix: ref.slice(at) }
}

function isExternalRef(path) {
  return path === '' || path.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)
}

function refKind(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.css') return 'style'
  if (ext === '.js' || ext === '.mjs') return 'script'
  if (ext === '.html' || ext === '.htm') return 'html'
  return 'copy'
}

function toPosix(p) {
  return p.split(sep).join('/').split('\\').join('/')
}

/** Escapes the tag-terminating sequence inside inlined css/js (mock.js has one
 * `</script>` in a comment — mandatory). */
function escapeClose(text, kind) {
  return kind === 'style'
    ? text.replace(/<\/(style)/gi, '<\\/$1')
    : text.replace(/<\/(script)/gi, '<\\/$1')
}

/** Snapshot data prelude: frozen data.json/canvas.json + fetch shim (file://). */
function mockPrelude(sourceDir) {
  const readJson = (name) => {
    try {
      return JSON.parse(readFileSync(join(sourceDir, name), 'utf8'))
    } catch {
      return {}
    }
  }
  const enc = (value) => JSON.stringify(value).split('<').join('\\u003c')
  return (
    `<script>window.__MOCK_DATA__=${enc(readJson('data.json'))};window.__MOCK_CANVAS__=${enc(readJson('canvas.json'))};</script>\n` +
    `<script>${FETCH_SHIM}</script>\n`
  )
}

function tagAttr(tag, name) {
  const m = new RegExp(`\\b${name}(\\s*=\\s*)("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  if (!m) return null
  return m[3] !== undefined ? m[3] : m[4]
}

/** Invariant sweep: no `href="../` / `src="../` survives anywhere in render/. */
function neutralizeRefs(text) {
  return text.replace(/\b(href|src)(=["'])(?:\.\.?\/)+/gi, '$1$2')
}

const TEXT_REF_RE = /\.(js|mjs|css|json|txt|svg|xml|md|html?|cjs|ts)$/i

/** Allocation chain for a render/ output name: basename -> preserved path
 * (source path relative to the design root) -> numeric suffix. Returns the
 * render-root-relative POSIX out path. */
function allocName(ctx, outDir, sourceAbs) {
  const base = basename(sourceAbs) || 'ref'
  const safeBase = /^\.+$/.test(base) ? 'ref' : base
  const dot = safeBase.lastIndexOf('.')
  const stem = dot > 0 ? safeBase.slice(0, dot) : safeBase
  const ext = dot > 0 ? safeBase.slice(dot) : ''
  const candidates = [`${outDir ? `${outDir}/` : ''}${safeBase}`]
  const relRoot = toPosix(relative(root, sourceAbs))
  if (relRoot && !relRoot.startsWith('..') && !relRoot.startsWith('/')) {
    candidates.push(`${outDir ? `${outDir}/` : ''}${relRoot}`)
  }
  for (let n = 2; n < 1000; n++) {
    candidates.push(`${outDir ? `${outDir}/` : ''}${stem}-${n}${ext}`)
  }
  for (const candidate of candidates) {
    if (!ctx.used.has(candidate)) {
      ctx.used.add(candidate)
      return candidate
    }
  }
  throw new Error(`render name allocation failed for ${sourceAbs}`)
}

function outDirOf(outRel) {
  const at = outRel.lastIndexOf('/')
  return at === -1 ? '' : outRel.slice(0, at)
}

/** Duplicate an already-produced render file beside the page (per-dir) so the
 * attr never needs to walk up with `../`. */
function dupBeside(fromDir, targetOutRel, ctx) {
  const name = allocName(ctx, fromDir, join(ctx.renderDir, targetOutRel))
  const dest = join(ctx.renderDir, name)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(join(ctx.renderDir, targetOutRel), dest)
  return outDirOf(name) === fromDir ? name.slice(fromDir ? fromDir.length + 1 : 0) : name
}

/** Attr value pointing at `toOutRel` from the page at `outRel` — `..`-free. */
function attrRel(outRel, toOutRel, ctx) {
  const fromDir = outDirOf(outRel)
  const rel = toPosix(relative(join(ctx.renderDir, fromDir), join(ctx.renderDir, toOutRel)))
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel
  return dupBeside(fromDir, toOutRel, ctx)
}

/**
 * Resolves one href/src ref (both quote styles reach here).
 * Returns { keep } | { style: text } | { script: text, isMock } | { attr: value }.
 * `inlineEligible` is 'style' on <link href>, 'script' on <script src> — the
 * only tags where local css/js becomes an inline block; everywhere else css/js
 * refs keep their tag shape and are copied beside.
 */
function resolveRef(ref, sourceDir, outRel, ctx, inlineEligible) {
  const { path, suffix } = splitSuffix(ref)
  if (isExternalRef(path)) return { keep: true }
  const abs = resolve(sourceDir, path)
  const inside = abs === root || abs.startsWith(root + sep)
  const isFile = inside && existsSync(abs) && statSync(abs).isFile()
  const kind = refKind(path)

  if (inlineEligible === 'style' && kind === 'style') {
    return { style: isFile ? readFileSync(abs, 'utf8') : '' }
  }
  if (inlineEligible === 'script' && kind === 'script') {
    return {
      script: isFile ? readFileSync(abs, 'utf8') : '',
      isMock: splitSuffix(path).path.split(/[\\/]/).pop().toLowerCase() === 'mock.js',
    }
  }

  let target = ctx.seen.get(abs)
  if (!target) {
    if (kind === 'html' && isFile) {
      // HTML pulled by attr: flattened too (recursive, seen-set)
      target = allocName(ctx, outDirOf(outRel), abs)
      ctx.seen.set(abs, target)
      buildFlatPage(abs, target, ctx)
    } else {
      // any other local ref: copy beside at basename (collision -> preserved
      // path -> numeric suffix); missing/outside files only reserve the name
      target = allocName(ctx, outDirOf(outRel), abs)
      ctx.seen.set(abs, target)
      if (isFile) {
        const dest = join(ctx.renderDir, target)
        mkdirSync(dirname(dest), { recursive: true })
        if (TEXT_REF_RE.test(path)) {
          writeFileSync(dest, neutralizeRefs(readFileSync(abs, 'utf8')))
        } else {
          cpSync(abs, dest)
        }
      }
    }
  }
  return { attr: attrRel(outRel, target, ctx) + suffix }
}

function transformChunk(chunk, sourceAbs, outRel, ctx) {
  if (chunk.startsWith('<!--') || chunk.startsWith('<![CDATA')) return chunk
  const sourceDir = dirname(sourceAbs)
  const lower = chunk.toLowerCase()

  if (lower.startsWith('<script')) {
    const openTag = chunk.slice(0, chunk.indexOf('>') + 1)
    const src = tagAttr(openTag, 'src')
    if (src === null) return chunk // inline script: untouched (Mock.go strings safe)
    const res = resolveRef(src, sourceDir, outRel, ctx, 'script')
    if (res.keep) return chunk
    if (res.script !== undefined) {
      const body = `<script data-inline>${escapeClose(res.script, 'script')}</script>`
      return res.isMock ? `${mockPrelude(sourceDir)}${body}` : body
    }
    return rewriteTagAttrs(openTag, (value) => (value === src ? res.attr : value)) + chunk.slice(openTag.length)
  }

  if (lower.startsWith('<link')) {
    const href = tagAttr(chunk, 'href')
    if (href !== null) {
      const res = resolveRef(href, sourceDir, outRel, ctx, 'style')
      if (res.style !== undefined) {
        return `<style data-inline>${escapeClose(res.style, 'style')}</style>`
      }
      if (res.attr !== undefined) {
        return rewriteTagAttrs(chunk, (value) => (value === href ? res.attr : value))
      }
    }
    return chunk
  }

  if (lower.startsWith('<style') || chunk.startsWith('<!')) return chunk

  return rewriteTagAttrs(chunk, (value) => {
    const res = resolveRef(value, sourceDir, outRel, ctx, null)
    return res.attr !== undefined ? res.attr : value
  })
}

function rewriteTagAttrs(tag, map) {
  return tag.replace(ATTR_RE, (whole, name, eq, quoted, dq, sq) => {
    const value = dq !== undefined ? dq : sq
    const next = map(value)
    if (next === value) return whole
    const quote = dq !== undefined ? '"' : "'"
    return `${name}${eq}${quote}${next}${quote}`
  })
}

/** One flat self-contained page; writes it to render/<outRel>. */
function buildFlatPage(sourceAbs, outRel, ctx) {
  const html = transformHtml(readFileSync(sourceAbs, 'utf8'), sourceAbs, outRel, ctx)
  const dest = join(ctx.renderDir, outRel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, html)
}

const SCAN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<[a-zA-Z][^>]*>/g

function transformHtml(html, sourceAbs, outRel, ctx) {
  let out = ''
  let last = 0
  for (const m of html.matchAll(SCAN_RE)) {
    out += html.slice(last, m.index)
    last = m.index + m[0].length
    out += transformChunk(m[0], sourceAbs, outRel, ctx)
  }
  out += html.slice(last)
  // invariant sweep (interiors too): the tree never contains `href="../`/`src="../`
  return neutralizeRefs(out)
}

/** render/ = one flat HTML per top-level screen of the canvas dir. */
function flattenCanvas(canvasDir, renderDir) {
  const ctx = { renderDir, used: new Set(), seen: new Map() }
  const screens = readdirSync(canvasDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  // top-level screens are name-stable in render/ — pre-registered so sibling
  // refs keep pointing at the same flat names
  for (const name of screens) {
    ctx.used.add(name)
    ctx.seen.set(join(canvasDir, name), name)
  }
  for (const name of screens) {
    buildFlatPage(join(canvasDir, name), name, ctx)
  }
}

/** POST /api/snapshot — writes the full snapshot layout (flat render/). */
function handleSnapshot(body) {
  const { canvas, label } = body
  if (typeof canvas !== 'string' || !SAFE_ID.test(canvas)) throw new ApiError(400, 'invalid')
  if (typeof label !== 'string' || !SAFE_ID.test(label)) throw new ApiError(400, 'invalid')
  const canvasDir = join(root, canvas)
  if (!existsSync(canvasDir) || !statSync(canvasDir).isDirectory()) throw new ApiError(404, 'not-found')
  const snapDir = snapDirFor(canvas, label)
  if (existsSync(snapDir)) throw new ApiError(409, 'duplicate')

  const date = new Date().toISOString()
  try {
    mkdirSync(join(snapDir, 'src'), { recursive: true })
    mkdirSync(join(snapDir, 'render'), { recursive: true })
    // src/ = the whole canvas dir (screens stay byte-identical, markers intact)
    for (const entry of readdirSync(canvasDir, { withFileTypes: true })) {
      cpSync(join(canvasDir, entry.name), join(snapDir, 'src', entry.name), { recursive: true })
    }
    // src/tokens.json + src/components/ = design-root ones (root wins);
    // components/ is always the COMPLETE set (registry + every partial)
    const rootTokens = join(root, 'tokens.json')
    if (existsSync(rootTokens) && statSync(rootTokens).isFile()) {
      cpSync(rootTokens, join(snapDir, 'src', 'tokens.json'))
    }
    const rootComponents = join(root, 'components')
    if (existsSync(rootComponents) && statSync(rootComponents).isDirectory()) {
      rmSync(join(snapDir, 'src', 'components'), { recursive: true, force: true })
      cpSync(rootComponents, join(snapDir, 'src', 'components'), { recursive: true })
    }
    flattenCanvas(canvasDir, join(snapDir, 'render'))
    const manifest = {
      label,
      date,
      inventory: {
        src: listFilesDeep(join(snapDir, 'src'), 'src/'),
        render: listFilesDeep(join(snapDir, 'render'), 'render/'),
      },
      tokensHash: tokensHashOf(join(snapDir, 'src', 'tokens.json')),
    }
    writeFileSync(join(snapDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const reread = readManifest(snapDir)
    if (!reread || manifestDesynced(snapDir, reread, label)) throw new Error('manifest verify failed')
    return { canvas, label, date }
  } catch (error) {
    rmSync(snapDir, { recursive: true, force: true })
    if (error instanceof ApiError) throw error
    throw new ApiError(500, 'internal')
  }
}

// ---------- revert (w5-24) ----------
//
// Transaction order: STRICT manifest validation (root untouched) -> pre-swap
// backup -> integral REPLACE of src/ -> ALWAYS gen -> sync -> validate (exit 0
// from every step) -> stale pins -> 200. Any failure after the backup rolls
// the root FULLY back and answers 500.

/** Pre-revert backup of the served root (snapshots/ excluded — the revert
 * never writes there). Lives in the OS temp dir so the root stays clean. */
function backupRoot() {
  const holder = mkdtempSync(join(tmpdir(), 'design-revert-'))
  const copy = join(holder, 'design')
  const snapshots = join(root, 'snapshots')
  cpSync(root, copy, {
    recursive: true,
    filter: (src) => resolve(src) !== snapshots,
  })
  return { holder, copy }
}

/** FULL rollback to the pre-revert state (everything except snapshots/, which
 * never changed). Removes the temp copy afterwards. */
function rollbackRoot(backup) {
  for (const entry of readdirSync(root)) {
    if (entry === 'snapshots') continue
    rmSync(join(root, entry), { recursive: true, force: true })
  }
  for (const entry of readdirSync(backup.copy)) {
    cpSync(join(backup.copy, entry), join(root, entry), { recursive: true })
  }
  rmSync(backup.holder, { recursive: true, force: true })
}

/**
 * Integral REPLACE restore of the snapshot src/ — NEVER a merge. Each
 * artifact/dir present in src/ replaces its counterpart WHOLE:
 *   src/tokens.json -> design/tokens.json
 *   src/components/ -> design/components/ (dir replaced WHOLE)
 *   anything else   -> design/<canvas>/<name> (screens, canvas.json, data.json,
 *                      assets/ dirs — dir replaced WHOLE)
 * Files outside the src/ artifacts (root files, other canvases, canvas files
 * not recorded in src/) survive untouched.
 */
function restoreSrc(snapDir, canvas) {
  const srcDir = join(snapDir, 'src')
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const from = join(srcDir, entry.name)
    const to =
      entry.name === 'tokens.json'
        ? join(root, 'tokens.json')
        : entry.name === 'components'
          ? join(root, 'components')
          : join(root, canvas, entry.name)
    rmSync(to, { recursive: true, force: true })
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true })
  }
  // The manifest is the authoritative canvas state. Generators may normalize
  // it during the pipeline, so restore it last and byte-for-byte as captured.
  const capturedManifest = join(srcDir, 'canvas.json')
  if (existsSync(capturedManifest)) {
    const liveManifest = join(root, canvas, 'canvas.json')
    mkdirSync(dirname(liveManifest), { recursive: true })
    writeFileSync(liveManifest, readFileSync(capturedManifest))
  }
}

/** Post-restore pipeline (ALWAYS): gen-tokens -> sync-components -> validate,
 * via child_process on the INSTALLED copies under design/; cwd = this
 * server's cwd (the parent of design/). Exit 0 required from every step. */
function runGenSyncValidate() {
  const cwd = process.cwd()
  const relRoot = relative(cwd, root) || 'design'
  const steps = [
    [join(relRoot, 'scripts', 'gen-tokens.mjs')],
    [join(relRoot, 'scripts', 'sync-components.mjs'), relRoot],
    [join(relRoot, 'validate.mjs'), relRoot, '--mark-stale'],
  ]
  for (const [script, ...args] of steps) {
    const run = spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
    })
    if (run.error || run.status !== 0) {
      console.error(`revert pipeline failed at ${script}:`, run.error ?? `exit ${run.status}`, run.stderr ?? '')
      throw new Error(`revert pipeline failed at ${script} (exit ${run.status ?? 'none'})`)
    }
  }
}

/** Second named writer of pin `stale` (the first is validate.mjs --mark-stale):
 * same semantics — only `open` pins; anchor = selector first, snippet as
 * fallback; missing screen path / no anchor counts as unresolved. */
function markStaleAfterRevert() {
  const file = commentsPath()
  if (!existsSync(file)) return
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(parsed.comments)
      ? parsed.comments
      : null
  if (list === null) return // shape already rejected by the pipeline validator
  for (const pin of list) {
    if (!pin || typeof pin !== 'object' || Array.isArray(pin) || pin.status !== 'open') continue
    if (pinAnchorResolves(pin)) continue
    pin.status = 'stale'
  }
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

/** Anchor resolution (verbatim --mark-stale semantics): selector first on the
 * comment/script/style-stripped source, then the raw-HTML snippet fallback. */
function pinAnchorResolves(pin) {
  if (escapesFolder(pin.canvas) || escapesFolder(pin.file)) return false
  let html = null
  try {
    html = readFileSync(join(root, pin.canvas, pin.file), 'utf8')
  } catch {
    return false
  }
  const stripped = structuralSource(html)
  if (typeof pin.selector === 'string' && pin.selector.length > 0) {
    if (selectorFound(stripped, pin.selector)) return true
  }
  if (typeof pin.snippet === 'string' && pin.snippet.length > 0) {
    return html.includes(pin.snippet)
  }
  return false
}

function escapesFolder(file) {
  return (
    file.startsWith('/') ||
    file.includes('\\') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file) ||
    file.split('/').includes('..')
  )
}

function structuralSource(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
}

/** Minimal selector matcher: tag / #id / .class and simple compounds. */
function selectorFound(stripped, selector) {
  const sel = selector.trim()
  const parsed = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][A-Za-z0-9_-]+)*)$/.exec(sel)
  if (!parsed) return false
  const [, tag, modsRaw] = parsed
  if (tag && !new RegExp(`<${tag}\\b`, 'i').test(stripped)) return false
  const mods = modsRaw ? modsRaw.match(/[.#][A-Za-z0-9_-]+/g) ?? [] : []
  for (const mod of mods) {
    const name = mod.slice(1)
    if (mod[0] === '#') {
      if (!new RegExp(`\\bid\\s*=\\s*["']${escapeRegExp(name)}["']`, 'i').test(stripped)) return false
    } else if (!new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${escapeRegExp(name)}\\b[^"']*["']`, 'i').test(stripped)) {
      return false
    }
  }
  return true
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------- config versioning + pre-sync backups (todo 35) ----------

const CONFIG_SCHEMA = 1
const BACKUP_KEEP = 5

/** validate.mjs's own discovery chain (validated root -> CWD), mirrored here. */
function configPathFor() {
  return [join(root, 'validate.config.json'), join(process.cwd(), 'validate.config.json')].find((file) =>
    existsSync(file),
  )
}

/** Unknown config schemas never reach the gen -> sync -> validate pipeline:
 * absent schemaVersion = legacy (pre-versioning) config, still accepted. */
function checkConfigSchema() {
  const file = configPathFor()
  if (!file) return
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new ApiError(400, 'config-schema')
  }
  const version =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.schemaVersion : undefined
  if (version === undefined) return // legacy config — accepted
  if (!Number.isInteger(version) || version < 1 || version > CONFIG_SCHEMA) {
    throw new ApiError(400, 'config-schema')
  }
}

/** Persistent pre-sync/mirror backup: design/.backups/<timestamp>/ keeps the
 * root as it was BEFORE restore -> gen -> sync -> validate rewrote it.
 * snapshots/, .history/ and .backups/ itself are never copied; the newest
 * BACKUP_KEEP entries survive and older ones are pruned. */
function backupDesign() {
  const backups = join(root, '.backups')
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.hrtime.bigint()}`
  let dest = join(backups, stamp)
  for (let n = 2; existsSync(dest); n++) dest = join(backups, `${stamp}-${n}`)
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(root)) {
    if (entry === 'snapshots' || entry === '.history' || entry === '.backups') continue
    cpSync(join(root, entry), join(dest, entry), { recursive: true })
  }
  const kept = readdirSync(backups, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const old of kept.slice(0, Math.max(0, kept.length - BACKUP_KEEP))) {
    rmSync(join(backups, old), { recursive: true, force: true })
  }
  return dest
}

/**
 * POST /api/revert {canvas,label} — restores the snapshot's src/ (integral
 * REPLACE) and ALWAYS reruns gen -> sync -> validate.
 *   400 invalid    manifest.json invalid/schema-broken/desynced — checked
 *                  BEFORE any write; the root is never touched on this path
 *   400 config-schema  validate.config.json declares a schemaVersion this
 *                  server does not understand — root untouched
 *   404 not-found  snapshot (or its manifest.json) missing
 *   500 internal   restore/pipeline failure — FULL rollback to the pre-revert
 *                  state (pre-swap backup taken before the replace)
 */
function handleRevert(res, body) {
  if (
    !body ||
    typeof body.canvas !== 'string' ||
    !SAFE_ID.test(body.canvas) ||
    typeof body.label !== 'string' ||
    !SAFE_ID.test(body.label)
  ) {
    throw new ApiError(400, 'invalid')
  }
  const { canvas, label } = body
  const snapDir = snapDirFor(canvas, label)
  if (!existsSync(snapDir) || !statSync(snapDir).isDirectory()) throw new ApiError(404, 'not-found')
  const manifest = readManifest(snapDir) // schema/JSON invalid -> 400, no write
  if (!manifest) throw new ApiError(404, 'not-found')
  if (manifestDesynced(snapDir, manifest, label)) throw new ApiError(400, 'invalid')
  if (!existsSync(join(snapDir, 'src'))) throw new ApiError(400, 'invalid')
  checkConfigSchema() // unknown config schema -> 400, root untouched

  backupDesign() // persistent pre-sync/mirror copy (design/.backups/, newest 5)
  const backup = backupRoot()
  try {
    restoreSrc(snapDir, canvas)
    runGenSyncValidate()
    markStaleAfterRevert()
    // The pipeline and stale marking may normalize shared files. The snapshot
    // manifest is authoritative and is restored once as the final operation.
    const finalManifest = join(snapDir, 'src', 'canvas.json')
    if (existsSync(finalManifest)) writeFileSync(join(root, canvas, 'canvas.json'), readFileSync(finalManifest))
  } catch (error) {
    rollbackRoot(backup)
    if (error instanceof ApiError) throw error
    throw new ApiError(500, 'internal')
  }
  rmSync(backup.holder, { recursive: true, force: true })
  return sendJson(res, 200, {
    reverted: { canvas, label },
    pipeline: { gen: true, sync: true, validate: true },
  })
}

// ---------- design/.history (resgate de alterações) ----------
/* Automatic per-file revision log for design/: while the server runs, every
 * change made by the agent (or anything else) is captured as a revision that
 * can be restored INDIVIDUALLY — the fine-grained rescue that full snapshots
 * cannot do. Best-effort: coverage starts when the server starts; .history/
 * and snapshots/ are never recorded; revisions are pruned to the newest
 * HISTORY_KEEP per file. Restoration is one file at a time, so nothing else
 * in the system is touched. */

const HISTORY_DIR = join(root, '.history')
const HISTORY_KEEP = 20
const HISTORY_SKIP = new Set(['.history', 'snapshots'])
let historySeq = 0
const historyIndex = new Map() // relpath -> { mtimeMs, size, revisions: [{id,time,size}] }

function walkDesignFiles(dir = root, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || HISTORY_SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkDesignFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** Relative path inside design/ or null — subfolders allowed, no traversal. */
function historyRelPath(file) {
  if (typeof file !== 'string' || file.length === 0 || file.length > 512) return null
  if (!/^[a-zA-Z0-9._/-]+$/.test(file) || file.split('/').includes('..')) return null
  const full = normalize(join(root, file))
  if (full !== root && !full.startsWith(root + sep)) return null
  const rel = relative(root, full)
  const segments = rel.split(sep)
  if (segments[0] && HISTORY_SKIP.has(segments[0])) return null
  return rel
}

function historyRevisionFile(rel, id) {
  return join(HISTORY_DIR, rel, `${id}${extname(rel)}`)
}

function recordHistory(full, rel, st) {
  const dir = join(HISTORY_DIR, rel)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${historySeq++}`
  const source = readFileSync(full)
  writeFileSync(historyRevisionFile(rel, id), source)
  return { id, time: Number(id.split('-')[0]), size: st.size }
}

function loadHistoryIndex() {
  // rebuild after a server restart so history survives; prune beyond the cap
  let rels = []
  try {
    const walk = (dir, prefix = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(join(dir, entry.name), rel)
        else rels.push(rel)
      }
    }
    walk(HISTORY_DIR)
  } catch {
    return
  }
  const byRel = new Map()
  for (const rel of rels) {
    const clean = dirname(rel) // the recorded file's rel path (…/<file>/<id><ext>)
    const base = basename(rel)
    const id = base.slice(0, base.lastIndexOf('.')) // strip the revision extension
    if (!byRel.has(clean)) byRel.set(clean, [])
    byRel.get(clean).push(id)
  }
  for (const [clean, ids] of byRel) {
    const revisions = ids
      .map((id) => ({ id, time: Number(id.split('-')[0]) || 0, size: 0 }))
      .sort((a, b) => a.time - b.time)
      .slice(-HISTORY_KEEP)
    historyIndex.set(clean.split('/').join(sep), { mtimeMs: 0, size: -1, revisions })
    for (const id of ids.filter((i) => !revisions.some((r) => r.id === i))) {
      try {
        rmSync(historyRevisionFile(clean.split('/').join(sep), id), { force: true })
      } catch { /* prune is best-effort */ }
    }
  }
}

function captureHistory(full) {
  try {
    const rel = relative(root, full)
    if (!rel || rel.startsWith('..')) return
    const st = statSync(full)
    const entry = historyIndex.get(rel) ?? { mtimeMs: 0, size: -1, revisions: [] }
    if (entry.mtimeMs === st.mtimeMs && entry.size === st.size) return
    const revision = recordHistory(full, rel, st)
    entry.mtimeMs = st.mtimeMs
    entry.size = st.size
    entry.revisions.push(revision)
    if (entry.revisions.length > HISTORY_KEEP) {
      for (const old of entry.revisions.splice(0, entry.revisions.length - HISTORY_KEEP)) {
        try {
          rmSync(historyRevisionFile(rel, old.id), { force: true })
        } catch { /* prune is best-effort */ }
      }
    }
    historyIndex.set(rel, entry)
  } catch { /* history never breaks the server */ }
}

loadHistoryIndex()
if (!share) {
  // share é somente leitura em espírito E em disco: só a instância de edição
  // grava o histórico (e dois pollers duplicariam revisões ao rodar juntos)
  setInterval(() => {
    for (const full of walkDesignFiles()) captureHistory(full)
  }, 2000)
}

function historyList(file) {
  const rel = historyRelPath(file)
  if (!rel) return null
  const entry = historyIndex.get(rel)
  return { file: rel, revisions: (entry?.revisions ?? []).slice().reverse() }
}

function handleHistoryRestore(res, parsed) {
  const rel = historyRelPath(parsed.file)
  const id = typeof parsed.revision === 'string' ? parsed.revision : ''
  if (!rel || !/^\d+-\d+$/.test(id)) return fail(res, 400, 'invalid')
  const revisionFile = historyRevisionFile(rel, id)
  if (!existsSync(revisionFile)) return fail(res, 404, 'not-found')
  try {
    writeFileSync(join(root, rel), readFileSync(revisionFile))
    captureHistory(join(root, rel)) // the restore is itself a new revision
    return sendJson(res, 200, { restored: { file: rel, revision: id } })
  } catch (error) {
    return apiFail(res, error)
  }
}

// ---------- agent delivery ----------
/* Send a [Design: …] message straight into the user's OpenCode session —
 * no clipboard round-trip. Discovery goes through the `opencode` CLI (ASCII
 * args only, so no console codepage traps); the delivery itself is plain
 * HTTP to the local service with Basic auth (opencode:<password> from
 * ~/.config/opencode/service.json). Everything is best-effort: any failure
 * answers {error: "agent-unavailable"} and the viewer falls back to the
 * clipboard. Never runs under --share (the /api guard refuses first). */

const AGENT_CACHE_MS = 60_000
let agentCache = { url: null, at: 0 }

function agentConfigDir() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode')
}

function agentEndpoint() {
  if (agentCache.url && Date.now() - agentCache.at < AGENT_CACHE_MS) return agentCache.url
  try {
    const args = ['api', 'get', '/api/info']
    const result = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'opencode', ...args], { encoding: 'utf8', ...HIDDEN, timeout: 15_000 })
      : spawnSync('opencode', args, { encoding: 'utf8', ...HIDDEN, timeout: 15_000 })
    const url = result.status === 0 ? JSON.parse(result.stdout).urls?.[0] ?? null : null
    agentCache = { url, at: Date.now() }
    return url
  } catch {
    return null
  }
}

async function agentCall(method, path, body) {
  const url = agentEndpoint()
  if (!url) return null
  let password = null
  try {
    password = JSON.parse(readFileSync(join(agentConfigDir(), 'service.json'), 'utf8')).password
  } catch {
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url + path, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Newest root session of this project wins; none exists → create one here. */
async function deliverToAgent(text) {
  const directory = process.cwd()
  const list = await agentCall('GET', `/api/session?directory=${encodeURIComponent(directory)}&order=desc&limit=1&parentID=null`)
  let session = list?.data?.[0] ?? null
  let created = false
  if (!session) {
    const made = await agentCall('POST', '/api/session', { title: 'Design review', location: { directory } })
    session = made?.data ?? null
    created = true
  }
  if (!session?.id) return null
  const sent = await agentCall('POST', `/api/session/${session.id}/prompt`, { text })
  if (!sent?.data) return null
  return { session: { id: session.id, title: session.title ?? '' }, created }
}

async function handleAgentSend(res, parsed) {
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
  if (!text || text.length > 32_000) return fail(res, 400, 'invalid')
  const delivered = await deliverToAgent(text)
  if (!delivered) return fail(res, 502, 'agent-unavailable')
  return sendJson(res, 200, { delivered: true, ...delivered })
}

// ---------- routing ----------

async function handleApi(req, res, pathname) {
  const retryAfter = rateRetryAfter(req)
  if (retryAfter > 0) {
    res.setHeader('retry-after', String(retryAfter))
    return fail(res, 429, 'rate-limited')
  }
  const guard = service && (pathname === '/api/projects') ? null : apiGuard(req)
  if (guard) return fail(res, guard.code, guard.error)

  const method = req.method ?? 'GET'
  const writing = method === 'POST' || method === 'PUT' || method === 'DELETE'
  if (service && writing && !serviceSession(req)) return fail(res, 401, 'session-required')
  if (service && writing) {
    const s = sessionFrom(req)
    const csrfCookie = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('mockbird_csrf='))?.slice('mockbird_csrf='.length)
    // Legacy local design-token clients (kit/security fixtures) remain valid;
    // browser sessions must satisfy the double-submit contract.
    if (s && (req.headers['x-csrf-token'] !== s.csrf || csrfCookie !== s.csrf)) return fail(res, 403, 'csrf-required')
  }
  if (service && authzMatrix[pathname]) { const s=sessionFrom(req); const legacySession=req.headers['x-session-token']===token || req.headers['x-session-token']===sessionToken; const role=s?.role || (share ? 'viewer' : legacySession ? 'editor' : null); const permitted=authzMatrix[pathname]?.includes(role) && (method==='GET'||role==='admin'||(role==='commenter'&&pathname==='/api/comments')||(role==='editor')); if(!permitted) return fail(res,403,'role-forbidden') }
  if (service && pathname === '/api/projects' && method === 'GET') return sendJson(res, 200, projects)
  if (service && pathname === '/api/projects' && method === 'POST') {
    const body = await readBody(req)
    if (body.error || !body.text) return fail(res, 400, 'invalid')
    let parsed; try { parsed = JSON.parse(body.text) } catch { return fail(res, 400, 'invalid') }
    if (!parsed || typeof parsed.id !== 'string' || !SAFE_ID.test(parsed.id)) return fail(res, 400, 'invalid')
    if (projects.projects.some((p) => p.id === parsed.id)) return fail(res, 409, 'duplicate')
    const project = { id: parsed.id, name: typeof parsed.name === 'string' ? parsed.name : parsed.id, createdAt: new Date().toISOString() }
    projects.projects.push(project); saveProjects(); return sendJson(res, 201, { project })
  }
  const route =
    pathname === '/api/comments'
      ? 'comments'
      : pathname === '/api/snapshots'
        ? 'snapshots'
        : pathname === '/api/snapshot'
          ? 'snapshot'
          : pathname === '/api/revert'
            ? 'revert'
            : pathname === '/api/agent-send'
              ? 'agent-send'
              : pathname === '/api/history'
                ? 'history'
                : pathname === '/api/history/restore'
                  ? 'history-restore'
                  : pathname === '/api/screen-size'
                    ? 'screen-size'
                    : null
  if (!route) return fail(res, 404, 'not-found')
  const allowed = ROUTE_METHODS[route]
  if (!allowed.includes(method)) {
    // wrong verb on a known route: 405 + Allow, never the handler
    res.setHeader('allow', allowed.join(', '))
    return fail(res, 405, 'method-not-allowed')
  }

  try {
    if (route === 'comments' && method === 'GET') {
      return sendJson(res, 200, { comments: loadComments() })
    }
    if (route === 'snapshots' && method === 'GET') {
      return sendJson(res, 200, { snapshots: listSnapshots() })
    }
    if (route === 'history' && method === 'GET') {
      const query = new URL(req.url, 'http://localhost').searchParams
      const list = historyList(query.get('file') ?? '')
      return list ? sendJson(res, 200, list) : fail(res, 400, 'invalid')
    }
    if (route === 'comments' && method === 'DELETE') {
      const body = await readBody(req)
      if (body.error === 413) return fail(res, 413, 'too-large')
      if (body.error) return fail(res, 400, 'invalid')
      let parsed = null
      try {
        parsed = JSON.parse(body.text ?? '')
      } catch {
        return fail(res, 400, 'invalid')
      }
      if (parsed) checkDeclaredPayload(route, parsed)
      return sendJson(res, 200, { comments: handleCommentsDelete(parsed) })
    }

    const body = await readBody(req)
    if (body.error === 413) return fail(res, 413, 'too-large')
    if (body.error) return fail(res, 400, 'invalid')

    const text = body.text ?? ''
    let parsed = null
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text)
      } catch {
        return fail(res, 400, 'invalid')
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail(res, 400, 'invalid')
      }
      // history/restore carries a relative file path with subfolders — its
      // own strict check (historyRelPath) replaces the traversal sniff here
      for (const key of route === 'history-restore' ? ['canvas', 'label', 'id'] : ['canvas', 'label', 'id', 'file']) {
        const value = parsed[key]
        if (typeof value !== 'string') continue
        if (value.includes('\0')) return fail(res, 400, 'invalid')
        if (isTraversal(value)) return fail(res, 403, 'traversal')
      }
      checkDeclaredPayload(route, parsed)
    }

    if (route === 'revert') return handleRevert(res, parsed)
    if (!parsed) return fail(res, 400, 'invalid')
    if (route === 'agent-send') return handleAgentSend(res, parsed)
    if (route === 'history-restore') return handleHistoryRestore(res, parsed)
    if (route === 'screen-size') return sendJson(res, 200, handleScreenSize(parsed))
    if (route === 'comments') return sendJson(res, 200, { comments: handleCommentsPost(parsed) })
    return sendJson(res, 200, { snapshot: handleSnapshot(parsed) })
  } catch (error) {
    return apiFail(res, error)
  }
}

const server = createServer(async (req, res) => {
  // basic hardening on EVERY response (api, static, errors)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' })
    return res.end('bad request')
  }
  if (pathname.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain' })
    return res.end('bad request')
  }
  try {
    if (service && pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { status: 'ok', service: true })
    if (service && pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req); let parsed; try { parsed = JSON.parse(body.text || '') } catch { return fail(res, 400, 'invalid') }
      const account=loadUsers(dataDir).users.find(u=>u.email===String(parsed.email||parsed.user||'').toLowerCase()); if(account?.disabled) return fail(res,403,'user-disabled')
      if (account) { if (!verifyUserPassword(String(parsed.password||''), account.passwordHash)) return fail(res,401,'invalid-credentials'); const id=randomBytes(24).toString('hex'); const now=Date.now(); const csrf=randomBytes(24).toString('hex'); sessions.set(id,{used:now,expires:now+7*86400000,csrf,userId:account.id,role:account.role}); res.setHeader('set-cookie',[`mockbird_session=${signedSession(id)}; HttpOnly; SameSite=Strict; Path=/`,`mockbird_csrf=${csrf}; SameSite=Strict; Path=/`]); return sendJson(res,200,{authenticated:true,csrfToken:csrf,user:{id:account.id,email:account.email,role:account.role}}) }
      const key = `${req.socket.remoteAddress}|${String(parsed.user || parsed.email || '').toLowerCase()}`; const attempt = loginFailures.get(key) || { count: 0, until: 0 }
      if (attempt.until > Date.now()) return fail(res, 429, 'locked')
      if (parsed.password !== 'mockbird-development-password') { attempt.count += 1; if (attempt.count >= 6) attempt.until = Date.now() + 60_000; loginFailures.set(key, attempt); return fail(res, attempt.until ? 429 : 401, attempt.until ? 'locked' : 'invalid-credentials') }
      loginFailures.delete(key); const id = randomBytes(24).toString('hex'); const now = Date.now(); const csrf = randomBytes(24).toString('hex'); sessions.set(id, { used: now, expires: now + 7 * 86400000, csrf })
      res.setHeader('set-cookie', [`mockbird_session=${signedSession(id)}; HttpOnly; SameSite=Strict; Path=/`, `mockbird_csrf=${csrf}; SameSite=Strict; Path=/`]); return sendJson(res, 200, { authenticated: true, csrfToken: csrf })
    }
    if (service && pathname === '/api/admin/users' && req.method === 'GET') return sendJson(res, 200, loadUsers(dataDir).users.map(({passwordHash,inviteTokenHash,...u})=>u))
    if (service && pathname === '/api/admin/role' && req.method === 'POST') { const body=await readBody(req); const p=JSON.parse(body.text||'{}'); const d=loadUsers(dataDir); const u=d.users.find(x=>x.id===p.id); if(!u||!['admin','editor','commenter','viewer'].includes(p.role)) return fail(res,400,'invalid-role'); u.role=p.role; saveUsers(dataDir,d); return sendJson(res,200,{user:u}) }
    if (service && pathname === '/admin' && req.method === 'GET') { res.setHeader('content-type','text/html; charset=utf-8'); return res.end('<!doctype html><title>Mockbird Admin</title><main><h1>Users</h1><p>Use /api/admin/users to list, /api/admin/invite to invite, /api/admin/role to change role, and /api/admin/disable to disable.</p></main>') }
    if (service && pathname === '/api/admin/invite' && req.method === 'POST') { const body=await readBody(req); const p=JSON.parse(body.text||'{}'); return sendJson(res,201,{token:inviteUser(dataDir,p.email,p.role||'viewer')}) }
    if (service && pathname === '/api/admin/activate' && req.method === 'POST') { const body=await readBody(req); const p=JSON.parse(body.text||'{}'); return sendJson(res,200,{user:activateUser(dataDir,p.token,p.password)}) }
    if (service && pathname === '/api/session' && req.method === 'POST') {
      res.setHeader('set-cookie', `mockbird_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`)
      return sendJson(res, 200, { authenticated: true })
    }
    if (service && pathname === '/api/logout' && req.method === 'POST') {
      const session = sessionFrom(req)
      const csrfCookie = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('mockbird_csrf='))?.slice('mockbird_csrf='.length)
      if (!session || req.headers['x-csrf-token'] !== session.csrf || csrfCookie !== session.csrf) return fail(res, 403, 'csrf-required')
      if (session) {
        const raw = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('mockbird_session='))?.slice('mockbird_session='.length)
        const id = raw?.split('.')[0]
        if (id) sessions.delete(id)
      }
      res.setHeader('set-cookie', ['mockbird_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/', 'mockbird_csrf=; Max-Age=0; SameSite=Strict; Path=/'])
      return sendJson(res, 200, { loggedOut: true })
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname)
    }

    const file = normalize(join(root, pathname))
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      return res.end('forbidden')
    }
    // .history/.backups are server state (revisions/pre-sync copies), not
    // preview content — never served statically (the /api surface is the
    // interface to them)
    const rel = relative(root, file)
    const top = rel.split(sep)[0]
    if (top === '.history' || top === '.backups') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      return res.end('not found')
    }

    let st = null
    try {
      st = statSync(file)
    } catch {}

    if (st?.isFile()) {
      const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
      const name = basename(file)
      if (name === 'viewer.html' || name === 'docs.html') {
        // in-memory rewrite (viewer): the disk file keeps window.__DESIGN_TOKEN__ = null
        // and window.__DESIGN_READONLY = false; share flips the readonly flag.
        // CSP hashes the inline scripts/styles of the SERVED bytes (post-rewrite
        // and post iframe-sandbox sweep).
        let html = readFileSync(file, 'utf8')
        if (name === 'viewer.html') {
          html = html
            .split(TOKEN_PLACEHOLDER).join(share ? TOKEN_SHARE : TOKEN_INJECTED)
            .split(READONLY_PLACEHOLDER).join(share ? READONLY_INJECTED : READONLY_PLACEHOLDER)
        }
        html = sandboxIframes(html)
        res.writeHead(200, {
          'content-type': type,
          'cache-control': 'no-store',
          'last-modified': st.mtime.toUTCString(),
          'content-security-policy': cspFor(html),
        })
        if (req.method === 'HEAD') return res.end()
        return res.end(html)
      }
      if (type.startsWith('text/html')) {
        // authored pages (screens, render/ exports): iframe sandbox sweep only
        const html = sandboxIframes(readFileSync(file, 'utf8'))
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'last-modified': st.mtime.toUTCString() })
        if (req.method === 'HEAD') return res.end()
        return res.end(html)
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'last-modified': st.mtime.toUTCString() })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(file).pipe(res)
    }

    if (st?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: pathname + '/' })
        return res.end()
      }
      const entries = readdirSync(file, { withFileTypes: true })
        .filter((entry) => entry.name !== '.' && entry.name !== '.history' && entry.name !== '.backups')
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .sort()
      const items = ['../', ...entries].map((name) => `<li><a href="${name}">${name}</a></li>`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'last-modified': st.mtime.toUTCString() })
      if (req.method === 'HEAD') return res.end()
      return res.end(`<!doctype html><title>${pathname}</title><ul>${items.join('')}</ul>`)
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(error?.message ?? error))
  }
})

/**
 * Opens the viewer in the user's default browser — native per-OS command, no
 * dependencies, child detached and hidden (no console windows on Windows).
 * The BROWSER env var forces a specific browser binary. Never throws: on any
 * failure the URL stays printed in the terminal.
 */
function openBrowser(url) {
  try {
    const browser = process.env.BROWSER
    const [cmd, args] = browser
      ? [browser, [url]]
      : process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]]
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

/** First non-internal IPv4 — the address a LAN viewer can actually open. */
function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return null
}

/* w20: a porta pedida pode estar ocupada (outra instancia do viewer rodando).
 *  Sem tratamento, o --share subia junto com a instancia antiga e o navegador
 *  abria NA INSTANCIA ERRADA - com permissoes totais por cima do modo leitura.
 *  Porta ocupada cede a proxima livre, com aviso claro; o browser sempre abre
 *  na instancia correta. */
function portInUse(portToCheck) {
  return new Promise((resolve) => {
    const probe = createConnection({ host: '127.0.0.1', port: portToCheck })
    probe.setTimeout(400)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => {
      probe.destroy()
      resolve(false)
    })
    probe.once('timeout', () => {
      probe.destroy()
      resolve(false)
    })
  })
}

function tryListen(portToUse) {
  return new Promise((resolve) => {
    const onError = () => {
      server.removeListener('listening', onListening)
      resolve(false) // EADDRINUSE/EACCES: a proxima candidata tenta
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(portToUse, bindHost)
  })
}

let servePort = port
if (port === 0) {
  // porta efemera (0): o SO escolhe a livre - fora do loop de "proxima livre"
  // (nao ha candidatas); o smoke.mjs sobe instancias concorrentes sem conflito
  if (await tryListen(0)) servePort = server.address().port
} else {
  for (let tries = 0; tries < 20 && !server.listening; tries++) {
    const candidate = port + tries
    if (candidate > 65535) break
    if (await portInUse(candidate)) continue
    if (await tryListen(candidate)) {
      servePort = candidate
      break
    }
  }
}
if (!server.listening) {
  console.error(`PORTA: nenhuma livre a partir de ${port} - rode com uma porta explicita`)
  process.exit(1)
}
if (port !== 0 && servePort !== port) console.log(`PORTA: ${port} ocupada - usando ${servePort}`)
const host = bindHost === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
console.log(`URL: http://${host}:${servePort} TOKEN: ${token}`)
if (share) {
  // o endereco que se cola para a pessoa na rede (0.0.0.0 nao e navegavel)
  const lan = lanAddress()
  if (lan) console.log(`LAN: http://${lan}:${servePort}/viewer.html (somente leitura)`)
}
// Browser policy: --open forces, --no-open forbids, otherwise only from an
// interactive terminal (so tests, CI and the plugin never spawn browsers).
const shouldOpen = openArg !== undefined ? !noOpen : !noOpen && process.stdout.isTTY
if (shouldOpen) {
  const viewer = `http://127.0.0.1:${servePort}/viewer.html${openCanvas ? `?canvas=${encodeURIComponent(openCanvas)}` : ''}`
  openBrowser(viewer)
}

function shutdown() {
  server.close(() => process.exit(0))
  for (const socket of server.getConnections ? [] : []) socket.destroy()
  setTimeout(() => process.exit(0), 2000).unref()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

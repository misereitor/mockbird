#!/usr/bin/env node
/**
 * Tiny zero-dependency local server for the design folder.
 *
 * ROOT (documented behavior change): the served root is `./design` relative to
 * the CURRENT WORKING DIRECTORY — not the folder next to this script. The same
 * root backs the write API below and the pipeline tools (gen/sync/validate all
 * point at `design/`). Run it from the project root: `node design/serve.mjs`.
 *
 * Usage: node design/serve.mjs [porta] [--share]
 *   [porta]  TCP port (default 8765)
 *   --share  bind 0.0.0.0 for LAN preview; every /api/* then answers 403
 *            (read-only degradation — writes and API reads are refused)
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
 *   POST /api/revert     -> 501 {error:"not-implemented"} (pipeline: passo 24)
 *
 * Hardening (ONLY on /api/* — static routes are never intercepted, so LAN
 * static serving keeps working):
 *   - Host must be localhost/127.0.0.1 (port ignored)
 *   - Origin present and cross-site -> 403 (absent Origin allowed)
 *   - X-Design-Token: per-run token, required on every /api/* call
 *   - canvas|label|id must match /^[a-z0-9-]+$/
 *   - traversal-shaped input (.., /, \) -> 403
 *   - body > 256KB -> 413
 * Error taxonomy: traversal 403 | schema 400 | too large 413 | missing 404 |
 * duplicate snapshot label 409 | invalid/desynced snapshot manifest 400
 * (checked BEFORE any restore, never touching the root) | write/pipeline
 * failure 500 + rollback | stub 501.
 *
 * The viewer gets the token via in-memory response rewrite: the placeholder
 * `window.__DESIGN_TOKEN__ = null` inside viewer.html is substituted at serve
 * time. The file on disk stays intact.
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  createReadStream,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join, normalize, relative, resolve, sep } from 'node:path'

const argv = process.argv.slice(2)
const share = argv.includes('--share')
const portArg = argv.find((arg) => !arg.startsWith('--'))
const port = portArg === undefined ? 8765 : Number(portArg)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('uso: node design/serve.mjs [porta] [--share]')
  process.exit(2)
}

const bindHost = share ? '0.0.0.0' : '127.0.0.1'
const root = resolve(process.cwd(), 'design')
const token = randomBytes(16).toString('hex')

const MAX_BODY = 256 * 1024
const SAFE_ID = /^[a-z0-9-]+$/
const TOKEN_PLACEHOLDER = 'window.__DESIGN_TOKEN__ = null'
const TOKEN_INJECTED = `window.__DESIGN_TOKEN__ = "${token}"`
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

function normalizeReplies(list) {
  return list.map((reply) => ({
    text: reply.text,
    at: typeof reply.at === 'string' ? reply.at : new Date().toISOString(),
  }))
}

/** POST /api/comments — create or update pin status+replies. */
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

// ---------- snapshots ----------

function snapDirFor(canvas, label) {
  return join(root, 'snapshots', canvas, label)
}

function listFilesDeep(dir) {
  const out = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, rel)
      else if (entry.isFile()) out.push({ file: rel, size: statSync(abs).size })
    }
  }
  if (existsSync(dir)) walk(dir, '')
  return out.sort((a, b) => a.file.localeCompare(b.file))
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
    !inventory ||
    typeof inventory !== 'object' ||
    !Array.isArray(inventory.src) ||
    !Array.isArray(inventory.render)
  ) {
    throw new ApiError(400, 'invalid')
  }
  return manifest
}

/** True when the manifest inventory no longer matches the files on disk. */
function manifestDesynced(snapDir, manifest, label) {
  try {
    if (manifest.label !== label) return true
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    return (
      !eq(listFilesDeep(join(snapDir, 'src')), manifest.inventory.src) ||
      !eq(listFilesDeep(join(snapDir, 'render')), manifest.inventory.render)
    )
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

/** POST /api/snapshot — writes the Scope layout with a provisional render/. */
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
    for (const entry of readdirSync(canvasDir, { withFileTypes: true })) {
      cpSync(join(canvasDir, entry.name), join(snapDir, 'src', entry.name), { recursive: true })
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.html') {
        // PROVISIONAL render/ = simple screen copies (real flat comes at passo 22)
        cpSync(join(canvasDir, entry.name), join(snapDir, 'render', entry.name))
      }
    }
    const manifest = {
      label,
      date,
      inventory: {
        src: listFilesDeep(join(snapDir, 'src')),
        render: listFilesDeep(join(snapDir, 'render')),
      },
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

/**
 * POST /api/revert — stub. The restore pipeline arrives at passo 24; here the
 * snapshot manifest is still validated (schema + inventory) BEFORE any restore
 * decision, without touching the root: invalid/desynced -> 400. Everything
 * else answers 501 {error:"not-implemented"}.
 */
function handleRevert(res, body) {
  if (body) {
    for (const key of ['canvas', 'label']) {
      if (body[key] !== undefined && (typeof body[key] !== 'string' || !SAFE_ID.test(body[key]))) {
        throw new ApiError(400, 'invalid')
      }
    }
    if (typeof body.canvas === 'string' && typeof body.label === 'string') {
      const snapDir = snapDirFor(body.canvas, body.label)
      if (existsSync(snapDir)) {
        const manifest = readManifest(snapDir)
        if (!manifest || manifestDesynced(snapDir, manifest, body.label)) throw new ApiError(400, 'invalid')
      }
    }
  }
  return fail(res, 501, 'not-implemented')
}

// ---------- routing ----------

async function handleApi(req, res, pathname) {
  const guard = apiGuard(req)
  if (guard) return fail(res, guard.code, guard.error)

  const method = req.method ?? 'GET'
  const route =
    pathname === '/api/comments'
      ? 'comments'
      : pathname === '/api/snapshots'
        ? 'snapshots'
        : pathname === '/api/snapshot'
          ? 'snapshot'
          : pathname === '/api/revert'
            ? 'revert'
            : null
  if (!route) return fail(res, 404, 'not-found')

  try {
    if (route === 'comments' && method === 'GET') {
      return sendJson(res, 200, { comments: loadComments() })
    }
    if (route === 'snapshots' && method === 'GET') {
      return sendJson(res, 200, { snapshots: listSnapshots() })
    }
    if (method !== 'POST') return fail(res, 404, 'not-found')

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
      for (const key of ['canvas', 'label', 'id', 'file']) {
        const value = parsed[key]
        if (typeof value === 'string' && isTraversal(value)) return fail(res, 403, 'traversal')
      }
    }

    if (route === 'revert') return handleRevert(res, parsed)
    if (!parsed) return fail(res, 400, 'invalid')
    if (route === 'comments') return sendJson(res, 200, { comments: handleCommentsPost(parsed) })
    return sendJson(res, 200, { snapshot: handleSnapshot(parsed) })
  } catch (error) {
    return apiFail(res, error)
  }
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname)
    }

    const file = normalize(join(root, pathname))
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      return res.end('forbidden')
    }

    let st = null
    try {
      st = statSync(file)
    } catch {}

    if (st?.isFile()) {
      const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
      if (basename(file) === 'viewer.html') {
        // in-memory rewrite: the disk file keeps window.__DESIGN_TOKEN__ = null
        const html = readFileSync(file, 'utf8').split(TOKEN_PLACEHOLDER).join(TOKEN_INJECTED)
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
        if (req.method === 'HEAD') return res.end()
        return res.end(html)
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(file).pipe(res)
    }

    if (st?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: pathname + '/' })
        return res.end()
      }
      const entries = readdirSync(file, { withFileTypes: true })
        .filter((entry) => entry.name !== '.')
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .sort()
      const items = ['../', ...entries].map((name) => `<li><a href="${name}">${name}</a></li>`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
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

server.listen(port, bindHost, () => {
  const host = bindHost === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
  console.log(`URL: http://${host}:${port} TOKEN: ${token}`)
})

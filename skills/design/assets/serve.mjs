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
 *   [porta]  TCP port (default 8765)
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
 * Error taxonomy: traversal 403 | schema 400 | too large 413 | missing 404 |
 * duplicate snapshot label 409 | invalid/desynced snapshot manifest 400
 * (checked BEFORE any restore, never touching the root) | write/pipeline
 * failure 500 + FULL rollback to the pre-revert state (backup taken before
 * the swap).
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
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
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
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path'

const argv = process.argv.slice(2)
const share = argv.includes('--share')
const noOpen = argv.includes('--no-open')
const openArg = argv.find((arg) => arg === '--open' || arg.startsWith('--open='))
const openCanvas = openArg?.startsWith('--open=') ? openArg.slice('--open='.length) : ''
const portArg = argv.find((arg) => !arg.startsWith('--'))
const port = portArg === undefined ? 8765 : Number(portArg)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
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

const MAX_BODY = 256 * 1024
const SAFE_ID = /^[a-z0-9-]+$/
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

/** Replies persist as {text, createdAt} (comments.json schema); legacy "at"
 * input is accepted and folded into createdAt. */
function normalizeReplies(list) {
  return list.map((reply) => ({
    text: reply.text,
    createdAt:
      typeof reply.createdAt === 'string'
        ? reply.createdAt
        : typeof reply.at === 'string'
          ? reply.at
          : new Date().toISOString(),
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
    [join(relRoot, 'validate.mjs'), relRoot],
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

/**
 * POST /api/revert {canvas,label} — restores the snapshot's src/ (integral
 * REPLACE) and ALWAYS reruns gen -> sync -> validate.
 *   400 invalid    manifest.json invalid/schema-broken/desynced — checked
 *                  BEFORE any write; the root is never touched on this path
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

  const backup = backupRoot()
  try {
    restoreSrc(snapDir, canvas)
    runGenSyncValidate()
    markStaleAfterRevert()
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
        // and window.__DESIGN_READONLY = false; share flips the readonly flag.
        const html = readFileSync(file, 'utf8')
          .split(TOKEN_PLACEHOLDER).join(share ? TOKEN_SHARE : TOKEN_INJECTED)
          .split(READONLY_PLACEHOLDER).join(share ? READONLY_INJECTED : READONLY_PLACEHOLDER)
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
        .filter((entry) => entry.name !== '.')
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

server.listen(port, bindHost, () => {
  const host = bindHost === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
  console.log(`URL: http://${host}:${port} TOKEN: ${token}`)
  // Browser policy: --open forces, --no-open forbids, otherwise only from an
  // interactive terminal (so tests, CI and the plugin never spawn browsers).
  const shouldOpen = openArg !== undefined ? !noOpen : !noOpen && process.stdout.isTTY
  if (shouldOpen) {
    const viewer = `http://127.0.0.1:${port}/viewer.html${openCanvas ? `?canvas=${encodeURIComponent(openCanvas)}` : ''}`
    openBrowser(viewer)
  }
})

#!/usr/bin/env node
/**
 * Design validator (read-only except the explicit --mark-stale write).
 * Prints one line per problem. Never throws: any internal error becomes an
 * `internal:` line.
 *
 * Usage: node design/validate.mjs [target] [--allow-stale] [--mark-stale]
 *   target = design-root (no canvas.json at its root -> project mode)
 *          | canvas (has canvas.json -> canvas mode)
 *   no target = ./design relative to cwd
 *   --allow-stale  skip ONLY the staleness check
 *   --mark-stale   the validator's ONLY write: rewrite comments.json marking
 *                  open pins whose anchor no longer resolves as "stale", exit 0
 *
 * Modes (pinned):
 *   canvas  = screen checks (bans + structural) on the screens listed in that
 *             canvas.json (plus the manifest checks below)
 *   project = everything: bans + structural (per canvas.json found under the
 *             root) + tokens.json/generated-CSS staleness + components/ +
 *             comments.json
 *   BOTH    = component checks (presence/variants/marker/divergence, todo 9)
 *             on every non-exempt .html in the walk - independent of canvas.json
 *
 * Exit codes: 0 = no issues, 1 = issues found, 2 = usage/input error.
 */
import { readFileSync, statSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DEVICES = new Set(['mobile', 'tablet', 'desktop'])
const MIN_SIZE = 100
const MAX_SIZE = 10000

// Bans walker: **/*.{html,css,js,jsx,mjs,svg} minus the exempt list
const WALK_EXT = /\.(?:html|css|js|jsx|mjs|svg)$/i
const EXEMPT_FILES = new Set([
  'design-system.css',
  'utilities.css',
  'mock.css',
  'viewer.html',
  'docs.html',
  'mock.js',
  'tokens.w3c.json',
])
const EXEMPT_DIRS = new Set(['vendor', 'scripts', 'snapshots']) // **/snapshots/** exempt whole tree
const ROOT_TOOLS = new Set(['validate.mjs', 'serve.mjs']) // exempt at the root of the run only

const PALETTE_CLASS =
  /^(?:bg|text|border|from|to|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/
const HEX_COLOR =
  /(?<![uU][rR][lL]\()(?<![0-9a-fA-F])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g
const RGB_COLOR = /rgba?\(/gi
const REMOTE_URL = /https?:\/\/[^\s"'<>()\\]+/g

// Component checks (todo 9): variant keys and the tag scan for instance attrs.
// The scan ALTERNATION consumes comments/script/style wholesale so markup text
// inside them can never masquerade as an element (byte offsets stay valid).
const COMPONENT_VARIANT_KEYS = ['size', 'tone', 'state']
const TAG_SCAN_RE =
  /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi
const DATA_ATTR_RE =
  /(?<![A-Za-z0-9_-])data-(component|size|tone|state)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------
const usage = 'usage: node design/validate.mjs [target] [--allow-stale] [--mark-stale]'
const argv = process.argv.slice(2)
const flags = argv.filter((a) => a.startsWith('--'))
const unknownFlags = flags.filter((f) => f !== '--allow-stale' && f !== '--mark-stale')
if (unknownFlags.length > 0) {
  console.error(`unknown flag "${unknownFlags[0]}" — ${usage}`)
  process.exit(2)
}
const positional = argv.filter((a) => !a.startsWith('--'))
if (positional.length > 1) {
  console.error(`${usage} (got ${positional.length} positional args)`)
  process.exit(2)
}
const allowStale = flags.includes('--allow-stale')
const markStale = flags.includes('--mark-stale')
const arg = positional[0] ?? './design'
// Extension point (todo 30): --example-inventory flag (no inventory.json = skip, exit 0).

const problems = []
const fail = (code, message) => problems.push(`- ${code}: ${message}`)

// Shared component machinery (marker-parser.mjs + sync-components.mjs) — the
// materializer is imported, NEVER reimplemented. Dual layout: the pack keeps
// both scripts side-by-side with this file; the installed layout keeps them in
// scripts/ (plan: validate.mjs at the design root). Missing scripts leave
// componentLib null and are reported ONLY when component checks are actually due.
const componentLib = await loadComponentLib()

try {
  const root = process.cwd()
  const canvasArg = arg.replaceAll('\\', '/').replace(/\/+$/, '')
  const canvasDir = resolve(root, canvasArg)
  if (canvasDir !== root && !canvasDir.startsWith(root + sep)) {
    fail('outside-project', `${canvasArg} is outside the project`)
  } else {
    let st = null
    try {
      st = statSync(canvasDir)
    } catch {}
    if (!st?.isDirectory()) {
      fail('not-found', `${canvasArg} is not a folder`)
    } else if (markStale) {
      markStalePins(canvasDir)
    } else if (pathExists(join(canvasDir, 'canvas.json'))) {
      runCanvasMode(canvasDir, canvasArg)
    } else {
      runProjectMode(canvasDir, canvasArg)
    }
  }
} catch (error) {
  fail('internal', String(error?.message ?? error))
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function runCanvasMode(canvasDir, canvasArg) {
  validateCanvas(canvasDir, canvasArg)
  // Screen checks (bans + structural) on the screens listed in this canvas.json.
  const manifest = readManifestQuiet(canvasDir)
  if (!manifest || !Array.isArray(manifest.screens)) return
  for (const screen of manifest.screens) {
    checkScreenFile(canvasDir, canvasDir, screen, { bans: true })
  }
  checkComponentInstances(canvasDir) // todo 9: every non-exempt .html, independent of canvas.json
  // Extension point (todo 14): unknown-transition screen check (canvas.json "transition").
  // Extension point (todo 28): contrast is a PROJECT check - never runs here.
}

function runProjectMode(rootDir, rootArg) {
  // Per canvas.json found under the root: manifest checks + structural screen checks.
  const found = []
  discoverCanvases(rootDir, rootArg, rootDir, found)
  for (const entry of found) {
    validateCanvas(entry.dir, entry.label)
    if (entry.kind !== 'canvas') continue
    const manifest = readManifestQuiet(entry.dir)
    if (!manifest || !Array.isArray(manifest.screens)) continue
    for (const screen of manifest.screens) {
      checkScreenFile(rootDir, entry.dir, screen, { bans: false })
    }
    // Extension point (todo 14): unknown-transition screen check (canvas.json "transition").
  }
  // Bans walker over the whole root (bans run on walked files regardless of canvas.json).
  const walked = []
  walkBanned(rootDir, rootDir, walked)
  for (const full of walked) checkBans(full, relLabel(rootDir, full))
  // Component checks (todo 9): every non-exempt .html, independent of canvas.json.
  checkComponentInstances(rootDir)
  if (!allowStale) checkStaleness(rootDir) // --allow-stale skips ONLY staleness
  checkComponentsDir(rootDir)
  checkCommentsShape(rootDir)
  // Extension point (todo 28): contrastPairs check (tokens.json, project mode only).
}

/** canvas.json discovery: every dir with canvas.json is a canvas; a dir with
 * data.json but no canvas.json is a broken canvas (keeps `missing-manifest`
 * reachable exactly as the single-canvas validator reported it). */
function discoverCanvases(dir, label, rootDir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  let hasManifest = false
  let hasData = false
  for (const entry of entries) {
    if (entry.name === 'canvas.json') hasManifest = true
    if (entry.name === 'data.json') hasData = true
  }
  if (hasManifest) out.push({ dir, label, kind: 'canvas' })
  else if (hasData) out.push({ dir, label, kind: 'broken' })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (isExemptDir(entry.name)) continue
    discoverCanvases(join(dir, entry.name), `${label}/${entry.name}`, rootDir, out)
  }
}

function checkScreenFile(scanRoot, canvasDir, screen, opts) {
  if (typeof screen !== 'object' || screen === null || Array.isArray(screen)) return
  if (typeof screen.file !== 'string' || screen.file.length === 0) return
  if (escapesCanvasFolder(screen.file)) return
  const full = join(canvasDir, screen.file)
  let st = null
  try {
    st = statSync(full)
  } catch {}
  if (!st?.isFile()) return
  const segments = screen.file.split('/')
  if (segments.some((s) => isExemptDir(s)) || isExemptFileName(basename(screen.file))) return
  const label = relLabel(scanRoot, full)
  if (opts.bans) checkBans(full, label)
  runStructuralChecks(full, label)
}

// ---------------------------------------------------------------------------
// Bans walker
// ---------------------------------------------------------------------------
function isExemptDir(name) {
  return EXEMPT_DIRS.has(name)
}

function isExemptFileName(name) {
  return EXEMPT_FILES.has(name)
}

function walkBanned(rootDir, dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isExemptDir(entry.name)) continue
      walkBanned(rootDir, join(dir, entry.name), out)
      continue
    }
    if (!entry.isFile() || !WALK_EXT.test(entry.name)) continue
    if (dir === rootDir && ROOT_TOOLS.has(entry.name)) continue
    if (isExemptFileName(entry.name)) continue
    out.push(join(dir, entry.name))
  }
}

function checkBans(full, label) {
  let content
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  // remote-url: anywhere in a non-exempt walked file
  for (const m of content.matchAll(REMOTE_URL)) {
    fail('remote-url', `${label}: remote URL "${m[0]}" is banned`)
  }
  // hard-coded-color: hex/rgb literals in VALUE position only - declaration
  // values inside <style> blocks and .css files; style="" attrs and SVG
  // fill=/stroke= attrs are value contexts (any hex/rgb there = flag)
  const ext = extname(full).toLowerCase()
  for (const [where, targets] of colorRegions(content, ext)) {
    for (const target of targets) {
      for (const m of target.matchAll(HEX_COLOR)) {
        fail('hard-coded-color', `${label}: literal color "${m[0]}" in ${where}`)
      }
      if (RGB_COLOR.test(target)) {
        fail('hard-coded-color', `${label}: literal rgb() color in ${where}`)
      }
      RGB_COLOR.lastIndex = 0
    }
  }
  // banned-class: palette utility classes and arbitrary values (-[...])
  for (const m of content.matchAll(/(?<![A-Za-z0-9_-])(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[1] ?? m[2] ?? ''
    for (const token of value.split(/\s+/)) {
      if (!token) continue
      if (PALETTE_CLASS.test(token) || token.includes('-[')) {
        fail('banned-class', `${label}: class "${token}" is banned`)
      }
    }
  }
}

function colorRegions(content, ext) {
  if (ext === '.css') return [['the CSS file', declarationValues(content)]]
  const regions = []
  for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    regions.push(['a <style> block', declarationValues(m[1])])
  }
  for (const m of content.matchAll(/(?<![A-Za-z0-9_-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    regions.push(['a style attribute', [m[1] ?? m[2] ?? '']]) // value context: whole value
  }
  for (const m of content.matchAll(/(?<![A-Za-z0-9_-])(?:fill|stroke)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    regions.push(['an SVG fill/stroke attribute', [m[1] ?? m[2] ?? '']]) // value context: whole value
  }
  return regions
}

// Strip CSS block comments so comment text never influences parsing or scans.
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** CSS declaration VALUES in value position: `property: <value>` inside { ... }
 * bodies (shorthand and multi-value included). Selectors, at-rule preludes,
 * pseudo-classes and property names are never scanned. */
function declarationValues(css) {
  const source = stripCssComments(css)
  const values = []
  let depth = 0
  let parens = 0
  let quote = null
  let colon = -1
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '(') {
      parens += 1
      continue
    }
    if (c === ')') {
      parens = Math.max(0, parens - 1)
      continue
    }
    if (parens > 0) continue // colon/semicolon inside url()/media queries/etc.
    if (c === '{') {
      depth += 1
      colon = -1 // everything before the brace was a prelude (selector/at-rule)
      continue
    }
    if (c === '}') {
      if (depth > 0 && colon >= 0) values.push(source.slice(colon + 1, i))
      depth = Math.max(0, depth - 1)
      colon = -1
      continue
    }
    if (depth === 0) continue // outside any block: selectors and at-rule preludes
    if (c === ';') {
      if (colon >= 0) values.push(source.slice(colon + 1, i))
      colon = -1
      continue
    }
    if (c === ':' && colon < 0) colon = i // first colon = property separator
  }
  return values
}

// ---------------------------------------------------------------------------
// Structural checks - ONLY screens listed in some canvas.json
// ---------------------------------------------------------------------------
function structuralSource(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
}

function runStructuralChecks(full, label) {
  let content
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const stripped = structuralSource(content)
  for (const m of stripped.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/.test(m[0])) {
      fail('img-alt', `${label}: <img> without alt attribute (${m[0].slice(0, 60)})`)
    }
  }
  const htmlTag = /<html\b[^>]*>/i.exec(stripped)
  if (htmlTag && !/\bdata-theme\s*=/.test(htmlTag[0])) {
    fail('missing-data-theme', `${label}: <html> without data-theme attribute`)
  }
  let hasViewport = false
  for (const m of stripped.matchAll(/<meta\b[^>]*>/gi)) {
    if (/\bname\s*=\s*["']viewport["']/.test(m[0])) hasViewport = true
  }
  if (!hasViewport) {
    fail('missing-viewport', `${label}: missing <meta name="viewport">`)
  }
  // Extension point (todo 28): input-label structural check (inputs need labels).
}

// ---------------------------------------------------------------------------
// Staleness (project mode only): generated CSS vs tokens.json hash
// ---------------------------------------------------------------------------
function checkStaleness(rootDir) {
  // Only checked when design-system.css OR utilities.css exists in the root;
  // missing tokens.json or missing generated CSS = skip silently.
  const regen = 'regen: node design/scripts/gen-tokens.mjs (instalado)'
  let tokensRaw = null
  try {
    tokensRaw = readFileSync(join(rootDir, 'tokens.json'))
  } catch {
    return
  }
  // Windows-safe normalization: same contract as gen-tokens.mjs (hash over
  // tokens.json bytes with all \r removed).
  const normalized = tokensRaw.toString('utf8').replace(/\r/g, '')
  const expected = createHash('sha256').update(normalized, 'utf8').digest('hex')
  for (const name of ['design-system.css', 'utilities.css']) {
    let cssRaw = null
    try {
      cssRaw = readFileSync(join(rootDir, name), 'utf8')
    } catch {
      continue // missing generated CSS -> skip
    }
    const firstLine = cssRaw.split('\n', 1)[0].replace(/\r$/, '')
    const m = /tokens-hash:\s*([0-9a-fA-F]+)/.exec(firstLine)
    if (!m) {
      fail('stale', `${name}: missing tokens-hash: in the first-line GENERATED header (${regen})`)
    } else if (m[1].toLowerCase() !== expected) {
      fail('stale', `${name}: tokens-hash mismatch (${regen})`)
    }
  }
}

// ---------------------------------------------------------------------------
// Component checks (todo 9) - EVERY non-exempt .html under the run root,
// independent of canvas.json, in BOTH modes. Absence policy: no components/
// directory = skipped entirely. Registry = components/components.json with
// fallback to the parser's DEFAULT_REGISTRY. Codes:
//   component-unknown    data-component (or marker id) not in the registry
//   component-variant    data-size/tone/state value not in that id's enums
//   component-marker /   marker grammar failures = the parser's own codes
//   slot-marker          (args required, paired, unclosed/mismatched, ...)
//   component-divergence (a) marker args vs root data-* (variantCompare) or
//                        (b) region bytes vs the registry-materialized render
//                        (materializeRegion - imported, never reimplemented).
// Marker args win; the validator FLAGS the divergence, sync repairs it.
// ---------------------------------------------------------------------------
function checkComponentInstances(rootDir) {
  const componentsDir = join(rootDir, 'components')
  let st = null
  try {
    st = statSync(componentsDir)
  } catch {
    return // absence policy: missing components/ = skip these checks
  }
  if (!st.isDirectory()) return // shape already reported by checkComponentsDir
  if (!componentLib) {
    return fail('internal', 'components: component checks unavailable (marker-parser.mjs / sync-components.mjs not found)')
  }
  const registry = loadComponentRegistry(rootDir)
  const files = []
  walkComponentHtml(rootDir, files)
  for (const full of files) checkComponentFile(rootDir, full, registry)
}

function walkComponentHtml(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (isExemptDir(entry.name)) continue
      walkComponentHtml(join(dir, entry.name), out)
      continue
    }
    if (!entry.isFile() || !/\.html$/i.test(entry.name)) continue
    if (isExemptFileName(entry.name)) continue
    out.push(join(dir, entry.name))
  }
}

function loadComponentRegistry(rootDir) {
  const registryPath = join(rootDir, 'components', 'components.json')
  let raw = null
  try {
    raw = readFileSync(registryPath, 'utf8')
  } catch {
    return componentLib.DEFAULT_REGISTRY // absence policy: no registry file = seeded default
  }
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) {
      fail('invalid-shape', 'components/components.json: the root must be an object of registry entries')
      return componentLib.DEFAULT_REGISTRY
    }
    return parsed
  } catch (error) {
    fail('invalid-json', `components/components.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
    return componentLib.DEFAULT_REGISTRY
  }
}

function checkComponentFile(rootDir, full, registry) {
  const label = relLabel(rootDir, full)
  let html = null
  try {
    html = readFileSync(full, 'utf8')
  } catch {
    return
  }
  // (1) instance rules on EVERY element carrying data-component - registry
  // membership + variant enum values, inside a marker region or not.
  for (const m of html.matchAll(TAG_SCAN_RE)) {
    if (m[1] === undefined) continue // comment/script/style alternative, not a tag
    const attrs = new Map()
    for (const a of m[0].matchAll(DATA_ATTR_RE)) {
      attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '')
    }
    if (!attrs.has('component')) continue
    const id = attrs.get('component')
    const line = lineOf(html, m.index)
    const entry = Object.prototype.hasOwnProperty.call(registry, id) ? registry[id] : undefined
    if (!isPlainObject(entry)) {
      fail('component-unknown', `${label}:${line}: data-component "${id}" is not in the registry`)
      continue
    }
    for (const key of COMPONENT_VARIANT_KEYS) {
      if (!attrs.has(key)) continue
      const value = attrs.get(key)
      const enums = isPlainObject(entry.variants) ? entry.variants[key] : undefined
      if (!Array.isArray(enums) || !enums.includes(value)) {
        const allowed = Array.isArray(enums) ? enums.join(', ') : '(none)'
        fail('component-variant', `${label}:${line}: data-${key} "${value}" is invalid for component "${id}" (allowed: ${allowed})`)
      }
    }
  }
  // (2) marker grammar + registry (parser-owned errors, reused verbatim) and
  // per-region divergence (marker vs root data-*, region vs registry render).
  let regions = null
  try {
    regions = componentLib.parseAll(html, registry)
  } catch (error) {
    if (isMarkerError(error)) {
      const line = markerErrorLine(error.message, html)
      const where = line === null ? label : `${label}:${line}`
      return fail(componentProblemCode(error), `${where}: ${error.message}`)
    }
    return fail('internal', `${label}: ${String(error?.message ?? error)}`)
  }
  for (const region of regions) {
    const diffs = []
    for (const div of componentLib.variantCompare(region.args, componentLib.rootVariantData(region.inner))) {
      diffs.push(`data-${div.key}: marker=${div.marker ?? '(absent)'} root=${div.root ?? '(absent)'}`)
    }
    const variantDetail = diffs.length > 0 ? `marker args diverge from root data-* (${diffs.join(', ')})` : null
    let byteDetail = null
    try {
      if (componentLib.materializeRegion(rootDir, region, registry) !== region.inner) {
        byteDetail = 'region bytes differ from the registry render'
      }
    } catch (error) {
      byteDetail = `registry render unavailable (${String(error?.message ?? error)})`
    }
    const details = [variantDetail, byteDetail].filter(Boolean)
    if (details.length > 0) {
      fail(
        'component-divergence',
        `${label}:${lineOf(html, region.start)}: component:${region.id}: ${details.join('; ')} (marker wins - run sync to fix)`,
      )
    }
  }
}

function isMarkerError(error) {
  return error?.name === 'MarkerError' && typeof error?.code === 'string'
}

/** Registry membership and enum failures become component-unknown /
 * component-variant; every grammar failure keeps the parser's own code. */
function componentProblemCode(error) {
  const message = String(error?.message ?? error)
  if (/^unknown component id "/.test(message)) return 'component-unknown'
  if (/^invalid (?:size|tone|state)="/.test(message)) return 'component-variant'
  return error.code
}

/** Parser messages carry "at index N" for positional failures only. */
function markerErrorLine(message, html) {
  const m = /at index (\d+)/.exec(message)
  return m ? lineOf(html, Number(m[1])) : null
}

// ---------------------------------------------------------------------------
// components/ (dir presence + shape) and comments.json
// ---------------------------------------------------------------------------
function checkComponentsDir(rootDir) {
  let st = null
  try {
    st = statSync(join(rootDir, 'components'))
  } catch {
    return // absence policy: missing components/ = skip silently
  }
  if (!st.isDirectory()) {
    fail('invalid-shape', 'components: must be a directory')
  }
  // Registry/variant/marker/divergence rules live in checkComponentInstances.
}

function checkCommentsShape(rootDir) {
  let raw = null
  try {
    raw = readFileSync(join(rootDir, 'comments.json'), 'utf8')
  } catch {
    return // absence policy: missing comments.json = skip silently
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('invalid-json', `comments.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
  }
  const list = commentsList(parsed)
  if (list === null) {
    return fail('invalid-shape', 'comments.json: the root must be a list of pin objects')
  }
  for (const [index, pin] of list.entries()) {
    validatePinShape(pin, index)
  }
}

function commentsList(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (isPlainObject(parsed) && Array.isArray(parsed.comments)) return parsed.comments
  return null
}

function validatePinShape(pin, index) {
  const where = `comments.json: pin #${index + 1}`
  if (!isPlainObject(pin)) {
    return fail('invalid-shape', `${where}: must be an object`)
  }
  for (const key of ['id', 'canvas', 'file']) {
    if (typeof pin[key] !== 'string' || pin[key].length === 0) {
      fail('invalid-shape', `${where} (${pin.id ?? '?'}): "${key}" must be a non-empty string`)
    }
  }
  if (!['open', 'resolved', 'stale'].includes(pin.status)) {
    fail('invalid-shape', `${where} (${pin.id ?? '?'}): "status" must be open|resolved|stale`)
  }
  if (pin.replies !== undefined && !Array.isArray(pin.replies)) {
    fail('invalid-shape', `${where} (${pin.id ?? '?'}): "replies" must be a list`)
  }
  if (pin.createdAt !== undefined && typeof pin.createdAt !== 'string') {
    fail('invalid-shape', `${where} (${pin.id ?? '?'}): "createdAt" must be a string`)
  }
  for (const key of ['selector', 'snippet']) {
    if (pin[key] !== undefined && typeof pin[key] !== 'string') {
      fail('invalid-shape', `${where} (${pin.id ?? '?'}): "${key}" must be a string`)
    }
  }
}

// ---------------------------------------------------------------------------
// --mark-stale: the validator's ONLY write
// ---------------------------------------------------------------------------
function markStalePins(rootDir) {
  let raw = null
  try {
    raw = readFileSync(join(rootDir, 'comments.json'), 'utf8')
  } catch {
    return // absence policy: nothing to rewrite, exit 0
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('invalid-json', `comments.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
  }
  const list = commentsList(parsed)
  if (list === null) {
    return fail('invalid-shape', 'comments.json: the root must be a list of pin objects')
  }
  for (const [index, pin] of list.entries()) {
    validatePinShape(pin, index)
  }
  if (problems.length > 0) return // shape broken -> report, never write
  let marked = 0
  for (const pin of list) {
    if (pin.status !== 'open') continue
    if (anchorResolves(rootDir, pin)) continue
    pin.status = 'stale'
    marked += 1
  }
  writeFileSync(join(rootDir, 'comments.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  console.log(`mark-stale: ${marked} pin(s) marked stale.`)
}

/** Anchor resolution: selector first, snippet as fallback. No anchor at all or
 * unresolvable screen path counts as unresolved. */
function anchorResolves(rootDir, pin) {
  if (escapesCanvasFolder(pin.canvas) || escapesCanvasFolder(pin.file)) return false
  let html = null
  try {
    html = readFileSync(join(rootDir, pin.canvas, pin.file), 'utf8')
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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve a shared script in the two supported layouts: side-by-side with this
 * file (pack source) or under scripts/ (installed: design/validate.mjs). */
async function importFromLayout(name) {
  for (const rel of [`./${name}`, `./scripts/${name}`]) {
    const url = new URL(rel, import.meta.url)
    if (existsSync(fileURLToPath(url))) return import(url.href)
  }
  return null
}

/** The shared marker grammar + the ONE materializer (sync-components.mjs).
 * Never throws: a missing/broken script yields null and is reported at the
 * check site only when component checks are actually due. */
async function loadComponentLib() {
  try {
    const parser = await importFromLayout('marker-parser.mjs')
    const sync = await importFromLayout('sync-components.mjs')
    if (!parser || !sync) return null
    return {
      parseAll: parser.parseAll,
      variantCompare: parser.variantCompare,
      DEFAULT_REGISTRY: parser.DEFAULT_REGISTRY,
      materializeRegion: sync.materializeRegion,
      rootVariantData: sync.rootVariantData,
    }
  } catch {
    return null
  }
}

function pathExists(target) {
  try {
    statSync(target)
    return true
  } catch {
    return false
  }
}

function readManifestQuiet(canvasDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(canvasDir, 'canvas.json'), 'utf8'))
    if (isPlainObject(manifest)) return manifest
  } catch {}
  return null
}

function relLabel(rootDir, full) {
  return full.slice(rootDir.length).replace(/^[\\/]/, '').replaceAll('\\', '/')
}

function escapesCanvasFolder(file) {
  return (
    file.startsWith('/') ||
    file.includes('\\') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(file) ||
    file.split('/').includes('..')
  )
}

// ---------------------------------------------------------------------------
// Baseline canvas.json validation (behavior preserved verbatim)
// ---------------------------------------------------------------------------
function validateCanvas(canvasDir, canvasArg) {
  let raw
  try {
    raw = readFileSync(join(canvasDir, 'canvas.json'), 'utf8')
  } catch {
    return fail('missing-manifest', `${canvasArg}/canvas.json not found`)
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    return fail('invalid-json', `canvas.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
  }

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return fail('invalid-shape', 'canvas.json: the root must be an object')
  }
  if (manifest.title !== undefined && typeof manifest.title !== 'string') {
    fail('invalid-shape', 'canvas.json: "title" must be a string')
  }
  if (!Array.isArray(manifest.screens)) {
    return fail('invalid-shape', 'canvas.json: "screens" must be a list of screen objects')
  }

  const seenIds = new Map()
  for (const [index, screen] of manifest.screens.entries()) {
    validateScreen(screen, index, canvasDir, seenIds)
  }

  try {
    const dataRaw = readFileSync(join(canvasDir, 'data.json'), 'utf8')
    let data = null
    try {
      data = JSON.parse(dataRaw)
    } catch (error) {
      fail('invalid-data', `data.json: ${jsonErrorWhere(error, dataRaw)}${String(error.message)}`)
    }
    if (data && data.scenarios !== undefined && (typeof data.scenarios !== 'object' || data.scenarios === null || Array.isArray(data.scenarios))) {
      fail('invalid-data', 'data.json: "scenarios" must be an object of named overrides')
    }
  } catch { /* data.json is optional */ }

  console.log(`Design canvas ${canvasArg}: ${manifest.screens.length} screen(s).`)
}

function validateScreen(screen, index, canvasDir, seenIds) {
  const where = `screen #${index + 1}`
  if (typeof screen !== 'object' || screen === null || Array.isArray(screen)) {
    return fail('invalid-shape', `${where}: must be an object with "id", "name" and "file"`)
  }

  for (const key of ['id', 'name', 'file']) {
    if (typeof screen[key] !== 'string' || screen[key].length === 0) {
      fail('invalid-shape', `${where} (${screen.id ?? '?'}): "${key}" must be a non-empty string`)
    }
  }
  if (typeof screen.id !== 'string' || typeof screen.file !== 'string') return

  if (seenIds.has(screen.id)) {
    fail('duplicate-id', `screen "${screen.id}" is repeated (also #${seenIds.get(screen.id)})`)
  } else {
    seenIds.set(screen.id, index + 1)
  }

  const size = readSize(screen, where)
  if (
    typeof screen.device === 'string' &&
    screen.device.length > 0 &&
    !DEVICES.has(screen.device) &&
    !size.complete
  ) {
    fail(
      'unknown-device',
      `screen "${screen.id}": device "${screen.device}" is not mobile/tablet/desktop and no width+height override exists`,
    )
  }

  if (screen.file.startsWith('/') || screen.file.includes('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(screen.file) || screen.file.split('/').includes('..')) {
    return fail('file-outside', `screen "${screen.id}" → ${screen.file} escapes the canvas folder`)
  }

  let st = null
  try {
    st = statSync(join(canvasDir, screen.file))
  } catch {}
  if (!st?.isFile()) {
    fail('missing-file', `screen "${screen.id}" → ${screen.file} not found`)
  }
}

function readSize(screen, where) {
  const size = { complete: false }
  for (const key of ['width', 'height']) {
    const value = screen[key]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < MIN_SIZE || value > MAX_SIZE) {
      fail('invalid-shape', `${where} (${screen.id ?? '?'}): "${key}" must be an integer from ${MIN_SIZE} to ${MAX_SIZE}`)
    } else {
      size[key] = value
    }
  }
  size.complete = size.width !== undefined && size.height !== undefined
  return size
}

/** Best-effort "line N" prefix for a JSON.parse SyntaxError. */
function jsonErrorWhere(error, raw) {
  const message = String(error.message)
  const lineMatch = /\(line (\d+)/.exec(message)
  if (lineMatch) return `line ${lineMatch[1]}: `
  const posMatch = /at position (\d+)/.exec(message)
  if (posMatch) return `line ${lineOf(raw, Number(posMatch[1]))}: `
  // Modern V8 embeds a quoted context snippet instead of a position.
  const context = /\.\.\.\s*"?(.*?)"?\s*is not valid JSON\s*$/s.exec(message)?.[1]
  if (!context) return ''
  const anchor = Math.max(0, raw.lastIndexOf(context))
  const token = /Unexpected token '(.*)'/.exec(message)?.[1]
  const offset = token && context.includes(token) ? context.indexOf(token) + 1 : context.length
  return `line ${lineOf(raw, anchor + offset)}: `
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length
}

if (problems.length > 0) {
  console.log('Fix these issues:')
  for (const problem of problems) console.log(problem)
  process.exit(1)
}
process.exit(0)

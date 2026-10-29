#!/usr/bin/env node
/* mockbird:config-driven:v2 */
/**
 * Design validator (read-only except the explicit --mark-stale write).
 * Prints one line per problem. Never throws: any internal error becomes an
 * `internal:` line.
 *
 * Usage: node design/validate.mjs [target] [--allow-stale] [--mark-stale]
 *          [--example-inventory] [--config <path>]
 *   target = design-root (no canvas.json at its root -> project mode)
 *          | canvas (has canvas.json -> canvas mode)
 *   no target = ./design relative to cwd
 *   --allow-stale  skip ONLY the staleness check
 *   --mark-stale   the validator's ONLY write: rewrite comments.json marking
 *                  open pins whose anchor no longer resolves as "stale", exit 0
 *   --example-inventory  todo 30 example contract - a MODE of its own (like
 *                  --mark-stale, it replaces the normal run): compare the
 *                  target's EXACT file list against inventory.json (bidirectional;
 *                  snapshot files under snapshots/ ARE listed and checked;
 *                  tokens.w3c.json is name-exempt on the extra side) and demand
 *                  "_demo": true on every comments.json pin. No inventory.json
 *                  in the design-root = the flag does nothing (skip, exit 0).
 *                  Codes: inventory-missing (listed, absent on disk),
 *                  inventory-extra (on disk, not listed), inventory-demo-missing
 *                  (pin without the demo marker), inventory-invalid (malformed
 *                  inventory.json / comments.json).
 *
 * Modes (pinned):
 *   canvas  = screen checks (bans + structural + unknown-transition) on the
 *             screens listed in that canvas.json (plus the manifest checks below)
 *   project = everything: bans + structural + unknown-transition (per canvas.json
 *             found under the root) + tokens.json/generated-CSS staleness +
 *             components/ + comments.json + contrast (todo 28: contrastPairs,
 *             PROJECT-only - never fires in canvas mode)
 *   BOTH    = component checks (presence/variants/marker/divergence, todo 9)
 *             on every non-exempt .html in the walk - independent of canvas.json;
 *             unknown-transition is a SCREEN check and runs in BOTH modes;
 *             input-label (todo 28) is a SCREEN check like img-alt (listed
 *             screens only, both modes)
 *
 * Config (config-driven v2): the exempt lists and component variant keys are
 * read from validate.config.json — discovery chain: --config <path> ->
 * validate.config.json in the validated root -> in the CWD. Absent = exit 3
 * with guided setup (NEVER a silent fallback to hardcoded values).
 *
 * Exit codes: 0 = no issues, 1 = issues found, 2 = usage/input error (incl.
 * toolchainScripts marker/entry integrity), 3 = missing/broken config.
 */
import { readFileSync, statSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep, extname, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DEVICES = new Set(['mobile', 'tablet', 'desktop'])
const MIN_SIZE = 100
const MAX_SIZE = 10000
// Screen "transition" enum (todo 14): absent = default "none" (schema-tolerant).
const TRANSITIONS = new Set(['fade', 'slide-left', 'none'])

// Bans walker: **/*.{html,css,js,jsx,mjs,svg} minus the exempt list.
// Exempt names come from the external validate.config.json (loaded below) —
// never hardcoded here: re-copying the scripts cannot change the rules (the
// config lives outside the re-copied files — flip-flop settle, §3.3/R2).
const WALK_EXT = /\.(?:html|css|js|jsx|mjs|svg)$/i
let EXEMPT_FILES = new Set()
let EXEMPT_DIRS = new Set() // **/snapshots/** exempt whole tree
const ROOT_TOOLS = new Set(['validate.mjs', 'serve.mjs']) // exempt at the root of the run only

const PALETTE_CLASS =
  /^(?:bg|text|border|from|to|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/
const HEX_COLOR =
  /(?<![uU][rR][lL]\()(?<![0-9a-fA-F])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g
const RGB_COLOR = /rgba?\(/gi
const REMOTE_URL = /https?:\/\/[^\s"'<>()\\]+/g
// contrast (todo 28): fg/bg slot accepts a color literal OR a token name
const COLOR_LITERAL_RE = /^(?:#(?:[0-9a-fA-F]{3,8})|rgba?\()/i

// Component checks (todo 9): variant keys (from validate.config.json) and the
// tag scan for instance attrs.
// The scan ALTERNATION consumes comments/script/style wholesale so markup text
// inside them can never masquerade as an element (byte offsets stay valid).
let COMPONENT_VARIANT_KEYS = []
const TAG_SCAN_RE =
  /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi
const DATA_ATTR_RE =
  /(?<![A-Za-z0-9_-])data-(component|size|tone|state)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------
const usage =
  'usage: node design/validate.mjs [target] [--allow-stale] [--mark-stale] [--example-inventory] [--config <path>]'
const argv = process.argv.slice(2)
const flags = []
const positional = []
let configArg = null
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--config') {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      console.error(`--config requires a path — ${usage}`)
      process.exit(2)
    }
    configArg = value
    i += 1
    continue
  }
  if (token.startsWith('--')) flags.push(token)
  else positional.push(token)
}
// rules/*.mjs (todo 2) load BEFORE flag validation so a rule can claim its own
// flags (optional `flags` export) without editing this file. Broken rule
// modules are toolchain integrity damage: exit 2 citing the file.
const ruleBook = await loadRules()
const KNOWN_FLAGS = new Set(['--allow-stale', '--mark-stale', '--example-inventory'])
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f) && !ruleBook.flags.has(f))
if (unknownFlags.length > 0) {
  console.error(`unknown flag "${unknownFlags[0]}" — ${usage}`)
  process.exit(2)
}
if (positional.length > 1) {
  console.error(`${usage} (got ${positional.length} positional args)`)
  process.exit(2)
}
const allowStale = flags.includes('--allow-stale')
const markStale = flags.includes('--mark-stale')
const exampleInventory = flags.includes('--example-inventory')
const arg = positional[0] ?? './design'

// ---------------------------------------------------------------------------
// External config — validate.config.json (config-driven v2). Discovery chain:
//   --config <path> -> validate.config.json in the validated root -> in the CWD
// Absent = exit 3 with guided setup — NEVER a silent fallback to hardcoded
// values. toolchainScripts entries resolve RELATIVE to the config file's own
// directory; every entry must exist and carry the config marker (R2), else
// exit 2 citing the exact file. Config file problems (missing, unreadable,
// invalid JSON) = exit 3; content problems (shape, toolchain integrity) = 2.
// ---------------------------------------------------------------------------
const CONFIG_NAME = 'validate.config.json'
const CONFIG_MARKER = '/* mockbird:config-driven:v2 */'
const CONFIG_SEED_HINT = `run setup-design.mjs to seed it (or copy skills/design/assets/${CONFIG_NAME} from the skill folder)`
let loadedConfig = null // parsed config object, handed to rules/*.mjs via ctx.config

function configFatal(message, code) {
  console.error(message)
  process.exit(code)
}

function configStringArray(parsed, key) {
  const value = parsed[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    configFatal(`${CONFIG_NAME}: "${key}" must be a list of strings`, 2)
  }
  return value
}

function loadConfig() {
  let configPath = null
  if (configArg !== null) {
    if (!pathExists(configArg)) {
      configFatal(`${configArg}: ${CONFIG_NAME} not found — ${CONFIG_SEED_HINT}`, 3)
    }
    configPath = configArg
  } else {
    const targetDir = resolve(process.cwd(), arg.replaceAll('\\', '/').replace(/\/+$/, ''))
    const candidates = [join(targetDir, CONFIG_NAME), join(process.cwd(), CONFIG_NAME)]
    configPath = candidates.find((candidate) => pathExists(candidate)) ?? null
    if (configPath === null) {
      configFatal(`${CONFIG_NAME} not found (checked ${candidates[0]} and ${candidates[1]}) — ${CONFIG_SEED_HINT}`, 3)
    }
  }
  let raw = null
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    configFatal(`${configPath}: cannot read ${CONFIG_NAME} — ${CONFIG_SEED_HINT}`, 3)
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    configFatal(`${configPath}: ${CONFIG_NAME} is not valid JSON — ${CONFIG_SEED_HINT}`, 3)
  }
  if (!isPlainObject(parsed)) {
    configFatal(`${configPath}: ${CONFIG_NAME} must have a JSON object at its root`, 2)
  }
  const exemptFiles = configStringArray(parsed, 'exemptFiles')
  const exemptDirs = configStringArray(parsed, 'exemptDirs')
  const variantKeys = configStringArray(parsed, 'componentVariantKeys')
  const toolchain = configStringArray(parsed, 'toolchainScripts')
  // R2: every toolchain script must exist and carry the config marker.
  const configDir = dirname(resolve(configPath))
  for (const entry of toolchain) {
    const full = resolve(configDir, entry)
    let content = null
    try {
      content = readFileSync(full, 'utf8')
    } catch {
      configFatal(`toolchainScripts: ${full} not found (entries resolve relative to ${configDir})`, 2)
    }
    if (!content.includes(CONFIG_MARKER)) {
      configFatal(`toolchainScripts: ${full} lacks the ${CONFIG_MARKER} marker (pre-config script?)`, 2)
    }
  }
  console.log(`config: ${configPath}`)
  EXEMPT_FILES = new Set(exemptFiles)
  EXEMPT_DIRS = new Set(exemptDirs)
  COMPONENT_VARIANT_KEYS = variantKeys
  loadedConfig = parsed
}
loadConfig()

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
    } else if (exampleInventory) {
      checkExampleInventory(canvasDir) // todo 30: mode of its own (skip, exit 0)
    } else if (pathExists(join(canvasDir, 'canvas.json'))) {
      runCanvasMode(canvasDir, canvasArg)
    } else {
      runProjectMode(canvasDir, canvasArg)
    }
    // rules/*.mjs (todo 2, append-only extension point): every registered rule
    // runs AFTER the inline checks in BOTH modes; --mark-stale and
    // --example-inventory replace the run, so they skip rules too (pinned).
    if (st?.isDirectory() && !markStale && !exampleInventory) {
      await runRules({
        rootDir: canvasDir,
        rootArg: canvasArg,
        mode: pathExists(join(canvasDir, 'canvas.json')) ? 'canvas' : 'project',
        config: loadedConfig,
        argv,
        flags,
        fail,
        relLabel,
      })
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
  checkScreenTransitions(manifest.screens, canvasArg) // todo 14: SCREEN check, runs in BOTH modes
  // contrast (todo 28) is a PROJECT check - it NEVER runs here (pinned).
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
    checkScreenTransitions(manifest.screens, entry.label) // todo 14: SCREEN check, runs in BOTH modes
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
  checkContrast(rootDir) // todo 28: contrastPairs check (tokens.json, project mode only)
}

// ---------------------------------------------------------------------------
// contrast (todo 28) - PROJECT-only check (NEVER runs in canvas mode). When the
// root tokens.json carries $extensions.designPack.contrastPairs, each pair
// {fg, bg, minRatio} is computed with the WCAG 2.x relative-luminance formula
// (pure JS). fg/bg accept a color literal (hex/rgb) OR a token name; token refs
// resolve in EVERY theme and EACH theme must meet minRatio (message names the
// failing theme). Literal-only pairs are theme-independent (one line).
// ---------------------------------------------------------------------------
function parseColorLiteral(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
    return parts.slice(0, 3)
  }
  return null
}

/** Resolve a token name (dotted path) to a color inside one theme object. */
function resolveThemeColor(theme, name) {
  if (!isPlainObject(theme)) return null
  let node = theme
  for (const part of String(name).split('.')) {
    if (!isPlainObject(node) || !(part in node)) return null
    node = node[part]
  }
  const value = isPlainObject(node) ? node.$value : undefined
  return typeof value === 'string' ? parseColorLiteral(value) : null
}

function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function checkContrast(rootDir) {
  let raw = null
  try {
    raw = readFileSync(join(rootDir, 'tokens.json'), 'utf8')
  } catch {
    return // absence policy: no tokens.json = skip
  }
  let tokens = null
  try {
    tokens = JSON.parse(raw)
  } catch {
    return // invalid tokens.json is gen-tokens' problem; never throws here
  }
  const pairs = tokens?.$extensions?.designPack?.contrastPairs
  if (!Array.isArray(pairs)) return
  const themes = isPlainObject(tokens) ? Object.keys(tokens).filter((k) => !k.startsWith('$')) : []
  for (const [index, pair] of pairs.entries()) {
    checkContrastPair(pair, index, tokens, themes)
  }
}

function checkContrastPair(pair, index, tokens, themes) {
  const where = `tokens.json: contrastPairs[${index}]`
  if (!isPlainObject(pair) || typeof pair.fg !== 'string' || typeof pair.bg !== 'string' || !(typeof pair.minRatio === 'number' && pair.minRatio > 0)) {
    return fail('invalid-shape', `${where}: must be { "fg": <color|token>, "bg": <color|token>, "minRatio": <number> }`)
  }
  const fgLiteral = COLOR_LITERAL_RE.test(pair.fg.trim())
  const bgLiteral = COLOR_LITERAL_RE.test(pair.bg.trim())
  const pairLabel = `${where} (fg "${pair.fg}" on bg "${pair.bg}")`
  const report = (scope, ratio) =>
    fail('contrast', `${pairLabel}${scope}: ratio ${ratio.toFixed(2)} < minRatio ${pair.minRatio}`)

  if (fgLiteral && bgLiteral) {
    const ratio = contrastRatio(parseColorLiteral(pair.fg), parseColorLiteral(pair.bg))
    if (ratio < pair.minRatio) report('', ratio) // literals: theme-independent, one line
    return
  }
  // At least one token ref: resolve BOTH sides in EVERY theme; each theme must
  // meet minRatio, and every failure names its theme.
  for (const themeName of themes) {
    const fg = fgLiteral ? parseColorLiteral(pair.fg) : resolveThemeColor(tokens[themeName], pair.fg)
    const bg = bgLiteral ? parseColorLiteral(pair.bg) : resolveThemeColor(tokens[themeName], pair.bg)
    if (!fg || !bg) {
      fail('contrast', `${pairLabel} (theme "${themeName}"): cannot resolve ${!fg ? `fg "${pair.fg}"` : `bg "${pair.bg}"`} as a color`)
      continue
    }
    const ratio = contrastRatio(fg, bg)
    if (ratio < pair.minRatio) report(` (theme "${themeName}")`, ratio)
  }
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
// unknown-transition (todo 14) - SCREEN check that runs in BOTH modes over the
// screens of every canvas.json. Per-screen optional "transition" must be
// fade|slide-left|none when present; absent = default "none" (schema-tolerant).
// ---------------------------------------------------------------------------
function checkScreenTransitions(screens, label) {
  for (const [index, screen] of screens.entries()) {
    if (!isPlainObject(screen)) continue
    if (screen.transition === undefined) continue // absent = default "none"
    const value = screen.transition
    if (typeof value === 'string' && TRANSITIONS.has(value)) continue
    const id = typeof screen.id === 'string' && screen.id.length > 0 ? screen.id : `#${index + 1}`
    fail('unknown-transition', `${label}: screen "${id}": transition ${JSON.stringify(value)} is not fade|slide-left|none`)
  }
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
  checkInputLabels(stripped, label)
}

// ---------------------------------------------------------------------------
// input-label (todo 28) - SCREEN check (same scope as img-alt: only screens
// listed in some canvas.json, both modes). Every <input|select|textarea> needs
// one of: a non-empty aria-label, an id referenced by some label[for], or a
// wrapping <label>...</label>. Triage: `stripped` already dropped comments,
// <script> and <style> bodies, so decoy markup in strings can never fire this.
// ---------------------------------------------------------------------------
function checkInputLabels(stripped, label) {
  const forIds = new Set()
  const wrapSpans = []
  for (const m of stripped.matchAll(/<label\b([^>]*)>/gi)) {
    const forMatch = /(?<![A-Za-z0-9_-])for\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1])
    if (forMatch) forIds.add(forMatch[1] ?? forMatch[2] ?? '')
    const close = stripped.indexOf('</label>', m.index + m[0].length)
    if (close >= 0) wrapSpans.push([m.index + m[0].length, close])
  }
  for (const m of stripped.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0]
    const start = m.index
    const end = m.index + tag.length
    if (/(?<![A-Za-z0-9_-])aria-label\s*=\s*(?:"[^"]+"|'[^']+')/i.test(tag)) continue
    const idMatch = /(?<![A-Za-z0-9_-])id\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const id = idMatch ? (idMatch[1] ?? idMatch[2] ?? '') : ''
    if (id && forIds.has(id)) continue
    if (wrapSpans.some(([openEnd, closeStart]) => start >= openEnd && end <= closeStart)) continue
    fail('input-label', `${label}: <${m[1].toLowerCase()}> without label[for], aria-label or <label> wrap (${tag.slice(0, 60)})`)
  }
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
// --example-inventory (todo 30): the example contract, assertable. A MODE of
// its own (like --mark-stale: it replaces the normal run). Without
// inventory.json in the design-root the flag does nothing (skip, exit 0).
// With inventory.json the file list is compared BIDIRECTIONALLY (missing ->
// inventory-missing, extra -> inventory-extra) - snapshot files under
// snapshots/ ARE listed and checked (they are exempt only from the bans
// walker) and tokens.w3c.json is name-exempt on the EXTRA side (derived
// export, todo 26). Every comments.json pin must carry "_demo": true
// (inventory-demo-missing). inventory-invalid = malformed inventory.json or
// comments.json.
// ---------------------------------------------------------------------------
function checkExampleInventory(rootDir) {
  const invPath = join(rootDir, 'inventory.json')
  if (!pathExists(invPath)) {
    console.log('example-inventory: no inventory.json — skipped.')
    return // the flag does nothing without the pinned inventory (todo 30)
  }
  let raw = null
  try {
    raw = readFileSync(invPath, 'utf8')
  } catch {
    return fail('inventory-invalid', 'inventory.json: unreadable')
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('inventory-invalid', `inventory.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
  }
  const list = Array.isArray(parsed)
    ? parsed
    : isPlainObject(parsed) && Array.isArray(parsed.files)
      ? parsed.files
      : null
  if (list === null) {
    return fail('inventory-invalid', 'inventory.json: the root must be {"files": [...]} (or a list of paths)')
  }
  const listed = new Set()
  for (const [index, entry] of list.entries()) {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail('inventory-invalid', `inventory.json: entry #${index + 1} must be a non-empty string`)
      continue
    }
    const rel = entry.replaceAll('\\', '/')
    if (
      rel.startsWith('/') ||
      rel.split('/').includes('..') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel)
    ) {
      fail('inventory-invalid', `inventory.json: entry "${entry}" escapes the root`)
      continue
    }
    listed.add(rel)
  }
  const disk = new Set()
  walkInventory(rootDir, rootDir, disk)
  for (const rel of listed) {
    if (!disk.has(rel)) {
      fail('inventory-missing', `${rel}: listed in inventory.json but missing on disk`)
    }
  }
  for (const rel of [...disk].sort()) {
    if (listed.has(rel)) continue
    if (basename(rel) === 'tokens.w3c.json') continue // derived export - name-exempt (todo 26/30)
    fail('inventory-extra', `${rel}: on disk but not listed in inventory.json`)
  }
  checkDemoMarkers(rootDir)
  if (problems.length === 0) {
    console.log(`example-inventory: ${listed.size} listed / ${disk.size} on disk — OK.`)
  }
}

/** Full recursive file list (rel paths, `/`-separated). Unlike the bans walker
 * this covers EVERY file - snapshots/ included (todo 30). */
function walkInventory(rootDir, dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkInventory(rootDir, full, out)
      continue
    }
    if (!entry.isFile()) continue
    out.add(relLabel(rootDir, full))
  }
}

/** Demo markers (todo 30): every pin of comments.json must carry "_demo": true. */
function checkDemoMarkers(rootDir) {
  let raw = null
  try {
    raw = readFileSync(join(rootDir, 'comments.json'), 'utf8')
  } catch {
    return // absence policy: no pins, nothing to mark
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('inventory-invalid', `comments.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
  }
  const list = commentsList(parsed)
  if (list === null) {
    return fail('inventory-invalid', 'comments.json: the root must be a list of pin objects')
  }
  for (const [index, pin] of list.entries()) {
    if (isPlainObject(pin) && pin._demo === true) continue
    const id = isPlainObject(pin) && typeof pin.id === 'string' && pin.id ? ` (${pin.id})` : ''
    fail('inventory-demo-missing', `comments.json: pin #${index + 1}${id} lacks "_demo": true`)
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

// ---------------------------------------------------------------------------
// rules/ loader + runner (todo 2) — APPEND-ONLY extension point: the inline
// rules above are never moved here. Every `rules/*.mjs` module registers via
// named exports and is invoked without any further edit to this file:
//   id    - non-empty string; used for error attribution (must be unique)
//   run   - (ctx) => {} sync or async; reports via ctx.fail(code, message)
//   flags - OPTIONAL list of `--flag` strings the rule claims; claimed flags
//           bypass the unknown-flag rejection above (e.g. future --metrics)
// ctx = { rootDir, rootArg, mode: 'canvas'|'project', config, argv, flags,
//         fail, relLabel } where config is the parsed validate.config.json.
// A module that fails to import or lacks { id, run } is toolchain integrity
// damage (same class as toolchainScripts): exit 2 citing the file.
// Layout: rules/ next to this file (pack source) or under scripts/ (installed).
// ---------------------------------------------------------------------------
async function loadRules() {
  const book = { rules: [], flags: new Set() }
  for (const rel of ['./rules/', './scripts/rules/']) {
    const dirUrl = new URL(rel, import.meta.url)
    let entries = null
    try {
      entries = readdirSync(fileURLToPath(dirUrl), { withFileTypes: true })
    } catch {
      continue // absence policy: no rules dir in this layout = no rules
    }
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of files) {
      const label = `${rel}${entry.name}`
      let mod = null
      try {
        mod = await import(new URL(entry.name, dirUrl).href)
      } catch (error) {
        configFatal(`rules: ${label}: cannot import (${String(error?.message ?? error)})`, 2)
      }
      const { id, run } = mod ?? {}
      if (typeof id !== 'string' || id.length === 0 || typeof run !== 'function') {
        configFatal(`rules: ${label}: contract violation — must export { id: <string>, run: <function> }`, 2)
      }
      if (mod.flags !== undefined) {
        if (!Array.isArray(mod.flags) || mod.flags.some((f) => typeof f !== 'string' || !f.startsWith('--'))) {
          configFatal(`rules: ${label}: "flags" must be a list of --flag strings`, 2)
        }
        for (const flag of mod.flags) book.flags.add(flag)
      }
      book.rules.push({ id, run, file: label })
    }
    break // first layout that exists wins (mirrors importFromLayout)
  }
  return book
}

/** Invokes every registered rule. Rule problems print to stderr (rule output
 * contract) AND join `problems` (the pinned stdout "Fix these issues:" block
 * stays untouched, exit 1 = issues found). A rule that throws becomes one
 * `internal:` line — one broken rule never takes the run down. */
async function runRules(ctx) {
  for (const rule of ruleBook.rules) {
    const ruleFail = (code, message) => {
      const line = `- ${code}: ${message}`
      problems.push(line)
      console.error(line)
    }
    try {
      await rule.run({ ...ctx, fail: ruleFail })
    } catch (error) {
      fail('internal', `rule ${rule.id} (${rule.file}): ${String(error?.message ?? error)}`)
    }
  }
}

if (problems.length > 0) {
  console.log('Fix these issues:')
  for (const problem of problems) console.log(problem)
  process.exit(1)
}
process.exit(0)

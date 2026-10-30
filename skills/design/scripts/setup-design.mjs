#!/usr/bin/env node
/**
 * setup-design.mjs — one-time per-project setup + safe update for the design
 * skill (plan todo 24, GAP-10). Zero dependencies. Requires Node 18+.
 *
 * Usage:
 *   node setup-design.mjs --target <designDir> [--update] [--with-smoke] [--force]
 *
 *   --target <designDir>  the project's design/ folder (created when missing)
 *   --update              update an existing project: merge NEW keys of
 *                         validate.config.json into the user's config (user
 *                         values win, user keys are NEVER removed)
 *   --with-smoke          write design/package.json (private; playwright-core
 *                         pinned as devDependency — the zero-dep exception)
 *   --force               also replace user-patched divergent files (their
 *                         previous content is kept at <nome>.bak)
 *
 * Exit codes: 0 ok (warnings allowed) | 3 guided failure (fixable input).
 *
 * File policy (both modes — "nunca brick"):
 *   - validate.config.json: setup never overwrites an existing file; --update
 *     only ADDS missing keys from the shipped default. Corrupted JSON = exit 3
 *     citing the file, with <file>.bak preserving the user's bytes.
 *   - toolchain scripts carrying the `mockbird:config-driven:v2` marker
 *     (line 2, right after the shebang) are config-driven (their config lives in validate.config.json) = safe to
 *     replace on every run; a pre-config LEGACY script (a .mjs/.js WITHOUT the
 *     marker) is replaced by the config-driven copy (that is the fix for the
 *     restored-script flip-flop) and listed on stdout.
 *   - a user-patched file that differs from BOTH the old copy (the hash this
 *     tool recorded in <designDir>/.mockbird-manifest.json) AND the new copy is
 *     KEPT, the new copy is written to <nome>.new and a warning is printed.
 *     Without provenance (legacy projects) a diverged file is presumed
 *     user-patched — conservative on purpose.
 *   - screens (canvas.json + *.html), data/, actions/, spec/, snapshots/ and
 *     every file outside the copy list are never touched.
 *
 * Windows-safe: node:path everywhere, `\` normalized to `/` in every managed
 * path, case-insensitive collision detection (warn list), UTF-8 without BOM
 * round-trip (byte-exact copies). Idempotent: a second run reports "0 changes".
 *
 * Copy list — single source `skills/design/scripts/copy-list.json` (todo 25).
 * Consumption contract (strict; malformed = exit 3):
 *   {
 *     "version": 1,
 *     "dirs": ["data", "actions", "spec", "snapshots"],   // optional
 *     "files": [
 *       { "from": "scripts/validate.mjs", "to": "validate.mjs" },
 *       { "from": "assets/components", "to": "components" }
 *     ]
 *   }
 *   - `from` is relative to the SKILL ROOT (the folder holding SKILL.md);
 *     `to` is relative to the target design dir. Both are normalized paths
 *     (no `..`, no absolute, no drive letters). A directory `from` is copied
 *     recursively (one operation per file).
 *   - only the keys `version`, `dirs`, `files` exist; `to` values are unique.
 *   - when the file is absent the built-in fallback list is used (the SKILL.md
 *     "One-time setup per project" copy list + validate.config.json).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const CONFIG_MARKER = '/* mockbird:config-driven:v2 */'
const CONFIG_NAME = 'validate.config.json'
const MANIFEST_NAME = '.mockbird-manifest.json'
const PLAYWRIGHT_CORE_VERSION = '1.64.1' // pinned exact — matches the repo root devDependency
const SCRIPT_EXTS = new Set(['.mjs', '.js'])
const DEFAULT_DIRS = ['data', 'actions', 'spec', 'snapshots']

// Built-in fallback copy list = SKILL.md "One-time setup per project" +
// validate.config.json. Single source of truth once copy-list.json exists
// (todo 25) — this list is the "só entra arquivo que já existe" floor.
const FALLBACK_FILES = [
  { from: 'assets/docs.html', to: 'docs.html' },
  { from: 'assets/mock.css', to: 'mock.css' },
  { from: 'assets/mock.js', to: 'mock.js' },
  { from: 'assets/serve.mjs', to: 'serve.mjs' },
  { from: 'assets/tokens.contract.md', to: 'tokens.contract.md' },
  { from: 'assets/validate.config.json', to: 'validate.config.json' },
  { from: 'assets/vendor/html-to-image.js', to: 'vendor/html-to-image.js' },
  { from: 'assets/viewer.html', to: 'viewer.html' },
  { from: 'assets/components', to: 'components' },
  { from: 'scripts/export-tokens.mjs', to: 'scripts/export-tokens.mjs' },
  { from: 'scripts/gen-tokens.mjs', to: 'scripts/gen-tokens.mjs' },
  { from: 'scripts/lib/token-groups.mjs', to: 'scripts/lib/token-groups.mjs' },
  { from: 'scripts/marker-parser.mjs', to: 'scripts/marker-parser.mjs' },
  { from: 'scripts/sync-components.mjs', to: 'scripts/sync-components.mjs' },
  { from: 'scripts/validate.mjs', to: 'validate.mjs' },
]

/* ------------------------------------------------------- path/case helpers */

/** Normalize a managed relative path to POSIX form or throw (guided input).
 * Accepts `\` separators (Windows/PowerShell input); rejects empty paths,
 * absolute paths, drive letters, UNC prefixes and `..`/`.` segments. */
export function normalizeRel(input) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('path must be a non-empty string')
  let p = input.replaceAll('\\', '/')
  if (/^[a-zA-Z]:/.test(p)) throw new Error(`drive letters are not allowed: ${input}`)
  if (p.startsWith('//')) throw new Error(`UNC paths are not allowed: ${input}`)
  p = p.replace(/\/+/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  while (p.startsWith('/')) p = p.slice(1)
  if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1)
  if (p.length === 0) throw new Error(`empty path: ${input}`)
  const segments = p.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') throw new Error(`path segment "${seg}" is not allowed: ${input}`)
  }
  return segments.join('/')
}

/** Case-insensitive collision groups among relative paths (Windows safety).
 * Paths are normalized first (`\` and `/` are one separator on Windows).
 * Returns a sorted list of groups (each ≥2 distinct paths differing only in
 * case) — the warn list the engine prints. Exact duplicates are not collisions. */
export function detectCaseCollisions(relPaths) {
  const byLower = new Map()
  for (const p of relPaths) {
    let norm = p
    try {
      norm = normalizeRel(p)
    } catch {
      // unnormalizable input: compare as-is (still a collision candidate)
    }
    const key = norm.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, new Set())
    byLower.get(key).add(norm)
  }
  const groups = []
  for (const set of byLower.values()) {
    if (set.size > 1) groups.push([...set].sort())
  }
  groups.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return groups
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function hasConfigMarker(buf) {
  return buf.includes(CONFIG_MARKER)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walkFiles(dir, prefix) {
  const out = []
  const entries = readdirSync(dir, { withFileTypes: true })
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walkFiles(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

/* ---------------------------------------------------------- copy list load */

function loadCopyList(scriptDir, skillRoot) {
  const listPath = join(scriptDir, 'copy-list.json')
  if (!existsSync(listPath)) {
    return { source: 'built-in fallback (SKILL.md copy list + validate.config.json)', files: FALLBACK_FILES, dirs: DEFAULT_DIRS }
  }
  const raw = readFileSync(listPath, 'utf8').replace(/^\uFEFF/, '')
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error(`setup-design: ${listPath} is not valid JSON (${error.message})`)
    console.error('  fix copy-list.json (schema: {version: 1, dirs?, files: [{from, to}]}) and rerun')
    process.exit(3)
  }
  const fail = (message) => {
    console.error(`setup-design: ${listPath} is malformed: ${message}`)
    console.error('  fix copy-list.json (schema: {version: 1, dirs?, files: [{from, to}]}) and rerun')
    process.exit(3)
  }
  if (!isPlainObject(parsed)) fail('root must be a JSON object')
  for (const key of Object.keys(parsed)) {
    if (key !== 'version' && key !== 'dirs' && key !== 'files') fail(`unknown key "${key}"`)
  }
  if (parsed.version !== 1) fail(`"version" must be 1 (got ${JSON.stringify(parsed.version)})`)
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) fail('"files" must be a non-empty array')
  const files = []
  const seen = new Set()
  for (let i = 0; i < parsed.files.length; i++) {
    const item = parsed.files[i]
    if (!isPlainObject(item)) fail(`files[${i}] must be an object`)
    for (const key of Object.keys(item)) {
      if (key !== 'from' && key !== 'to') fail(`files[${i}]: unknown key "${key}"`)
    }
    if (typeof item.from !== 'string' || typeof item.to !== 'string') fail(`files[${i}]: "from" and "to" must be strings`)
    let from = null
    let to = null
    try {
      from = normalizeRel(item.from)
      to = normalizeRel(item.to)
    } catch (error) {
      fail(`files[${i}]: ${error.message}`)
    }
    if (seen.has(to)) fail(`files[${i}]: duplicate "to" (${to})`)
    seen.add(to)
    if (!existsSync(join(skillRoot, from))) fail(`files[${i}]: source not found in the skill folder (${from})`)
    files.push({ from, to })
  }
  let dirs = DEFAULT_DIRS
  if (parsed.dirs !== undefined) {
    if (!Array.isArray(parsed.dirs) || parsed.dirs.some((d) => typeof d !== 'string')) fail('"dirs" must be an array of strings')
    dirs = parsed.dirs.map((d) => {
      try {
        return normalizeRel(d)
      } catch (error) {
        fail(`"dirs": ${error.message}`)
        return null
      }
    })
  }
  files.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
  return { source: listPath, files, dirs }
}

/* ------------------------------------------------------------- config merge */

/** Deep defaults merge: keys missing from the user config are ADDED from the
 * shipped default (objects recurse; arrays/scalars are leaves where the user
 * value wins). User keys are NEVER removed. Returns the sorted dotted keys
 * that were added. */
function mergeConfigDefaults(user, defaults, prefix, added) {
  for (const key of Object.keys(defaults)) {
    const dotted = prefix ? `${prefix}${key}` : key
    if (!(key in user)) {
      user[key] = JSON.parse(JSON.stringify(defaults[key]))
      added.push(dotted)
    } else if (isPlainObject(user[key]) && isPlainObject(defaults[key])) {
      mergeConfigDefaults(user[key], defaults[key], `${dotted}.`, added)
    }
  }
  return added
}

/* -------------------------------------------------------------------- main */

function usage() {
  console.log(`setup-design.mjs — per-project setup and safe update for the design skill.

Usage:
  node setup-design.mjs --target <designDir> [--update] [--with-smoke] [--force]

  --target <designDir>  the project's design/ folder (created when missing)
  --update              merge new validate.config.json keys into the user's
                        config (user values win; user keys are never removed)
  --with-smoke          write design/package.json (private; playwright-core
                        pinned as devDependency)
  --force               replace user-patched divergent files too (their
                        previous content is kept at <nome>.bak)

Exit codes: 0 ok (warnings allowed) | 3 guided failure.
Copy list: skills/design/scripts/copy-list.json when present, else the
built-in SKILL.md copy list + validate.config.json.`)
}

function main() {
  const argv = process.argv.slice(2)
  const args = { update: false, withSmoke: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target' || arg === '-t') args.target = argv[++i]
    else if (arg === '--update' || arg === '-u') args.update = true
    else if (arg === '--with-smoke') args.withSmoke = true
    else if (arg === '--force') args.force = true
    else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      console.error(`setup-design: unknown argument: ${arg}`)
      usage()
      process.exit(3)
    }
  }
  if (!args.target || args.target.trim() === '') {
    console.error('setup-design: --target <designDir> is required')
    usage()
    process.exit(3)
  }

  const targetRoot = resolve(args.target)
  if (existsSync(targetRoot) && !statSync(targetRoot).isDirectory()) {
    console.error(`setup-design: --target exists and is not a folder: ${targetRoot}`)
    console.error('  point --target at the project design/ folder')
    process.exit(3)
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const skillRoot = dirname(scriptDir)
  const shippedConfigPath = join(skillRoot, 'assets', CONFIG_NAME)
  if (!existsSync(shippedConfigPath)) {
    console.error(`setup-design: incomplete skill package — ${shippedConfigPath} not found`)
    console.error('  run this script from the skill folder (skills/design/scripts/setup-design.mjs)')
    process.exit(3)
  }

  const mode = args.update ? 'update' : 'setup'
  console.log(`setup-design: ${mode} → ${targetRoot}`)
  console.log(`  source: ${skillRoot}`)

  const list = loadCopyList(scriptDir, skillRoot)
  console.log(`  copy-list: ${list.source}`)

  const createdTarget = !existsSync(targetRoot)
  if (createdTarget) mkdirSync(targetRoot, { recursive: true })

  // --with-smoke: managed tool file (same divergence rules as copy-list files)
  const ops = []
  const sourceToDest = new Map()
  for (const entry of list.files) {
    const fromAbs = resolve(skillRoot, entry.from)
    const st = statSync(fromAbs)
    if (st.isDirectory()) {
      for (const rel of walkFiles(fromAbs, '')) {
        ops.push({ from: join(fromAbs, rel), to: normalizeRel(`${entry.to}/${rel}`) })
      }
    } else {
      ops.push({ from: fromAbs, to: entry.to })
    }
    sourceToDest.set(entry.from, entry.to)
  }
  if (args.withSmoke) ops.push({ from: null, to: 'package.json' })
  ops.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))

  // Windows safety: case-insensitive collision warn list (planned + on disk)
  const existing = existsSync(targetRoot) ? walkFiles(targetRoot, '') : []
  const collisions = detectCaseCollisions([...ops.map((op) => op.to), ...existing])
  for (const group of collisions) {
    console.log(`! case-collision (case-insensitive): ${group.join(' vs ')}`)
  }

  // shipped defaults with project-form toolchainScripts (derived via the
  // copy list: shipped entries resolve against assets/, then map to their dest)
  const shippedRaw = readFileSync(shippedConfigPath, 'utf8').replace(/^\uFEFF/, '')
  const defaults = JSON.parse(shippedRaw)
  const shippedConfigDir = dirname(shippedConfigPath)
  defaults.toolchainScripts = (defaults.toolchainScripts ?? []).map((entry) => {
    const abs = resolve(shippedConfigDir, entry.replaceAll('\\', '/'))
    const rel = relative(skillRoot, abs).replaceAll('\\', '/')
    const dest = sourceToDest.get(rel)
    if (dest === undefined) {
      console.log(`! copy-list has no destination for toolchain script ${rel} (kept as-is)`)
      return entry
    }
    return dest
  })

  const manifestPath = join(targetRoot, MANIFEST_NAME)
  const manifestBefore = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) : { version: 1, files: {} }
  const manifest = { version: 1, files: { ...manifestBefore.files } }
  let manifestTouched = false

  // fail fast: a corrupted validate.config.json aborts BEFORE any file is
  // written (a guided failure never leaves a half-updated project behind)
  const configTarget = join(targetRoot, CONFIG_NAME)
  if (ops.some((op) => op.to === CONFIG_NAME) && existsSync(configTarget)) {
    try {
      const parsed = JSON.parse(readFileSync(configTarget, 'utf8').replace(/^\uFEFF/, ''))
      if (!isPlainObject(parsed)) throw new Error('root must be a JSON object')
    } catch (error) {
      if (!existsSync(`${configTarget}.bak`)) {
        writeFileSync(`${configTarget}.bak`, readFileSync(configTarget))
        console.log(`+ ${CONFIG_NAME}.bak (your file preserved as a backup)`)
      }
      console.error(`setup-design: ${configTarget} is not valid ${CONFIG_NAME} (${error.message})`)
      console.error(`  your file was preserved and copied to ${configTarget}.bak`)
      console.error('  fix the JSON (or restore from the .bak) and rerun — setup-design.mjs never overwrites your config')
      process.exit(3)
    }
  }

  let changes = 0
  let warnings = 0

  const writeIfDifferent = (absPath, buf, reportLine) => {
    if (existsSync(absPath) && readFileSync(absPath).equals(buf)) return true
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, buf)
    changes++
    console.log(reportLine)
    return true
  }

  const recordManifest = (op, nBuf) => {
    if (manifest.files[op.to] !== sha256Hex(nBuf)) {
      manifest.files[op.to] = sha256Hex(nBuf)
      manifestTouched = true
    }
  }
  const writeFresh = (op, nBuf) => {
    writeIfDifferent(join(targetRoot, op.to), nBuf, `+ ${op.to}`)
    recordManifest(op, nBuf)
  }
  const replaceFile = (op, nBuf, reason) => {
    writeIfDifferent(join(targetRoot, op.to), nBuf, `~ ${op.to} (replaced: ${reason})`)
    recordManifest(op, nBuf)
  }

  for (const op of ops) {
    const target = join(targetRoot, op.to)

    if (op.to === 'package.json') {
      const pkg = `${JSON.stringify({ private: true, devDependencies: { 'playwright-core': PLAYWRIGHT_CORE_VERSION } }, null, 2)}\n`
      const nBuf = Buffer.from(pkg, 'utf8')
      if (!existsSync(target)) {
        writeFresh(op, nBuf)
      } else {
        const tBuf = readFileSync(target)
        if (tBuf.equals(nBuf)) {
          // unchanged
        } else {
          const clean = manifestBefore.files[op.to] === sha256Hex(tBuf)
          if (clean || args.force) {
            if (!clean) writeIfDifferent(`${target}.bak`, tBuf, `+ ${op.to}.bak (previous user copy kept)`)
            replaceFile(op, nBuf, 'smoke package.json updated')
          } else {
            writeIfDifferent(`${target}.new`, nBuf, `+ ${op.to}.new (new version kept aside)`)
            console.log(`! ${op.to} (kept user-patched copy; new version at ${op.to}.new)`)
            warnings++
          }
        }
      }
      continue
    }

    if (op.to === CONFIG_NAME) {
      if (!existsSync(target)) {
        // seed = shipped default with toolchainScripts in project form
        const seedBuf = Buffer.from(`${JSON.stringify(defaults, null, 2)}\n`, 'utf8')
        writeIfDifferent(target, seedBuf, `+ ${op.to} (seeded; toolchainScripts in project form)`)
        continue
      }
      const tBuf = readFileSync(target)
      const raw = tBuf.toString('utf8').replace(/^\uFEFF/, '')
      let userConfig = null
      try {
        userConfig = JSON.parse(raw)
        if (!isPlainObject(userConfig)) throw new Error('root must be a JSON object')
      } catch (error) {
        if (!existsSync(`${target}.bak`)) {
          writeFileSync(`${target}.bak`, tBuf)
          console.log(`+ ${op.to}.bak (your file preserved as a backup)`)
        }
        console.error(`setup-design: ${target} is not valid ${CONFIG_NAME} (${error.message})`)
        console.error(`  your file was preserved and copied to ${target}.bak`)
        console.error('  fix the JSON (or restore from the .bak) and rerun — setup-design.mjs never overwrites your config')
        process.exit(3)
      }
      if (!args.update) {
        console.log(`= ${op.to} (kept; setup never overwrites an existing config)`)
        continue
      }
      const added = mergeConfigDefaults(userConfig, defaults, '', [])
      if (added.length === 0) {
        console.log(`= ${op.to} (kept; no new keys to merge)`)
        continue
      }
      const merged = `${JSON.stringify(userConfig, null, 2)}\n`
      writeIfDifferent(target, Buffer.from(merged, 'utf8'), `~ ${op.to} (merged: added ${added.join(', ')})`)
      continue
    }

    const nBuf = readFileSync(op.from)
    if (!existsSync(target)) {
      writeFresh(op, nBuf)
      continue
    }
    const tBuf = readFileSync(target)
    if (tBuf.equals(nBuf)) continue

    const nMarked = hasConfigMarker(nBuf)
    const tMarked = hasConfigMarker(tBuf)
    const tIsScript = SCRIPT_EXTS.has(extname(op.to).toLowerCase())

    if (nMarked && !tMarked && tIsScript) {
      replaceFile(op, nBuf, 'legacy pre-config script')
    } else if (nMarked) {
      replaceFile(op, nBuf, 'toolchain update')
    } else {
      const clean = manifestBefore.files[op.to] === sha256Hex(tBuf)
      if (clean) {
        replaceFile(op, nBuf, 'asset update')
      } else if (args.force) {
        writeIfDifferent(`${target}.bak`, tBuf, `+ ${op.to}.bak (previous user copy kept)`)
        replaceFile(op, nBuf, 'user-patched copy replaced by --force')
      } else {
        writeIfDifferent(`${target}.new`, nBuf, `+ ${op.to}.new (new version kept aside)`)
        console.log(`! ${op.to} (kept user-patched copy; new version at ${op.to}.new)`)
        warnings++
      }
    }
  }

  // scaffold dirs (data/, actions/, spec/, snapshots/ — or the copy-list "dirs")
  for (const dir of list.dirs) {
    const abs = join(targetRoot, dir)
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true })
      changes++
      console.log(`+ ${dir}/ (dir)`)
    }
  }

  if (manifestTouched) {
    const ordered = {}
    for (const key of Object.keys(manifest.files).sort()) ordered[key] = manifest.files[key]
    const manifestBuf = Buffer.from(`${JSON.stringify({ version: 1, files: ordered }, null, 2)}\n`, 'utf8')
    const isNew = !existsSync(manifestPath)
    if (!existsSync(manifestPath) || !readFileSync(manifestPath).equals(manifestBuf)) {
      writeFileSync(manifestPath, manifestBuf)
      if (isNew) console.log(`+ ${MANIFEST_NAME} (tool manifest: hashes of the copies this tool wrote)`)
    }
  }

  if (changes === 0) console.log('0 changes')
  else console.log(`${changes} change${changes === 1 ? '' : 's'}`)
  if (warnings > 0) console.log(`${warnings} warning${warnings === 1 ? '' : 's'} — user-patched copies kept (never overwritten without --force)`)
}

const isMain = (() => {
  try {
    return (
      typeof process.argv[1] === 'string' &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
})()
if (isMain) main()

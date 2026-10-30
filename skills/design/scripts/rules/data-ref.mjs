/* mockbird:config-driven:v2 */
/**
 * data-ref (todo 21, GAP-7) — the $ref binder of the shared mock datasets:
 * data.json values of the exact form {"$ref": "file.json#key"} must resolve
 * from <design-root>/data/file.json (key = one top-level key of that file;
 * a dataset value may itself be a $ref — chains must end in inline data).
 * The design root is the validated root (project mode) or its parent (canvas
 * mode: canvases sit one level under the design root — screens include
 * ../mock.js, whose folder anchors data/ exactly like actions/).
 * Checks, one line per broken ref, every line CITES the file#key chain:
 *   - data-ref-shape  a "$ref" object is not exactly {"$ref": "file.json#key"}
 *   - data-ref-missing the dataset file is absent, unreadable, not valid JSON
 *                     or not a JSON object (message states the exact cause)
 *   - data-ref-key    the dataset exists but has no such top-level key
 *   - data-ref-cycle  circular chain (A -> B -> A) — never resolved at runtime
 * The runtime resolver (mock.js) degrades those same refs with a guided
 * console message and ZERO throw; this rule fails them at validate time.
 * Only refs REACHABLE from a canvas's data.json are checked (the runtime only
 * ever resolves those). Unparseable data.json is skipped — validate.mjs
 * already reports invalid-data. rules are standalone (loadRules() imports
 * every *.mjs in rules/ as a rule, so no shared helper can live there).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const id = 'data-ref'

const REF_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\.json#([A-Za-z0-9][A-Za-z0-9._-]*)$/

export function run(ctx) {
  const designRoot = ctx.mode === 'canvas' ? dirname(ctx.rootDir) : ctx.rootDir
  const storeDir = join(designRoot, 'data')
  const files = new Map() // dataset file name -> { ok, obj } | { ok: false, cause, code }
  for (const { dir, label } of discoverBinders(ctx, storeDir)) {
    let data = null
    try {
      data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'))
    } catch {
      continue // unparseable = validate.mjs's invalid-data job (skip)
    }
    checkValue(ctx, label, data, [], files, storeDir)
  }
}

/** Every $ref-bearing object found in `value` is shape-checked and resolved
 * through the store with the current `chain` (list of 'file#key' already
 * visited — a repeat is the circular case). Failures cite the full chain. */
function checkValue(ctx, label, value, chain, files, storeDir) {
  if (Array.isArray(value)) {
    for (const item of value) checkValue(ctx, label, item, chain, files, storeDir)
    return
  }
  if (!isPlainObject(value)) return
  if ('$ref' in value) {
    const raw = value.$ref
    const match = typeof raw === 'string' ? REF_RE.exec(raw) : null
    if (!match || Object.keys(value).length !== 1) {
      return ctx.fail(
        'data-ref-shape',
        `${label}: $ref ${JSON.stringify(raw)} must be exactly {"$ref": "file.json#key"} ` +
          `(file.json#key selects a top-level key of <design-root>/data/file.json)`,
      )
    }
    const file = `${match[1]}.json`
    const key = match[2]
    const ref = `${file}#${key}`
    const path = chain.concat(ref).map((r) => `"${r}"`).join(' -> ')
    if (chain.includes(ref)) {
      return ctx.fail(
        'data-ref-cycle',
        `${label}: circular $ref chain ${chain.concat(ref).join(' -> ')} — a reference chain must end in inline data`,
      )
    }
    const dataset = loadDataset(files, storeDir, file)
    if (!dataset.ok) {
      return ctx.fail('data-ref-missing', `${label}: $ref ${path} is broken — ${dataset.cause}`)
    }
    if (!Object.prototype.hasOwnProperty.call(dataset.obj, key)) {
      return ctx.fail(
        'data-ref-key',
        `${label}: $ref ${path} is broken — data/${file} has no key "${key}"`,
      )
    }
    checkValue(ctx, label, dataset.obj[key], chain.concat(ref), files, storeDir)
    return
  }
  for (const key of Object.keys(value)) checkValue(ctx, label, value[key], chain, files, storeDir)
}

/** One read per dataset file (cached); the cause string names the exact
 * failure so a broken ref is never a silent empty value. */
function loadDataset(files, storeDir, file) {
  if (files.has(file)) return files.get(file)
  let result
  let raw = null
  try {
    raw = readFileSync(join(storeDir, file), 'utf8')
  } catch {
    raw = null
  }
  if (raw === null) {
    result = {
      ok: false,
      cause: `data/${file} does not exist (shared datasets live in <design-root>/data/)`,
    }
  } else {
    let parsed = null
    let parseError = null
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      parseError = String(error.message)
    }
    if (parseError !== null) {
      result = { ok: false, cause: `data/${file} is not valid JSON (${parseError})` }
    } else if (!isPlainObject(parsed)) {
      result = { ok: false, cause: `data/${file} must contain a JSON object` }
    } else {
      result = { ok: true, obj: parsed }
    }
  }
  files.set(file, result)
  return result
}

/** Every dir carrying a data.json under the validated root (canvas binders;
 * broken canvases are checked too — their refs are just as broken). Exempt
 * dirs and the store dir itself are skipped: design/data/ holds datasets,
 * never a binder. Same discovery contract as rules/canvas-meta.mjs. */
function discoverBinders(ctx, storeDir) {
  const out = []
  const exempt = new Set(
    Array.isArray(ctx.config?.exemptDirs) ? ctx.config.exemptDirs.filter((d) => typeof d === 'string') : [],
  )
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {}
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isDirectory() && !exempt.has(entry.name) && join(dir, entry.name) !== storeDir) {
        walk(join(dir, entry.name))
      }
    }
    try {
      readFileSync(join(dir, 'data.json'), 'utf8')
    } catch {
      return
    }
    out.push({ dir, label: ctx.relLabel(ctx.rootDir, join(dir, 'data.json')) })
  }
  walk(ctx.rootDir)
  return out
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

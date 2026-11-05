#!/usr/bin/env node
/**
 * Design memory CLI (plan todo 18, GAP-B2) — Node stdlib only.
 * design/decisions.json is the per-project design decision register: each
 * decision gets a stable DEC-id, its reason, its scope and the screens it
 * governs. Decisions are NEVER deleted — a new decision supersedes the old one
 * (the old record keeps `status: "superseded"`, the new record carries
 * `supersedes`); a decision without `reason` is rejected (§5.3). `query`
 * answers "qual decisão causou esta mudança?" (by screen, DEC-id or text);
 * `impact` answers the reverse — given a DEC-id OR a screen it lists the
 * affected screens and the decisions that govern them. DEC-id is the join key
 * with approvals (todo 27) and evolution (todo 31).
 *
 * Usage: node decisions.mjs <command> [args] [--file <path>]
 *   add    --category <c> --decision <text> --reason <text> [--scope <s>]
 *          [--screens a.html,b.html] [--supersedes DEC-xxx]
 *          records the next DEC-id (DEC-001, DEC-002, ...); with --supersedes
 *          the referenced record flips to status "superseded"
 *   list   [--status active|superseded]   show the register
 *   query  <screen|DEC-id|text>           decisions matching the term
 *   impact <DEC-id|screen>                screens affected + decisions that
 *                                         govern them (both directions)
 *   delete/remove ...                     ALWAYS rejected — supersede instead
 *   --file <path>  register path (default: design/decisions.json)
 *
 * Exit codes: 0 = ok; 1 = rejected by contract or zero results (issue lines on
 * stdout — a zero-result list is never "ok"); 2 = usage/input error (unknown
 * command or flag, missing or invalid register — guided message on stderr,
 * never a stack). Register-derived text is sanitized on output: control chars
 * stripped, HTML escaped, whitespace collapsed, truncated — untrusted decision
 * text can never inject markup or terminal escapes into the listing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const usage = 'usage: node decisions.mjs <add|list|query|impact> [args] [--file <path>]'
const SHAPE = '{schemaVersion, decisions: [{id: "DEC-001", category, decision, reason, status, scope, screens: [], createdAt, supersedes}]}'

function fatal(message) {
  console.error(message)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Output sanitization (untrusted register text): control chars out, HTML
// escaped, whitespace collapsed, truncated. Applied to EVERY register-derived
// fragment (same contract as validate-brief.mjs).
// ---------------------------------------------------------------------------
function escapeOut(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function render(value) {
  return typeof value === 'string' ? `"${escapeOut(value)}"` : escapeOut(JSON.stringify(value) ?? String(value))
}

function typeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// CLI contract (mirrors validate-brief.mjs: unknown flags/extra args = exit 2).
// ---------------------------------------------------------------------------
const COMMANDS = new Set(['add', 'list', 'query', 'impact'])
const DELETE_COMMANDS = new Set(['delete', 'remove', 'rm'])
const COMMAND_FLAGS = {
  add: new Set(['--file', '--category', '--decision', '--reason', '--scope', '--screens', '--supersedes']),
  list: new Set(['--file', '--status']),
  query: new Set(['--file']),
  impact: new Set(['--file']),
}

const argv = process.argv.slice(2)
if (argv.length === 0) fatal(usage)
const command = argv[0]
if (DELETE_COMMANDS.has(command)) {
  console.error(
    `delete: decisions are never deleted — supersede instead: node decisions.mjs add --category <c> --decision <text> --reason <text> --supersedes ${argv[1] ?? 'DEC-xxx'}`,
  )
  process.exit(1)
}
if (!COMMANDS.has(command)) fatal(`unknown command "${escapeOut(command)}" — ${usage}`)

const flags = {}
const positional = []
for (let i = 1; i < argv.length; i++) {
  const token = argv[i]
  if (token.startsWith('--')) {
    if (!COMMAND_FLAGS[command].has(token)) fatal(`unknown flag "${escapeOut(token)}" for ${command} — ${usage}`)
    if (token in flags) fatal(`duplicate flag "${escapeOut(token)}" — ${usage}`)
    const value = argv[++i]
    if (value === undefined) fatal(`${token} requires a value — ${usage}`)
    flags[token] = value
  } else {
    positional.push(token)
  }
}
const expectedPositionals = command === 'query' || command === 'impact' ? 1 : 0
if (positional.length !== expectedPositionals) {
  fatal(`${command} expects ${expectedPositionals} positional arg(s), got ${positional.length} — ${usage}`)
}

const fileLabel = escapeOut(flags['--file'] ?? 'design/decisions.json')
const storePath = resolve(process.cwd(), flags['--file'] ?? 'design/decisions.json')

// ---------------------------------------------------------------------------
// Schema (single source of truth: assets/design-decisions.schema.json; dual
// layout like validate-brief.mjs: side-by-side or under assets/).
// ---------------------------------------------------------------------------
const schemaCandidates = [
  new URL('../assets/design-decisions.schema.json', import.meta.url),
  new URL('./design-decisions.schema.json', import.meta.url),
]
const schemaUrl = schemaCandidates.find((url) => existsSync(fileURLToPath(url)))
if (!schemaUrl) {
  fatal(`design-decisions.schema.json not found (checked ${schemaCandidates.map((u) => fileURLToPath(u)).join(' and ')})`)
}
let schema = null
try {
  schema = JSON.parse(readFileSync(fileURLToPath(schemaUrl), 'utf8'))
} catch (error) {
  fatal(`design-decisions.schema.json: cannot load schema — ${String(error?.message ?? error)}`)
}
if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
  fatal('design-decisions.schema.json: broken schema (root must define "properties")')
}

// ---------------------------------------------------------------------------
// Issues: one line each, `- category [severity] (fields): message` (same
// output contract as validate-brief.mjs). A zero-result list is never "ok":
// rejections AND empty results exit 1 with explicit lines.
// ---------------------------------------------------------------------------
const issues = []
const fail = (category, severity, fields, message) => issues.push({ category, severity, fields, message })

function printIssuesAndExit() {
  console.log('Fix these issues:')
  for (const issue of issues) {
    console.log(`- ${issue.category} [${issue.severity}] (${escapeOut(issue.fields)}): ${issue.message}`)
  }
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Shape validation driven by the schema file (required, const, enum, pattern,
// string minLength, array items, nullable union). Unknown fields are warnings
// that still block exit 0 — never accepted silently.
// ---------------------------------------------------------------------------
function fieldLabel(prefix, key) {
  return prefix ? `${prefix}.${key}` : key
}

function checkObject(value, spec, prefix) {
  const label = prefix || 'root'
  if (!isPlainObject(value)) {
    return fail('schema', 'error', label, `must be a JSON object, got ${typeName(value)}`)
  }
  const props = isPlainObject(spec.properties) ? spec.properties : {}
  for (const key of Object.keys(value)) {
    if (!isPlainObject(props[key])) {
      fail(
        'unknown-field',
        'warning',
        fieldLabel(prefix, key),
        `unknown field "${escapeOut(key)}" — never accepted silently; known fields: ${Object.keys(props).join(', ')}`,
      )
    }
  }
  for (const key of Array.isArray(spec.required) ? spec.required : []) {
    if (!(key in value)) {
      fail('schema', 'error', fieldLabel(prefix, key), `missing required field "${key}" (shape: ${SHAPE})`)
    }
  }
  for (const [key, sub] of Object.entries(props)) {
    if (key in value) checkValue(value[key], sub, fieldLabel(prefix, key))
  }
}

function checkValue(value, spec, path) {
  if (spec.const !== undefined) {
    if (value !== spec.const) {
      fail('schema', 'error', path, `expected ${JSON.stringify(spec.const)}, got ${render(value)}`)
    }
    return
  }
  if (Array.isArray(spec.enum)) {
    if (!spec.enum.includes(value)) {
      fail('schema', 'error', path, `expected one of ${spec.enum.map((v) => JSON.stringify(v)).join('|')}, got ${render(value)}`)
    }
    return
  }
  const types = Array.isArray(spec.type) ? spec.type : [spec.type]
  const matched = types.some((t) =>
    t === 'null'
      ? value === null
      : t === 'string'
        ? typeof value === 'string'
        : t === 'array'
          ? Array.isArray(value)
          : t === 'object'
            ? isPlainObject(value)
            : t === 'number'
              ? typeof value === 'number'
              : false,
  )
  if (!matched) {
    return fail('schema', 'error', path, `expected ${types.join('|')}, got ${typeName(value)}`)
  }
  if (typeof value === 'string') {
    if (typeof spec.pattern === 'string' && !new RegExp(spec.pattern).test(value)) {
      fail('schema', 'error', path, `expected format ${spec.pattern}, got ${render(value)}`)
    }
    if (typeof spec.minLength === 'number' && value.trim().length < spec.minLength) {
      fail('schema', 'error', path, 'empty string — fill the field in')
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkValue(item, spec.items ?? {}, `${path}[${index}]`))
  }
}

// ---------------------------------------------------------------------------
// Supersede graph consistency (stale_state detection). The register is
// append-only: a superseded record must show status "superseded", exactly one
// successor per decision, links must resolve. Hand-edited corruption is caught
// on EVERY read — a stale decision can never pass as active.
// ---------------------------------------------------------------------------
function checkGraph(decisions) {
  const byId = new Map()
  decisions.forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.id !== 'string') return
    if (byId.has(entry.id)) {
      fail('duplicate-id', 'error', `decisions[${index}].id`, `id ${render(entry.id)} already used by ${byId.get(entry.id)}`)
    } else {
      byId.set(entry.id, `decisions[${index}]`)
    }
  })
  const successorOf = new Map()
  decisions.forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.supersedes !== 'string') return
    const label = `decisions[${index}].supersedes`
    if (entry.supersedes === entry.id) {
      return fail('supersede', 'error', label, `decision ${render(entry.id)} supersedes itself`)
    }
    if (!byId.has(entry.supersedes)) {
      return fail('supersede', 'error', label, `target ${render(entry.supersedes)} does not exist in ${fileLabel}`)
    }
    if (successorOf.has(entry.supersedes)) {
      return fail('supersede', 'error', label, `${render(entry.supersedes)} already superseded by ${render(successorOf.get(entry.supersedes))} — one successor per decision`)
    }
    successorOf.set(entry.supersedes, entry.id)
    const target = decisions.find((d) => isPlainObject(d) && d.id === entry.supersedes)
    if (isPlainObject(target) && target.status !== 'superseded') {
      fail('stale-state', 'error', `${byId.get(entry.supersedes)}.status`, `${render(entry.supersedes)} is superseded by ${render(entry.id)} but still shows status ${render(target.status)} — set it to "superseded"`)
    }
  })
  decisions.forEach((entry, index) => {
    if (!isPlainObject(entry) || entry.status !== 'superseded' || typeof entry.id !== 'string') return
    if (!successorOf.has(entry.id)) {
      fail('stale-state', 'error', `decisions[${index}].status`, `${render(entry.id)} shows status "superseded" but no decision supersedes it — restore "active" or register the successor`)
    }
  })
}

function checkStore(store) {
  checkObject(store, schema, '')
  if (isPlainObject(store) && Array.isArray(store.decisions)) {
    const items = schema.properties?.decisions?.items ?? {}
    store.decisions.forEach((entry, index) => {
      if (isPlainObject(entry)) checkObject(entry, items, `decisions[${index}]`)
    })
    checkGraph(store.decisions)
  }
}

// ---------------------------------------------------------------------------
// Register IO. Invalid JSON is a guided exit 2, never a stack trace.
// ---------------------------------------------------------------------------
function loadStore(path, label) {
  let raw = null
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    fatal(`${label}: decisions register not found — record the first decision with: node decisions.mjs add --category <c> --decision <text> --reason <text> (shape: ${SHAPE})`)
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    fatal(`${label}: invalid JSON — ${escapeOut(String(error?.message ?? error))}`)
  }
}

// ---------------------------------------------------------------------------
// Shared output: one line per decision, every register-derived fragment
// escaped (untrusted decision/reason text can never inject markup).
// ---------------------------------------------------------------------------
function decisionLine(entry) {
  return (
    `- ${escapeOut(entry.id)} [${escapeOut(entry.status)}]` +
    ` category="${escapeOut(entry.category)}" decision="${escapeOut(entry.decision)}" reason="${escapeOut(entry.reason)}"` +
    ` scope="${escapeOut(entry.scope)}" screens="${escapeOut((Array.isArray(entry.screens) ? entry.screens : []).join(', '))}"` +
    ` createdAt="${escapeOut(entry.createdAt)}" supersedes="${escapeOut(entry.supersedes ?? '-')}" `
  ).trimEnd()
}

function matchScreen(a, b) {
  const na = String(a).trim().toLowerCase()
  const nb = String(b).trim().toLowerCase()
  return na === nb || na.includes(nb) || nb.includes(na)
}

function matchesTerm(entry, term) {
  const t = term.trim().toLowerCase()
  if (String(entry.id).toLowerCase() === t) return true
  if (entry.screens.some((s) => matchScreen(s, term))) return true
  return [entry.category, entry.decision, entry.reason, entry.scope].some((f) => String(f).toLowerCase().includes(t))
}

// ---------------------------------------------------------------------------
// add — assign next DEC-id, enforce reason, supersede instead of delete.
// ---------------------------------------------------------------------------
function cmdAdd() {
  if (positional.length !== 0) fatal(`add takes no positional args — ${usage}`)
  for (const [flag, field] of [
    ['--category', 'category'],
    ['--decision', 'decision'],
    ['--reason', 'reason'],
  ]) {
    const raw = flags[flag]
    if (raw === undefined || raw.trim() === '') {
      fail('schema', 'error', field, `missing required field "${field}" — a decision without ${field} is rejected${field === 'reason' ? ' (§5.3: no decision without reason)' : ''}`)
    }
  }
  if (issues.length > 0) printIssuesAndExit()

  let supersedes = null
  if (flags['--supersedes'] !== undefined) {
    const raw = flags['--supersedes'].trim()
    if (!/^DEC-\d{3,}$/i.test(raw)) fatal(`--supersedes: expected a DEC-id like DEC-001, got ${render(raw)} — ${usage}`)
    supersedes = raw.toUpperCase()
  }

  const fresh = !existsSync(storePath)
  const store = fresh ? { schemaVersion: 1, decisions: [] } : loadStore(storePath, fileLabel)
  checkStore(store)
  if (issues.length > 0) printIssuesAndExit()

  let target = null
  if (supersedes !== null) {
    target = store.decisions.find((d) => isPlainObject(d) && d.id === supersedes)
    if (target === undefined) {
      fail('supersede', 'error', '--supersedes', `target ${render(supersedes)} does not exist in ${fileLabel} — check ids with: node decisions.mjs list`)
      printIssuesAndExit()
    }
    if (target.status !== 'active') {
      const successor = store.decisions.find((d) => isPlainObject(d) && d.supersedes === supersedes)
      fail('supersede', 'error', '--supersedes', `${render(supersedes)} is already superseded by ${render(successor?.id ?? '(unknown)')} — supersede the active successor instead`)
      printIssuesAndExit()
    }
  }

  let max = 0
  for (const entry of store.decisions) {
    const m = isPlainObject(entry) && /^DEC-(\d+)$/.exec(String(entry.id ?? ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  const entry = {
    id: `DEC-${String(max + 1).padStart(3, '0')}`,
    category: flags['--category'].trim(),
    decision: flags['--decision'].trim(),
    reason: flags['--reason'].trim(),
    status: 'active',
    scope: (flags['--scope'] ?? 'global').trim() || 'global',
    screens: (flags['--screens'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    createdAt: new Date().toISOString().slice(0, 10),
    supersedes,
  }
  if (target !== null) target.status = 'superseded'
  store.decisions.push(entry)

  checkStore(store)
  if (issues.length > 0) printIssuesAndExit()

  mkdirSync(dirname(storePath), { recursive: true })
  writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8')
  console.log(`added ${decisionLine(entry)}`)
  if (target !== null) console.log(`superseded ${escapeOut(target.id)}: status "superseded" (superseded by ${escapeOut(entry.id)})`)
  console.log(`${fileLabel}: ${store.decisions.length} decision(s)`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// list — full register (optional status filter). Empty is never "ok".
// ---------------------------------------------------------------------------
function cmdList() {
  if (positional.length !== 0) fatal(`list takes no positional args — ${usage}`)
  const status = flags['--status']
  if (status !== undefined && status !== 'active' && status !== 'superseded') {
    fatal(`--status: expected active or superseded, got ${render(status)} — ${usage}`)
  }
  const store = loadStore(storePath, fileLabel)
  checkStore(store)
  if (issues.length > 0) printIssuesAndExit()

  const all = store.decisions
  const shown = status === undefined ? all : all.filter((e) => e.status === status)
  if (shown.length === 0) {
    console.log(`list: 0 decision(s) in ${fileLabel}${status === undefined ? '' : ` with status "${escapeOut(status)}"`} — record the first with: node decisions.mjs add --category <c> --decision <text> --reason <text>`)
    process.exit(1)
  }
  const active = all.filter((e) => e.status === 'active').length
  console.log(`decisions: ${all.length} total (${active} active, ${all.length - active} superseded) — ${fileLabel}`)
  for (const entry of shown) console.log(decisionLine(entry))
  process.exit(0)
}

// ---------------------------------------------------------------------------
// query — "qual decisão causou esta mudança?": by screen, DEC-id or text.
// ---------------------------------------------------------------------------
function cmdQuery() {
  const term = positional[0]
  if (term.trim() === '') fatal(`query: empty term — ${usage}`)
  const store = loadStore(storePath, fileLabel)
  checkStore(store)
  if (issues.length > 0) printIssuesAndExit()

  const matches = store.decisions.filter((e) => matchesTerm(e, term))
  if (matches.length === 0) {
    console.log(`query ${render(term)}: 0 decision(s) matched in ${fileLabel} — nothing in the register explains this change; record it with: node decisions.mjs add --category <c> --decision <text> --reason <text>`)
    process.exit(1)
  }
  console.log(`query ${render(term)}: ${matches.length} decision(s) in ${fileLabel}`)
  for (const entry of matches) console.log(decisionLine(entry))
  process.exit(0)
}

// ---------------------------------------------------------------------------
// impact — both directions: DEC-id -> screens affected + decisions governing
// them; screen -> decisions governing it + screens those decisions affect.
// ---------------------------------------------------------------------------
function cmdImpact() {
  const target = positional[0]
  const store = loadStore(storePath, fileLabel)
  checkStore(store)
  if (issues.length > 0) printIssuesAndExit()

  const screenSet = new Set()
  let governing = []
  if (/^DEC-\d+$/i.test(target)) {
    const id = target.toUpperCase()
    const entry = store.decisions.find((e) => isPlainObject(e) && e.id === id)
    if (entry === undefined) {
      const known = store.decisions.map((e) => e.id).join(', ')
      console.log(`impact ${render(target)}: 0 results — no such decision in ${fileLabel}${known ? ` (known ids: ${escapeOut(known)})` : ''}`)
      process.exit(1)
    }
    for (const s of entry.screens) screenSet.add(s)
    governing = store.decisions.filter((e) => e.screens.some((s) => entry.screens.some((t) => matchScreen(s, t))))
  } else {
    governing = store.decisions.filter((e) => e.screens.some((s) => matchScreen(s, target)))
    if (governing.length === 0) {
      console.log(`impact ${render(target)}: 0 results — no decision in ${fileLabel} governs this screen; register one before changing it: node decisions.mjs add --category <c> --decision <text> --reason <text> --screens ${escapeOut(target)}`)
      process.exit(1)
    }
    for (const e of governing) for (const s of e.screens) screenSet.add(s)
  }

  const screens = [...screenSet]
  if (screens.length === 0 && governing.length === 0) {
    console.log(`impact ${render(target)} — ${fileLabel}`)
    console.log('screens affected (0):')
    console.log('- (none registered)')
    console.log('decisions governing those screens (0):')
    console.log('- (none)')
    process.exit(1)
  }
  console.log(`impact ${render(target)} — ${fileLabel}`)
  if (/^DEC-\d+$/i.test(target)) {
    console.log(`screens affected (${screens.length}):`)
    for (const s of screens.length > 0 ? screens : ['(none registered)']) console.log(`- ${escapeOut(s)}`)
    console.log(`decisions governing those screens (${governing.length}):`)
    for (const e of governing.length > 0 ? governing : [{ id: '(none)', status: '', category: '', decision: '', reason: '', scope: '', screens: [], createdAt: '', supersedes: null }]) {
      console.log(e.id === '(none)' ? '- (none)' : decisionLine(e))
    }
  } else {
    console.log(`decisions governing this screen (${governing.length}):`)
    for (const e of governing) console.log(decisionLine(e))
    console.log(`screens affected by those decisions (${screens.length}):`)
    for (const s of screens.length > 0 ? screens : ['(none registered)']) console.log(`- ${escapeOut(s)}`)
  }
  process.exit(screens.length > 0 || governing.length > 0 ? 0 : 1)
}

if (command === 'add') cmdAdd()
else if (command === 'list') cmdList()
else if (command === 'query') cmdQuery()
else cmdImpact()

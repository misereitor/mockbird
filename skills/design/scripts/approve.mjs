#!/usr/bin/env node
/**
 * Design approval CLI (plan todo 27, GAP-D2) — Node stdlib only.
 * design/approvals.json is the per-project approval register: one entry per
 * screen bound by SHA-256 to the screen FILE content at the moment of the last
 * status decision. Hash scope = the screen file ONLY (mock.css/tokens.json
 * changes do NOT reopen an approval — declared limit; composite hash is out of
 * this plan). CENTRAL RULE: when the screen content changes (current hash ≠
 * recorded hash) an approved|implemented entry is auto-downgraded to "review"
 * by verify — an approval never survives its content ("proibido deixar
 * aprovado quando o hash mudar").
 *
 * Approval is tied to DEC-ids (todo 18): when an ACTIVE decision in the
 * decisions register governs the screen, set-status approved|implemented
 * REQUIRES --dec citing every governing decision (governance lookup mirrors
 * `decisions.mjs query` screen matching); unknown DEC-ids are rejected.
 *
 * Usage: node approve.mjs <set-status|verify> [args] [--file <path>]
 *   [--decisions <path>] [--target <dir>]
 *   set-status <tela> <status> [--dec DEC-001,DEC-002] [--reviewed-by <who>]
 *          status: draft|review|changes-requested|approved|implemented
 *          <tela>: screen id, "canvas/id" or file name (canvas.json discovery)
 *          every set-status rebinds contentHash to the CURRENT file bytes —
 *          approving without a hash (missing/unreadable screen file) is
 *          rejected ("proibido aprovar sem hash")
 *   verify   rechecks the whole register: screen files exist, every recorded
 *            contentHash matches the current bytes (ANY mismatch fails — a
 *            stale record never passes as ok), approved|implemented entries
 *            cite the decisions that govern them; approved|implemented entries
 *            whose hash changed are auto-downgraded to "review" IN THE
 *            REGISTER (status flip only — contentHash stays as provenance)
 *   --file <path>        approvals register (default: design/approvals.json)
 *   --decisions <path>   decisions register for the DEC join (default:
 *                        design/decisions.json — the same register as
 *                        decisions.mjs --file; absent = no decision governs)
 *   --target <dir>       design root holding the canvas dirs (default: design,
 *                        falling back to skills/design/assets/example when
 *                        design/ has no canvas — the fallback is printed)
 *
 * Exit codes: 0 = ok; 1 = rejected by contract/state ("Fix these issues:"
 * lines on stdout — a stale, tampered or empty register is never "ok");
 * 2 = usage/input error (unknown command/flag/status, unresolvable tela,
 * missing or invalid register — guided message on stderr, never a stack).
 * Register-derived text is sanitized on output (same contract as
 * decisions.mjs: control chars stripped, HTML escaped, truncated).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const usage =
  'usage: node approve.mjs <set-status|verify> [args] [--file <path>] [--decisions <path>] [--target <dir>]'
const SHAPE = '{schemaVersion, approvals: [{screen, contentHash: sha256, status, decIds: [], reviewedBy, at}]}'
const STATUSES = ['draft', 'review', 'changes-requested', 'approved', 'implemented']
// Statuses that CLAIM content sign-off: they need DEC-ids when a decision
// governs the screen and they are auto-downgraded when the hash changes.
const GREEN = new Set(['approved', 'implemented'])
const SKIP_DIRS = new Set(['node_modules', '.history', 'snapshots', 'vendor', 'scripts', 'spec', '.visual'])

function fatal(message) {
  console.error(message)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Output sanitization (untrusted register text) — same contract as
// decisions.mjs: control chars out, HTML escaped, whitespace collapsed.
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

const sha256Hex = (buffer) => createHash('sha256').update(buffer).digest('hex')

// ---------------------------------------------------------------------------
// CLI contract (mirrors decisions.mjs: unknown flags/extra args = exit 2).
// ---------------------------------------------------------------------------
const COMMANDS = new Set(['set-status', 'verify'])
const COMMAND_FLAGS = {
  'set-status': new Set(['--file', '--decisions', '--target', '--dec', '--reviewed-by']),
  verify: new Set(['--file', '--decisions', '--target']),
}

const argv = process.argv.slice(2)
if (argv.length === 0) fatal(usage)
const command = argv[0]
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
const expectedPositionals = command === 'set-status' ? 2 : 0
if (positional.length !== expectedPositionals) {
  fatal(`${command} expects ${expectedPositionals} positional arg(s), got ${positional.length} — ${usage}`)
}

// ---------------------------------------------------------------------------
// Issues: one line each, `- category [severity] (fields): message` (same
// output contract as decisions.mjs/validate-brief.mjs).
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
// Target + screen discovery (canvas.json manifests — same convention as
// visual-orchestrator.mjs/agent-map.mjs). `--target` is authoritative; the
// implicit default prefers ./design and falls back to the pack example so the
// documented cycle works from the repository root.
// ---------------------------------------------------------------------------
function canvasDirsUnder(root) {
  if (existsSync(join(root, 'canvas.json'))) return [root]
  const found = []
  const walk = (dir) => {
    let entries = null
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (existsSync(join(full, 'canvas.json'))) found.push(full)
      walk(full)
    }
  }
  walk(root)
  return found
}

function resolveTarget() {
  if (flags['--target'] !== undefined) return resolve(flags['--target'])
  const design = resolve('design')
  if (canvasDirsUnder(design).length > 0) return design
  const example = resolve('skills/design/assets/example')
  if (canvasDirsUnder(example).length > 0) {
    console.error('approve.mjs: design/ sem canvas — target implícito: skills/design/assets/example (use --target para fixar)')
    return example
  }
  return design
}

function discoverScreens(root) {
  const screens = []
  for (const dir of canvasDirsUnder(root)) {
    const rel = dir === root ? '' : dir.slice(root.length + 1).split('\\').join('/')
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'canvas.json'), 'utf8'))
    } catch (error) {
      fatal(`canvas.json inválido (${rel ? `${rel}/` : ''}canvas.json): ${escapeOut(String(error?.message ?? error))}`)
    }
    if (!isPlainObject(manifest) || !Array.isArray(manifest.screens)) {
      fatal(`canvas.json fora do contrato (${rel ? `${rel}/` : ''}canvas.json): esperado objeto com "screens"`)
    }
    for (const [index, entry] of manifest.screens.entries()) {
      if (!isPlainObject(entry) || typeof entry.file !== 'string' || entry.file.length === 0) {
        fatal(`${rel ? `${rel}/` : ''}canvas.json: screen #${index + 1} precisa de "file"`)
      }
      screens.push({
        canvas: rel,
        tela: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : entry.file.replace(/\.[^.]+$/, ''),
        file: rel ? `${rel}/${entry.file}` : entry.file,
      })
    }
  }
  return screens
}

/** tela = screen id, "canvas/id", "canvas/file" or bare file name. */
function resolveTela(screens, query) {
  const q = query.trim().toLowerCase()
  const forms = (s) => [`${s.canvas}/${s.tela}`.toLowerCase(), `${s.canvas}/${s.file.split('/').pop()}`.toLowerCase(), s.tela.toLowerCase(), s.file.split('/').pop().toLowerCase()]
  const exact = screens.filter((s) => forms(s).includes(q))
  const matches = exact.length > 0 ? exact : screens.filter((s) => forms(s).some((f) => f.includes(q) || q.includes(f)))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) {
    const known = screens.map((s) => s.tela).join(', ')
    fatal(`tela ${render(query)} não encontrada em ${escapeOut(targetLabel)}${known ? ` — telas conhecidas: ${escapeOut(known)}` : ''}`)
  }
  fatal(`tela ${render(query)} ambígua (${matches.length} candidatas) — use canvas/id: ${escapeOut(matches.map((s) => `${s.canvas}/${s.tela}`).join(', '))}`)
}

// ---------------------------------------------------------------------------
// Decisions join (todo 18). Same screen matching as decisions.mjs query/impact
// (matchScreen: case-insensitive equality or mutual substring). A missing
// register means "no decision governs" (the join is skipped and said so).
// ---------------------------------------------------------------------------
function matchScreen(a, b) {
  const na = String(a).trim().toLowerCase()
  const nb = String(b).trim().toLowerCase()
  return na === nb || na.includes(nb) || nb.includes(na)
}

function screenIdentifiers(screen) {
  return [screen.tela, screen.file, screen.file.split('/').pop(), `${screen.canvas}/${screen.tela}`]
}

function loadDecisions(path, label) {
  if (!existsSync(path)) return null
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fatal(`${label}: invalid JSON — ${escapeOut(String(error?.message ?? error))}`)
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.decisions)) {
    fatal(`${label}: fora do contrato (todo 18) — esperado {schemaVersion, decisions: []} (shape: ${SHAPE})`)
  }
  return parsed.decisions
}

function governingIds(decisions, screen) {
  if (decisions === null) return []
  const ids = []
  for (const entry of decisions) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.status !== 'active') continue
    const screens = Array.isArray(entry.screens) ? entry.screens : []
    if (screens.some((s) => screenIdentifiers(screen).some((id) => matchScreen(s, id)))) ids.push(entry.id)
  }
  return [...new Set(ids)]
}

// ---------------------------------------------------------------------------
// Approvals register IO + shape validation (tamper detection on EVERY read:
// malformed JSON, forged hash format, unknown status, duplicate screens —
// never a stack trace, never silent acceptance).
// ---------------------------------------------------------------------------
function loadApprovals(path, label, { create }) {
  if (!existsSync(path)) {
    if (create) return { schemaVersion: 1, approvals: [] }
    fatal(
      `${label}: registro de aprovações não encontrado — grave o primeiro com: ` +
        `node approve.mjs set-status <tela> ${escapeOut(STATUSES.join('|'))} (shape: ${SHAPE})`,
    )
  }
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fatal(`${label}: invalid JSON — ${escapeOut(String(error?.message ?? error))}`)
  }
  return parsed
}

function checkApprovals(store, label) {
  if (!isPlainObject(store)) {
    fail('schema', 'error', 'root', `must be a JSON object, got ${typeName(store)} (shape: ${SHAPE})`)
    return
  }
  if (store.schemaVersion !== 1) {
    fail('schema', 'error', 'schemaVersion', `expected 1, got ${render(store.schemaVersion)}`)
  }
  for (const key of Object.keys(store)) {
    if (key !== 'schemaVersion' && key !== 'approvals') {
      fail('unknown-field', 'warning', key, `unknown field "${escapeOut(key)}" — known fields: schemaVersion, approvals`)
    }
  }
  if (!Array.isArray(store.approvals)) {
    fail('schema', 'error', 'approvals', `must be an array, got ${typeName(store.approvals)} (shape: ${SHAPE})`)
    return
  }
  const seen = new Map()
  store.approvals.forEach((entry, index) => {
    const at = `approvals[${index}]`
    if (!isPlainObject(entry)) {
      fail('schema', 'error', at, `must be a JSON object, got ${typeName(entry)} (shape: ${SHAPE})`)
      return
    }
    for (const key of Object.keys(entry)) {
      if (!['screen', 'contentHash', 'status', 'decIds', 'reviewedBy', 'at'].includes(key)) {
        fail('unknown-field', 'warning', `${at}.${key}`, `unknown field "${escapeOut(key)}"`)
      }
    }
    for (const key of ['screen', 'contentHash', 'status', 'decIds', 'reviewedBy', 'at']) {
      if (!(key in entry)) fail('schema', 'error', at, `missing required field "${key}" (shape: ${SHAPE})`)
    }
    if (typeof entry.screen !== 'string' || entry.screen.trim() === '') {
      fail('schema', 'error', `${at}.screen`, 'must be a non-empty string (target-relative screen file)')
    } else if (entry.screen.includes('..') || entry.screen.includes('\\') || entry.screen.startsWith('/')) {
      fail('traversal', 'error', `${at}.screen`, `traversal-shaped screen path ${render(entry.screen)} — target-relative only`)
    } else if (seen.has(entry.screen)) {
      fail('duplicate-screen', 'error', `${at}.screen`, `${render(entry.screen)} already registered at ${seen.get(entry.screen)}`)
    } else {
      seen.set(entry.screen, at)
    }
    if (typeof entry.contentHash !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.contentHash)) {
      fail('schema', 'error', `${at}.contentHash`, `expected sha256 hex (64 chars), got ${render(entry.contentHash)}`)
    }
    if (typeof entry.status !== 'string' || !STATUSES.includes(entry.status)) {
      fail('schema', 'error', `${at}.status`, `expected one of ${STATUSES.join('|')}, got ${render(entry.status)}`)
    }
    if (!Array.isArray(entry.decIds)) {
      fail('schema', 'error', `${at}.decIds`, `must be an array, got ${typeName(entry.decIds)}`)
    } else {
      entry.decIds.forEach((id, i) => {
        if (typeof id !== 'string' || !/^DEC-\d{3,}$/i.test(id)) {
          fail('schema', 'error', `${at}.decIds[${i}]`, `expected a DEC-id like DEC-001, got ${render(id)}`)
        }
      })
    }
    if (typeof entry.reviewedBy !== 'string') {
      fail('schema', 'error', `${at}.reviewedBy`, `must be a string, got ${typeName(entry.reviewedBy)}`)
    } else if (GREEN.has(entry.status) && entry.reviewedBy.trim() === '') {
      fail('schema', 'error', `${at}.reviewedBy`, `status ${escapeOut(entry.status)} requires a reviewer — an approval without provenance is rejected`)
    }
    if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) {
      fail('schema', 'error', `${at}.at`, `expected a parseable date string, got ${render(entry.at)}`)
    }
  })
}

function writeApprovals(path, store) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

const storeLabel = escapeOut(flags['--file'] ?? 'design/approvals.json')
const storePath = resolve(process.cwd(), flags['--file'] ?? 'design/approvals.json')
const decLabel = escapeOut(flags['--decisions'] ?? 'design/decisions.json')
const decPath = resolve(process.cwd(), flags['--decisions'] ?? 'design/decisions.json')
const targetDir = resolveTarget()
const targetLabel = escapeOut(flags['--target'] ?? (targetDir === resolve('skills/design/assets/example') ? 'skills/design/assets/example' : 'design'))

function parseDecIds() {
  const raw = flags['--dec']
  if (raw === undefined) return []
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
  for (const id of ids) {
    if (!/^DEC-\d{3,}$/i.test(id)) fatal(`--dec: expected DEC-ids like DEC-001,DEC-002, got ${render(id)} — ${usage}`)
  }
  const upper = ids.map((id) => id.toUpperCase())
  if (new Set(upper).size !== upper.length) fatal(`--dec: duplicate DEC-id in ${render(raw)} — ${usage}`)
  return upper
}

// ---------------------------------------------------------------------------
// set-status — bind the CURRENT screen bytes to a status decision. Never
// approves without a hash (missing/unreadable screen file = exit 2) and never
// approves without the DEC-ids that govern the screen (exit 1).
// ---------------------------------------------------------------------------
function cmdSetStatus() {
  const [telaArg, statusArg] = positional
  if (!STATUSES.includes(statusArg)) {
    fatal(`status: expected one of ${STATUSES.join('|')}, got ${render(statusArg)} — ${usage}`)
  }
  const screens = discoverScreens(targetDir)
  if (screens.length === 0) fatal(`nenhuma tela encontrada em ${targetLabel} (canvas.json manifests) — nada a aprovar`)
  const screen = resolveTela(screens, telaArg)

  const abs = join(targetDir, screen.file)
  let bytes = null
  try {
    bytes = readFileSync(abs)
  } catch {
    fatal(`tela ${render(screen.file)} sem arquivo legível em ${targetLabel} — aprovar sem hash é proibido`)
  }
  const contentHash = sha256Hex(bytes)

  const decIds = parseDecIds()
  const decisions = loadDecisions(decPath, decLabel)
  if (decisions === null && decIds.length > 0) {
    fatal(`${decLabel}: registro de decisões não encontrado — impossível validar --dec (crie com: node decisions.mjs add --category <c> --decision <text> --reason <text> --screens ${escapeOut(screen.tela)})`)
  }
  if (decisions !== null) {
    for (const id of decIds) {
      if (!decisions.some((d) => isPlainObject(d) && d.id === id)) {
        fail('dec-unknown', 'error', '--dec', `${render(id)} não existe em ${decLabel} — confira com: node decisions.mjs list`)
      }
    }
    const governing = governingIds(decisions, screen)
    if (GREEN.has(statusArg)) {
      const missing = governing.filter((id) => !decIds.includes(id))
      if (missing.length > 0) {
        fail(
          'approval-dec',
          'error',
          '--dec',
          `tela ${escapeOut(screen.file)} é governada por decisão(ões) ativa(s) ${escapeOut(missing.join(', '))} — ` +
            `aprovação exige --dec citando-as (lookup: node decisions.mjs query ${escapeOut(screen.tela)})`,
        )
      }
    }
  }
  if (issues.length > 0) printIssuesAndExit()

  const store = loadApprovals(storePath, storeLabel, { create: true })
  checkApprovals(store, storeLabel)
  if (issues.length > 0) printIssuesAndExit()

  const entry = {
    screen: screen.file,
    contentHash,
    status: statusArg,
    decIds,
    reviewedBy: (flags['--reviewed-by'] ?? process.env.USER ?? process.env.USERNAME ?? 'unknown').trim() || 'unknown',
    at: new Date().toISOString(),
  }
  const existing = store.approvals.findIndex((e) => isPlainObject(e) && e.screen === entry.screen)
  const previous = existing >= 0 ? store.approvals[existing] : null
  if (existing >= 0) store.approvals[existing] = entry
  else store.approvals.push(entry)

  checkApprovals(store, storeLabel)
  if (issues.length > 0) printIssuesAndExit()
  writeApprovals(storePath, store)

  console.log(
    `set-status ${escapeOut(entry.screen)} → ${escapeOut(entry.status)} ` +
      `(hash ${escapeOut(entry.contentHash.slice(0, 12))}…, decIds: ${escapeOut(entry.decIds.join(', ') || '-')})` +
      `${previous ? `, era ${escapeOut(previous.status)}` : ''}, reviewedBy: ${escapeOut(entry.reviewedBy)}, at: ${escapeOut(entry.at)})`,
  )
  console.log(`${storeLabel}: ${store.approvals.length} registro(s)`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// verify — the register never lies: screens exist, every recorded hash equals
// the CURRENT content (any mismatch fails — stale state is never "ok") and
// green entries cite the decisions that govern them. approved|implemented
// entries whose hash changed are auto-downgraded to "review" (central rule;
// only the status flips — contentHash keeps the provenance).
// ---------------------------------------------------------------------------
function cmdVerify() {
  const store = loadApprovals(storePath, storeLabel, { create: false })
  checkApprovals(store, storeLabel)
  if (issues.length > 0) printIssuesAndExit()
  if (store.approvals.length === 0) {
    console.log(`verify: 0 registro(s) em ${storeLabel} — registro vazio nunca é ok; grave o primeiro com: node approve.mjs set-status <tela> <status>`)
    process.exit(1)
  }

  const screens = discoverScreens(targetDir)
  const decisions = loadDecisions(decPath, decLabel)
  const byFile = new Map(screens.map((s) => [s.file, s]))
  const downgraded = []
  const lines = []
  for (const entry of store.approvals) {
    const screen = byFile.get(entry.screen)
    if (!screen) {
      fail('screen-missing', 'error', entry.screen, `listada no registro mas ausente em ${targetLabel} (canvas.json discovery) — registro stale`)
      continue
    }
    let current = null
    try {
      current = sha256Hex(readFileSync(join(targetDir, entry.screen)))
    } catch {
      fail('screen-missing', 'error', entry.screen, `arquivo ilegível em ${targetLabel} — sem hash não há verificação`)
      continue
    }
    const decNote = `decIds: ${entry.decIds.join(', ') || '-'}`
    if (current !== entry.contentHash.toLowerCase()) {
      if (GREEN.has(entry.status)) {
        entry.status = 'review'
        downgraded.push(entry.screen)
        fail(
          'hash-changed',
          'error',
          entry.screen,
          `conteúdo difere do hash registrado no set-status (${escapeOut(entry.at)}) — ` +
            `status rebaixado para review (regra central: aprovação nunca sobrevive ao conteúdo); re-aprove após a revisão`,
        )
      } else {
        fail(
          'hash-changed',
          'error',
          entry.screen,
          `conteúdo difere do hash registrado no set-status (status ${escapeOut(entry.status)}) — ` +
            `registro stale; rode set-status para re-vincular o conteúdo`,
        )
      }
      lines.push(`- ${escapeOut(entry.screen)} [${escapeOut(entry.status)}] hash DIVERGE — ${decNote}`)
      continue
    }
    if (decisions !== null && GREEN.has(entry.status)) {
      const missing = governingIds(decisions, screen).filter((id) => !entry.decIds.map((d) => d.toUpperCase()).includes(id))
      if (missing.length > 0) {
        fail(
          'approval-dec',
          'error',
          entry.screen,
          `status ${escapeOut(entry.status)} não cita decisão(ões) ativa(s) ${escapeOut(missing.join(', '))} que governam a tela — ` +
            `re-aprove com --dec (stale_state)`,
        )
      }
      for (const id of entry.decIds) {
        if (!decisions.some((d) => isPlainObject(d) && d.id === id.toUpperCase())) {
          fail('dec-unknown', 'error', entry.screen, `${render(id)} não existe em ${decLabel} — join rompido (registro adulterado?)`)
        }
      }
    }
    lines.push(`- ${escapeOut(entry.screen)} [${escapeOut(entry.status)}] hash ok — ${decNote}`)
  }

  console.log(
    `verify: ${storeLabel} — ${store.approvals.length} registro(s), alvo ${targetLabel}` +
      (decisions === null ? ` (${decLabel} ausente — join DEC não verificado)` : ''),
  )
  for (const line of lines) console.log(line)
  if (downgraded.length > 0) {
    writeApprovals(storePath, store)
    console.log(`${storeLabel}: ${downgraded.length} status rebaixado(s) para review — ${downgraded.map(escapeOut).join(', ')}`)
  }
  if (issues.length > 0) printIssuesAndExit()
  console.log(`verify: ${store.approvals.length} registro(s) conferem`)
  process.exit(0)
}

if (command === 'set-status') cmdSetStatus()
else cmdVerify()

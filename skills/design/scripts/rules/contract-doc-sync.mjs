/* mockbird:config-driven:v2 */
/**
 * contract-doc-sync (todo 20, GAP-7) — the generated token contract must match
 * tokens.json. The contract exists twice on purpose: the artifact
 * tokens.contract.md (written by `gen-tokens.mjs --contract`) and the byte-
 * identical embed between `<!-- contract:begin -->` / `<!-- contract:end -->`
 * in SKILL.md. This rule regenerates the values table IN-MEMORY from
 * tokens.json and diffs both artifacts against it; drift exits 1 citing every
 * drifted token path (the artifact's value vs the tokens.json value).
 *
 * Sources checked (per artifact, absence policy: a missing artifact is simply
 * not opted into the sync — a project without the contract stays green):
 *   1. the validated design root (project mode; the parent in canvas mode):
 *      <root>/tokens.json vs <root>/tokens.contract.md + <root>/SKILL.md
 *   2. the skill pack's own contract (repo layout): assets/example/tokens.json
 *      vs assets/tokens.contract.md + the skill's SKILL.md. Outside the pack
 *      layout (installed projects) those files do not exist and this stays
 *      silent.
 *
 * The renderer below mirrors buildContract() in gen-tokens.mjs BYTE-FOR-BYTE
 * (rules are standalone — loadRules() imports every *.mjs in rules/ as a rule,
 * so no shared helper can live here; a lib/ import would also break in install
 * layouts where rules/ is not next to lib/). The duplication is self-checking:
 * if the two renderers ever diverge, this rule reports drift on the synced
 * artifacts instead of failing silently.
 *
 * tokens.json is rendered AS-IS (no contract-group canonicalization): a
 * hand-edited value — motion.duration.fast included — is exactly the drift to
 * catch. Unreadable/unparseable tokens.json is skipped silently (validate.mjs
 * owns input reporting; the staleness rule has the same absence policy).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const id = 'contract-doc-sync'

const BEGIN = '<!-- contract:begin -->'
const END = '<!-- contract:end -->'
const THEMES = ['light', 'dark']
const REGEN =
  'regen: node design/scripts/gen-tokens.mjs --contract, then paste tokens.contract.md between the SKILL.md contract markers'

export function run(ctx) {
  // 1. the validated design root (user projects, fixtures)
  const designRoot = ctx.mode === 'canvas' ? dirname(ctx.rootDir) : ctx.rootDir
  checkPair(ctx, join(designRoot, 'tokens.json'), {
    contractPath: join(designRoot, 'tokens.contract.md'),
    skillPath: join(designRoot, 'SKILL.md'),
    contractLabel: ctx.relLabel(designRoot, join(designRoot, 'tokens.contract.md')),
    skillLabel: ctx.relLabel(designRoot, join(designRoot, 'SKILL.md')),
  })
  // 2. the skill pack's own contract (assets/example/tokens.json is the
  //    canonical source of the shipped table and of the SKILL.md embed)
  const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets')
  checkPair(ctx, join(assetsDir, 'example', 'tokens.json'), {
    contractPath: join(assetsDir, 'tokens.contract.md'),
    skillPath: join(assetsDir, '..', 'SKILL.md'),
    contractLabel: 'skills/design/assets/tokens.contract.md',
    skillLabel: 'skills/design/SKILL.md',
  })
}

function checkPair(ctx, tokensPath, artifacts) {
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(tokensPath, 'utf8').replace(/\r/g, ''))
  } catch {
    return // absence policy: no readable tokens.json = nothing to sync
  }
  if (!isPlainObject(parsed)) return
  const generated = buildContract(parsed)
  checkFile(ctx, artifacts.contractPath, artifacts.contractLabel, generated, 'contract-drift', false)
  checkFile(ctx, artifacts.skillPath, artifacts.skillLabel, generated, 'contract-block-drift', true)
}

function checkFile(ctx, path, label, generated, driftCode, isBlock) {
  let text = null
  try {
    text = readFileSync(path, 'utf8').replace(/\r/g, '')
  } catch {
    return // absence policy: artifact not opted in
  }
  if (isBlock) {
    const begin = text.indexOf(BEGIN)
    const end = text.indexOf(END)
    if (begin === -1 || end === -1 || end < begin) {
      return ctx.fail(
        'contract-block-missing',
        `${label}: no ${BEGIN} / ${END} contract block — embed the generated ` +
          `tokens.contract.md content between the markers (${REGEN})`,
      )
    }
    text = text.slice(begin + BEGIN.length + 1, end)
  }
  if (text === generated) return
  for (const drift of diffRows(text, generated)) {
    const doc = drift.doc ? `"${drift.doc.light} | ${drift.doc.dark}"` : '(missing)'
    const gen = drift.gen ? `"${drift.gen.light} | ${drift.gen.dark}"` : '(missing)'
    ctx.fail(driftCode, `${label}: drift at ${drift.key} — ${doc} != tokens.json ${gen} (${REGEN})`)
  }
}

/** Row-level diff: every token path whose rendered values differ, missing on
 * one side included. Deterministic: key order is the regenerated order. */
function diffRows(docText, genText) {
  const doc = parseRows(docText)
  const gen = parseRows(genText)
  const out = []
  for (const key of gen.keys()) {
    const docRow = doc.get(key)
    if (!sameRow(docRow, gen.get(key))) out.push({ key, doc: docRow ?? null, gen: gen.get(key) })
  }
  for (const key of doc.keys()) {
    if (!gen.has(key)) out.push({ key, doc: doc.get(key), gen: null })
  }
  return out
}

function parseRows(text) {
  const rows = new Map()
  const row = /^\| ((?:\\\||[^|])*?) \| ((?:\\\||[^|])*?) \| ((?:\\\||[^|])*?) \|$/
  for (const line of text.split('\n')) {
    const match = row.exec(line)
    if (!match) continue
    const key = match[1].trim()
    if (key === 'token' || key === '---' || key === '') continue
    rows.set(key, { light: match[2].trim(), dark: match[3].trim() })
  }
  return rows
}

function sameRow(a, b) {
  if (!a || !b) return false
  return a.light === b.light && a.dark === b.dark
}

// --- renderer: mirrors buildContract() in gen-tokens.mjs BYTE-FOR-BYTE ------

function buildContract(tree) {
  const rows = new Map() // token path -> { light, dark } rendered cells
  for (const themeName of THEMES) {
    const section = isPlainObject(tree[themeName]) ? tree[themeName] : {}
    collectContractRows(section, '', (path, cell) => {
      const row = rows.get(path) ?? { light: '', dark: '' }
      row[themeName] = cell
      rows.set(path, row)
    })
  }
  const lines = [
    '<!-- GENERATED by gen-tokens.mjs --contract — do not edit; source: tokens.json -->',
    '| token | light | dark |',
    '| --- | --- | --- |',
  ]
  for (const path of [...rows.keys()].sort()) {
    const row = rows.get(path)
    lines.push(`| ${path} | ${row.light} | ${row.dark} |`)
  }
  return `${lines.join('\n')}\n`
}

/** Leaf = any object carrying $value (namespace folders and groups recurse). */
function collectContractRows(node, prefix, emit) {
  for (const [key, entry] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    if (!isPlainObject(entry)) continue
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (Object.prototype.hasOwnProperty.call(entry, '$value')) {
      emit(path, contractCell(entry.$value))
    } else {
      collectContractRows(entry, path, emit)
    }
  }
}

function contractCell(value) {
  const text = isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value)
  return text.replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', '\\n')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

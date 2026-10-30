/* mockbird:config-driven:v2 */
/**
 * action-module (todo 8, GAP-4) — the per-screen action module contract
 * (§13.2 R1, §15.2 2.1). Registered with validate.mjs's loadRules() via
 * { id, run } (append-only extension point — ZERO loader edits).
 *
 * Convention: <design-root>/actions/<telaId>.js is a plain script that calls
 * Mock.registerActions('<telaId>', { … }) and its FIRST ARGUMENT must be the
 * literal file stem. Per *.js file inside any actions/ directory under the
 * validated root (exemptDirs skipped, exemptFiles skipped by basename, sorted
 * walk — deterministic):
 *   - a Mock.registerActions call whose string-literal first argument differs
 *     from the file stem FAILS (module id mismatch), citing the file and BOTH
 *     names (registered literal vs file stem);
 *   - a Mock.registerActions call without a string-literal first argument
 *     FAILS — a dynamic id can never be verified against the module filename.
 *
 * Call sites are found in a length-preserving masked copy of the source where
 * comment and string bodies are blanked (quotes kept) — the same "strings can
 * never masquerade as code" contract as rules/metrics.mjs's start-tag scan —
 * so a commented-out or quoted call can never register (or fail) anything.
 * The literal value is then read back at the SAME offsets in the raw source.
 * No call at all is NOT a failure here: this rule polices the registration
 * contract, not the existence of registrations.
 *
 * The rule is standalone (loadRules() imports EVERY *.mjs in rules/ as a rule,
 * so no shared helper can live here) and its output is fully deterministic
 * (sorted walk, source order, no timestamps) — qa.mjs R3 10x stability.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const id = 'action-module'

const CALL_RE = /\bMock\.registerActions\s*\(\s*/g
const LITERAL_RE = /^'[^']*'|^"[^"]*"/

export function run(ctx) {
  for (const entry of walkActionModules(ctx)) {
    checkModule(ctx, entry)
  }
}

function checkModule(ctx, { full, stem }) {
  const label = ctx.relLabel(ctx.rootDir, full)
  let source = null
  try {
    source = readFileSync(full, 'utf8')
  } catch {
    return // unreadable file: validate.mjs already reports it
  }
  const masked = maskCode(source)
  CALL_RE.lastIndex = 0
  for (const match of masked.matchAll(CALL_RE)) {
    const argAt = match.index + match[0].length
    const where = `${label}:${lineOf(masked, match.index)}`
    const literal = masked[argAt] === "'" || masked[argAt] === '"' ? LITERAL_RE.exec(masked.slice(argAt)) : null
    if (literal === null) {
      ctx.fail(
        'action-module',
        `${where}: Mock.registerActions first argument must be the string literal of the file stem ` +
          `"${stem}" — a dynamic id can never be verified against the module filename`,
      )
      continue
    }
    // the mask is length-preserving: the literal value lives at the SAME
    // offsets in the raw source (the masked body is blanked, quotes kept).
    const value = source.slice(argAt + 1, argAt + 1 + literal[0].length - 2)
    if (value !== stem) {
      ctx.fail(
        'action-module',
        `${where}: Mock.registerActions(${JSON.stringify(value)}) does not match the module filename — ` +
          `file stem is "${stem}" but the registered namespace is "${value}" (module id mismatch: file vs literal)`,
      )
    }
  }
}

/** Length-preserving mask: comment and string bodies become spaces (quotes and
 *  newlines kept) so offsets and line numbers map 1:1 onto the raw source.
 *  Regex literals are skipped as opaque bodies so quotes inside them can never
 *  start a string (comment detection needs the same protection). */
function maskCode(code) {
  const out = code.split('')
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' '
    }
  }
  let state = 'code'
  let prev = '' // last significant code char (regex-literal heuristic)
  let start = 0
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line'
        start = i
        i += 2
        continue
      }
      if (ch === '/' && next === '*') {
        state = 'block'
        start = i
        i += 2
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        state = ch
        start = i + 1
        i++
        continue
      }
      if (ch === '/' && regexAllowed(code, i, prev)) {
        state = 'regex'
        i++
        continue
      }
      if (!/\s/.test(ch)) prev = ch
      i++
    } else if (state === 'line') {
      if (ch === '\n') {
        blank(start, i)
        state = 'code'
        prev = ''
      }
      i++
    } else if (state === 'block') {
      if (ch === '*' && next === '/') {
        blank(start, i)
        state = 'code'
        i += 2
        continue
      }
      i++
    } else if (state === 'regex') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '[') {
        state = 'regex['
        i++
        continue
      }
      if (ch === '/') {
        state = 'code'
        prev = '/'
      }
      i++
    } else if (state === 'regex[') {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === ']') state = 'regex'
      i++
    } else {
      // a string/template body — blanked, quotes kept (templates are opaque:
      // code inside ${…} is not scanned for call sites).
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === state) {
        blank(start, i)
        state = 'code'
        prev = '"'
      }
      i++
    }
  }
  if (state === 'line' || state === 'block') blank(start, code.length)
  else if (state !== 'code' && state !== 'regex' && state !== 'regex[') blank(start, code.length)
  return out.join('')
}

/** A '/' starts a regex literal (not division) after an operator/punctuator or
 *  a keyword that expects an expression — the standard lexer heuristic. */
function regexAllowed(code, at, prev) {
  if (prev === '') return true
  if ('(,=:[!&|?{};+-*%~^<>'.includes(prev)) return true
  return /\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await)$/.test(
    code.slice(Math.max(0, at - 10), at),
  )
}

/** Every actions/<stem>.js under the validated root (sorted, deterministic).
 *  Same discovery contract as rules/metrics.mjs: rules are standalone modules. */
function walkActionModules(ctx) {
  const out = []
  const exemptDirs = new Set(
    Array.isArray(ctx.config?.exemptDirs) ? ctx.config.exemptDirs.filter((d) => typeof d === 'string') : [],
  )
  const exemptFiles = new Set(
    Array.isArray(ctx.config?.exemptFiles) ? ctx.config.exemptFiles.filter((f) => typeof f === 'string') : [],
  )
  const collect = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (!entry.isFile() || !/\.js$/i.test(entry.name)) continue
      if (exemptFiles.has(entry.name)) continue
      out.push({ full: join(dir, entry.name), stem: entry.name.replace(/\.js$/i, '') })
    }
  }
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (!entry.isDirectory() || exemptDirs.has(entry.name)) continue
      if (entry.name === 'actions') collect(join(dir, entry.name))
      else walk(join(dir, entry.name))
    }
  }
  walk(ctx.rootDir)
  return out
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length
}

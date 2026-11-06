/**
 * i18n consistency check (CI): the viewer's I18N dictionary must stay in sync
 * (en/pt same keys, every key used, same {vars}), and the docs' bilingual
 * blocks must carry the same section ids with working same-page anchors.
 *
 * Run: node scripts/i18n-check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

export class StaticDictionaryError extends Error {}

function fail(source, pos, message) {
  throw new StaticDictionaryError(`${message} at position ${pos}`)
}

function extractObject(source, start) {
  let depth = 0; let quote = null; let escaped = false; let lineComment = false; let blockComment = false
  for (let i = start; i < source.length; i++) {
    const c = source[i]; const n = source[i + 1]
    if (lineComment) { if (c === '\n') lineComment = false; continue }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++ } continue }
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = null; continue }
    if (c === '/' && n === '/') { lineComment = true; i++; continue }
    if (c === '/' && n === '*') { blockComment = true; i++; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '{') depth++
    if (c === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  fail(source, start, 'unterminated object')
}

class ObjectParser {
  constructor(source) { this.s = source; this.i = 0 }
  ws() { while (this.i < this.s.length) { if (/\s/.test(this.s[this.i])) this.i++; else if (this.s.startsWith('//', this.i)) { this.i = this.s.indexOf('\n', this.i + 2); if (this.i < 0) this.i = this.s.length } else if (this.s.startsWith('/*', this.i)) { const e = this.s.indexOf('*/', this.i + 2); if (e < 0) fail(this.s, this.i, 'unterminated comment'); this.i = e + 2 } else break } }
  key() {
    this.ws(); const c = this.s[this.i]
    if (c === '[') fail(this.s, this.i, 'computed key rejected')
    if (c === "'" || c === '"') return this.string()
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i))
    if (!m) fail(this.s, this.i, 'expected object key')
    this.i += m[0].length; return m[0]
  }
  string() {
    const quote = this.s[this.i++]; let out = ''
    while (this.i < this.s.length) { const c = this.s[this.i++]
      if (c === quote) return out
      if (c === '\\') { if (this.i >= this.s.length) break; const e = this.s[this.i++]; const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }; if (e === 'u') { const hex = this.s.slice(this.i, this.i + 4); if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(this.s, this.i, 'invalid unicode escape'); out += String.fromCharCode(parseInt(hex, 16)); this.i += 4 } else out += map[e] ?? e } else out += c
    } fail(this.s, this.i, 'unterminated string')
  }
  value() { this.ws(); if (this.s[this.i] === '{') return this.object(); if (this.s[this.i] === "'" || this.s[this.i] === '"') return this.string(); if (this.s[this.i] === '`') fail(this.s, this.i, 'template literal rejected'); fail(this.s, this.i, 'value must be a string or object') }
  object() {
    this.i++; const out = Object.create(null); this.ws()
    while (this.i < this.s.length && this.s[this.i] !== '}') { const key = this.key(); if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(this.s, this.i, `dangerous key ${key}`); this.ws(); if (this.s[this.i++] !== ':') fail(this.s, this.i - 1, 'expected colon'); if (Object.prototype.hasOwnProperty.call(out, key)) fail(this.s, this.i, `duplicate key ${key}`); out[key] = this.value(); this.ws(); if (this.s[this.i] === ',') { this.i++; this.ws(); continue } if (this.s[this.i] !== '}') fail(this.s, this.i, 'expected comma or closing brace') }
    if (this.s[this.i] !== '}') fail(this.s, this.i, 'unterminated object'); this.i++; return out
  }
  parse() { const value = this.value(); this.ws(); if (this.i !== this.s.length) fail(this.s, this.i, 'expression rejected'); return value }
}

export function parseStaticObject(source) { return new ObjectParser(source).parse() }
export function extractI18N(source) {
  const marker = 'const I18N'; const at = source.indexOf(marker); if (at < 0) fail(source, 0, 'I18N dictionary not found')
  const start = source.indexOf('{', at); if (start < 0) fail(source, at, 'I18N object not found')
  return parseStaticObject(extractObject(source, start))
}

/* ---------------------------------------------- viewer: I18N dictionary */

const viewer = readFileSync(join(ROOT, 'skills/design/assets/viewer.html'), 'utf8')
try {
  const I18N = extractI18N(viewer)
  const en = Object.keys(I18N.en)
  const pt = Object.keys(I18N.pt)
  for (const key of en) if (!pt.includes(key)) errors.push(`viewer: missing pt: ${key}`)
  for (const key of pt) if (!en.includes(key)) errors.push(`viewer: missing en: ${key}`)

  const used = new Set()
  for (const m of viewer.matchAll(/[^a-zA-Z]t\('([^']+)'/g)) used.add(m[1])
  for (const m of viewer.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria|-alt)?="([^"]+)"/g)) used.add(m[1])
  for (const m of viewer.matchAll(/DEVICE_LABEL = \{([^}]*)\}/g)) {
    for (const kv of m[1].matchAll(/:\s*'([^']+)'/g)) used.add(kv[1])
  }
  for (const key of used) {
    if (!(key in I18N.en)) errors.push(`viewer: used but missing in en: ${key}`)
    if (!(key in I18N.pt)) errors.push(`viewer: used but missing in pt: ${key}`)
  }
  for (const key of en) if (!used.has(key)) errors.push(`viewer: defined but never used: ${key}`)

  for (const [lang, dict] of Object.entries(I18N)) {
    for (const [key, value] of Object.entries(dict)) {
      const vars = [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      const other = lang === 'en' ? I18N.pt[key] : I18N.en[key]
      const otherVars = [...String(other).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      if (vars !== otherVars) errors.push(`viewer: var mismatch in ${key}: "${vars}" vs "${otherVars}"`)
    }
  }
  console.log(`viewer: ${en.length} keys`)
} catch (error) { errors.push(`viewer: ${error.message}`) }

/* -------------------------------------------------- docs: bilingual blocks */

const docs = readFileSync(join(ROOT, 'skills/design/assets/docs.html'), 'utf8')
const blocks = new Map()
for (const m of docs.matchAll(/<div data-lang="(en|pt)">([\s\S]*?)\n  <\/div>/g)) blocks.set(m[1], m[2])
if (blocks.size !== 2) {
  errors.push(`docs: expected 2 data-lang blocks, found ${blocks.size}`)
} else {
  const ids = {}
  for (const [lang, body] of blocks) {
    ids[lang] = [...body.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]).sort()
    const idSet = new Set(ids[lang])
    for (const m of body.matchAll(/href="#([^"]+)"/g)) {
      if (!idSet.has(m[1])) errors.push(`docs[${lang}]: anchor #${m[1]} has no target`)
    }
  }
  if (ids.en.join(',') !== ids.pt.join(',')) {
    errors.push('docs: en/pt blocks declare different ids')
  }
  console.log(`docs: ${ids.en.length} section ids per language`)
}

/* ---------------------------------------------------------- version tag */

// the on-screen footer version must match package.json (never lie to the user)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const tag = /id="versionTag">([^<]+)</.exec(viewer)?.[1]?.trim()
if (!tag) {
  errors.push('viewer: versionTag footer missing')
} else if (tag !== `v${pkg.version}`) {
  errors.push(`viewer: versionTag says ${tag} but package.json says v${pkg.version}`)
} else {
  console.log(`version: ${tag} (footer == package.json)`)
}

if (errors.length > 0) {
  console.error(`FAIL (${errors.length}):\n` + errors.map((e) => ` - ${e}`).join('\n'))
  process.exit(1)
}
console.log('i18n OK — dictionaries and docs in sync')

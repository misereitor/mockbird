#!/usr/bin/env node
/**
 * Design brief validator (plan todo 17, GAP-B1) — read-only, Node stdlib only.
 * Validates a design brief against assets/design-brief.schema.json AND detects
 * cross-field contradictions, printing one line per issue (category + severity).
 * Unknown fields are warned about (severity=warning) and NEVER accepted
 * silently. Brief-derived text is sanitized on output: control chars stripped,
 * HTML escaped, values truncated — untrusted brief content can never inject
 * markup or terminal escapes into the issue stream.
 *
 * Usage: node validate-brief.mjs [brief.json]
 *   brief.json  the brief to validate (default: ./design/brief.json)
 *
 * Exit codes: 0 = no issues, 1 = issues found (errors AND warnings block —
 * an unknown field is never accepted in silence), 2 = usage/input error
 * (missing file, invalid JSON, broken schema — guided message, never a stack).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const usage = 'usage: node validate-brief.mjs [brief.json]'
const BRIEF_SHAPE = '{schemaVersion, audience, goal, visualDirection, constraints, tone, platform, must, mustNot}'

// ---------------------------------------------------------------------------
// CLI contract (mirrors validate.mjs: unknown flags/extra args = exit 2)
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const positional = []
for (const token of argv) {
  if (token.startsWith('--')) {
    console.error(`unknown flag "${token}" — ${usage}`)
    process.exit(2)
  }
  positional.push(token)
}
if (positional.length > 1) {
  console.error(`${usage} (got ${positional.length} positional args)`)
  process.exit(2)
}
const briefArg = positional[0] ?? 'design/brief.json'

function fatal(message) {
  console.error(message)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Output sanitization (untrusted brief text): control chars out, HTML escaped,
// whitespace collapsed, truncated. Applied to EVERY brief-derived fragment.
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

/** Accent-insensitive, case-insensitive text for keyword matching. */
function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Schema (single source of truth: assets/design-brief.schema.json; dual layout
// like importFromLayout in validate.mjs: side-by-side or under assets/).
// ---------------------------------------------------------------------------
const schemaCandidates = [
  new URL('../assets/design-brief.schema.json', import.meta.url),
  new URL('./design-brief.schema.json', import.meta.url),
]
const schemaUrl = schemaCandidates.find((url) => existsSync(fileURLToPath(url)))
if (!schemaUrl) {
  fatal(`design-brief.schema.json not found (checked ${schemaCandidates.map((u) => fileURLToPath(u)).join(' and ')})`)
}
let schema = null
try {
  schema = JSON.parse(readFileSync(fileURLToPath(schemaUrl), 'utf8'))
} catch (error) {
  fatal(`design-brief.schema.json: cannot load schema — ${String(error?.message ?? error)}`)
}
if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
  fatal('design-brief.schema.json: broken schema (root must define "properties")')
}

// ---------------------------------------------------------------------------
// Brief input — invalid JSON is a guided exit 2, never a stack trace.
// ---------------------------------------------------------------------------
const briefPath = resolve(process.cwd(), briefArg)
let raw = null
try {
  raw = readFileSync(briefPath, 'utf8')
} catch {
  fatal(`${briefArg}: brief not found — create it with ${BRIEF_SHAPE} (schema: skills/design/assets/design-brief.schema.json) or pass a path: ${usage}`)
}
let brief = null
try {
  brief = JSON.parse(raw)
} catch (error) {
  fatal(`${briefArg}: invalid JSON — ${escapeOut(String(error?.message ?? error))}`)
}

// ---------------------------------------------------------------------------
// Issues: one line each, `- category [severity] (fields): message`.
// ---------------------------------------------------------------------------
const issues = []
const fail = (category, severity, fields, message) => issues.push({ category, severity, fields, message })

// ---------------------------------------------------------------------------
// Schema shape — driven by the schema file itself (required, additionalProperties
// false, const, string minLength, array items). Unknown field = warning that
// still blocks exit 0 (não aceito em silêncio).
// ---------------------------------------------------------------------------
function checkShape(value) {
  if (!isPlainObject(value)) {
    return fail('schema', 'error', 'root', `the brief root must be a JSON object, got ${typeName(value)}`)
  }
  const props = schema.properties
  for (const key of Object.keys(value)) {
    if (!isPlainObject(props[key])) {
      fail(
        'unknown-field',
        'warning',
        key,
        `unknown field "${escapeOut(key)}" — never accepted silently; known fields: ${Object.keys(props).join(', ')}`,
      )
    }
  }
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (!(key in value)) {
      fail('schema', 'error', key, `missing required field "${key}" (brief shape: ${BRIEF_SHAPE})`)
    }
  }
  for (const [key, spec] of Object.entries(props)) {
    if (key in value) checkValue(value[key], spec, key)
  }
}

function checkValue(value, spec, path) {
  if (spec.const !== undefined) {
    if (value !== spec.const) {
      fail('schema', 'error', path, `expected ${JSON.stringify(spec.const)}, got ${render(value)}`)
    }
    return
  }
  if (spec.type === 'string') {
    if (typeof value !== 'string') {
      return fail('schema', 'error', path, `expected string, got ${typeName(value)}`)
    }
    if (typeof spec.minLength === 'number' && value.trim().length < spec.minLength) {
      fail('schema', 'error', path, 'empty string — fill the field in')
    }
    return
  }
  if (spec.type === 'array') {
    if (!Array.isArray(value)) {
      return fail('schema', 'error', path, `expected array, got ${typeName(value)}`)
    }
    value.forEach((item, index) => checkValue(item, spec.items ?? {}, `${path}[${index}]`))
    return
  }
  if (spec.type === 'object') {
    if (!isPlainObject(value)) {
      fail('schema', 'error', path, `expected object, got ${typeName(value)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Contradiction detection (todo 17). Every hit cites BOTH field names and the
// matched terms. Keywords match accent-insensitive word forms on the
// normalized field text; array fields are scanned per item and cited by index.
// ---------------------------------------------------------------------------
const CONTRADICTION_RULES = [
  {
    id: 'tone-direction',
    severity: 'error',
    why: 'contained tone vs exuberant visual direction',
    leftFields: ['tone'],
    left: /\b(sobri[oa]s?|seri[oa]s?|formal(is)?|contid[oa]s?|conservador[ao]s?|discret[oa]s?|neutr[oa]s?|corporativ[oa]s?|institucional(is)?)\b/,
    rightFields: ['visualDirection'],
    right: /\b(neon(is)?|maximalist[ao]s?|extravagantes?|vibrantes?|colorid[oa]s?|exuberantes?|ousad[oa]s?|bold|cyberpunk|psicodelic[oa]s?)\b/,
  },
  {
    id: 'audience-density',
    severity: 'warning',
    why: 'elderly audience vs data-dense screen',
    leftFields: ['audience'],
    left: /\b(idos[oa]s?|terceira idade|elderly|seniors?|aposentad[oa]s?|60\s*\+|mais velh[oa]s?)\b/,
    rightFields: ['visualDirection', 'goal'],
    right: /\b(dens[oa]s?|data-?dense|densamente|alta\s+densidade|densidade\s+alta)\b/,
  },
  {
    id: 'constraints-libs',
    severity: 'error',
    why: 'no-libraries constraint vs direction that demands an external library',
    leftFields: ['constraints'],
    left: /\b(sem\s+libs?|sem\s+bibliotecas?|sem\s+dependencias?|zero\s+dependencias?|vanilla|puro\s+js|javascript\s+puro|sem\s+frameworks?|apenas?\s+nativ[oa]s?|tecnologias?\s+nativas?)\b/,
    rightFields: ['visualDirection', 'must'],
    right: /\b(gsap|framer|three\.?js|threejs|lottie|anime\.?js|scrolltrigger|barba(\.js)?|locomotive\s+scroll|swiper|d3(\.js)?|jquery)\b/,
  },
]

function fieldItems(briefValue, name) {
  const value = briefValue[name]
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string')
  return []
}

function itemLabel(name, index, isList) {
  return isList ? `${name}[${index}]` : name
}

function checkContradictions(briefValue) {
  for (const rule of CONTRADICTION_RULES) {
    for (const leftName of rule.leftFields) {
      const leftIsList = Array.isArray(briefValue[leftName])
      for (const [li, ltext] of fieldItems(briefValue, leftName).entries()) {
        const lm = rule.left.exec(normalize(ltext))
        if (!lm) continue
        for (const rightName of rule.rightFields) {
          const rightIsList = Array.isArray(briefValue[rightName])
          for (const [ri, rtext] of fieldItems(briefValue, rightName).entries()) {
            const rm = rule.right.exec(normalize(rtext))
            if (!rm) continue
            const lLabel = itemLabel(leftName, li, leftIsList)
            const rLabel = itemLabel(rightName, ri, rightIsList)
            fail(
              'contradiction',
              rule.severity,
              `${lLabel} × ${rLabel}`,
              `${rule.why}: ${lLabel} ${render(ltext)} conflicts with ${rLabel} ${render(rtext)} (terms "${escapeOut(lm[0])}" x "${escapeOut(rm[0])}")`,
            )
          }
        }
      }
    }
  }
  checkMustOverlap(briefValue)
}

/** Same requirement in must and mustNot (equal or one inside the other) is a
 * contradiction even when it shares no keyword — the disguised case. */
function checkMustOverlap(briefValue) {
  const must = fieldItems(briefValue, 'must')
  const mustNot = fieldItems(briefValue, 'mustNot')
  for (const [mi, m] of must.entries()) {
    const mn = normalize(m).trim()
    if (mn.length < 4) continue
    for (const [ni, n] of mustNot.entries()) {
      const nn = normalize(n).trim()
      if (nn.length < 4) continue
      if (mn === nn || mn.includes(nn) || nn.includes(mn)) {
        fail(
          'contradiction',
          'error',
          `must[${mi}] × mustNot[${ni}]`,
          `required and forbidden at once: must[${mi}] ${render(m)} conflicts with mustNot[${ni}] ${render(n)}`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Run (after every declaration — the rule table is a const) and output
// (validate.mjs contract: "Fix these issues:" block on stdout, exit 1).
// ---------------------------------------------------------------------------
try {
  checkShape(brief)
  if (isPlainObject(brief)) checkContradictions(brief)
} catch (error) {
  fail('internal', 'error', 'validate-brief', String(error?.message ?? error))
}

if (issues.length > 0) {
  console.log('Fix these issues:')
  for (const issue of issues) {
    console.log(`- ${issue.category} [${issue.severity}] (${escapeOut(issue.fields)}): ${issue.message}`)
  }
  process.exit(1)
}
console.log(`brief-check: OK — ${briefArg} (schemaVersion ${brief.schemaVersion})`)
process.exit(0)

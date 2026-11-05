#!/usr/bin/env node
/** Temporary token what-if runner. Never mutates tokens.json unless --apply
 * has first recorded a DEC through decisions.mjs. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const here = dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const value = (name, fallback = undefined) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const has = (name) => args.includes(name)
const target = resolve(value('--target', 'design'))
const variant = value('--var')
if (!variant) { console.error('token-sandbox: --var <name> is required'); process.exit(2) }
const tokenPath = join(target, 'tokens.json')
if (!existsSync(tokenPath)) { console.error(`token-sandbox: tokens.json not found: ${tokenPath}`); process.exit(2) }
const before = readFileSync(tokenPath)
const hash = (b) => createHash('sha256').update(b).digest('hex')
const beforeHash = hash(before)
const out = join(target, '.visual', 'sandbox', variant)
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const tmp = join(out, '.work')
cpSync(target, tmp, { recursive: true, filter: (src) => !src.includes('.visual') })
const tmpTokens = join(tmp, 'tokens.json')
const tokens = JSON.parse(readFileSync(tmpTokens, 'utf8'))
const palette = value('--palette')
const scale = Number(value('--scale', '1'))
const radius = Number(value('--radius', '1'))
const density = Number(value('--density', '1'))
if (![scale, radius, density].every(Number.isFinite) || scale <= 0 || radius <= 0 || density <= 0) { console.error('token-sandbox: scales must be positive numbers'); process.exit(2) }
function walk(x, key = '') {
  if (!x || typeof x !== 'object') return
  if ('$value' in x && typeof x.$value === 'string') {
    if (palette && /color/i.test(key)) x.$value = palette
    else if (/fontSize/i.test(key)) x.$value = x.$value.replace(/([\d.]+)px/, (_, n) => `${Number(n) * scale}px`)
    else if (/radius|borderRadius/i.test(key)) x.$value = x.$value.replace(/([\d.]+)px/, (_, n) => `${Number(n) * radius}px`)
    else if (/density|space/i.test(key)) x.$value = x.$value.replace(/([\d.]+)px/, (_, n) => `${Number(n) * density}px`)
  }
  for (const [k, v] of Object.entries(x)) walk(v, `${key}.${k}`)
}
walk(tokens)
writeFileSync(tmpTokens, JSON.stringify(tokens, null, 2) + '\n')
execFileSync(process.execPath, [join(here, 'gen-tokens.mjs'), tmp], { stdio: 'inherit' })
execFileSync(process.execPath, [join(here, 'visual-capture.mjs'), '--target', tmp], { stdio: 'inherit' })
const visual = join(tmp, '.visual')
cpSync(visual, out, { recursive: true })
rmSync(join(out, '.work'), { recursive: true, force: true })
let delta = 0
const report = { schemaVersion: 1, variant, tokensHashBefore: beforeHash, tokensHashAfter: hash(readFileSync(tokenPath)), scoreDelta: delta, comparison: { mode: '3-up', baseline: 'current', variant: out }, generatedAt: new Date().toISOString() }
writeFileSync(join(out, 'sandbox-report.json'), JSON.stringify(report, null, 2) + '\n')
if (has('--apply')) {
  const category = value('--dec-category'); const decision = value('--dec-decision'); const reason = value('--dec-reason')
  if (!category || !decision || !reason) { console.error('token-sandbox: --apply requires --dec-category, --dec-decision and --dec-reason; no DEC, nothing applied'); process.exit(1) }
  execFileSync(process.execPath, [join(here, 'decisions.mjs'), 'add', '--category', category, '--decision', decision, '--reason', reason], { stdio: 'inherit', cwd: process.cwd() })
  writeFileSync(tokenPath, readFileSync(tmpTokens))
  execFileSync(process.execPath, [join(here, 'gen-tokens.mjs'), target], { stdio: 'inherit' })
  report.applied = true; report.tokensHashAfter = hash(readFileSync(tokenPath)); writeFileSync(join(out, 'sandbox-report.json'), JSON.stringify(report, null, 2) + '\n')
} else if (hash(readFileSync(tokenPath)) !== beforeHash) { console.error('token-sandbox: tokens.json changed during preview'); process.exit(1) }
console.log(`token-sandbox: ${variant} preview ready (${out}); score delta ${delta}`)

#!/usr/bin/env node
/** Deterministic role orchestration with mechanical evaluator isolation. */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createDesignAgent } from './agent-adapters/stub-deterministic.mjs'
import { validatePayload } from './agent-adapters/validate.mjs'

export const ROLES = Object.freeze([
  { role: 'Design Architect', writes: true },
  { role: 'UI Designer', writes: true },
  { role: 'UX Reviewer', writes: false },
  { role: 'Visual Critic', writes: false },
  { role: 'A11y Auditor', writes: false },
  { role: 'Frontend Reviewer', writes: false },
])
const EVALUATORS = new Set(ROLES.filter((r) => !r.writes).map((r) => r.role))
const REPORT = '.visual/report.json'

function files(root, out = []) {
  for (const ent of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name === '.git' || ent.name === 'node_modules') continue
    const p = join(root, ent.name)
    if (ent.isDirectory()) files(p, out)
    else out.push(p)
  }
  return out
}
export function workspaceHash(root) {
  const hash = createHash('sha256')
  for (const file of files(resolve(root))) {
    if (relative(root, file).split('\\').join('/') === REPORT) continue
    hash.update(relative(root, file)).update('\0').update(readFileSync(file)).update('\0')
  }
  return hash.digest('hex')
}

function cleanText(value) {
  return String(value).replace(/[\u0000-\u001f<>]/g, (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`)
}
function safeResult(result) {
  return JSON.parse(JSON.stringify(result, (_, value) => typeof value === 'string' ? cleanText(value) : value))
}

export async function orchestrate({ target = '.', mode = 'single', agentFactory = createDesignAgent, request = {}, reportPath } = {}) {
  const root = resolve(target)
  if (!['single', 'review', 'multi'].includes(mode)) throw new Error(`modo inválido "${mode}"; use single, review ou multi`)
  const selected = mode === 'single' ? [ROLES[0]] : mode === 'review' ? [ROLES[0], ROLES[2]] : [...ROLES]
  if (mode === 'multi' && !selected.some((r) => !r.writes)) throw new Error('modo multi requer pelo menos um papel avaliador')
  const before = workspaceHash(root)
  const existing = resolve(reportPath ?? join(root, REPORT))
  if (existsSync(existing)) {
    try {
      const prior = JSON.parse(readFileSync(existing, 'utf8')).orchestration
      if (prior?.workspaceHashAfter && prior.workspaceHashAfter !== before) throw new Error('stale report')
    } catch (error) {
      if (error.message === 'stale report') throw error
    }
  }
  const results = []
  for (const descriptor of selected) {
    const agent = agentFactory({ adapter: 'stub', role: descriptor.role })
    const operation = descriptor.writes ? 'generate' : 'review'
    const payload = operation === 'generate'
      ? { schemaVersion: 1, operation, budgetTokens: 1000, brief: request.brief ?? { goal: 'orchestration' }, screens: request.screens ?? [{ screen: 'default' }] }
      : { schemaVersion: 1, operation, budgetTokens: 1000, screen: request.screen ?? 'default', viewport: request.viewport ?? '1920x1080', state: request.state ?? 'default', html: request.html ?? '<html></html>', screenshotPng: request.screenshotPng ?? '' }
    const response = await agent[operation](validatePayload(payload, `${operation}-request`))
    results.push({ role: descriptor.role, writes: descriptor.writes, operation, response: safeResult(response), selfEvaluation: false })
    const after = workspaceHash(root)
    if (!descriptor.writes && after !== before) throw new Error('evaluator write detected')
  }
  const after = workspaceHash(root)
  if (after !== before) throw new Error('workspace changed during orchestration')
  const report = { schemaVersion: 1, orchestration: { mode, workspaceHashBefore: before, workspaceHashAfter: after, roles: results, generatedAt: 'deterministic' } }
  const destination = existing
  mkdirSync(join(destination, '..'), { recursive: true }); writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const target = process.argv[process.argv.indexOf('--target') + 1] ?? '.'
  const mode = process.argv[process.argv.indexOf('--mode') + 1] ?? 'single'
  orchestrate({ target, mode }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exitCode = 2 })
}

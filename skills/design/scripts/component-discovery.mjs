#!/usr/bin/env node
/** Component reuse gate: catalog-backed, deterministic, append-only audit trail. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const CATALOG = resolve('design/components/catalog.json')
const LOG = resolve('design/components/discovery-log.json')
const usage = 'usage: node component-discovery.mjs --markup <file> [--catalog <file>] [--log <file>]'
function fail(message) { console.error(`component-discovery: ${message}`); process.exitCode = 2 }
function attrs(html) {
  const root = html.match(/<([A-Za-z][\w-]*)(?:\s[^>]*)?>/)
  if (!root) throw new Error('markup has no root element')
  const values = {}
  for (const m of root[0].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) values[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return { tag: root[1].toLowerCase(), classes: new Set((values.class || '').split(/\s+/).filter(Boolean)), args: Object.fromEntries(['size','tone','state'].map(k => [k, values[`data-${k}`] ?? ''])) }
}
function feature(entry) { return { tag: entry.tag, classes: new Set(entry.classes || []), args: entry.args || {} } }
function score(a, b) {
  const union = new Set([...a.classes, ...b.classes]).size || 1
  const overlap = [...a.classes].filter(x => b.classes.has(x)).length / union
  const args = ['size','tone','state'].filter(k => a.args[k] && a.args[k] === b.args[k]).length / 3
  return overlap * 0.7 + args * 0.3
}
function catalogFeature(entry) {
  const p = entry.previews?.find(x => x.variant?.size === 'md' && x.variant?.tone === 'primary') || entry.previews?.[0]
  const html = p?.html || entry.html || ''
  if (html) { const x = attrs(html); return feature({ tag: x.tag, classes: [...x.classes], args: x.args }) }
  return feature({ tag: entry.tag || 'div', classes: entry.classes || [], args: entry.props?.markerArgs || entry.markerArgs || {} })
}
function gitSha() { try { return execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim() } catch { return null } }
function main(argv) {
  const get = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
  const markupPath = get('--markup'), catalogPath = resolve(get('--catalog') || CATALOG), logPath = resolve(get('--log') || LOG)
  if (!markupPath) return fail(usage)
  if (!existsSync(catalogPath)) return fail(`catalog dependency missing: ${catalogPath}; run component-docs.mjs first`)
  let proposed, catalog
  try { proposed = attrs(readFileSync(resolve(markupPath), 'utf8')); catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch (e) { return fail(e.message) }
  const entries = Array.isArray(catalog.components) ? catalog.components : Object.entries(catalog).filter(([k]) => k !== 'schemaVersion').map(([id, v]) => ({ id, ...v }))
  if (!entries.length) return fail('catalog has no components')
  const ranked = entries.map(entry => ({ entry, score: score(proposed, catalogFeature(entry)) })).sort((a,b) => b.score-a.score)
  const best = ranked[0], id = best.entry.id || best.entry.name
  const recommendation = best.score >= 0.72 ? (score(proposed, catalogFeature(best.entry)) >= 0.92 ? 'reuse' : 'variant') : 'create'
  const text = recommendation === 'reuse' ? `markup matches ${id} structure, tokens/classes, and marker args` : recommendation === 'variant' ? `markup matches ${id} structure but differs in marker args or tokens/classes` : `no registry component has sufficient structural, token, and marker-arg similarity`
  const result = { recommendation, component: recommendation === 'create' ? null : id, justification: text, similarity: Number(best.score.toFixed(4)) }
  const record = { timestamp: new Date().toISOString(), markup: resolve(markupPath), ...result, catalogSha256: createHash('sha256').update(readFileSync(catalogPath)).digest('hex'), gitSHA: gitSha() }
  let log = { schemaVersion: 1, entries: [] }
  if (existsSync(logPath)) { try { log = JSON.parse(readFileSync(logPath, 'utf8')); if (!Array.isArray(log.entries)) log.entries = [] } catch { return fail(`invalid discovery log: ${logPath}`) } }
  log.schemaVersion = 1; log.entries.push(record); mkdirSync(dirname(logPath), { recursive: true }); writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n')
  console.log(`${recommendation === 'reuse' ? 'reuse' : recommendation === 'variant' ? 'variant' : 'create'}${id ? `: ${id}` : ''} — ${text}`)
}
try { main(process.argv.slice(2)) } catch (e) { fail(e.message) }

/**
 * ADR-0006 structural check (docs-only guard for the skill reconciliation).
 *
 * Verifies that docs/adr/ADR-0006-regra-unica-entre-skills.md keeps its
 * contract: every contradiction (a)–(h) declares a winner rule and a scope,
 * every `path:line` citation resolves to a real, non-empty line, the scoped
 * dial baselines really exist in their source-of-truth files, and the dead
 * `skills/taste-skill` path stays gone.
 *
 * Usage: node docs/adr/ADR-0006.check.mjs [caminho-do-ADR]
 *   (defaults to the ADR next to this script; a /tmp copy can be checked)
 *
 * Exit 0 = contract holds. Exit 1 = violation, listed on stdout.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ADR_PATH = resolve(process.argv[2] ?? join(HERE, 'ADR-0006-regra-unica-entre-skills.md'))

const errors = []
const fail = (msg) => errors.push(msg)

if (!existsSync(ADR_PATH)) {
  console.log(`ADR-0006 CHECK FAIL: arquivo não encontrado: ${ADR_PATH}`)
  process.exit(1)
}
const adr = readFileSync(ADR_PATH, 'utf8')

/* ---- 1. contradiction entries: (a)–(h), each with Vencedora + Escopo ---- */
const REQUIRED_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const entries = []
for (const m of adr.matchAll(/^### \(([a-h])\)\s+(.+)$/gm)) {
  const start = m.index
  const next = adr.indexOf('\n### (', start + 1)
  const end = next === -1 ? adr.indexOf('\n## ', start + 1) : next
  entries.push({ id: m[1], title: m[2].trim(), body: adr.slice(start, end === -1 ? adr.length : end) })
}

if (entries.length < 8) fail(`contradições declaradas: ${entries.length} (mínimo 8)`)
for (const id of REQUIRED_IDS) {
  if (!entries.some((e) => e.id === id)) fail(`contradição (${id}) ausente`)
}
for (const e of entries) {
  const winner = /^- \*\*Vencedora:\*\*\s*\S/m.exec(e.body)
  const scope = /^- \*\*Escopo:\*\*\s*\S/m.exec(e.body)
  if (!winner) fail(`contradição (${e.id}) sem regra vencedora declarada`)
  if (!scope) fail(`contradição (${e.id}) sem escopo declarado`)
}

/* ---- 2. every `path:line` citation resolves to a real non-empty line ---- */
const fileCache = new Map()
const readRepoFile = (rel) => {
  if (!fileCache.has(rel)) {
    const abs = join(ROOT, rel)
    fileCache.set(rel, existsSync(abs) ? readFileSync(abs, 'utf8').split('\n') : null)
  }
  return fileCache.get(rel)
}
const citation = /`((?:skills|docs|plugin|scripts)\/[^`:\s]*):(\d+)`/g
let citations = 0
for (const m of adr.matchAll(citation)) {
  citations++
  const [, rel, lineStr] = m
  const lines = readRepoFile(rel)
  if (lines === null) {
    fail(`citação ${rel}:${lineStr} — arquivo não existe`)
    continue
  }
  const line = lines[Number(lineStr) - 1]
  if (line === undefined) fail(`citação ${rel}:${lineStr} — linha fora do arquivo (${lines.length} linhas)`)
  else if (line.trim() === '') fail(`citação ${rel}:${lineStr} — linha vazia`)
}
if (citations < 8) fail(`citações path:line verificadas: ${citations} (mínimo 8)`)

/* ---- 3. dial baselines exist in their declared source-of-truth files ---- */
const taste = readRepoFile('skills/taste/SKILL.md') ?? []
const craft = readRepoFile('skills/design/assets/craft.md') ?? []
if (!taste.some((l) => l.includes('8 / 6 / 4'))) fail('baseline 8 / 6 / 4 ausente de skills/taste/SKILL.md')
if (!craft.some((l) => l.includes('| 7 | 4 | 4 |'))) fail('baseline 7 / 4 / 4 ausente de skills/design/assets/craft.md')
if (!craft.some((l) => l.includes('| 8 | 6 | 4 |'))) fail('baseline 8 / 6 / 4 (landing) ausente de skills/design/assets/craft.md')

/* ---- 4. dead path stays gone (resolution f) ---- */
if (taste.some((l) => l.includes('skills/taste-skill'))) {
  fail('skills/taste/SKILL.md volta a citar skills/taste-skill (caminho morto)')
}

/* ---- report ---- */
if (errors.length) {
  console.log('ADR-0006 CHECK FAIL:')
  for (const e of errors) console.log(`  - ${e}`)
  process.exit(1)
}
console.log(`ADR-0006 CHECK OK — ${entries.length} contradições com vencedora + escopo, ${citations} citações path:line resolvidas, baselines 7/4/4 e 8/6/4 confirmadas, caminho morto ausente`)

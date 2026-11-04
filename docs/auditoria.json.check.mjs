#!/usr/bin/env node
/**
 * docs/auditoria.json.check.mjs — verificador da auditoria técnica (todo 1).
 *
 * Usage: node docs/auditoria.json.check.mjs [caminho-do-auditoria.json] [--seed <n>]
 *   (default: docs/auditoria.json deste repositório; o alvo de verificação é
 *   SEMPRE a árvore de trabalho deste checkout, mesmo quando o JSON é uma cópia)
 *
 * Verifica (exit 0 só quando TUDO passa):
 *   1. o JSON parseia e carrega os campos obrigatórios (vazio/truncado = exit 2
 *      — nunca passa em silêncio);
 *   2. cobertura total: cada arquivo de `plugin scripts skills commands docs .github`
 *      está em exatamente uma entrada de arquivo, member de grupo ou exclusão
 *      explícita (lista completa — sem dupla cobertura, sem arquivo esquecido);
 *   3. cada path citado (entrada, member, amostra, exclusão, evidence) existe;
 *   4. as linhas declaradas de cada entrada/member conferem com o arquivo real
 *      (mudança de conteúdo pós-auditoria = auditoria stale, citada pelo path);
 *   5. cada evidence aponta arquivo:line válido, linha não vazia, com o texto
 *      da linha preso no JSON (evidenceText; prefixo quando termina em …);
 *   6. grupos de fixtures: members sem duplicata e sem fora-do-escopo, união
 *      exatamente igual a skills/design/scripts/fixtures/, amostra =
 *      min(10, members) conferida linha a linha;
 *   7. amostra aleatória semeada (10 entradas, membros de grupo inclusos) com
 *      class dentro do enum e a linha citada impressa para conferência;
 *   8. gitSHA é um commit conhecido e as mudanças commitadas desde ele são
 *      listadas (informacional — o fail duro é de fato, item 4).
 *
 * Exit codes: 0 ok | 1 violação (cada uma nomeada) | 2 entrada inutilizável.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROOTS = ['plugin', 'scripts', 'skills', 'commands', 'docs', '.github']
const FIXTURES_DIR = 'skills/design/scripts/fixtures'
const LAYERS = new Set(['Core', 'Skills', 'Adapters'])
const CLASSES = new Set(['existe', 'parcial', 'refatorar', 'construir'])
const SUBSYSTEMS = new Set([1, 2, 3, 4, 5, 6, 7, 8])
const MAX_TEXT = 200

const argv = process.argv.slice(2)
let jsonPath = 'docs/auditoria.json'
let seedText = 'mockbird-auditoria'
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--seed') {
    seedText = argv[i + 1] ?? seedText
    i += 1
    continue
  }
  if (!argv[i].startsWith('--') && jsonPath === 'docs/auditoria.json' && argv.length > 0 && argv[i] !== 'docs/auditoria.json.check.mjs') jsonPath = argv[i]
}
const AUDIT_PATH = jsonPath.startsWith('/')
  ? jsonPath
  : (existsSync(join(process.cwd(), jsonPath)) ? join(process.cwd(), jsonPath) : join(ROOT, jsonPath))

const errors = []
const fail = (msg) => errors.push(msg)

function lineCount(rel) {
  const content = readFileSync(join(ROOT, rel), 'utf8')
  return content === '' ? 0 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
}
function lineText(rel, n) {
  const content = readFileSync(join(ROOT, rel), 'utf8')
  return (content.split('\n')[n - 1] ?? '').replace(/\r$/, '')
}
function isFile(rel) {
  try { return statSync(join(ROOT, rel)).isFile() } catch { return false }
}
function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

// 1. entrada utilizável (vazio/truncado/malformado NUNCA passa)
let doc
try {
  const raw = readFileSync(AUDIT_PATH, 'utf8')
  if (raw.trim() === '') throw new Error('arquivo vazio')
  doc = JSON.parse(raw)
} catch (error) {
  console.error(`CHECK FALHOU: auditoria.json ilegível (${AUDIT_PATH}): ${error.message}`)
  process.exit(2)
}
const required = ['schemaVersion', 'audit', 'gitSHA', 'generatedAt', 'roots', 'taxonomy', 'exclusions', 'entries', 'fixtureGroups', 'totals']
for (const key of required) {
  if (doc[key] === undefined) {
    console.error(`CHECK FALHOU: campo obrigatório ausente: ${key}`)
    process.exit(2)
  }
}
if (!Array.isArray(doc.entries) || !Array.isArray(doc.fixtureGroups) || !Array.isArray(doc.exclusions)) {
  console.error('CHECK FALHOU: entries/fixtureGroups/exclusions devem ser listas')
  process.exit(2)
}

// 8. gitSHA conhecido + mudanças desde o auditado (informacional)
let driftList = []
try {
  execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${doc.gitSHA}^{commit}`], { stdio: 'pipe' })
} catch {
  fail(`gitSHA desconhecido no repositório (auditoria stale ou corrompida): ${doc.gitSHA}`)
}
if (errors.length === 0) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', `${doc.gitSHA}`, 'HEAD', '--', ...ROOTS], { encoding: 'utf8' })
    const self = new Set(['docs/auditoria.json', 'docs/auditoria.json.check.mjs', 'docs/auditoria-tecnica.md'])
    driftList = out.split('\n').filter((p) => p && !self.has(p))
  } catch { /* sem diff = sem drift */ }
}

// 2. inventário da árvore × cobertura
const treeFiles = []
for (const root of ROOTS) {
  if (!existsSync(join(ROOT, root))) {
    fail(`raiz declarada ausente: ${root}`)
    continue
  }
  walk(root, treeFiles)
}
const coveredBy = new Map()
const claim = (path, who) => {
  if (coveredBy.has(path)) fail(`cobertura dupla: ${path} (${coveredBy.get(path)} e ${who})`)
  else coveredBy.set(path, who)
}
const exclusionPrefixes = []
for (const e of doc.entries) claim(e.path, 'entrada de arquivo')
for (const g of doc.fixtureGroups) for (const m of g.members) claim(m, `grupo ${g.group}`)
for (const x of doc.exclusions) {
  if (!x || typeof x.path !== 'string' || typeof x.reason !== 'string' || x.reason.trim() === '') {
    fail(`exclusão sem path/reason explícito: ${JSON.stringify(x).slice(0, 100)}`)
    continue
  }
  if (x.path.endsWith('/')) exclusionPrefixes.push(x.path)
  else claim(x.path, 'exclusão')
}
for (const file of treeFiles) {
  if (!coveredBy.has(file) && !exclusionPrefixes.some((p) => file.startsWith(p))) {
    fail(`não coberto por entrada/grupo/exclusão: ${file}`)
  }
}
for (const [path, who] of coveredBy) {
  if (who !== 'exclusão' && !treeFiles.includes(path)) fail(`${who} aponta arquivo inexistente: ${path}`)
}

// 3-5. entradas de arquivo
for (const e of doc.entries) {
  if (!LAYERS.has(e.layer)) fail(`layer inválido em ${e.path}: ${e.layer}`)
  if (!CLASSES.has(e.class)) fail(`class inválido em ${e.path}: ${e.class}`)
  if (!SUBSYSTEMS.has(e.subsystem)) fail(`subsystem inválido em ${e.path}: ${e.subsystem}`)
  if (!Array.isArray(e.evidence) || e.evidence.length === 0) fail(`evidence ausente em ${e.path}`)
  if (isFile(e.path) && e.lines !== lineCount(e.path)) {
    fail(`linhas divergentes (auditoria stale): ${e.path} — auditoria ${e.lines}, árvore ${lineCount(e.path)}`)
  }
  for (const ev of e.evidence ?? []) checkEvidence(ev, `entrada ${e.path}`)
}

function checkEvidence(ev, who) {
  const ref = typeof ev === 'string' ? ev : ev.ref
  const text = typeof ev === 'string' ? '' : ev.text
  const idx = (ref ?? '').lastIndexOf(':')
  const file = idx > 0 ? ref.slice(0, idx) : ''
  const n = Number(ref.slice(idx + 1))
  if (!isFile(file)) {
    fail(`evidence aponta arquivo inexistente (${who}): ${ref}`)
    return
  }
  const total = lineCount(file)
  if (!(n >= 1 && n <= total)) {
    fail(`evidence fora do intervalo (${who}): ${ref} — o arquivo tem ${total} linha(s)`)
    return
  }
  const real = lineText(file, n)
  if (real.trim() === '') fail(`evidence em linha vazia (${who}): ${ref}`)
  const bind = text.endsWith('…') ? real.startsWith(text.slice(0, -1)) : real === text
  if (!bind) fail(`evidenceText não confere com a linha citada (${who}): ${ref}`)
}

// 6. grupos de fixtures
const fixtureFiles = existsSync(join(ROOT, FIXTURES_DIR)) ? walk(FIXTURES_DIR) : []
const membersSeen = new Map()
const groupNames = new Set()
for (const g of doc.fixtureGroups) {
  if (groupNames.has(g.group)) fail(`grupo duplicado: ${g.group}`)
  groupNames.add(g.group)
  if (!CLASSES.has(g.class)) fail(`class inválido no grupo ${g.group}: ${g.class}`)
  if (!LAYERS.has(g.layer)) fail(`layer inválido no grupo ${g.group}: ${g.layer}`)
  if (!Array.isArray(g.members) || g.members.length === 0) fail(`grupo sem members: ${g.group}`)
  let sum = 0
  for (const m of g.members) {
    if (membersSeen.has(m)) fail(`member duplicado: ${m} (grupos ${membersSeen.get(m)} e ${g.group})`)
    else membersSeen.set(m, g.group)
    if (!m.startsWith(`${FIXTURES_DIR}/`)) fail(`member fora do escopo de fixtures (${g.group}): ${m}`)
    if (isFile(m)) sum += lineCount(m)
  }
  if (isFile(g.members[0]) && g.lines !== sum) {
    fail(`lines do grupo ${g.group} divergente: auditoria ${g.lines}, soma real ${sum}`)
  }
  for (const ev of g.evidence ?? []) checkEvidence(ev, `grupo ${g.group}`)
  const expectedSample = Math.min(10, g.members.length)
  if (!Array.isArray(g.sample) || g.sample.length !== expectedSample) {
    fail(`amostra do grupo ${g.group} deve ter ${expectedSample} membros (tem ${g.sample?.length ?? 0})`)
    continue
  }
  for (const s of g.sample) {
    if (!g.members.includes(s.path)) fail(`amostra fora dos members (${g.group}): ${s.path}`)
    if (isFile(s.path) && s.lines !== lineCount(s.path)) {
      fail(`linhas divergentes na amostra (${g.group}): ${s.path} — auditoria ${s.lines}, árvore ${lineCount(s.path)}`)
    }
    checkEvidence(s.evidence, `amostra ${g.group}`)
  }
}
for (const f of fixtureFiles) if (!membersSeen.has(f)) fail(`fixture sem grupo: ${f}`)

// 7. amostra aleatória semeada (10 entradas; membros de grupo inclusos)
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let seed = 0
for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) | 0
const rand = mulberry32(seed)
const pool = [
  ...doc.entries.map((e) => ({ kind: 'entrada', path: e.path, class: e.class, ev: e.evidence?.[0] })),
  ...doc.fixtureGroups.flatMap((g) => g.members.map((m) => {
    const s = g.sample.find((x) => x.path === m)
    return { kind: `member ${g.group}`, path: m, class: g.class, ev: s ? s.evidence : g.evidence?.[0] }
  })),
]
const picks = []
for (let i = 0; i < 10 && pool.length > 0; i += 1) {
  picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
}
console.log('amostra aleatória (class | path | evidence | linha citada):')
for (const p of picks) {
  if (!CLASSES.has(p.class)) fail(`class inválido na amostra: ${p.path} → ${p.class}`)
  const ref = typeof p.ev === 'string' ? p.ev : p.ev?.ref
  const idx = (ref ?? '').lastIndexOf(':')
  const file = idx > 0 ? ref.slice(0, idx) : ''
  const n = Number(ref.slice(idx + 1))
  const shown = isFile(file) && n >= 1 && n <= lineCount(file) ? lineText(file, n).slice(0, 120) : '<linha indisponível>'
  console.log(`  ${p.class} | ${p.path} | ${ref} | ${shown}`)
  checkEvidence(p.ev ?? '', `amostra aleatória ${p.path}`)
}

// saída (totais)
const totalCovered = coveredBy.size
console.log(`arquivos conferidos: ${totalCovered} (entradas ${doc.entries.length}, members de grupos ${membersSeen.size}, exclusões ${doc.exclusions.length})`)
console.log(`grupos de fixtures: ${doc.fixtureGroups.length} | arquivos em fixtures/: ${fixtureFiles.length}`)
if (doc.totals && typeof doc.totals === 'object') {
  const t = doc.totals
  if (t.filesInFind !== treeFiles.length) {
    fail(`totals.filesInFind divergente: auditoria ${t.filesInFind}, árvore ${treeFiles.length}`)
  }
}
if (driftList.length > 0) {
  console.log(`mudanças commitadas desde o gitSHA auditado (${doc.gitSHA.slice(0, 7)}): ${driftList.length} arquivo(s) — informação; os fatos auditados ainda são verificados item a item:`)
  for (const d of driftList.slice(0, 10)) console.log(`  ~ ${d}`)
}

if (errors.length > 0) {
  console.error(`CHECK FALHOU (${errors.length} violação/ões):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log('CHECK OK')
process.exit(0)

#!/usr/bin/env node
/**
 * docs/camadas.check.mjs — verificador do mapa de camadas (todo 3).
 *
 * Usage: node docs/camadas.check.mjs [caminho-do-camadas.md] [--audit <path>]
 *   (default: docs/camadas.md e docs/auditoria.json deste repositório; o alvo
 *   de verificação é SEMPRE a árvore de trabalho deste checkout, mesmo quando o
 *   mapa é uma cópia em /tmp)
 *
 * Verifica (exit 0 só quando TUDO passa):
 *   1. o mapa parseia: tabela de ownership (8 subsistemas) + tabela de
 *      diretórios de produto (vazio/truncado = exit 2);
 *   2. todo path citado nos documentos (mapa + ADR-0005) existe — tokens
 *      template (com * ou <>), flags e pseudo-caminhos são ignorados; refs de
 *      linha (path:12, path:12-34) conferem com o tamanho real do arquivo;
 *   3. toda linha de diretório aponta diretório EXISTENTE dentro das raízes de
 *      produto (plugin, scripts, skills, commands, docs, .github);
 *   4. nenhum diretório de produto ficou de fora: todo arquivo/diretório da
 *      árvore sob as raízes está no escopo de >=1 linha da tabela de diretórios
 *      e os diretórios de produto canônicos têm linha dedicada;
 *   5. os 8 nomes de subsistema do todo 1 aparecem na tabela de ownership, cada
 *      um com camada dona válida (Core|Skills|Adapters) e >=1 arquivo dono
 *      existente (subsistema sem dono = falha nomeando-o);
 *   6. a coluna Planejado particiona EXATAMENTE os todos 9-62 (sem omissão,
 *      sem duplicata, sem número fora do intervalo);
 *   7. todo arquivo auditado (docs/auditoria.json: entradas + members de grupo
 *      + exclusões) mapeia para um subsistema: o subsistema auditado pertence
 *      ao conjunto declarado da linha que cobre o arquivo, e cada linha declara
 *      exatamente o conjunto de subsistemas da sua subárvore no audit. Entradas
 *      malformadas do audit são DADO EXTERNO: contadas e puladas, nunca derrubam
 *      o check nem alteram o veredito de cobertura;
 *   8. o gitSHA auditado embutido no mapa bate com o de docs/auditoria.json e
 *      resolve em commit conhecido; mudanças commitadas desde ele são listadas
 *      (informacional — o fail duro de staleness é o item 7).
 *
 * Exit codes: 0 ok | 1 violação (cada uma nomeada) | 2 entrada inutilizável.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROOTS = ['plugin', 'scripts', 'skills', 'commands', 'docs', '.github']
const LAYERS = new Set(['Core', 'Skills', 'Adapters'])
const SUBSYSTEMS = {
  1: 'Design Intelligence',
  2: 'Prototype Engine',
  3: 'Design System',
  4: 'Visual QA',
  5: 'Review Engine',
  6: 'Implementation QA',
  7: 'Design Memory',
  8: 'Agent Orchestration & Quality Gates',
}
/** Diretórios de produto canônicos (grão de gestão) — cada um exige linha dedicada. */
const REQUIRED_DIRS = [
  '.github', 'commands', 'docs', 'plugin', 'scripts',
  'skills/design', 'skills/design/assets', 'skills/design/assets/components',
  'skills/design/assets/example', 'skills/design/assets/vendor',
  'skills/design/scripts', 'skills/design/scripts/fixtures',
  'skills/design/scripts/lib', 'skills/design/scripts/rules',
  'skills/emil-design-eng', 'skills/impeccable', 'skills/impeccable/reference',
  'skills/impeccable/scripts', 'skills/taste',
]
const ADR_PATH = 'docs/adr/ADR-0005-remap-taxonomia.md'

const argv = process.argv.slice(2)
let mapArg = 'docs/camadas.md'
let auditArg = 'docs/auditoria.json'
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--audit') { auditArg = argv[i + 1] ?? auditArg; i += 1; continue }
  if (!argv[i].startsWith('--') && !argv[i].endsWith('camadas.check.mjs')) mapArg = argv[i]
}
const resolveArg = (p) => (p.startsWith('/') ? p : (existsSync(join(process.cwd(), p)) ? join(process.cwd(), p) : join(ROOT, p)))
const MAP_PATH = resolveArg(mapArg)
const AUDIT_PATH = resolveArg(auditArg)

const errors = []
const fail = (msg) => errors.push(msg)
const exists = (rel) => { try { statSync(join(ROOT, rel)); return true } catch { return false } }
const isDir = (rel) => { try { return statSync(join(ROOT, rel)).isDirectory() } catch { return false } }
const isFile = (rel) => { try { return statSync(join(ROOT, rel)).isFile() } catch { return false } }
function lineCount(rel) {
  const content = readFileSync(join(ROOT, rel), 'utf8')
  return content === '' ? 0 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
}
function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) { out.push(rel); walk(rel, out) } else out.push(rel)
  }
  return out
}

// 1. entrada utilizável (mapa vazio/truncado/malformado NUNCA passa)
let mapRaw
try {
  mapRaw = readFileSync(MAP_PATH, 'utf8')
  if (mapRaw.trim() === '') throw new Error('arquivo vazio')
} catch (error) {
  console.error(`CHECK FALHOU: camadas.md ilegível (${MAP_PATH}): ${error.message}`)
  process.exit(2)
}

function parseTable(md, requiredHeaders) {
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue
    const group = []
    let j = i
    while (j < lines.length && lines[j].trim().startsWith('|')) { group.push(lines[j]); j += 1 }
    i = j - 1
    const header = group[0].split('|').slice(1, -1).map((c) => c.trim())
    if (!requiredHeaders.every((h) => header.some((c) => c.startsWith(h)))) continue
    const idx = Object.fromEntries(requiredHeaders.map((h) => [h, header.findIndex((c) => c.startsWith(h))]))
    const rows = []
    for (const line of group.slice(1)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^:?-{3,}:?$/.test(c) || c === '')) continue
      rows.push({ cells, idx, line })
    }
    return rows
  }
  return null
}

const ownRows = parseTable(mapRaw, ['Subsistema', 'Camada dona', 'Arquivos donos', 'Planejado'])
const dirRows = parseTable(mapRaw, ['Diretório', 'Camada', 'Subsistemas servidos', 'Arquivo dono'])
if (!ownRows || ownRows.length === 0) { console.error('CHECK FALHOU: tabela de ownership por subsistema ausente ou sem linhas'); process.exit(2) }
if (!dirRows || dirRows.length === 0) { console.error('CHECK FALHOU: tabela de diretórios de produto ausente ou sem linhas'); process.exit(2) }

// 2. todo path citado existe (mapa + ADR-0005)
function citedTokens(text) {
  const noFences = text.replace(/```[\s\S]*?```/g, '')
  const tokens = []
  for (const m of noFences.matchAll(/`([^`\n]+)`/g)) {
    for (let tok of m[1].split(/\s+/)) {
      tok = tok.replace(/[.,;:)]+$/, '')
      const lineRef = tok.match(/^(.+?):([0-9]+(?:[,.-][0-9]+)*)$/)
      let rel = tok
      let maxLine = 0
      if (lineRef && !/^[0-9a-f]+$/.test(lineRef[1])) { rel = lineRef[1]; maxLine = Math.max(...lineRef[2].split(/[,-]/).map(Number)) }
      rel = rel.replace(/#.*$/, '').replace(/\/$/, '')
      if (rel === '' || /[<>*~$\s]/.test(rel) || rel.startsWith('-') || rel.startsWith('/')) continue
      const pathish = /^\.?[a-z0-9][A-Za-z0-9_./-]*$/.test(rel) && (rel.includes('/') || /\.(mjs|js|ts|json|md|yml|yaml|html|css|cmd|txt)$/.test(rel))
      if (!pathish) continue
      tokens.push({ rel, maxLine })
    }
  }
  return tokens
}
const scannedDocs = [{ who: 'camadas.md', text: mapRaw }]
if (isFile(ADR_PATH)) scannedDocs.push({ who: ADR_PATH, text: readFileSync(join(ROOT, ADR_PATH), 'utf8') })
else fail(`documento citado pelo mapa não existe: ${ADR_PATH}`)
const treeFiles = []
for (const root of ROOTS) {
  if (!existsSync(join(ROOT, root))) { fail(`raiz de produto ausente: ${root}`); continue }
  walk(root, treeFiles)
}
const basenames = new Set(treeFiles.map((p) => p.split('/').pop()))
for (const doc of scannedDocs) {
  for (const { rel, maxLine } of citedTokens(doc.text)) {
    if (exists(rel)) {
      if (maxLine > 0 && isFile(rel) && maxLine > lineCount(rel)) fail(`ref de linha além do fim do arquivo (${doc.who}): ${rel}:${maxLine} > ${lineCount(rel)} linha(s)`)
    } else if (!rel.includes('/') && basenames.has(rel)) {
      // nome de arquivo sem diretório: aceito quando existe na árvore
    } else {
      fail(`path citado não existe (${doc.who}): ${rel}`)
    }
  }
}

// 3-4. tabela de diretórios: linhas existentes + cobertura total da árvore
const rowScopes = []
for (const r of dirRows) {
  const dir = r.cells[r.idx['Diretório']]
  const layer = (r.cells[r.idx['Camada']] ?? '').match(/^(Core|Skills|Adapters)/)?.[1]
  const ownerTokens = citedTokens(r.cells[r.idx['Arquivo dono']] ?? '')
  const declared = new Set((r.cells[r.idx['Subsistemas servidos']] ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean))
  if (!dir || !isDir(dir)) { fail(`linha de diretório aponta caminho inexistente: ${dir || '(vazia)'}`); continue }
  if (!ROOTS.some((root) => dir === root || dir.startsWith(`${root}/`))) fail(`diretório fora das raízes de produto: ${dir}`)
  if (!layer) fail(`camada inválida na linha ${dir}: ${r.cells[r.idx['Camada']]}`)
  if (ownerTokens.length === 0) fail(`linha de diretório sem arquivo dono: ${dir}`)
  for (const { rel } of ownerTokens) {
    if (!exists(rel)) fail(`arquivo dono inexistente na linha ${dir}: ${rel}`)
    else if (!(rel === dir || rel.startsWith(`${dir}/`))) fail(`arquivo dono fora do diretório da linha ${dir}: ${rel}`)
  }
  rowScopes.push({ dir, layer, declared, row: r })
}
for (const req of REQUIRED_DIRS) {
  if (!rowScopes.some((s) => s.dir === req)) fail(`diretório de produto sem linha dedicada na tabela: ${req}`)
}
const covered = (p) => rowScopes.some((s) => p === s.dir || p.startsWith(`${s.dir}/`))
for (const p of treeFiles) {
  if (!covered(p)) fail(`diretório/arquivo de produto sem linha que o cobre: ${p}`)
}

// 5. os 8 subsistemas aparecem na tabela de ownership com camada + ≥1 dono
const ownBySub = new Map()
for (const r of ownRows) {
  const name = (r.cells[r.idx['Subsistema']] ?? '').trim()
  const m = name.match(/^([1-8])\s+(.+)$/)
  if (!m) { fail(`linha de subsistema com nome fora do enum: "${name}"`); continue }
  const expected = `${m[1]} ${SUBSYSTEMS[Number(m[1])]}`
  if (name !== expected) fail(`nome de subsistema divergente do todo 1: "${name}" (esperado: "${expected}")`)
  const layer = (r.cells[r.idx['Camada dona']] ?? '').trim()
  if (!LAYERS.has(layer)) fail(`camada dona inválida em ${name}: ${layer}`)
  const owners = citedTokens(r.cells[r.idx['Arquivos donos']] ?? '')
  if (owners.length === 0) fail(`subsistema sem arquivo dono: ${name}`)
  for (const { rel } of owners) if (!exists(rel)) fail(`arquivo dono inexistente em ${name}: ${rel}`)
  ownBySub.set(name, { layer, owners, row: r })
}
for (const n of Object.keys(SUBSYSTEMS)) {
  const expected = `${n} ${SUBSYSTEMS[n]}`
  if (!ownBySub.has(expected)) fail(`subsistema sem linha na tabela de ownership: ${expected}`)
}

// 6. coluna Planejado particiona exatamente os todos 9-62
const seen = new Map()
for (const [name, { row }] of ownBySub) {
  const cell = row.cells[row.idx['Planejado']] ?? ''
  for (const m of cell.matchAll(/\b(\d{1,2})\b/g)) {
    const n = Number(m[1])
    if (n < 9 || n > 62) { fail(`todo fora do intervalo 9-62 na coluna Planejado de ${name}: ${n}`); continue }
    if (seen.has(n)) fail(`todo ${n} planejado em mais de um subsistema: ${seen.get(n)} e ${name}`)
    else seen.set(n, name)
  }
}
for (let n = 9; n <= 62; n += 1) if (!seen.has(n)) fail(`todo ${n} sem subsistema dono na coluna Planejado`)

// 7. todo arquivo auditado mapeia para um subsistema (audit é dado externo)
let audit
try {
  const raw = readFileSync(AUDIT_PATH, 'utf8')
  if (raw.trim() === '') throw new Error('arquivo vazio')
  audit = JSON.parse(raw)
} catch (error) {
  console.error(`CHECK FALHOU: auditoria.json ilegível (${AUDIT_PATH}): ${error.message}`)
  process.exit(2)
}
if (!Array.isArray(audit.entries) || !Array.isArray(audit.fixtureGroups) || !Array.isArray(audit.exclusions)) {
  console.error('CHECK FALHOU: entries/fixtureGroups/exclusions do audit devem ser listas')
  process.exit(2)
}
let skipped = 0 // entradas malformadas: dado externo hostil/nulo nunca derruba o check
const items = [] // {path, sub|0}
for (const e of audit.entries) {
  if (e && typeof e.path === 'string' && Number.isInteger(e.subsystem) && SUBSYSTEMS[e.subsystem]) items.push({ path: e.path, sub: e.subsystem })
  else skipped += 1
}
for (const g of audit.fixtureGroups) {
  const valid = g && Number.isInteger(g.subsystem) && SUBSYSTEMS[g.subsystem] && Array.isArray(g.members)
  for (const m of valid ? g.members : []) {
    if (typeof m === 'string') items.push({ path: m, sub: g.subsystem })
    else skipped += 1
  }
  if (!valid && g !== null) skipped += 1
}
const prefixExclusions = []
for (const x of audit.exclusions) {
  if (x && typeof x.path === 'string') {
    if (x.path.endsWith('/')) prefixExclusions.push(x.path)
    else items.push({ path: x.path, sub: 0 })
  } else skipped += 1
}
let mapped = 0
for (const { path, sub } of items) {
  if (sub === 0) continue // exclusão sem subsistema: só precisa estar coberta por linha
  const covering = rowScopes.filter((s) => path === s.dir || path.startsWith(`${s.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)
  if (covering.length === 0) { fail(`arquivo auditado sem linha que o cobre: ${path}`); continue }
  if (!covering[0].declared.has(sub)) fail(`arquivo auditado fora do subsistema declarado na linha ${covering[0].dir}: ${path} (audit: sub ${sub}; linha declara: ${[...covering[0].declared].join(',')})`)
  else mapped += 1
}
for (const s of rowScopes) {
  const recomputed = new Set(items.filter((it) => it.sub !== 0 && (it.path === s.dir || it.path.startsWith(`${s.dir}/`))).map((it) => it.sub))
  const missing = [...recomputed].filter((x) => !s.declared.has(x))
  const extra = [...s.declared].filter((x) => !recomputed.has(x))
  if (missing.length > 0 || extra.length > 0) {
    fail(`linha ${s.dir} declara subsistemas ${[...s.declared].sort().join(',') || '(vazio)'} mas a subárvore auditada tem ${[...recomputed].sort().join(',') || '(vazio)'}`)
  }
}

// 8. gitSHA embutido == gitSHA do audit, resolvido em commit conhecido
const shaMatch = mapRaw.match(/gitSHA auditado[^0-9a-f]*([0-9a-f]{7,40})/)
if (!shaMatch) fail('gitSHA auditado não encontrado no mapa (campo obrigatório de staleness)')
else {
  const sha = shaMatch[1]
  if (typeof audit.gitSHA !== 'string' || !audit.gitSHA.startsWith(sha)) {
    fail(`gitSHA embutido no mapa (${sha}) não bate com o do auditoria.json (${audit.gitSHA})`)
  }
  try {
    execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `${sha}^{commit}`], { stdio: 'pipe' })
  } catch {
    fail(`gitSHA auditado desconhecido no repositório (mapa stale ou corrompido): ${sha}`)
  }
  if (errors.length === 0) {
    try {
      const out = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', audit.gitSHA, 'HEAD', '--', ...ROOTS], { encoding: 'utf8' })
      const drift = out.split('\n').filter(Boolean)
      if (drift.length > 0) {
        console.log(`mudanças commitadas desde o gitSHA auditado (${audit.gitSHA.slice(0, 7)}): ${drift.length} arquivo(s) — informação; o mapa continua validando contra a árvore atual:`)
        for (const d of drift.slice(0, 10)) console.log(`  ~ ${d}`)
      }
    } catch { /* sem diff = sem drift */ }
  }
}

// saída (contagens)
const layerCount = {}
for (const s of rowScopes) layerCount[s.layer] = (layerCount[s.layer] ?? 0) + 1
console.log(`tabela de diretórios: ${rowScopes.length} linhas (${Object.entries(layerCount).map(([k, v]) => `${k} ${v}`).join(', ')})`)
console.log(`tabela de ownership: ${ownBySub.size} subsistemas (camadas donas: ${[...ownBySub.values()].map((v) => v.layer).join(', ')})`)
console.log(`todos planejados particionados: ${seen.size} (9-62)`)
console.log(`arquivos auditados mapeados por subsistema: ${mapped} (entradas+members; ${prefixExclusions.length} exclusões por prefixo, ${skipped} entradas de audit ignoradas como dado inválido)`)
if (errors.length > 0) {
  console.error(`CHECK FALHOU (${errors.length} violação/ões):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log('CHECK OK')
process.exit(0)

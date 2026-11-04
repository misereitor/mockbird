#!/usr/bin/env node
/**
 * visual-score.mjs — Quality Score por critério com histórico (plano todo 12, GAP-A3).
 *
 * SCORE É INSTRUMENTO DE RASTREIO (docs/arquitetura-evolutiva.md §8): este
 * script NUNCA bloqueia nada. O gate (skills/design/scripts/visual-gate.mjs)
 * decide APENAS por diff determinístico (pixelRatio/SSIM vs limiar da
 * plataforma) ou contrato quebrado — nunca por score.
 *
 * Agrega as issues do Visual Critic (todo 11 — <target>/.visual/critic/*.json)
 * e as métricas determinísticas da matriz de captura (todo 9 —
 * <target>/.visual/manifest.json) num score 0-100 por critério (os 8 de
 * critic-report.schema.json: hierarquia, composicao, tipografia, espacamento,
 * consistencia, responsividade, acessibilidade, microinteracao) + overall
 * ponderado.
 *
 * Método (determinístico; TRUNCA em 2 casas — arredondar para cima é proibido):
 *   base_c      = max(0, 100 - 25*blockers_c - 10*majors_c - 3*minors_c)
 *                 (penalidades = pesos do scoreOf do critic — todo 11)
 *   cobertura   = fração da matriz 5 viewports × 7 estados (todo 9) com
 *                 evidência de captura no manifest:
 *                   responsividade × viewports_distintos/5
 *                   microinteracao × estados_distintos/7
 *                   demais critérios × 1
 *   perCriteria = trunc2(base_c × cobertura_c)   (aritmética inteira: floor)
 *   overall     = trunc2(Σ peso_c × perCriteria_c) — pesos inteiros em
 *                 centésimos de percentual (WEIGHTS, soma 100); truncado
 *                 sobre os valores já truncados dos critérios.
 *
 * Histórico (append-only) em <target>/.visual/scores.json:
 *   { schemaVersion: 1, entries: [{gitSHA, timestamp, screen, perCriteria, overall}] }
 * Cada execução ANEXA uma entrada por tela; entradas anteriores nunca são
 * alteradas nem removidas (arquivo corrompido/fora do contrato => erro guiado,
 * nunca regravado). A primeira entrada por tela é a baseline do rastreio.
 * gitSHA/timestamp seguem a §5.6 (anti-fake).
 *
 * Entradas obrigatórias (ausência ou malformação => erro guiado, exit 2 —
 * nunca "verde parcial"): relatórios do critic em .visual/critic/ e
 * .visual/manifest.json. Chave de join: report.screen == images[].file do
 * manifest (caminho da tela relativo ao target, separador '/'). Telas sem
 * evidência nos dois lados reprovam o run inteiro.
 *
 * Exit codes: 0 = histórico anexado (score nunca bloqueia), 2 = erro de
 * entrada/uso (nada é gravado).
 *
 * Usage: node skills/design/scripts/visual-score.mjs [--target <dir>] [--help]
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAgainstSchema } from './visual-critic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(HERE, '..', 'assets', 'critic-report.schema.json')

const usage = 'usage: node skills/design/scripts/visual-score.mjs [--target <dir>] [--help]'

// Os 8 critérios (craft.md pós-todo 4 = critic-report.schema.json).
export const CRITERIA = [
  'hierarquia',
  'composicao',
  'tipografia',
  'espacamento',
  'consistencia',
  'responsividade',
  'acessibilidade',
  'microinteracao',
]

// Pesos do overall, inteiros em centésimos de percentual (soma 100).
// craft.md fixa os 8 critérios; a ponderação é contrato deste script.
export const WEIGHTS = {
  hierarquia: 15,
  composicao: 13,
  tipografia: 13,
  espacamento: 10,
  consistencia: 12,
  responsividade: 13,
  acessibilidade: 14,
  microinteracao: 10,
}

// Matriz de captura do todo 9: 5 viewports × 7 estados por tela.
const MATRIX_VIEWPORTS = 5
const MATRIX_STATES = 7

// trunc2 via aritmética inteira (centésimos) — floor, nunca arredondar p/ cima.
function scoreScreen(issues, viewportCount, stateCount) {
  const perCriteria = {}
  const hundredths = {}
  for (const c of CRITERIA) {
    let blocker = 0
    let major = 0
    let minor = 0
    for (const it of issues) {
      if (it.category !== c) continue
      if (it.severity === 'blocker') blocker += 1
      else if (it.severity === 'major') major += 1
      else minor += 1
    }
    const base = Math.max(0, 100 - 25 * blocker - 10 * major - 3 * minor)
    let num = 1
    let den = 1
    if (c === 'responsividade') {
      num = Math.min(viewportCount, MATRIX_VIEWPORTS)
      den = MATRIX_VIEWPORTS
    } else if (c === 'microinteracao') {
      num = Math.min(stateCount, MATRIX_STATES)
      den = MATRIX_STATES
    }
    hundredths[c] = Math.floor((base * num * 100) / den)
    perCriteria[c] = hundredths[c] / 100
  }
  let weighted = 0
  for (const c of CRITERIA) weighted += WEIGHTS[c] * hundredths[c]
  return { perCriteria, overall: Math.floor(weighted / 100) / 100 }
}

function die(message) {
  console.error(`visual-score: ${message}`)
  process.exit(2)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(path) {
  return String(path).split('\\').join('/')
}

function gitShaOf(dir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
let targetArg = './design'
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(usage)
    process.exit(0)
  } else if (token === '--target') {
    if (i + 1 >= argv.length) die(`--target requer um caminho — ${usage}`)
    targetArg = argv[i + 1]
    i += 1
  } else {
    die(`argumento desconhecido "${token}" — ${usage}`)
  }
}

const targetDir = resolve(targetArg)
const targetSt = (() => {
  try {
    return statSync(targetDir)
  } catch {
    return null
  }
})()
if (!targetSt?.isDirectory()) die(`target não encontrado ou não é diretório: ${targetArg}`)

const visualDir = join(targetDir, '.visual')
const criticDir = join(visualDir, 'critic')
const manifestPath = join(visualDir, 'manifest.json')
const scoresPath = join(visualDir, 'scores.json')

// ---------------------------------------------------------------------------
// 1. Relatórios do critic (todo 11) — obrigatórios e schema-válidos.
// ---------------------------------------------------------------------------
let schema = null
try {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
} catch {
  die('critic-report.schema.json ausente ou ilegível em skills/design/assets/')
}
const reportFiles = existsSync(criticDir)
  ? readdirSync(criticDir)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .sort()
  : []
if (reportFiles.length === 0) {
  die(`nenhum relatório do critic em ${join(targetArg, '.visual', 'critic')} — rode skills/design/scripts/visual-critic.mjs antes do score`)
}
const reports = []
for (const name of reportFiles) {
  const full = join(criticDir, name)
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(full, 'utf8'))
  } catch (error) {
    die(`${join(targetArg, '.visual', 'critic', name)}: JSON inválido — ${String(error?.message ?? error)}`)
  }
  const errors = validateAgainstSchema(parsed, schema)
  if (errors.length > 0) die(`${join(targetArg, '.visual', 'critic', name)}: relatório fora do contrato — ${errors[0]}`)
  reports.push(parsed)
}

// ---------------------------------------------------------------------------
// 2. Manifest da captura (todo 9) — obrigatório e estruturalmente válido.
// ---------------------------------------------------------------------------
if (!existsSync(manifestPath)) {
  die(`manifest de captura ausente: ${join(targetArg, '.visual', 'manifest.json')} — rode skills/design/scripts/visual-capture.mjs antes do score`)
}
let manifest = null
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  die(`${join(targetArg, '.visual', 'manifest.json')}: JSON inválido — ${String(error?.message ?? error)}`)
}
if (!isPlainObject(manifest) || !Array.isArray(manifest.images)) {
  die(`${join(targetArg, '.visual', 'manifest.json')}: contrato quebrado — esperado objeto com "images" (todo 9)`)
}
const captures = new Map() // screen file -> { viewports: Set, states: Set }
manifest.images.forEach((entry, index) => {
  if (
    !isPlainObject(entry) ||
    typeof entry.file !== 'string' ||
    typeof entry.viewport !== 'string' ||
    typeof entry.state !== 'string'
  ) {
    die(`${join(targetArg, '.visual', 'manifest.json')}: images[${index}] fora do contrato (file/viewport/state obrigatórios)`)
  }
  const key = normalize(entry.file)
  if (!captures.has(key)) captures.set(key, { viewports: new Set(), states: new Set() })
  captures.get(key).viewports.add(entry.viewport)
  captures.get(key).states.add(entry.state)
})

// ---------------------------------------------------------------------------
// 3. Join por tela: evidência nos DOIS lados ou o run inteiro reprova
//    (sem verde parcial).
// ---------------------------------------------------------------------------
const byScreen = new Map() // screen -> issues concatenadas
for (const report of reports) {
  const key = normalize(report.screen)
  if (!byScreen.has(key)) byScreen.set(key, [])
  byScreen.get(key).push(...report.issues)
}
const missingEvidence = [...byScreen.keys()].filter((key) => !captures.has(key)).sort()
if (missingEvidence.length > 0) {
  die(`tela(s) com relatório do critic mas sem evidência de captura no manifest: ${missingEvidence.join(', ')} — sem score parcial`)
}
const missingReports = [...captures.keys()].filter((key) => !byScreen.has(key)).sort()
if (missingReports.length > 0) {
  die(`tela(s) capturada(s) no manifest mas sem relatório do critic: ${missingReports.join(', ')} — sem score parcial`)
}
const screens = [...byScreen.keys()].sort()
if (screens.length === 0) die('nenhuma tela nos relatórios do critic — score sem telas não emite nada')

// ---------------------------------------------------------------------------
// 4. Score por tela.
// ---------------------------------------------------------------------------
const gitSHA = gitShaOf(targetDir)
const timestamp = new Date().toISOString()
const entries = []
for (const screen of screens) {
  const cap = captures.get(screen)
  const { perCriteria, overall } = scoreScreen(byScreen.get(screen), cap.viewports.size, cap.states.size)
  entries.push({ gitSHA, timestamp, screen, perCriteria, overall })
  console.log(
    `score: ${screen} — overall ${overall} | ${CRITERIA.map((c) => `${c} ${perCriteria[c]}`).join(', ')}`
  )
}

// ---------------------------------------------------------------------------
// 5. Histórico append-only: entradas anteriores nunca mudam nem somem.
// ---------------------------------------------------------------------------
let history = { schemaVersion: 1, entries: [] }
if (existsSync(scoresPath)) {
  try {
    history = JSON.parse(readFileSync(scoresPath, 'utf8'))
  } catch (error) {
    die(`${join(targetArg, '.visual', 'scores.json')}: histórico ilegível — nunca é sobrescrito (${String(error?.message ?? error)})`)
  }
  if (!isPlainObject(history) || history.schemaVersion !== 1 || !Array.isArray(history.entries)) {
    die(`${join(targetArg, '.visual', 'scores.json')}: histórico fora do contrato — nunca é sobrescrito`)
  }
}
const priorCount = history.entries.length
history.entries.push(...entries)
mkdirSync(visualDir, { recursive: true })
writeFileSync(scoresPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8')
console.log(
  `score: ${entries.length} entrada(s) anexada(s) em ${join(targetArg, '.visual', 'scores.json')} (${priorCount} anteriores preservada(s))`
)
console.log('score: instrumento de rastreio — nunca bloqueia; o gate decide por diff/contrato (skills/design/scripts/visual-gate.mjs)')
process.exit(0)

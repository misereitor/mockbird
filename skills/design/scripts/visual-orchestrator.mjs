#!/usr/bin/env node
/**
 * visual-orchestrator.mjs — Orquestrador de testes visuais com relatório único
 * (plano todo 13, GAP-A5).
 *
 * Identifica telas/dispositivos de cada canvas do target (canvas.json manifests
 * — convenção de agent-map.mjs/visual-capture.mjs) e roda a cadeia COMPLETA, em
 * ordem, sem cache e sem etapa opcional:
 *
 *   1. capture  visual-capture.mjs (todo 9) — matriz 5 viewports × 7 estados
 *               por tela + manifest versionado em <target>/.visual/;
 *   2. diff     lib/image-diff.mjs (todo 10) — pares baseline
 *               (<target>/.visual/baseline/) × captura atual; imagem sem par é
 *               AVISO (contada em withoutBaseline), nunca bloqueio — a
 *               semântica de bloqueio pertence ao visual-gate.mjs;
 *   3. critic   visual-critic.mjs (todo 11) — issues determinísticas por tela
 *               em <target>/.visual/critic/;
 *   4. score    visual-score.mjs (todo 12) — histórico por critério anexado em
 *               <target>/.visual/scores.json (1 entrada por tela);
 *   5. a11y     regras a11y existentes: rules/a11y.mjs (regra de template) +
 *               checks do validate.mjs — os achados dos DOIS canais, dedupados
 *               e atribuídos por tela.
 *
 * Emissão: UM relatório <target>/.visual/report.json + saída legível no
 * stdout. Forma do relatório (conteúdo determinístico menos o timestamp):
 *
 *   { schemaVersion: 1, gitSHA, timestamp, platform,
 *     screens: [{ screen, capture, diff, critic, score, a11y }],
 *     summary: { blockers, issues, gate } }
 *
 *   screen   caminho da tela relativo ao target (chave de join manifest/
 *            critic/score); capture = {canvas, tela, device, width, height,
 *            contentHash, images, viewports, states} — contentHash = sha256 do
 *            HTML da tela (screenHash do manifest, §5.6 anti-fake); diff =
 *            {compared, aboveThreshold, withoutBaseline, pairs:[{file,
 *            pixelRatio, ssim, pass}]}; critic = {score, issues}; score =
 *            {perCriteria, overall}; a11y = {checks, failures, ok}.
 *   summary.issues   = Σ telas (issues do critic + falhas a11y + pares acima do
 *                      limiar) — "soma dos issues = contagem";
 *   summary.blockers = Σ telas (issues do critic com severity "blocker" +
 *                      falhas a11y + pares acima do limiar);
 *   summary.gate     = 'skipped' (sem --gate) | 'pass' | 'fail'.
 *
 * --gate emite o relatório e DELEGA a decisão de bloqueio ao gate do todo 12
 * (visual-gate.mjs — npm run visual:gate; nunca reimplementado aqui: diff/
 * contrato são avaliados pelo gate). A proibição do plano "exit 0 com blockers
 * quando --gate" é literal e soma-se à delegação (mesmo molde do --gate do
 * visual-critic.mjs: decide o exit code pela presença de blockers): com --gate,
 * exit 0 somente com veredito delegado pass E blockers 0.
 *
 * Sem verde parcial (proibição "relatório parcial mascarado como completo"):
 * etapa ausente, falha ou sem evidência para QUALQUER tela aborta com exit ≠ 0
 * nomeando a etapa ("etapa ausente: <etapa>") e o relatório NÃO é emitido. O
 * relatório só sai quando as 5 etapas têm evidência para todas as telas —
 * evidência é artefato verificado: manifest apontando PNG ausente no disco ou
 * contentHash divergente da fonte conta como "sem evidência".
 *
 * Limiar do diff: loadThresholds com caminho EXPLÍCITO (o default do módulo é
 * cwd-relative e não é usado aqui) — --thresholds <arquivo>, senão
 * <target>/visual-thresholds.json, senão design/visual-thresholds.json do pack.
 *
 * Exit codes: 0 = relatório completo emitido (sem --gate; ou --gate pass);
 *   1 = --gate bloqueado; 2 = erro de uso/entrada ou etapa ausente/falhou
 *   (relatório nunca emitido).
 *
 * Usage: node skills/design/scripts/visual-orchestrator.mjs [--target <dir>]
 *   [--config <validate.config.json>] [--thresholds <arquivo>] [--gate]
 *   [--help]
 *   target = design-root (modo projeto). canvas.json na raiz é rejeitado: a
 *   cadeia capture/critic/score/gate só é coerente com o design root como alvo.
 */
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CAPTURE = join(HERE, 'visual-capture.mjs')
const CRITIC = join(HERE, 'visual-critic.mjs')
const SCORE = join(HERE, 'visual-score.mjs')
const GATE = join(HERE, 'visual-gate.mjs')
const VALIDATE = join(HERE, 'validate.mjs')
const IMAGE_DIFF = join(HERE, 'lib', 'image-diff.mjs')
const A11Y_RULE = join(HERE, 'rules', 'a11y.mjs')
const DEFAULT_CONFIG = join(HERE, '..', 'assets', 'validate.config.json')
const PACK_THRESHOLDS = join(HERE, '..', '..', '..', 'design', 'visual-thresholds.json')

const REPORT_NAME = 'report.json'
const SCHEMA_VERSION = 1
const A11Y_CHECKS = ['rules/a11y.mjs', 'validate.mjs']
// Espelho do SKIP_DIRS do visual-capture.mjs (pastas que nunca hospedam canvas).
const SKIP_DIRS = new Set(['node_modules', '.history', 'snapshots', 'vendor', 'scripts', 'spec', '.visual'])

const usage =
  'usage: node skills/design/scripts/visual-orchestrator.mjs [--target <dir>] [--config <path>] ' +
  '[--thresholds <path>] [--gate] [--help]'

function die(message) {
  console.error(`visual-orchestrator: ${message}`)
  process.exit(2)
}

function dieStep(step, detail) {
  die(`etapa ${step}: ${detail}`)
}

function dieMissing(step, detail) {
  die(`etapa ausente: ${step} — ${detail} (relatório incompleto nunca é emitido)`)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePath(value) {
  return String(value).split('\\').join('/')
}

function gitShaOf(dir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const opts = { target: './design', config: null, thresholds: null, gate: false }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(usage)
    process.exit(0)
  } else if (token === '--target' || token === '--config' || token === '--thresholds') {
    if (i + 1 >= argv.length) die(`${token} requer um caminho — ${usage}`)
    opts[token.slice(2)] = argv[i + 1]
    i += 1
  } else if (token === '--gate') {
    opts.gate = true
  } else {
    die(`argumento desconhecido "${token}" — ${usage}`)
  }
}

const targetDir = resolve(opts.target)
const targetSt = (() => {
  try {
    return statSync(targetDir)
  } catch {
    return null
  }
})()
if (!targetSt?.isDirectory()) die(`target não encontrado ou não é diretório: ${opts.target}`)
if (existsSync(join(targetDir, 'canvas.json'))) {
  die(`target deve ser um design-root (modo projeto): ${opts.target} tem canvas.json na raiz`)
}

// ---------------------------------------------------------------------------
// Etapas — registro único usado pela checagem de pré-condição (módulo presente)
// e pela montagem (evidência por tela). Qualquer etapa sem módulo ou sem
// evidência => exit ≠ 0 nomeando a etapa, nunca relatório incompleto.
// ---------------------------------------------------------------------------
const STEPS = [
  { id: 'capture', modules: [CAPTURE] },
  { id: 'diff', modules: [IMAGE_DIFF] },
  { id: 'critic', modules: [CRITIC] },
  { id: 'score', modules: [SCORE] },
  { id: 'a11y', modules: [A11Y_RULE, VALIDATE] },
]
if (opts.gate) STEPS.push({ id: 'gate', modules: [GATE] })
for (const step of STEPS) {
  for (const modulePath of step.modules) {
    if (!existsSync(modulePath)) {
      dieMissing(step.id, `módulo ${normalizePath(relative(process.cwd(), modulePath)) || modulePath} não encontrado`)
    }
  }
}

// ---------------------------------------------------------------------------
// Identificação: telas/dispositivos de cada canvas (canvas.json manifests).
// ---------------------------------------------------------------------------
function readCanvasManifest(path) {
  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    die(`canvas.json inválido (${normalizePath(path)}): ${String(error?.message ?? error)}`)
  }
  if (!isPlainObject(manifest) || !Array.isArray(manifest.screens)) {
    die(`canvas.json fora do contrato (${normalizePath(path)}): esperado objeto com "screens"`)
  }
  return manifest
}

const screens = []
{
  const canvases = []
  const walk = (dir) => {
    let entries = null
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (existsSync(join(full, 'canvas.json'))) {
        canvases.push({ dir: full, relDir: normalizePath(relative(targetDir, full)) })
      }
      walk(full)
    }
  }
  walk(targetDir)
  for (const canvas of canvases) {
    const manifest = readCanvasManifest(join(canvas.dir, 'canvas.json'))
    for (const [index, entry] of manifest.screens.entries()) {
      if (!isPlainObject(entry) || typeof entry.file !== 'string' || entry.file.length === 0) {
        die(`${canvas.relDir}/canvas.json: screen #${index + 1} precisa de "file"`)
      }
      const fileRel = normalizePath(`${canvas.relDir}/${entry.file}`)
      if (!existsSync(join(targetDir, fileRel))) {
        die(`${fileRel}: listado em ${canvas.relDir}/canvas.json mas ausente no disco`)
      }
      screens.push({
        file: fileRel,
        canvas: canvas.relDir,
        tela: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : basename(entry.file, extname(entry.file)),
        device: entry.device ?? null,
        width: entry.width ?? null,
        height: entry.height ?? null,
      })
    }
  }
}
if (screens.length === 0) {
  die(`nenhuma tela encontrada em ${opts.target} (canvas.json manifests) — nada a orquestrar`)
}
const screenKeys = new Set(screens.map((screen) => screen.file))
const labelOf = (key) => normalizePath(relative(process.cwd(), join(targetDir, key)) || key)

console.log(`visual-orchestrator: target ${opts.target} (gitSHA ${gitShaOf(targetDir)}, platform ${process.platform})`)
console.log(
  `visual-orchestrator: telas — ${screens
    .map((s) => `${s.file} [${s.device ?? 'device?'} ${s.width ?? '?'}x${s.height ?? '?'}]`)
    .join('; ')}`
)

// ---------------------------------------------------------------------------
// Executor de etapa: stdout/serred capturados; ecoados só em falha (o stdout do
// orquestrador é a saída legível — determinístico, sem timestamps).
// ---------------------------------------------------------------------------
function runStep(id, args) {
  const run = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' })
  if (run.error) dieStep(id, `não foi possível executar ${normalizePath(args[0])} — ${String(run.error.message)}`)
  if (run.status !== 0) {
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
    if (output) console.error(output)
    dieStep(id, `${normalizePath(args[0])} exit ${run.status}`)
  }
  return run
}

// ---------------------------------------------------------------------------
// 1. capture — manifest como evidência por tela.
// ---------------------------------------------------------------------------
runStep('capture', [CAPTURE, '--target', opts.target])
const manifestPath = join(targetDir, '.visual', 'manifest.json')
if (!existsSync(manifestPath)) dieMissing('capture', `manifest não encontrado: ${labelOf('.visual/manifest.json')}`)
let manifest = null
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  dieStep('capture', `manifest ilegível (${labelOf('.visual/manifest.json')}): ${String(error?.message ?? error)}`)
}
if (!isPlainObject(manifest) || !Array.isArray(manifest.images)) {
  dieStep('capture', `manifest fora do contrato (todo 9): ${labelOf('.visual/manifest.json')}`)
}
const captureByScreen = new Map() // screen -> { tela, contentHash, images, viewports:Set, states:Set }
manifest.images.forEach((entry, index) => {
  if (
    !isPlainObject(entry) ||
    typeof entry.file !== 'string' ||
    typeof entry.viewport !== 'string' ||
    typeof entry.state !== 'string' ||
    typeof entry.png !== 'string'
  ) {
    dieStep('capture', `manifest images[${index}] fora do contrato (todo 9)`)
  }
  const key = normalizePath(entry.file)
  if (!screenKeys.has(key)) {
    dieStep('capture', `manifest com tela fora da descoberta atual (estado stale?): ${key}`)
  }
  if (!captureByScreen.has(key)) {
    captureByScreen.set(key, { tela: entry.screen, contentHash: entry.screenHash, images: [], viewports: new Set(), states: new Set() })
  }
  const bucket = captureByScreen.get(key)
  if (bucket.contentHash !== entry.screenHash) {
    dieStep('capture', `manifest com contentHash divergente para ${key} (screenHash muda quando a fonte muda)`)
  }
  // Evidência é artefato: entrada de manifest apontando PNG inexistente nunca
  // conta como captura (saída enganosa = sucesso com evidência furada).
  if (!existsSync(join(targetDir, entry.png))) {
    dieMissing('capture', `PNG listado no manifest ausente no disco: ${normalizePath(entry.png)}`)
  }
  bucket.images.push(entry.png)
  bucket.viewports.add(entry.viewport)
  bucket.states.add(entry.state)
})
for (const screen of screens) {
  const bucket = captureByScreen.get(screen.file)
  if (!bucket || bucket.images.length === 0) dieMissing('capture', `manifest sem evidência de captura para ${screen.file}`)
  // Anti-fake (§5.6): o contentHash embutido no relatório precisa ser o hash
  // REAL da fonte atual — manifest stale ou fonte alterada após a captura aborta.
  const sourceHash = sha256(readFileSync(join(targetDir, screen.file)))
  if (bucket.contentHash !== sourceHash) {
    dieStep('capture', `contentHash do manifest diverge da fonte atual de ${screen.file} (estado stale ou fonte alterada após a captura)`)
  }
}
console.log(
  `capture: ${screens.length} tela(s), ${manifest.images.length} PNG(s) — manifest com ${manifest.images.length} entrada(s)`
)

// ---------------------------------------------------------------------------
// 2. diff — lib/image-diff.mjs (consumo puro; a semântica de bloqueio é do
//    visual-gate.mjs). Pares baseline × atual; sem par = aviso.
// ---------------------------------------------------------------------------
let diffLib = null
try {
  diffLib = await import(new URL('./lib/image-diff.mjs', import.meta.url).href)
} catch (error) {
  dieStep('diff', `lib/image-diff.mjs: ${String(error?.message ?? error)}`)
}
const thresholdsPath = opts.thresholds
  ? resolve(opts.thresholds)
  : existsSync(join(targetDir, 'visual-thresholds.json'))
    ? join(targetDir, 'visual-thresholds.json')
    : PACK_THRESHOLDS
let limits = null
try {
  limits = diffLib.thresholdsForPlatform(diffLib.loadThresholds(thresholdsPath), process.platform)
} catch (error) {
  dieStep('diff', String(error?.message ?? error))
}
const baselineDir = join(targetDir, '.visual', 'baseline')
const diffByScreen = new Map() // screen -> { compared, aboveThreshold, withoutBaseline, pairs }
for (const screen of screens) {
  const bucket = captureByScreen.get(screen.file)
  const pairs = []
  let compared = 0
  let aboveThreshold = 0
  let withoutBaseline = 0
  for (const png of [...bucket.images].sort()) {
    const rel = normalizePath(png).replace(/^\.visual\//, '')
    const baselineFile = join(baselineDir, rel)
    if (!existsSync(baselineFile)) {
      withoutBaseline += 1
      continue
    }
    compared += 1
    try {
      const outcome = diffLib.combinedDiff(
        diffLib.decodePng(readFileSync(baselineFile)),
        diffLib.decodePng(readFileSync(join(targetDir, png)))
      )
      if (outcome.sizeMismatch) {
        const [bw, bh, cw, ch] = outcome.sizeMismatch
        aboveThreshold += 1
        pairs.push({
          file: rel,
          pixelRatio: null,
          ssim: null,
          pass: false,
          error: `geometria divergente (baseline ${bw}x${bh} vs atual ${cw}x${ch})`,
        })
        continue
      }
      const verdict = diffLib.withinThresholds(outcome, limits)
      if (!verdict.pass) aboveThreshold += 1
      pairs.push({ file: rel, pixelRatio: outcome.pixelRatio, ssim: outcome.ssim, pass: verdict.pass })
    } catch (error) {
      // PNG ilegível num par = diff acima do limiar (contrato do visual-gate.mjs).
      aboveThreshold += 1
      pairs.push({ file: rel, pixelRatio: null, ssim: null, pass: false, error: String(error?.message ?? error) })
    }
  }
  diffByScreen.set(screen.file, { compared, aboveThreshold, withoutBaseline, pairs })
}
{
  const totals = [...diffByScreen.values()].reduce(
    (acc, d) => ({ compared: acc.compared + d.compared, above: acc.above + d.aboveThreshold, without: acc.without + d.withoutBaseline }),
    { compared: 0, above: 0, without: 0 }
  )
  console.log(
    `diff: ${totals.compared} par(es) vs baseline — ${totals.above} acima do limiar (${process.platform}: maxDiffPixelRatio ${limits.maxDiffPixelRatio}, minSsim ${limits.minSsim}), ${totals.without} sem baseline`
  )
}

// ---------------------------------------------------------------------------
// 3. critic — relatório por tela em .visual/critic/.
// ---------------------------------------------------------------------------
runStep('critic', [CRITIC, '--target', opts.target])
const criticDir = join(targetDir, '.visual', 'critic')
const criticByScreen = new Map()
if (existsSync(criticDir)) {
  const files = readdirSync(criticDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort()
  for (const name of files) {
    let report = null
    try {
      report = JSON.parse(readFileSync(join(criticDir, name), 'utf8'))
    } catch (error) {
      dieStep('critic', `${labelOf(`.visual/critic/${name}`)}: JSON inválido — ${String(error?.message ?? error)}`)
    }
    if (!isPlainObject(report) || typeof report.screen !== 'string' || !Array.isArray(report.issues) || typeof report.score !== 'number') {
      dieStep('critic', `${labelOf(`.visual/critic/${name}`)}: relatório fora do contrato (todo 11)`)
    }
    const key = normalizePath(report.screen)
    if (!screenKeys.has(key)) dieStep('critic', `relatório para tela desconhecida (estado stale?): ${labelOf(`.visual/critic/${name}`)} → ${key}`)
    if (criticByScreen.has(key)) dieStep('critic', `mais de um relatório para ${key} (${labelOf(`.visual/critic/${name}`)})`)
    criticByScreen.set(key, report)
  }
}
for (const screen of screens) {
  if (!criticByScreen.has(screen.file)) dieMissing('critic', `sem relatório do critic para ${screen.file}`)
}
{
  let blocker = 0
  let major = 0
  let minor = 0
  for (const report of criticByScreen.values()) {
    for (const issue of report.issues) {
      if (issue.severity === 'blocker') blocker += 1
      else if (issue.severity === 'major') major += 1
      else minor += 1
    }
  }
  console.log(`critic: ${criticByScreen.size} relatório(s), ${blocker + major + minor} issue(s) (${blocker} blocker(s), ${major} major(s), ${minor} minor(s))`)
}

// ---------------------------------------------------------------------------
// 4. score — histórico append-only; a evidência nova é o que a montagem usa.
// ---------------------------------------------------------------------------
const scoresPath = join(targetDir, '.visual', 'scores.json')
const priorCount = (() => {
  if (!existsSync(scoresPath)) return 0
  try {
    const doc = JSON.parse(readFileSync(scoresPath, 'utf8'))
    return Array.isArray(doc?.entries) ? doc.entries.length : 0
  } catch {
    return 0
  }
})()
runStep('score', [SCORE, '--target', opts.target])
const scoreByScreen = new Map()
{
  if (!existsSync(scoresPath)) {
    dieMissing('score', `scores.json não gravado — etapa sem evidência (${labelOf('.visual/scores.json')})`)
  }
  let doc = null
  try {
    doc = JSON.parse(readFileSync(scoresPath, 'utf8'))
  } catch (error) {
    dieStep('score', `scores.json ilegível após a execução: ${String(error?.message ?? error)}`)
  }
  const entries = Array.isArray(doc?.entries) ? doc.entries.slice(priorCount) : []
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry.screen !== 'string' || !isPlainObject(entry.perCriteria) || typeof entry.overall !== 'number') {
      dieStep('score', 'entrada fora do contrato em .visual/scores.json (todo 12)')
    }
    scoreByScreen.set(normalizePath(entry.screen), entry) // última entrada nova por tela
  }
}
for (const screen of screens) {
  if (!scoreByScreen.has(screen.file)) dieMissing('score', `sem entrada de score para ${screen.file}`)
}
console.log(`score: ${scoreByScreen.size} entrada(s) nova(s) anexada(s) — overall mínimo ${Math.min(...[...scoreByScreen.values()].map((e) => e.overall))}`)

// ---------------------------------------------------------------------------
// 5. a11y — rules/a11y.mjs + checks do validate.mjs, dedupados e atribuídos.
// ---------------------------------------------------------------------------
const findings = []
const seenFindings = new Set()
const addFinding = (code, message) => {
  const key = `${code}\u0000${message}`
  if (seenFindings.has(key)) return
  seenFindings.add(key)
  findings.push({ code, message })
}
try {
  const rule = await import(new URL('./rules/a11y.mjs', import.meta.url).href)
  await rule.run({
    rootDir: targetDir,
    rootArg: opts.target,
    mode: 'project',
    config: null,
    argv,
    flags: [],
    fail: (code, message) => addFinding(code, message),
    relLabel: (rootDir, full) => normalizePath(full.slice(rootDir.length)).replace(/^\//, ''),
  })
} catch (error) {
  dieStep('a11y', `rules/a11y.mjs: ${String(error?.message ?? error)}`)
}
{
  const configPath = opts.config ? resolve(opts.config) : DEFAULT_CONFIG
  const contract = spawnSync(process.execPath, [VALIDATE, '--config', configPath, opts.target], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (contract.error) dieStep('a11y', `validate.mjs: ${String(contract.error.message)}`)
  if (contract.status !== 0 && contract.status !== 1) {
    const output = `${contract.stdout ?? ''}${contract.stderr ?? ''}`.trim()
    if (output) console.error(output)
    dieStep('a11y', `validate.mjs exit ${contract.status}`)
  }
  const lines = String(contract.stdout).split('\n')
  const start = lines.findIndex((line) => line.startsWith('Fix these issues:'))
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith('- ')) continue
      const at = line.indexOf(': ')
      if (at < 0) continue
      addFinding(line.slice(2, at), line.slice(at + 2))
    }
  }
}
const a11yByScreen = new Map() // screen -> failures atribuídas
for (const screen of screens) a11yByScreen.set(screen.file, [])
for (const finding of findings) {
  const owner = screens.find(
    (screen) =>
      finding.message === screen.file ||
      finding.message.startsWith(`${screen.file}:`) ||
      finding.message.startsWith(`${screen.file} `)
  )
  if (owner) {
    a11yByScreen.get(owner.file).push(finding)
  } else {
    // Achado de raiz (componentes/tokens/contrato) — afeta toda tela que o
    // consome: listado em cada tela (contado uma vez por listagem no resumo).
    for (const screen of screens) a11yByScreen.get(screen.file).push(finding)
  }
}
console.log(`a11y: ${A11Y_CHECKS.join(' + ')} — ${findings.length} achado(s) único(s)`)

// ---------------------------------------------------------------------------
// Montagem — as 5 etapas precisam de evidência por tela ou nada é emitido.
// ---------------------------------------------------------------------------
const gitSHA = gitShaOf(targetDir)
const timestamp = new Date().toISOString()
const reportScreens = []
let blockers = 0
let issues = 0
for (const screen of screens) {
  const capture = captureByScreen.get(screen.file)
  const diff = diffByScreen.get(screen.file)
  const critic = criticByScreen.get(screen.file)
  const score = scoreByScreen.get(screen.file)
  const failures = a11yByScreen.get(screen.file)
  if (!capture) dieMissing('capture', `sem evidência de captura para ${screen.file}`)
  if (!diff) dieMissing('diff', `sem comparação para ${screen.file}`)
  if (!critic) dieMissing('critic', `sem relatório para ${screen.file}`)
  if (!score) dieMissing('score', `sem entrada de score para ${screen.file}`)
  if (!failures) dieMissing('a11y', `sem resultado de regras a11y para ${screen.file}`)
  const screenBlockers =
    critic.issues.filter((issue) => issue.severity === 'blocker').length + failures.length + diff.aboveThreshold
  blockers += screenBlockers
  issues += critic.issues.length + failures.length + diff.aboveThreshold
  reportScreens.push({
    screen: screen.file,
    capture: {
      canvas: screen.canvas,
      tela: capture.tela,
      device: screen.device,
      width: screen.width,
      height: screen.height,
      contentHash: capture.contentHash,
      images: capture.images.length,
      viewports: [...capture.viewports].sort(),
      states: [...capture.states].sort(),
    },
    diff: {
      compared: diff.compared,
      aboveThreshold: diff.aboveThreshold,
      withoutBaseline: diff.withoutBaseline,
      pairs: diff.pairs,
    },
    critic: { score: critic.score, issues: critic.issues },
    score: { perCriteria: score.perCriteria, overall: score.overall },
    a11y: { checks: A11Y_CHECKS, failures, ok: failures.length === 0 },
  })
}

// ---------------------------------------------------------------------------
// --gate: a decisão de bloqueio é DELEGADA a visual-gate.mjs (todo 12, o dono
// da semântica). A proibição "exit 0 com blockers quando --gate" é literal.
// ---------------------------------------------------------------------------
let gate = 'skipped'
if (opts.gate) {
  const args = [GATE, '--target', opts.target]
  if (opts.config) args.push('--config', opts.config)
  if (opts.thresholds) args.push('--thresholds', opts.thresholds)
  const run = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (run.error) dieStep('gate', `visual-gate.mjs: ${String(run.error.message)}`)
  if (run.status !== 0 && run.status !== 1) {
    if (output) console.error(output)
    dieStep('gate', `visual-gate.mjs exit ${run.status}`)
  }
  if (output) console.log(output)
  gate = run.status === 0 && blockers === 0 ? 'pass' : 'fail'
}

const report = {
  schemaVersion: SCHEMA_VERSION,
  gitSHA,
  timestamp,
  platform: process.platform,
  screens: reportScreens,
  summary: { blockers, issues, gate },
}
const reportPath = join(targetDir, '.visual', REPORT_NAME)
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

for (const entry of reportScreens) {
  console.log(
    `tela ${entry.screen} — captura ${entry.capture.images} img(s) hash ${entry.capture.contentHash.slice(0, 12)} | ` +
      `diff ${entry.diff.compared} par(es), ${entry.diff.aboveThreshold} acima do limiar, ${entry.diff.withoutBaseline} sem baseline | ` +
      `critic ${entry.critic.score} (${entry.critic.issues.length} issue(s)) | score ${entry.score.overall} | ` +
      `a11y ${entry.a11y.ok ? 'ok' : `${entry.a11y.failures.length} falha(s)`}`
  )
}
console.log(`resumo: blockers ${blockers} | issues ${issues} | gate ${gate}`)
console.log(`visual-orchestrator: relatório -> ${normalizePath(relative(process.cwd(), reportPath)) || reportPath}`)
if (opts.gate && gate === 'fail') {
  console.error(
    'visual-orchestrator: BLOQUEADO — veredito delegado ao visual-gate.mjs (a semântica de gate é do todo 12); com --gate, blockers nunca saem com exit 0'
  )
  process.exit(1)
}
process.exit(0)

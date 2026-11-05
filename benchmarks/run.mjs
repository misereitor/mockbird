#!/usr/bin/env node
/**
 * benchmarks/run.mjs — harness de benchmark com corpus fixo (plano todo 14, GAP-A5).
 *
 * CORPUS FIXO: benchmarks/briefings/NN-*.md (01-08). Todo run passa pelos MESMOS
 * 8 briefings — "melhoria" que não passe pelo corpus inteiro não é melhoria
 * (docs/arquitetura-evolutiva.md §9; IS-5). Não existe flag de subconjunto.
 *
 * Modos:
 *   --dry-run          stub determinístico, spend=0, zero rede. Gera relatório
 *                      schema-válido de ponta a ponta em
 *                      benchmarks/results/dry-<gitSHA>.json. Mesma entrada →
 *                      mesmo conteúdo (só timestamp varia; hash normalizado é
 *                      impresso para comparação).
 *   --model <id> --budget-tokens <N>
 *                      run real (opt-in, "runs pagos"): passe de modelo por
 *                      briefing pelo contrato DesignAgent (§5.5; seam do todo 32)
 *                      com teto de tokens por execução e gasto registrado em
 *                      spend/token-usage. SEM as duas flags o run real não
 *                      executa: "runs pagos exigem --model e --budget-tokens".
 *   --check <arquivo>  valida um relatório existente contra benchmarks/schema.json
 *                      + invariantes 8x8 (check embutido, usado pelo mutation probe).
 *
 * Garantia offline (contrato §5.6): este checkout NUNCA toca a rede. Um wrapper
 * de globalThis.fetch bloqueia e conta qualquer tentativa; networkCalls deve
 * ficar em 0 e é impresso/assertado em todo caminho de saída. Nenhum import de
 * node:http(s)/fetch existe neste arquivo.
 *
 * Teto: --budget-tokens deve ser inteiro >= 1 (0 não é teto válido). Violação de
 * teto (pré-flight ou gasto esgotado antes do fim do corpus) aborta com exit≠0,
 * mensagem "teto violado" e log de rede vazio. --budget-tokens é validado ANTES
 * de --model (o cenário de falha --model fake --budget-tokens 0 reprova por teto).
 *
 * Resultados: benchmarks/results/dry-<gitSHA>.json é versionado (um arquivo por
 * SHA; re-run no mesmo SHA sobrescreve — conteúdo idêntico normalizado; SHA novo
 * cria arquivo novo, preservando o histórico). Relatórios de run real ficam fora
 * do versionamento (benchmarks/results/.gitignore).
 *
 * Métricas (8 por briefing): design, ux, a11y, functional, consistency,
 * tokens-compliance (qualidade — instrumentos dos todos 11/12 sobre o artefato
 * quando o conector existir; hoje corpus-stub determinístico, nomeado em source)
 * + execution-time (wall-clock; 0 em dry-run) e token-usage (contabilidade do
 * contrato DesignAgent; 0 em dry-run).
 *
 * Exit codes: 0 = relatório emitido/check ok; 2 = erro guiado de uso, entrada,
 * teto ou contrato (nada é gravado, log de rede impresso).
 *
 * Usage: node benchmarks/run.mjs --dry-run
 *        node benchmarks/run.mjs --model <id> --budget-tokens <N>
 *        node benchmarks/run.mjs --check <relatorio.json>
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDesignAgent } from '../skills/design/scripts/agent-adapters/stub-deterministic.mjs'
import { createLLMConnector } from '../skills/design/scripts/lib/llm/connector.mjs'
import { validateAgainstSchema } from '../skills/design/scripts/visual-critic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const BRIEFINGS_DIR = join(HERE, 'briefings')
const RESULTS_DIR = join(HERE, 'results')
const SCHEMA_PATH = join(HERE, 'schema.json')

const EXPECTED_IDS = ['01', '02', '03', '04', '05', '06', '07', '08']
const REQUIRED_SECTIONS = ['audience', 'goal', 'visualDirection', 'constraints']
const QUALITY_METRICS = ['design', 'ux', 'a11y', 'functional', 'consistency', 'tokens-compliance']
const ALL_METRICS = [...QUALITY_METRICS, 'execution-time', 'token-usage']
const REQUIRED_MESSAGE = 'runs pagos exigem --model e --budget-tokens'
const USAGE =
  'usage: node benchmarks/run.mjs --dry-run\n' +
  '       node benchmarks/run.mjs --model <id> --budget-tokens <N>\n' +
  '       node benchmarks/run.mjs --check <relatorio.json>\n' +
  `runs pagos exigem --model e --budget-tokens; --dry-run é o stub determinístico sem custo\n` +
  'exit codes: 0 = ok; 2 = erro guiado (uso/entrada/teto/contrato)'

// --- Garantia de rede: bloqueia e conta qualquer fetch (§5.6 offline) --------
const networkLog = []
let networkCalls = 0
globalThis.fetch = async (url) => {
  networkCalls += 1
  networkLog.push(String(url))
  throw new Error(`rede bloqueada pelo harness do benchmark: ${String(url)}`)
}

function networkStatus() {
  return `rede: networkCalls=${networkCalls} log=[${networkLog.join(', ')}]`
}

function fail(message) {
  console.error(`bench: ${message}`)
  console.error(networkStatus())
  process.exit(2)
}

function dieIfNetworkTouched() {
  if (networkCalls > 0) fail(`run offline com chamada de rede detectada (${networkCalls})`)
}

// --- Corpus -----------------------------------------------------------------
function loadCorpus() {
  if (!existsSync(BRIEFINGS_DIR)) fail(`corpus ausente: ${relative(ROOT, BRIEFINGS_DIR)}/`)
  const files = readdirSync(BRIEFINGS_DIR)
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort()
  const ids = files.map((f) => f.slice(0, 2))
  if (files.length !== 8 || ids.some((id, i) => id !== EXPECTED_IDS[i])) {
    fail(`corpus fixo exige exatamente 8 briefings numerados ${EXPECTED_IDS.join(', ')}; encontrados: ${ids.join(', ') || 'nenhum'}`)
  }
  return files.map((name) => {
    const abs = join(BRIEFINGS_DIR, name)
    const text = readFileSync(abs, 'utf8')
    const lines = text.split('\n')
    for (const section of REQUIRED_SECTIONS) {
      const heading = lines.findIndex((l) => l.trim() === `## ${section}`)
      let end = lines.length
      if (heading !== -1) {
        for (let i = heading + 1; i < lines.length; i += 1) {
          if (/^## /.test(lines[i])) {
            end = i
            break
          }
        }
      }
      const body = heading === -1 ? '' : lines.slice(heading + 1, end).join('\n').trim()
      if (!body) {
        fail(`briefing ${name}: seção obrigatória ausente ou vazia: ## ${section}`)
      }
    }
    return {
      id: name.slice(0, 2),
      file: relative(ROOT, abs).split('\\').join('/'),
      contentHash: createHash('sha256').update(readFileSync(abs)).digest('hex'),
      text,
    }
  })
}

// --- Métricas ---------------------------------------------------------------
// Stub determinístico: valor derivado por sha256(conteúdo + métrica) — estável
// por execução e sensível a mudança de conteúdo (anti-fake). Nomeado em source.
function stubScore(text, metric) {
  const h = createHash('sha256').update(text).update('\u0000').update(metric).digest()
  return h.readUInt32BE(0) % 101
}

function stubMetrics(briefing) {
  const metrics = {}
  for (const name of QUALITY_METRICS) {
    metrics[name] = { value: stubScore(briefing.text, name), unit: 'score-0-100', source: 'corpus-stub' }
  }
  return metrics
}

function gitSHA() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

function buildReport({ mode, model, adapter, briefings, spend, metricsOf }) {
  return {
    schemaVersion: 1,
    mode,
    model,
    adapter,
    gitSHA: gitSHA(),
    timestamp: new Date().toISOString(),
    platform: process.platform,
    networkCalls,
    spend,
    briefings: briefings.map((b) => ({
      id: b.id,
      file: b.file,
      contentHash: b.contentHash,
      metrics: metricsOf(b),
    })),
  }
}

// --- Check embutido ---------------------------------------------------------
function checkReport(report) {
  const errors = validateAgainstSchema(report, schema)
  const briefings = Array.isArray(report?.briefings) ? report.briefings : []
  if (briefings.length !== 8) errors.push(`$.briefings: esperado exatamente 8 briefings, recebido ${briefings.length}`)
  briefings.forEach((b, i) => {
    const want = EXPECTED_IDS[i]
    if (b?.id !== want) errors.push(`$.briefings[${i}].id: esperado "${want}", recebido ${JSON.stringify(b?.id)}`)
    const keys = Object.keys(b?.metrics ?? {}).sort()
    const expected = [...ALL_METRICS].sort()
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      errors.push(`$.briefings[${i}].metrics: métricas devem ser exatamente ${expected.join(', ')}; recebido ${keys.join(', ')}`)
    }
  })
  return errors
}

function assertValid(report, label) {
  const errors = checkReport(report)
  if (errors.length > 0) fail(`${label} não passa no schema embutido:\n  - ${errors.join('\n  - ')}`)
}

function writeReport(report, name) {
  assertValid(report, 'relatório gerado')
  mkdirSync(RESULTS_DIR, { recursive: true })
  writeFileSync(join(RESULTS_DIR, name), `${JSON.stringify(report, null, 2)}\n`)
  return join(RESULTS_DIR, name)
}

// Hash do relatório com timestamp normalizado: prova de determinismo (mesma
// entrada → mesmo conteúdo; só timestamp varia entre execuções).
function normalizedHash(report) {
  return createHash('sha256').update(JSON.stringify({ ...report, timestamp: 'NORMALIZED' })).digest('hex')
}

// --- Modos ------------------------------------------------------------------
function runDry(briefings) {
  const report = buildReport({
    mode: 'dry-run',
    model: null,
    adapter: null,
    briefings,
    spend: { budgetTokens: 0, usedTokens: 0, budgetRespected: true, accounting: 'none' },
    metricsOf: (b) => ({
      ...stubMetrics(b),
      'execution-time': { value: 0, unit: 'ms', source: 'dry-stub' },
      'token-usage': { value: 0, unit: 'tokens', source: 'dry-stub' },
    }),
  })
  const out = writeReport(report, `dry-${report.gitSHA}.json`)
  console.log(`bench: dry-run ok → ${relative(ROOT, out)} (8 briefings × 8 métricas, spend=0)`)
  console.log(`bench: deterministicHash(timestamp normalizado)=${normalizedHash(report)}`)
  dieIfNetworkTouched()
  console.log(networkStatus())
  return report
}

async function runReal(model, budgetTokens, briefings) {
  if (!Number.isInteger(budgetTokens) || budgetTokens < 1) {
    fail(`teto violado: --budget-tokens deve ser inteiro >= 1 (0 não é um teto válido); recebido ${JSON.stringify(budgetTokens)}`)
  }
  if (!model) fail(REQUIRED_MESSAGE)
  // Contrato DesignAgent (§5.5): único ponto de passe de modelo. O stub
  // determinístico (offline) é o único adapter deste checkout; adaptadores reais
  // são seam do todo 32 e entram pela mesma chamada.
  const adapter = createLLMConnector({ provider: model === 'stub' ? 'stub' : model, env: process.env })
  let used = 0
  const entries = []
  for (const b of briefings) {
    const remaining = budgetTokens - used
    const started = Date.now()
    const result = await adapter.analyze({
      screen: b.file,
      viewport: '1280x800',
      state: 'default',
      html: b.text,
      screenshotPng: new Uint8Array(0),
      budgetTokens: remaining,
    })
    const elapsed = Date.now() - started
    if (typeof result.tokensUsed !== 'number' || result.tokensUsed > remaining) {
      fail(`teto violado: adapter ${adapter.id} estourou o orçamento no briefing ${b.id} (usou ${result.tokensUsed}, restava ${remaining})`)
    }
    used += result.tokensUsed
    entries.push({ briefing: b, tokensUsed: result.tokensUsed, elapsed })
    if (used >= budgetTokens && b.id !== briefings[briefings.length - 1].id) {
      fail(`teto violado: orçamento esgotado (${used}/${budgetTokens}) antes do fim do corpus (parou no briefing ${b.id})`)
    }
  }
  const report = buildReport({
    mode: 'real',
    model,
    adapter: adapter.id ?? 'native-llm-connector',
    briefings,
    spend: { budgetTokens, usedTokens: used, budgetRespected: true, accounting: adapter.offline ? 'nominal' : 'real' },
    metricsOf: (b) => {
      const e = entries.find((x) => x.briefing.id === b.id)
      return {
        ...stubMetrics(b),
        'execution-time': { value: e.elapsed, unit: 'ms', source: 'wall-clock' },
        'token-usage': { value: e.tokensUsed, unit: 'tokens', source: 'adapter-usage' },
      }
    },
  })
  const out = writeReport(report, `real-${report.gitSHA}-${model.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`)
  console.log(`bench: run real ok → ${relative(ROOT, out)} (model=${model}, adapter=${adapter.id}, gasto ${used}/${budgetTokens} tokens)`)
  console.log(networkStatus())
  return report
}

function runCheck(file) {
  const abs = resolve(file)
  if (!existsSync(abs)) fail(`arquivo não encontrado: ${file}`)
  let report
  try {
    report = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    fail(`JSON inválido em ${file}: ${String(err.message)}`)
  }
  const errors = checkReport(report)
  if (errors.length > 0) {
    fail(`${file} não passa no schema embutido:\n  - ${errors.join('\n  - ')}`)
  }
  console.log(`bench: ${file} é um relatório válido (schema + 8×8)`)
  console.log(networkStatus())
}

// --- CLI --------------------------------------------------------------------
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))

const args = process.argv.slice(2)
const flags = { dryRun: false, model: null, budget: null, check: null, experiment: null }
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  const needsValue = (name) => {
    if (i + 1 >= args.length) fail(`flag ${name} exige um valor (use --help)`)
    i += 1
    return args[i]
  }
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE)
    process.exit(0)
  } else if (arg === '--dry-run') {
    flags.dryRun = true
  } else if (arg === '--model') {
    flags.model = needsValue('--model')
    if (!flags.model) fail('--model exige um valor não vazio (use --help)')
  } else if (arg === '--budget-tokens') {
    flags.budget = needsValue('--budget-tokens')
  } else if (arg === '--check') {
    flags.check = needsValue('--check')
  } else if (arg === '--experiment') {
    flags.experiment = needsValue('--experiment')
  } else {
    fail(`flag desconhecida: ${arg} (use --help)`)
  }
}

if (flags.check !== null) {
  if (flags.dryRun || flags.model !== null || flags.budget !== null) fail('--check não se combina com as outras flags (use --help)')
  runCheck(flags.check)
} else if (flags.dryRun) {
  if (flags.model !== null || flags.budget !== null) fail('--dry-run não se combina com --model/--budget-tokens (runs pagos são opt-in)')
  if (flags.experiment) { const p=resolve('design/experiments',flags.experiment,'experiment.json'); if(!existsSync(p)) fail(`experiment not found: ${flags.experiment}`); const e=JSON.parse(readFileSync(p,'utf8')); if(!e.metric||!Array.isArray(e.variants)||e.variants.length<3) fail('experiment requires metric and control plus two variants') }
  runDry(loadCorpus())
} else if (flags.model === null && flags.budget === null) {
  fail(`${REQUIRED_MESSAGE} (use --dry-run para o stub determinístico sem custo, ou --help)`)
} else if (flags.model === null || flags.budget === null) {
  fail(`${REQUIRED_MESSAGE} (use --dry-run para o stub determinístico sem custo, ou --help)`)
} else {
  const budget = flags.budget
  if (!/^\d+$/.test(budget)) {
    fail(`teto violado: --budget-tokens deve ser inteiro >= 1 (0 não é um teto válido); recebido ${JSON.stringify(budget)}`)
  }
  runReal(flags.model, Number(budget), loadCorpus()).then(() => {
    dieIfNetworkTouched()
  })
}

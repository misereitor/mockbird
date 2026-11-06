/**
 * visual-orchestrator.test.mjs — Orquestrador de testes visuais com relatório
 * único consolidado (plano todo 13, GAP-A5).
 *
 * Contrato sob teste:
 *   - relatório único .visual/report.json: forma exata do docblock, 1 entrada
 *     por tela, contentHash == sha256 do HTML da tela, gitSHA ==
 *     `git rev-parse HEAD`, summary coerente (soma dos issues = contagem);
 *   - determinismo: re-execução reproduz o relatório com timestamp normalizado;
 *   - --gate DELEGA a decisão ao visual-gate.mjs (todo 12): fixture com diff
 *     acima do limiar => exit 1 + summary.gate=fail (relatório completo sai
 *     mesmo bloqueado); baseline íntegra => exit 0 + summary.gate=pass;
 *   - sem verde parcial: etapa ausente (módulo removido OU etapa sem evidência)
 *     => exit≠0 nomeando a etapa, relatório nunca emitido;
 *   - CLI guiado (argumento/target inválido, target em modo canvas).
 *
 * Alvo: fixtures/visual-orchestrator (design-root mínima, 1 tela), copiada
 * para um alvo temporário POR PROCESSO dentro do repositório (o relatório
 * exige gitSHA do worktree): execuções concorrentes da suite não partilham
 * estado .visual e a fixture versionada fica intacta.
 * Pesado: cada run completo executa a matriz de captura (35 PNGs ≈ 30 s).
 *
 * Run: node --test skills/design/scripts/visual-orchestrator.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { decodePng } from './lib/image-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const ORCH = join(HERE, 'visual-orchestrator.mjs')
const GATE = join(HERE, 'visual-gate.mjs')
const CAPTURE = join(HERE, 'visual-capture.mjs')
const FIXTURE = join(HERE, 'fixtures', 'visual-orchestrator')
const SCREEN = join(FIXTURE, 'tela', '01-tela.html')
const REPORT_KEYS = ['gitSHA', 'platform', 'schemaVersion', 'screens', 'summary', 'timestamp']

const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
// Alvo de execução por processo: cópia descartável da fixture, como irmã em
// fixtures/ (gitSHA do relatório resolve ao HEAD do worktree). Nunca a fixture
// partilhada — runs concorrentes da suite não podem apagar o .visual uma da
// outra (era a fonte do flake: manifest apontando PNG já removido).
function fixtureTarget() {
  const target = mkdtempSync(join(HERE, 'fixtures', '.tmp-orch-'))
  tmpRoots.push(target)
  cpSync(FIXTURE, target, {
    recursive: true,
    filter: (src) => !src.endsWith(`${sep}.visual`),
  })
  return target
}

process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function runOrch(args, script = ORCH, target = RUN_TARGET) {
  return spawnSync(process.execPath, [script, '--target', target, ...args], { cwd: ROOT, encoding: 'utf8' })
}

function readReport(target = RUN_TARGET) {
  return JSON.parse(readFileSync(join(target, '.visual', 'report.json'), 'utf8'))
}

/**
 * Relatório com campos de ambiente normalizados: timestamp (o único campo não
 * determinístico do conteúdo) e gitSHA (acompanha HEAD — um commit concorrente
 * entre execuções não é não-determinismo do relatório).
 */
function normalized(report) {
  const copy = structuredClone(report)
  copy.timestamp = '<normalized>'
  copy.gitSHA = '<normalized>'
  for (const screen of copy.screens ?? []) if (screen.perf?.metrics) screen.perf.metrics.renderMs = '<normalized>'
  return copy
}

const RUN_TARGET = fixtureTarget() // séries relatório único + determinismo
const GATE_TARGET = fixtureTarget() // séries --gate (freeze → corrompe → re-freeze)

// ---------- encoder PNG mínimo (RGB/RGBA, linhas filter 0) para corromper baseline ----------

function encodePng(width, height, channels, pixels) {
  const stride = width * channels
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = channels === 4 ? 6 : 2 // color type: RGBA | RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------- rig em /tmp: cópia da cadeia de scripts (sem fixtures/example) ----------

function copyChain(destScripts) {
  cpSync(HERE, destScripts, {
    recursive: true,
    filter: (src) => !src.includes(`${sep}fixtures`) && !src.endsWith('.test.mjs'),
  })
  cpSync(join(HERE, '..', 'assets'), join(destScripts, '..', 'assets'), {
    recursive: true,
    filter: (src) => !src.includes(`${sep}example`),
  })
  // playwright-core resolve via import.meta.url (visual-critic.mjs) — o rig
  // precisa alcançar o node_modules do checkout como a árvore real faz.
  symlinkSync(join(ROOT, 'node_modules'), join(destScripts, '..', 'node_modules'), 'dir')
}

function copyFixtureTarget(rig) {
  const target = join(rig, 'target')
  cpSync(FIXTURE, target, { recursive: true, filter: (src) => !src.endsWith('.visual') })
  return target
}

// ---------- relatório único: forma, 1 entrada por tela, anti-fake, resumo ----------

let firstRunReport = null

test('relatório único: forma do contrato, 1 entrada por tela, gitSHA/contentHash embutidos, resumo coerente', () => {
  const run = runOrch([])
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
  const report = readReport()
  assert.deepEqual(Object.keys(report).sort(), REPORT_KEYS)
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.platform, process.platform)
  assert.equal(report.gitSHA, execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim())
  assert.deepEqual(Object.keys(report.summary).sort(), ['blockers', 'gate', 'issues'])
  assert.equal(report.summary.gate, 'skipped')

  // 1 entrada por tela (a fixture tem exatamente uma tela declarada)
  assert.equal(report.screens.length, 1)
  const [screen] = report.screens
  assert.equal(screen.screen, 'tela/01-tela.html')
  assert.deepEqual(Object.keys(screen).sort(), ['a11y', 'capture', 'critic', 'diff', 'i18n-stress', 'perf', 'score', 'screen'])

  // capture: identificação + contentHash = sha256 do HTML da tela (§5.6)
  assert.equal(screen.capture.canvas, 'tela')
  assert.equal(screen.capture.device, 'mobile')
  assert.equal(screen.capture.width, 390)
  assert.equal(screen.capture.contentHash, createHash('sha256').update(readFileSync(SCREEN)).digest('hex'))
  assert.equal(screen.capture.images, 40) // matriz congelada 5 viewports × 8 estados (inclui long-text)
  assert.equal(screen.capture.viewports.length, 5)
  assert.equal(screen.capture.states.length, 8)

  // seções com evidência
  assert.deepEqual(Object.keys(screen.diff).sort(), ['aboveThreshold', 'compared', 'pairs', 'withoutBaseline'])
  assert.equal(Array.isArray(screen.critic.issues), true)
  assert.deepEqual(Object.keys(screen.score.perCriteria).sort(), [
    'acessibilidade',
    'composicao',
    'consistencia',
    'espacamento',
    'hierarquia',
    'microinteracao',
    'responsividade',
    'tipografia',
  ])
  assert.deepEqual(screen.a11y.checks, ['rules/a11y.mjs', 'validate.mjs'])
  assert.equal(typeof screen.a11y.ok, 'boolean')

  // summary coerente: soma dos issues = contagem (por listagem, por tela)
  const totals = report.screens.reduce(
    (acc, s) => ({
      issues: acc.issues + s.critic.issues.length + s.a11y.failures.length + s.diff.aboveThreshold,
      blockers:
        acc.blockers +
        s.critic.issues.filter((issue) => issue.severity === 'blocker').length +
        s.a11y.failures.length +
        s.diff.aboveThreshold,
    }),
    { issues: 0, blockers: 0 }
  )
  assert.equal(report.summary.issues, totals.issues, 'soma dos issues = contagem')
  assert.equal(report.summary.blockers, totals.blockers)
  assert.match(
    run.stdout,
    new RegExp(`resumo: blockers ${report.summary.blockers} \\| issues ${report.summary.issues} \\| gate skipped`)
  )
  firstRunReport = normalized(report)
})

test('determinismo: re-execução reproduz o relatório (timestamp/gitSHA normalizados)', () => {
  const run = runOrch([])
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
  assert.deepEqual(normalized(readReport()), firstRunReport, 'relatório reproduzido byte a byte menos timestamp/gitSHA (ambiente)')
})

// ---------- --gate: delegação ao visual-gate.mjs (todo 12, o dono da semântica) ----------

function freezeBaseline(target) {
  const freeze = spawnSync(process.execPath, [GATE, '--update-baseline', '--target', target], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(freeze.status, 0, `${freeze.stdout}${freeze.stderr}`)
}

test('--gate com diff acima do limiar: exit 1 + summary.gate=fail (decisão delegada)', () => {
  // capturas reais primeiro: o freeze congela as imagens ATUAIS de .visual/tela
  const capture = spawnSync(process.execPath, [CAPTURE, '--target', GATE_TARGET], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(capture.status, 0, `${capture.stdout}${capture.stderr}`)
  freezeBaseline(GATE_TARGET)
  // corrompe 1 PNG da baseline: bloco preto acima do limiar da plataforma
  const key = join(GATE_TARGET, '.visual', 'baseline', 'tela', '1440x900__modal.png')
  const { width, height, channels } = decodePng(readFileSync(key))
  writeFileSync(key, encodePng(width, height, channels, Buffer.alloc(width * height * channels)))
  const run = runOrch(['--gate'], ORCH, GATE_TARGET)
  assert.equal(run.status, 1, `${run.stdout}${run.stderr}`)
  const report = readReport(GATE_TARGET)
  assert.equal(report.summary.gate, 'fail')
  assert.ok(report.screens[0].diff.aboveThreshold >= 1, 'o par corrompido está acima do limiar')
  assert.match(run.stdout, /visual-gate: FALHOU|visual-gate: BLOQUEADO/, 'a saída do gate delegado aparece no stdout')
  // o relatório sai mesmo com o gate bloqueado — completo, nunca parcial
  assert.deepEqual(Object.keys(report).sort(), REPORT_KEYS)
  assert.equal(report.screens.length, 1)
  assert.match(run.stdout, /relatório ->/)
})

test('--gate com baseline íntegra: exit 0 + summary.gate=pass', () => {
  freezeBaseline(GATE_TARGET) // re-congela por cima da cópia corrompida
  const run = runOrch(['--gate'], ORCH, GATE_TARGET)
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
  assert.equal(readReport(GATE_TARGET).summary.gate, 'pass')
})

// ---------- sem verde parcial: etapa ausente nunca vira relatório completo ----------

const STEP_MODULES = [
  ['capture', 'visual-capture.mjs'],
  ['diff', join('lib', 'image-diff.mjs')],
  ['critic', 'visual-critic.mjs'],
  ['score', 'visual-score.mjs'],
  ['a11y', join('rules', 'a11y.mjs')],
  ['a11y', 'validate.mjs'],
]

test('etapa ausente: módulo removido => exit≠0 nomeia a etapa e nenhum relatório é emitido', () => {
  for (const [step, moduleRel] of STEP_MODULES) {
    const rig = tmpRoot('orch-missing-')
    copyChain(join(rig, 'scripts'))
    rmSync(join(rig, 'scripts', moduleRel))
    const target = copyFixtureTarget(rig)
    const run = runOrch([], join(rig, 'scripts', 'visual-orchestrator.mjs'), target)
    assert.notEqual(run.status, 0, `remover ${moduleRel} deve falhar`)
    assert.match(run.stderr, new RegExp(`etapa ausente: ${step}`), `erro deve nomear a etapa ${step}: ${run.stderr}`)
    assert.ok(!existsSync(join(target, '.visual', 'report.json')), 'relatório incompleto nunca é emitido')
  }
})

test('etapa score sem evidência (executa mas não grava) => exit≠0 "etapa ausente: score"', () => {
  const rig = tmpRoot('orch-stub-')
  copyChain(join(rig, 'scripts'))
  writeFileSync(join(rig, 'scripts', 'visual-score.mjs'), '#!/usr/bin/env node\nprocess.exit(0)\n')
  const target = copyFixtureTarget(rig)
  const run = runOrch([], join(rig, 'scripts', 'visual-orchestrator.mjs'), target)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /etapa ausente: score/, run.stderr)
  assert.ok(!existsSync(join(target, '.visual', 'report.json')), 'relatório incompleto nunca é emitido')
  assert.ok(!/\bresumo:/.test(run.stdout), 'run quebrado não emite resumo verde')
})

test('anti-fake: manifest mentiroso (PNG ausente ou contentHash falso) => exit≠0 e nenhum relatório', () => {
  // stub de captura que grava manifest sem artefato real — a evidência do
  // orquestrador é o artefato verificado, nunca a entrada do manifest.
  const stub = (body) => `#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const target = process.argv[process.argv.indexOf('--target') + 1]
const screenHash = createHash('sha256').update(readFileSync(join(target, 'tela', '01-tela.html'))).digest('hex')
${body}
`
  // 1. PNG listado no manifest mas ausente no disco
  {
    const rig = tmpRoot('orch-lie-png-')
    copyChain(join(rig, 'scripts'))
    writeFileSync(
      join(rig, 'scripts', 'visual-capture.mjs'),
      stub(`mkdirSync(join(target, '.visual'), { recursive: true })
writeFileSync(join(target, '.visual', 'manifest.json'), JSON.stringify({
  images: [
    { file: 'tela/01-tela.html', screen: 'tela', viewport: '390x844', state: 'success', png: '.visual/tela/390x844__success.png', screenHash },
    { file: 'tela/01-tela.html', screen: 'tela', viewport: '390x844', state: 'error', png: '.visual/tela/390x844__error.png', screenHash },
  ],
}))`)
    )
    const target = copyFixtureTarget(rig)
    const run = runOrch([], join(rig, 'scripts', 'visual-orchestrator.mjs'), target)
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /etapa ausente: capture/, run.stderr)
    assert.match(run.stderr, /PNG listado no manifest ausente no disco/, run.stderr)
    assert.ok(!existsSync(join(target, '.visual', 'report.json')), 'evidência furada nunca vira relatório')
    assert.ok(!/\bresumo:/.test(run.stdout), 'run quebrado não emite resumo verde')
  }
  // 2. PNG existe mas contentHash não é o da fonte (anti-fake §5.6)
  {
    const rig = tmpRoot('orch-lie-hash-')
    copyChain(join(rig, 'scripts'))
    writeFileSync(
      join(rig, 'scripts', 'visual-capture.mjs'),
      stub(`mkdirSync(join(target, '.visual', 'tela'), { recursive: true })
for (const state of ['success', 'error']) {
  writeFileSync(join(target, '.visual', 'tela', '390x844__' + state + '.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
}
writeFileSync(join(target, '.visual', 'manifest.json'), JSON.stringify({
  images: [
    { file: 'tela/01-tela.html', screen: 'tela', viewport: '390x844', state: 'success', png: '.visual/tela/390x844__success.png', screenHash: 'hash-falso' },
    { file: 'tela/01-tela.html', screen: 'tela', viewport: '390x844', state: 'error', png: '.visual/tela/390x844__error.png', screenHash: 'hash-falso' },
  ],
}))`)
    )
    const target = copyFixtureTarget(rig)
    const run = runOrch([], join(rig, 'scripts', 'visual-orchestrator.mjs'), target)
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /etapa capture: contentHash do manifest diverge da fonte atual/, run.stderr)
    assert.ok(!existsSync(join(target, '.visual', 'report.json')), 'contentHash falso nunca vira relatório')
    assert.ok(!/\bresumo:/.test(run.stdout), 'run quebrado não emite resumo verde')
  }
})

// ---------- CLI guiado ----------

test('CLI guiado: argumento desconhecido, --target sem valor, target ausente ou em modo canvas => exit 2', () => {
  const bad = spawnSync(process.execPath, [ORCH, '--flag-desconhecida'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /argumento desconhecido/)
  const noValue = spawnSync(process.execPath, [ORCH, '--target'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(noValue.status, 2)
  assert.match(noValue.stderr, /requer um caminho/)
  const missing = runOrch([], ORCH, join(FIXTURE, 'nao-existe'))
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /target não encontrado/)
  // modo canvas (canvas.json na raiz): a cadeia capture/critic/score só é coerente em design-root
  const canvas = runOrch([], ORCH, join(FIXTURE, 'tela'))
  assert.equal(canvas.status, 2)
  assert.match(canvas.stderr, /design-root/)
})

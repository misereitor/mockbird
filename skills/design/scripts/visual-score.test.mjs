/**
 * visual-score.test.mjs — Quality Score por critério + histórico + semântica do
 * gate (plano todo 12, GAP-A3).
 *
 * Contrato sob teste:
 *   - score agrega issues do critic + métricas determinísticas (cobertura da
 *     matriz 5×7 do manifest) em 8 critérios + overall ponderado, com os
 *     valores EXATOS do método (truncamento — nunca arredonda para cima);
 *   - histórico em scores.json é append-only: entradas anteriores nunca mudam
 *     nem somem, inclusive de outro gitSHA (stale state); segunda execução
 *     reproduz scores e gitSHA;
 *   - entradas ausentes/malformadas (sem relatório do critic, sem manifest,
 *     zero telas, relatório fora do contrato, histórico corrompido) => erro
 *     guiado e NENHUM verde parcial (scores.json nunca nasce de run quebrado);
 *   - GATE (todo 12, o dono da semântica): uma queda de score isolada NÃO
 *     altera o exit code do gate enquanto um pixel acima do limiar da
 *     plataforma ALTERA; contrato quebrado bloqueia mesmo com todos os diffs
 *     ok; o gate nunca referencia o histórico de score.
 *
 * Mutation-sensitive: VISUAL_GATE=/tmp/copia-mutada.mjs aponta o teste para uma
 * cópia do gate corrompida para bloquear por score — o caso "queda isolada"
 * falha (a asserção morde; prova no QA manual do todo). O tripwire estático
 * também falha se o gate passar a citar scores.json.
 *
 * Run: node --test skills/design/scripts/visual-score.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { combinedDiff, decodePng, thresholdsForPlatform, withinThresholds, loadThresholds, DEFAULT_THRESHOLDS } from './lib/image-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const SCORE = join(HERE, 'visual-score.mjs')
const GATE = process.env.VISUAL_GATE ?? join(HERE, 'visual-gate.mjs')
// alvo de contrato do gate: fixture mínima que valida limpa (rápida) vs a
// fixture propositalmente quebrada (hard-coded-color) para o probe de contrato.
const CONTRACT_OK = 'skills/design/scripts/fixtures/marker'
const CONTRACT_BAD = 'skills/design/scripts/fixtures/gate-contract-bad'

const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

// ---------- tiny RGB PNG encoder (filter 0 rows) for constructed fixtures ----------

function encodePng(width, height, pixels) {
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
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

function gradient(width, height) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3
      pixels[o] = (x * 4) % 256
      pixels[o + 1] = (y * 4) % 256
      pixels[o + 2] = ((x + y) * 4) % 256
    }
  }
  return pixels
}

// ---------- payload builders (critic-report.schema.json + manifest do todo 9) ----------

const VIEWPORTS = ['1440x900', '1366x768', '768x1024', '390x844', '360x800']
const STATES = ['modal', 'dropdown', 'form-invalid', 'loading', 'empty', 'error', 'success']

function issue(severity, category) {
  return { severity, category, element: 'main', problem: 'problema medido', suggestion: 'ajuste', evidence: 'tela.html:1: medido' }
}

function criticReport(screen, issues) {
  return {
    schemaVersion: 1,
    screen,
    viewport: '1440x900',
    state: 'default',
    score: 100,
    issues,
    deterministic: {
      detectors: [{ id: 'contrast', category: 'acessibilidade', status: 'ran' }],
      rendering: { pageScripts: 'stripped', network: 'blocked' },
      issuesSortedBy: ['severity', 'category', 'element', 'problem'],
      rerunStable: true,
    },
    vision: { model: null, run: false, optIn: false },
    gitSHA: 'unknown',
    screenHash: '0'.repeat(64),
    platform: 'linux',
    timestamp: '2026-01-01T00:00:00.000Z',
  }
}

function manifestDoc(screenCoverage) {
  const images = []
  for (const [file, { viewports, states }] of Object.entries(screenCoverage)) {
    for (const viewport of VIEWPORTS.slice(0, viewports)) {
      for (const state of STATES.slice(0, states)) {
        images.push({
          canvas: 'fixture',
          screen: 'tela',
          file,
          png: `tela/${viewport}__${state}.png`,
          viewport,
          state,
          gitSHA: 'unknown',
          screenHash: '0'.repeat(64),
          pngHash: '1'.repeat(64),
          timestamp: '2026-01-01T00:00:00.000Z',
          platform: 'linux',
          activation: 'fixture',
        })
      }
    }
  }
  return {
    schemaVersion: 1,
    tool: 'visual-capture',
    target: 'fixture',
    gitSHA: 'unknown',
    platform: 'linux',
    generatedAt: '2026-01-01T00:00:00.000Z',
    viewports: VIEWPORTS,
    states: STATES,
    expectedImages: images.length,
    images,
  }
}

/** target/.visual/{critic/,manifest.json} a partir de telas declaradas. */
function makeTarget({ reports = {}, coverage = {}, manifest = 'auto' } = {}) {
  const dir = tmpRoot('score-target-')
  const visual = join(dir, '.visual')
  mkdirSync(join(visual, 'critic'), { recursive: true })
  let index = 0
  for (const [screen, issues] of Object.entries(reports)) {
    index += 1
    writeFileSync(join(visual, 'critic', `report-${index}.json`), `${JSON.stringify(criticReport(screen, issues), null, 2)}\n`)
  }
  if (manifest !== null) {
    const doc = manifest === 'auto' ? manifestDoc(coverage) : manifest
    writeFileSync(join(visual, 'manifest.json'), `${JSON.stringify(doc, null, 2)}\n`)
  }
  return dir
}

function runScore(target) {
  return spawnSync(process.execPath, [SCORE, '--target', target], { cwd: ROOT, encoding: 'utf8' })
}

function runGate(args) {
  return spawnSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8' })
}

function readScores(target) {
  return JSON.parse(readFileSync(join(target, '.visual', 'scores.json'), 'utf8'))
}

const FULL = { viewports: 5, states: 7 }

// ---------- score: método exato ----------

test('score agrega issues + cobertura em 8 critérios + overall ponderado', () => {
  const target = makeTarget({
    reports: {
      'a/01.html': [issue('blocker', 'hierarquia'), issue('major', 'tipografia'), issue('minor', 'espacamento')],
      'b/02.html': [],
    },
    coverage: { 'a/01.html': FULL, 'b/02.html': FULL },
  })
  const run = runScore(target)
  assert.equal(run.status, 0, run.stderr)
  const doc = readScores(target)
  assert.equal(doc.schemaVersion, 1)
  assert.equal(doc.entries.length, 2)
  const [a, b] = doc.entries
  assert.equal(a.screen, 'a/01.html')
  assert.deepEqual(Object.keys(a.perCriteria).sort(), [
    'acessibilidade',
    'composicao',
    'consistencia',
    'espacamento',
    'hierarquia',
    'microinteracao',
    'responsividade',
    'tipografia',
  ])
  // método exato: 100 - 25/10/3 por blocker/major/minor na categoria
  assert.deepEqual(a.perCriteria, {
    hierarquia: 75,
    composicao: 100,
    tipografia: 90,
    espacamento: 97,
    consistencia: 100,
    responsividade: 100,
    acessibilidade: 100,
    microinteracao: 100,
  })
  // overall ponderado sobre os valores truncados (pesos 15/13/13/10/12/13/14/10)
  assert.equal(a.overall, 94.65)
  assert.deepEqual(b.perCriteria, {
    hierarquia: 100,
    composicao: 100,
    tipografia: 100,
    espacamento: 100,
    consistencia: 100,
    responsividade: 100,
    acessibilidade: 100,
    microinteracao: 100,
  })
  assert.equal(b.overall, 100)
})

test('truncamento: cobertura parcial nunca arredonda para cima', () => {
  const target = makeTarget({
    reports: { 'c/03.html': [] },
    coverage: { 'c/03.html': { viewports: 4, states: 6 } },
  })
  const run = runScore(target)
  assert.equal(run.status, 0, run.stderr)
  const [entry] = readScores(target).entries
  assert.equal(entry.perCriteria.responsividade, 80) // 100 × 4/5
  // 100 × 6/7 = 85.714... — truncado em 85.71; arredondar p/ cima daria 85.72
  assert.equal(entry.perCriteria.microinteracao, 85.71)
  assert.notEqual(entry.perCriteria.microinteracao, 85.72)
  assert.ok(entry.perCriteria.microinteracao < (100 * 6) / 7)
  assert.equal(entry.overall, 95.97) // ponderado dos valores truncados
})

// ---------- histórico ----------

test('histórico é append-only e a segunda execução reproduz scores e gitSHA', () => {
  const target = makeTarget({
    reports: { 'a/01.html': [issue('minor', 'composicao')], 'b/02.html': [] },
    coverage: { 'a/01.html': FULL, 'b/02.html': FULL },
  })
  assert.equal(runScore(target).status, 0)
  const first = readScores(target).entries
  assert.equal(first.length, 2)
  const snapshot = JSON.stringify(first)
  assert.equal(runScore(target).status, 0)
  const second = readScores(target).entries
  assert.equal(second.length, 4)
  assert.equal(JSON.stringify(second.slice(0, 2)), snapshot, 'entradas anteriores nunca mudam')
  // entradas novas reproduzem scores e apontam gitSHA igual (determinismo)
  assert.deepEqual(second[2].perCriteria, first[0].perCriteria)
  assert.equal(second[2].overall, first[0].overall)
  assert.equal(second[2].gitSHA, first[0].gitSHA)
  assert.deepEqual(second[3].perCriteria, first[1].perCriteria)
})

test('stale state: entrada de outro gitSHA é preservada, nunca mutada', () => {
  const target = makeTarget({ reports: { 'a/01.html': [] }, coverage: { 'a/01.html': FULL } })
  const prior = {
    gitSHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    timestamp: '2020-01-01T00:00:00.000Z',
    screen: 'z/antiga.html',
    perCriteria: {
      hierarquia: 0,
      composicao: 0,
      tipografia: 0,
      espacamento: 0,
      consistencia: 0,
      responsividade: 0,
      acessibilidade: 0,
      microinteracao: 0,
    },
    overall: 0,
  }
  mkdirSync(join(target, '.visual'), { recursive: true })
  writeFileSync(join(target, '.visual', 'scores.json'), `${JSON.stringify({ schemaVersion: 1, entries: [prior] }, null, 2)}\n`)
  assert.equal(runScore(target).status, 0)
  const entries = readScores(target).entries
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0], prior, 'a entrada antiga (outro gitSHA) permanece byte a byte')
  assert.equal(entries[1].screen, 'a/01.html')
})

// ---------- entrada malformada: erro claro, nunca verde parcial ----------

test('sem relatórios do critic, sem manifest ou histórico corrompido => erro guiado e nada é gravado', () => {
  // (a) critic dir ausente
  const noCritic = tmpRoot('score-nocritic-')
  mkdirSync(join(noCritic, '.visual'), { recursive: true })
  writeFileSync(join(noCritic, '.visual', 'manifest.json'), `${JSON.stringify(manifestDoc({ 'a/01.html': FULL }), null, 2)}\n`)
  const a = runScore(noCritic)
  assert.notEqual(a.status, 0)
  assert.match(a.stderr, /relatório do critic/i)
  assert.ok(!existsSync(join(noCritic, '.visual', 'scores.json')), 'run quebrado nunca grava histórico')

  // (b) manifest ausente
  const noManifest = makeTarget({ reports: { 'a/01.html': [] }, manifest: null })
  const b = runScore(noManifest)
  assert.notEqual(b.status, 0)
  assert.match(b.stderr, /manifest/i)
  assert.ok(!existsSync(join(noManifest, '.visual', 'scores.json')))

  // (c) zero telas com evidência (manifest sem imagens + relatório órfão)
  const zeroScreens = makeTarget({ reports: { 'a/01.html': [] }, manifest: manifestDoc({}) })
  const c = runScore(zeroScreens)
  assert.notEqual(c.status, 0)
  assert.match(c.stderr, /sem evidência de captura|nenhuma tela/i)
  assert.ok(!existsSync(zeroScreens + '/.visual/scores.json'))
  assert.ok(!/\boverall\b/.test(c.stdout), 'run sem telas não emite score (nunca "all 100")')

  // (d) relatório fora do contrato
  const badReport = makeTarget({ reports: {}, coverage: { 'a/01.html': FULL } })
  writeFileSync(
    join(badReport, '.visual', 'critic', 'quebrado.json'),
    `${JSON.stringify({ schemaVersion: 1, screen: 'a/01.html' }, null, 2)}\n`
  )
  const d = runScore(badReport)
  assert.notEqual(d.status, 0)
  assert.match(d.stderr, /quebrado\.json/)
  assert.ok(!existsSync(join(badReport, '.visual', 'scores.json')))

  // (e) histórico corrompido => erro guiado e bytes preservados
  const corrupt = makeTarget({ reports: { 'a/01.html': [] }, coverage: { 'a/01.html': FULL } })
  const scoresPath = join(corrupt, '.visual', 'scores.json')
  const garbage = '{ corrompido'
  writeFileSync(scoresPath, garbage)
  const e = runScore(corrupt)
  assert.notEqual(e.status, 0)
  assert.equal(readFileSync(scoresPath, 'utf8'), garbage, 'histórico corrompido nunca é sobrescrito')
})

// ---------- GATE (todo 12 — o dono da semântica) ----------

/** par baseline/current em tmp: identical | one-pixel (1 px acima do limiar). */
function makePairs(kind) {
  const dir = tmpRoot(`gate-${kind}-`)
  const baseline = join(dir, 'baseline')
  const current = join(dir, 'current')
  mkdirSync(baseline, { recursive: true })
  mkdirSync(current, { recursive: true })
  const base = gradient(7, 7)
  const now = gradient(7, 7)
  if (kind === 'one-pixel') {
    const o = (3 * 7 + 3) * 3
    now[o] = 0
    now[o + 1] = 0
    now[o + 2] = 0
  }
  writeFileSync(join(baseline, 'tela__1440x900__default.png'), encodePng(7, 7, base))
  writeFileSync(join(current, 'tela__1440x900__default.png'), encodePng(7, 7, now))
  return { dir, baseline, current }
}

test('fixture de 1 pixel está acima do limiar da plataforma (premissa do gate)', () => {
  const { baseline, current } = makePairs('one-pixel')
  const diff = combinedDiff(
    decodePng(readFileSync(join(baseline, 'tela__1440x900__default.png'))),
    decodePng(readFileSync(join(current, 'tela__1440x900__default.png')))
  )
  assert.equal(diff.pixelRatio, 1 / 49)
  const limits = thresholdsForPlatform(DEFAULT_THRESHOLDS, 'linux')
  assert.ok(diff.pixelRatio > limits.maxDiffPixelRatio, '1 px em 7x7 = 1/49 > 0.02')
  assert.equal(withinThresholds(diff, limits).pass, false)
})

test('queda isolada de score NÃO altera o exit code do gate; 1 px acima do limiar ALTERA', () => {
  // contextos de score reais, produzidos pelo próprio score: queda vs perfeito
  const dropTarget = makeTarget({
    reports: {
      'drop/01.html': [
        issue('blocker', 'hierarquia'),
        issue('blocker', 'composicao'),
        issue('blocker', 'tipografia'),
        issue('blocker', 'acessibilidade'),
      ],
    },
    coverage: { 'drop/01.html': FULL },
  })
  const perfectTarget = makeTarget({ reports: { 'ok/01.html': [] }, coverage: { 'ok/01.html': FULL } })
  assert.equal(runScore(dropTarget).status, 0)
  assert.equal(runScore(perfectTarget).status, 0)
  const dropScores = readFileSync(join(dropTarget, '.visual', 'scores.json'), 'utf8')
  const perfectScores = readFileSync(join(perfectTarget, '.visual', 'scores.json'), 'utf8')
  assert.ok(JSON.parse(dropScores).entries[0].overall < JSON.parse(perfectScores).entries[0].overall, 'a queda é real')

  const ok = makePairs('identical')
  const bad = makePairs('one-pixel')

  // score baixo + sem diff => gate passa
  writeFileSync(join(ok.current, 'scores.json'), dropScores)
  const lowRun = runGate(['--target', CONTRACT_OK, '--baseline', ok.baseline, '--current', ok.current])
  assert.equal(lowRun.status, 0, `score baixo sem diff não pode bloquear:\n${lowRun.stdout}${lowRun.stderr}`)

  // score perfeito + sem diff => MESMO exit code (queda isolada não muda nada)
  writeFileSync(join(ok.current, 'scores.json'), perfectScores)
  const highRun = runGate(['--target', CONTRACT_OK, '--baseline', ok.baseline, '--current', ok.current])
  assert.equal(highRun.status, lowRun.status, 'queda isolada de score não altera o exit code do gate')
  assert.equal(highRun.stdout, lowRun.stdout, 'a saída do gate não muda com o score')

  // 1 px acima do limiar + score perfeito => gate bloqueia (o diff decide)
  writeFileSync(join(bad.current, 'scores.json'), perfectScores)
  const pixelRun = runGate(['--target', CONTRACT_OK, '--baseline', bad.baseline, '--current', bad.current])
  assert.notEqual(pixelRun.status, 0, 'um pixel acima do limiar deve bloquear mesmo com score 100')
  assert.match(pixelRun.stderr, /FALHOU|BLOQUEADO/)
})

test('gate bloqueia por contrato quebrado mesmo com todos os diffs ok', () => {
  const ok = makePairs('identical')
  const clean = runGate(['--target', CONTRACT_OK, '--baseline', ok.baseline, '--current', ok.current])
  assert.equal(clean.status, 0, clean.stderr)
  const broken = runGate(['--target', CONTRACT_BAD, '--baseline', ok.baseline, '--current', ok.current])
  assert.notEqual(broken.status, 0, 'contrato quebrado deve bloquear com diffs limpos')
  assert.match(broken.stderr, /contrato/)
})

test('gate nunca referencia o histórico de score', () => {
  const src = readFileSync(GATE, 'utf8')
  assert.ok(!/\bscores\.json\b/.test(src), 'o gate não pode citar scores.json nem em comentário')
})

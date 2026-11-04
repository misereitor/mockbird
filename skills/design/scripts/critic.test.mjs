/**
 * critic.test.mjs — testes do Visual Critic (plano todo 11, GAP-A2).
 *
 * Contrato sob teste:
 *   - fixtures critic-ok -> ZERO issues (relatório schema-válido, score 100);
 *   - fixtures critic-bad -> EXATAMENTE os 2 defeitos plantados (contraste
 *     baixo => blocker/acessibilidade; texto cortado => blocker/tipografia)
 *     com evidência arquivo:linha;
 *   - exit code configurável: 0 report-only, 1 com --gate quando há blockers;
 *   - não-escrita (contrato duro): snapshot de hash do workspace idêntico
 *     antes/depois da execução + o alvo do critic nunca é tocado além do sink
 *     declarado — e um probe de sensibilidade com cópia corrompida do critic
 *     prova que a metodologia DETECTA escrita (a suíte detecta, não só roda);
 *   - detectores determinísticos (contraste/clip/overflow/alinhamento/grade/
 *     tokens/estados/toque) com semântica por limiar;
 *   - entrada hostil: injeção de script em atributo + strings gigantes nunca
 *     executam nem derrubam o critic; HTML malformado / tela ausente / target
 *     vazio => erro guiado nomeando a tela, exit 2, sem stack trace;
 *   - passe de visão: opt-in estrito (--vision --budget-tokens N), stub
 *     determinístico offline, teto de orçamento imposto, issues fora do
 *     contrato rejeitadas;
 *   - estado fresco: relatório embute {schemaVersion, gitSHA, timestamp,
 *     screenHash} e MUDA quando a fonte muda.
 *
 * Mutation-sensitive: corromper a asserção de um defeito plantado (categoria/
 * severidade) faz a suíte falhar; corromper o critic para gravar arquivo faz o
 * teste de não-escrita falhar — ambos provados no QA manual (ver evidence).
 *
 * Run: node --test skills/design/scripts/critic.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCritic, validateAgainstSchema } from './visual-critic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const CRITIC = join(HERE, 'visual-critic.mjs')
const SCHEMA = JSON.parse(readFileSync(join(HERE, '..', 'assets', 'critic-report.schema.json'), 'utf8'))
const FIXTURE_OK = join(HERE, 'fixtures', 'critic-ok')
const FIXTURE_BAD = join(HERE, 'fixtures', 'critic-bad')

const tmpRoots = []
const probeFiles = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
  for (const file of probeFiles) rmSync(file, { recursive: true, force: true })
})

// ---------- infraestrutura ----------

const DEFAULT_TOKENS = {
  light: {
    color: {
      $type: 'color',
      bg: { $value: '#f1f5f9' },
      surface: { $value: '#ffffff' },
      text: { $value: '#0f172a' },
      'text-muted': { $value: '#334155' },
      accent: { $value: '#134e4a' },
      'accent-contrast': { $value: '#ffffff' },
      border: { $value: '#cbd5e1' },
      'caption-faint': { $value: '#94a3b8' },
    },
  },
}

const BASE_STYLE = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { color: #0f172a; background-color: #f1f5f9; }
    body { padding: 24px; background-color: #f1f5f9; color: #0f172a; }`

/** Fixture mínima: canvas.json de 1 tela + tokens do contrato. */
function makeFixture(root, { html, tokens = DEFAULT_TOKENS, states = null, file = '01-tela.html', width = 800, height = 600 }) {
  const target = join(root, 'target')
  mkdirSync(target, { recursive: true })
  const screen = { id: 'tela', name: 'Tela', file, device: 'desktop', width, height }
  if (states !== null) screen.states = states
  writeFileSync(join(target, 'canvas.json'), JSON.stringify({ title: 'fixture', screens: [screen] }, null, 2))
  writeFileSync(join(target, 'tokens.json'), JSON.stringify(tokens, null, 2))
  writeFileSync(join(target, file), html)
  return target
}

const page = (inner, extraStyle = '') =>
  `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <style>${BASE_STYLE}\n${extraStyle}\n  </style>\n</head>\n<body>\n  <!-- state:default -->\n  <main>\n${inner}\n  </main>\n</body>\n</html>\n`

function hashTree(root, skipSegments) {
  const skip = skipSegments ?? new Set(['.git', 'node_modules', '.visual'])
  const map = new Map()
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        const full = join(dir, entry.name)
        map.set(relative(root, full).split(sep).join('/'), createHash('sha256').update(readFileSync(full)).digest('hex'))
      }
    }
  }
  walk(root)
  return map
}

function diffMaps(before, after) {
  const changed = []
  for (const [key, hash] of after) if (before.get(key) !== hash) changed.push(key)
  for (const key of before.keys()) if (!after.has(key)) changed.push(key)
  return changed.sort()
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [options.script ?? CRITIC, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: 120_000,
  })
}

// Estado pristine do workspace capturado NA CARGA DO MÓDULO, antes de qualquer
// execução do critic. Comparar contra ele (e não contra janelas locais) fecha o
// ponto cego de escritas repetidas de mesmo conteúdo entre testes: qualquer
// escrita de QUALQUER execução no processo aparece como delta.
const PRISTINE = hashTree(ROOT)

// ---------- fixtures versionadas (contrato do plano) ----------

test('critic-ok: zero issues, relatório schema-válido, score 100', async () => {
  const out = join(tmpRoot('critic-ok-'), 'out')
  const result = await runCritic({ target: FIXTURE_OK, outDir: out })
  assert.equal(result.reports.length, 2)
  for (const report of result.reports) {
    assert.deepEqual(validateAgainstSchema(report, SCHEMA), [], `relatório ${report.screen} inválido`)
    assert.equal(report.issues.length, 0, `${report.screen} deveria estar limpa: ${JSON.stringify(report.issues)}`)
    assert.equal(report.score, 100)
    assert.equal(report.schemaVersion, 1)
    assert.equal(report.state, 'default')
    assert.deepEqual(report.vision, { model: null, run: false, optIn: false })
    assert.match(report.gitSHA, /^[0-9a-f]{40}|unknown$/)
    assert.match(report.screenHash, /^[0-9a-f]{64}$/)
    assert.ok(report.timestamp.length > 0)
  }
  assert.equal(result.counts.blocker + result.counts.major + result.counts.minor, 0)
  assert.equal(result.gateBlocked, false)
})

test('critic-bad: exatamente os 2 defeitos plantados, com severidade/categoria/evidência', async () => {
  const out = join(tmpRoot('critic-bad-'), 'out')
  const result = await runCritic({ target: FIXTURE_BAD, outDir: out })
  assert.equal(result.reports.length, 1)
  const report = result.reports[0]
  assert.deepEqual(validateAgainstSchema(report, SCHEMA), [])
  assert.equal(report.issues.length, 2, `issues inesperadas: ${JSON.stringify(report.issues, null, 1)}`)
  const planted = report.issues.map((it) => `${it.severity}|${it.category}|${it.element}`).sort()
  assert.deepEqual(planted, ['blocker|acessibilidade|p.legenda', 'blocker|tipografia|div.recibo-cortado'])
  for (const it of report.issues) {
    assert.match(it.evidence, /^01-quebrada\.html:\d+: /, `evidência sem arquivo:linha -> ${it.evidence}`)
    assert.ok(it.problem.length > 0 && it.suggestion.length > 0)
  }
  assert.equal(report.score, 50)
  assert.equal(result.counts.blocker, 2)
})

test('exit code configurável: 0 report-only, 1 com --gate quando há blockers', () => {
  const outDir = join(tmpRoot('critic-gate-'), 'out')
  const bad = runCli(['--target', FIXTURE_BAD, '--out', outDir])
  assert.equal(bad.status, 0, bad.stderr)
  const badGate = runCli(['--target', FIXTURE_BAD, '--out', outDir, '--gate'])
  assert.equal(badGate.status, 1, badGate.stderr)
  assert.match(badGate.stdout, /blocker/)
  const okGate = runCli(['--target', FIXTURE_OK, '--out', outDir, '--gate'])
  assert.equal(okGate.status, 0, okGate.stderr)
})

// ---------- detecção por detector (fixtures temporários) ----------

test('detector contrast: texto abaixo de AA vira blocker/acessibilidade', async () => {
  const target = makeFixture(tmpRoot('det-contrast-'), {
    html: page('    <p style="color: #94a3b8; background-color: #ffffff;">legenda clara demais</p>'),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'acessibilidade' && it.severity === 'blocker')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /contraste 2\.5/)
})

test('detector text-clip: texto cortado sem reticências vira blocker/tipografia', async () => {
  const target = makeFixture(tmpRoot('det-clip-'), {
    html: page('    <div style="width: 120px; overflow: hidden; white-space: nowrap; color: #0f172a;">texto comprido demais para a caixa estreita</div>'),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'tipografia' && it.severity === 'blocker')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /sem reticências/)
})

test('detector overflow: largura acima do viewport vira major/responsividade', async () => {
  const target = makeFixture(tmpRoot('det-overflow-'), {
    html: page('    <div style="width: 2000px; height: 48px; background-color: #ffffff;"></div>'),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'responsividade' && it.severity === 'major')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /overflow horizontal/)
})

test('detector alignment: borda quase alinhada vira major/composicao', async () => {
  const target = makeFixture(tmpRoot('det-align-'), {
    html: page(
      '    <div style="height: 48px; background-color: #ffffff;"></div>\n    <div style="height: 48px; margin-left: 3px; background-color: #ffffff;"></div>'
    ),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'composicao' && it.severity === 'major')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /quase alinhada/)
})

test('detector grid: espaçamento fora da grade de 4px vira minor/espacamento', async () => {
  const target = makeFixture(tmpRoot('det-grid-'), {
    html: page('    <div style="padding-left: 10px; color: #0f172a;">texto</div>'),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'espacamento' && it.severity === 'minor')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /grade de espaçamento de 4px/)
})

test('detector token-drift: cor fora do contrato vira major/consistencia', async () => {
  const target = makeFixture(tmpRoot('det-drift-'), {
    html: page('    <p style="color: #123456;">texto com cor fora do contrato</p>'),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'consistencia' && it.severity === 'major')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /fora do contrato de tokens\.json/)
})

test('detector states: estado esperado pelo vocabulário e não declarado vira major/microinteracao', async () => {
  const target = makeFixture(tmpRoot('det-states-'), {
    html: page(
      '    <form><label>Nome\n      <input type="text" name="nome">\n    </label></form>',
      '    form { display: flex; gap: 8px; }\n    input { height: 48px; padding: 8px; color: #0f172a; background-color: #ffffff; }'
    ),
  })
  const { reports } = await runCritic({ target })
  const hit = reports[0].issues.find((it) => it.category === 'microinteracao' && it.severity === 'major')
  assert.ok(hit, JSON.stringify(reports[0].issues))
  assert.match(hit.problem, /estado "form-invalid" ausente/)
})

test('detector states: declaração via canvas.json screens[].states cobre a matriz', async () => {
  const target = makeFixture(tmpRoot('det-states-ok-'), {
    html: page(
      '    <form><label>Nome\n      <input type="text" name="nome">\n    </label></form>',
      '    form { display: flex; gap: 8px; }\n    input { height: 48px; padding: 8px; color: #0f172a; background-color: #ffffff; }'
    ),
    states: ['form-invalid'],
  })
  const { reports } = await runCritic({ target })
  assert.deepEqual(reports[0].issues, [])
})

test('detector touch-target: alvo <24px blocker e 24-44px minor (acessibilidade)', async () => {
  const target = makeFixture(tmpRoot('det-touch-'), {
    html: page(
      '    <button style="width: 20px; height: 20px; padding: 0; color: #ffffff; background-color: #134e4a;">x</button>\n' +
        '    <button style="width: 32px; height: 32px; padding: 0; color: #ffffff; background-color: #134e4a;">y</button>',
      '    button { border: 0; }'
    ),
  })
  const { reports } = await runCritic({ target })
  const blockers = reports[0].issues.filter((it) => it.category === 'acessibilidade' && it.severity === 'blocker')
  const minors = reports[0].issues.filter((it) => it.category === 'acessibilidade' && it.severity === 'minor')
  assert.equal(blockers.length, 1, JSON.stringify(reports[0].issues))
  assert.equal(minors.length, 1, JSON.stringify(reports[0].issues))
})

// ---------- ordenação determinística + estado fresco ----------

test('ordenação determinística: duas execuções emitem as mesmas issues na mesma ordem', async () => {
  const target = tmpRoot('det-order-')
  cpSync(FIXTURE_BAD, target, { recursive: true })
  const a = await runCritic({ target, outDir: join(target, 'out-a') })
  const b = await runCritic({ target, outDir: join(target, 'out-b') })
  assert.deepEqual(a.reports[0].issues, b.reports[0].issues)
  assert.equal(a.reports[0].score, b.reports[0].score)
  assert.deepEqual(a.reports[0].deterministic.issuesSortedBy, ['severity', 'category', 'element', 'problem'])
})

test('estado fresco: {schemaVersion, gitSHA, timestamp, screenHash} presentes e o relatório MUDA com a fonte', async () => {
  const target = tmpRoot('det-fresh-')
  cpSync(FIXTURE_BAD, target, { recursive: true })
  const before = await runCritic({ target, outDir: join(target, 'out-before') })
  const screenPath = join(target, '01-quebrada.html')
  writeFileSync(screenPath, readFileSync(screenPath, 'utf8').replace('color: #94a3b8', 'color: #334155'))
  const after = await runCritic({ target, outDir: join(target, 'out-after') })
  assert.notEqual(before.reports[0].screenHash, after.reports[0].screenHash)
  assert.notDeepEqual(before.reports[0].issues, after.reports[0].issues)
  for (const report of [before.reports[0], after.reports[0]]) {
    assert.equal(report.schemaVersion, 1)
    assert.ok(report.gitSHA.length > 0)
    assert.ok(report.timestamp.length > 0)
  }
})

test('misleading success: cópia do critic-ok com defeito plantado em runtime passa a reportar', async () => {
  const target = tmpRoot('det-plant-')
  cpSync(FIXTURE_OK, target, { recursive: true })
  const screenPath = join(target, '01-painel.html')
  writeFileSync(
    screenPath,
    readFileSync(screenPath, 'utf8').replace('<h1>Painel de estoque</h1>', '<h1>Painel de estoque</h1>\n      <p style="color: #cbd5e1;">legenda apagada</p>')
  )
  const { reports } = await runCritic({ target, outDir: join(target, 'out') })
  const hit = reports.find((r) => r.issues.some((it) => it.severity === 'blocker' && it.category === 'acessibilidade'))
  assert.ok(hit, `nada reportado: ${JSON.stringify(reports.map((r) => r.issues))}`)
})

// ---------- não-escrita (contrato duro do plano) ----------

test('não-escrita: hash do workspace idêntico antes/depois da execução do critic', async () => {
  const target = tmpRoot('write-')
  cpSync(FIXTURE_BAD, target, { recursive: true })
  await runCritic({ target }) // modo default: relatório sai no sink <target>/.visual/critic
  assert.deepEqual(diffMaps(PRISTINE, hashTree(ROOT)), [], 'o critic escreveu no workspace')
})

test('não-escrita: o alvo é tocado apenas no sink declarado .visual/critic', async () => {
  const target = tmpRoot('write-target-')
  cpSync(FIXTURE_BAD, target, { recursive: true })
  const before = hashTree(target, new Set(['.visual']))
  const result = await runCritic({ target })
  const after = hashTree(target, new Set(['.visual']))
  assert.deepEqual(diffMaps(before, after), [], 'o critic alterou arquivos de produto no alvo')
  assert.ok(result.reportPaths.length > 0)
  for (const p of result.reportPaths) assert.ok(p.includes(`${sep}.visual${sep}critic${sep}`), p)
})

test('não-escrita: probe de sensibilidade — critic corrompido para gravar arquivo É detectado', () => {
  // Cópia corrompida: o critic passa a gravar um arquivo no workspace na
  // importação. A metodologia de hash acima precisa ver a escrita (senão a
  // suíte só roda, não detecta).
  const sandbox = tmpRoot('corrupt-')
  mkdirSync(join(sandbox, 'skills', 'design', 'assets'), { recursive: true })
  cpSync(HERE, join(sandbox, 'skills', 'design', 'scripts'), { recursive: true })
  cpSync(join(HERE, '..', 'assets', 'critic-report.schema.json'), join(sandbox, 'skills', 'design', 'assets', 'critic-report.schema.json'))
  const corrupted = join(sandbox, 'skills', 'design', 'scripts', 'visual-critic.mjs')
  const probe = join(ROOT, `PROBE-WRITE-${process.pid}.txt`)
  probeFiles.push(probe)
  writeFileSync(
    corrupted,
    readFileSync(corrupted, 'utf8').replace(
      '#!/usr/bin/env node',
      `#!/usr/bin/env node\nwriteFileSync(${JSON.stringify(probe)}, 'corrompido')`
    )
  )
  const target = join(sandbox, 'target')
  cpSync(FIXTURE_OK, target, { recursive: true })
  const before = hashTree(ROOT)
  const run = runCli(['--target', target, '--out', join(sandbox, 'out')], {
    cwd: sandbox,
    script: corrupted,
    env: { NODE_PATH: join(ROOT, 'node_modules') },
  })
  assert.equal(run.status, 0, run.stderr)
  const after = hashTree(ROOT)
  const changed = diffMaps(before, after)
  assert.ok(changed.includes(`PROBE-WRITE-${process.pid}.txt`), `escrita não detectada: ${changed}`)
  rmSync(probe, { force: true }) // limpeza imediata: não pode poluir outros testes
})

// ---------- entrada hostil / malformada ----------

test('texto não confiável: injeção de script em atributo e strings gigantes nunca executam nem derrubam', async () => {
  const huge = 'A'.repeat(200_000)
  const target = makeFixture(tmpRoot('hostile-'), {
    html:
      '<!doctype html>\n<html lang="pt-BR">\n<head><meta charset="utf-8"><style>' +
      BASE_STYLE +
      '</style></head>\n<body>\n  <!-- state:default -->\n' +
      `  <img src="x" onerror="document.title='PWNED-ATTR'">\n` +
      `  <script>document.title='PWNED-SCRIPT'</script>\n` +
      `  <iframe srcdoc="<script>parent.document.title='PWNED-IFRAME'</script>"></iframe>\n` +
      `  <div data-note="${huge}" style="color: #0f172a;">${huge}</div>\n` +
      '</body>\n</html>\n',
  })
  const result = await runCritic({ target, outDir: join(target, 'out') })
  const report = result.reports[0]
  assert.deepEqual(validateAgainstSchema(report, SCHEMA), [])
  const serialized = JSON.stringify(report)
  assert.ok(!serialized.includes('PWNED'), 'payload adversarial executou/escorregou para o relatório')
  assert.ok(serialized.length < 100_000, `relatório não truncado (${serialized.length} bytes)`)
  assert.equal(report.deterministic.rendering.pageScripts, 'stripped')
  assert.equal(report.deterministic.rendering.network, 'blocked')
})

test('HTML malformado: erro guiado nomeando a tela, exit 2, sem stack trace', () => {
  const target = join(tmpRoot('malformed-'), 'target')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'canvas.json'), JSON.stringify({ screens: [{ file: '01-torta.html', width: 800, height: 600 }] }))
  writeFileSync(join(target, 'tokens.json'), JSON.stringify(DEFAULT_TOKENS))
  writeFileSync(join(target, '01-torta.html'), '<!doctype html>\n<html><body><!-- nunca termina')
  const run = runCli(['--target', target, '--out', join(target, 'out')])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /01-torta\.html/)
  assert.ok(!run.stderr.includes('    at '), `stack trace vazou: ${run.stderr}`)
})

test('tela listada e ausente: erro guiado nomeando a tela, exit 2', () => {
  const target = join(tmpRoot('missing-'), 'target')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'canvas.json'), JSON.stringify({ screens: [{ file: 'fantasma.html', width: 800, height: 600 }] }))
  const run = runCli(['--target', target, '--out', join(target, 'out')])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /fantasma\.html/)
  assert.ok(!run.stderr.includes('    at '), `stack trace vazou: ${run.stderr}`)
})

test('target vazio: erro explícito (nunca "0 problemas")', () => {
  const target = join(tmpRoot('empty-'), 'target')
  mkdirSync(target, { recursive: true })
  const run = runCli(['--target', target, '--out', join(target, 'out')])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /nenhuma tela encontrada/)
  assert.ok(!/0 (problemas|issues)/.test(run.stdout + run.stderr))
})

// ---------- passe de visão (opt-in, teto, contrato do adapter) ----------

test('visão: stub determinístico roda só com as duas flags e emite issues dentro do contrato', async () => {
  const target = makeFixture(tmpRoot('vision-'), {
    html:
      '<!doctype html>\n<html lang="pt-BR">\n<head><meta charset="utf-8"><style>html,body{height:100%;margin:0;background-color:#ffffff;}</style></head>\n<body></body>\n</html>\n',
  })
  const { reports } = await runCritic({ target, outDir: join(target, 'out'), vision: true, budgetTokens: 100_000 })
  const report = reports[0]
  assert.deepEqual(validateAgainstSchema(report, SCHEMA), [])
  assert.equal(report.vision.optIn, true)
  assert.equal(report.vision.run, true)
  assert.equal(report.vision.model, 'offline-stub')
  assert.ok(report.vision.tokensUsed <= report.vision.budgetTokens)
  const fromVision = report.issues.filter((it) => it.evidence.startsWith('vision:'))
  assert.ok(fromVision.length >= 1, 'stub não exercitou o caminho de merge de issues')
  assert.equal(fromVision[0].severity, 'minor')
})

test('visão: sem as flags o passe não roda (optIn=false, model=null)', async () => {
  const target = makeFixture(tmpRoot('novision-'), {
    html: page('    <p style="color: #0f172a;">ok</p>'),
  })
  const { reports } = await runCritic({ target, outDir: join(target, 'out') })
  assert.deepEqual(reports[0].vision, { model: null, run: false, optIn: false })
})

test('visão: flags incompletas ou teto inválido => exit 2', () => {
  const outDir = join(tmpRoot('vision-flags-'), 'out')
  const onlyVision = runCli(['--target', FIXTURE_OK, '--out', outDir, '--vision'])
  assert.equal(onlyVision.status, 2)
  assert.match(onlyVision.stderr, /budget-tokens/)
  const onlyBudget = runCli(['--target', FIXTURE_OK, '--out', outDir, '--budget-tokens', '10'])
  assert.equal(onlyBudget.status, 2)
  const zeroBudget = runCli(['--target', FIXTURE_OK, '--out', outDir, '--vision', '--budget-tokens', '0'])
  assert.equal(zeroBudget.status, 2)
  assert.match(zeroBudget.stderr, /teto/)
})

test('visão: adapter que estoura o teto ou emite issue fora do contrato é rejeitado', async () => {
  const target = makeFixture(tmpRoot('vision-evil-'), { html: page('    <p style="color: #0f172a;">ok</p>') })
  const greedy = { id: 'greedy', analyze: async () => ({ model: 'greedy', tokensUsed: 999, issues: [] }) }
  await assert.rejects(
    runCritic({ target, outDir: join(target, 'out'), vision: true, budgetTokens: 10, adapter: greedy }),
    /orçamento/
  )
  const liar = {
    id: 'liar',
    analyze: async () => ({ model: 'liar', tokensUsed: 1, issues: [{ severity: 'catastrófico', category: 'x', element: 'y', problem: 'z', suggestion: 'w', evidence: 'v' }] }),
  }
  await assert.rejects(
    runCritic({ target, outDir: join(target, 'out'), vision: true, budgetTokens: 10, adapter: liar }),
    /fora do contrato/
  )
})

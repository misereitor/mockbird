/**
 * a11y-responsive.test.mjs — Responsive Intelligence + Accessibility
 * Intelligence (plano todo 26, GAP-C4/GAP-C5).
 *
 * Contrato sob teste:
 *   - responsive-report.mjs emite 1 JSON por tela com os 5 viewports da matriz
 *     do todo 9 e recomendacoes por viewport (layout-break, touch-target,
 *     content-order, densidade por dispositivo);
 *   - stale_state: capture ausente / PNG listado sem arquivo / screenHash
 *     divergente => erro guiado pedindo visual-capture.mjs primeiro;
 *   - a11y-report.mjs SEM --with-axe declara a lacuna axe (nunca finge
 *     cobertura) e executa zoom-200/reduced-motion/aria-live;
 *   - COM --with-axe inclui resultados axe quando axe-core esta instalado
 *     (npm i --no-save axe-core) ou morre com erro guiado de instalacao;
 *   - fixture de contraste baixo => --gate exit != 0 citando o criterio WCAG
 *     (1.4.3) e audit-only segue exit 0;
 *   - fixture com ordem de foco quebrada (tabindex>0) => o relatorio aponta o
 *     elemento e --gate exit != 0 citando 2.4.3;
 *   - malformed_input: HTML malformado => erro guiado nomeando a tela.
 *
 * Run: node --test skills/design/scripts/a11y-responsive.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const RESPONSIVE = join(HERE, 'responsive-report.mjs')
const A11Y = join(HERE, 'a11y-report.mjs')
const MATRIX = ['1440x900', '1366x768', '768x1024', '390x844', '360x800']

const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

// 1x1 PNG (signature + IHDR) — evidencia de captura sintetizada para fixtures.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 })
}

// ---------- fixtures ----------

const SCREEN_WIDE_AND_TINY = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tela A</title>
</head>
<body>
<main>
  <h1>Tela A</h1>
  <button type="button" style="width:10px;height:10px;font-size:8px;padding:0;border:0">x</button>
  <div style="width:2000px;height:40px;background:#eee">conteudo largo</div>
</main>
</body>
</html>
`

const SCREEN_CLEAN = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tela B</title>
</head>
<body>
<main>
  <h1>Tela B</h1>
  <button type="button" style="width:120px;height:48px">Salvar</button>
</main>
</body>
</html>
`

/** Raiz de projeto: canvases em subdirs, sem canvas.json na raiz. */
function makeTarget({ screens, capture = false, skipManifest = false, dropPng = null, staleHash = false }) {
  const root = tmpRoot('a11y-responsive-')
  mkdirSync(join(root, 'c1'), { recursive: true })
  const entries = []
  for (const [index, [id, html]] of screens.entries()) {
    const file = `0${index + 1}.html`
    writeFileSync(join(root, 'c1', file), html)
    entries.push({ id, name: id, file, device: 'mobile', width: 390, height: 844 })
  }
  writeFileSync(join(root, 'c1', 'canvas.json'), `${JSON.stringify({ title: 'C1', screens: entries }, null, 2)}\n`)
  if (capture && !skipManifest) {
    const images = []
    for (const entry of entries) {
      const html = readFileSync(join(root, 'c1', entry.file), 'utf8')
      for (const viewport of MATRIX) {
        const png = `.visual/${entry.id}/${viewport}__modal.png`
        mkdirSync(join(root, '.visual', entry.id), { recursive: true })
        writeFileSync(join(root, png), TINY_PNG)
        images.push({
          canvas: 'c1',
          screen: entry.id,
          file: `c1/${entry.file}`,
          png,
          viewport,
          state: 'modal',
          screenHash: staleHash ? sha256('conteudo que mudou') : sha256(html),
          pngHash: sha256(TINY_PNG),
        })
      }
    }
    writeFileSync(
      join(root, '.visual', 'manifest.json'),
      `${JSON.stringify({ schemaVersion: 1, tool: 'visual-capture', viewports: MATRIX, states: ['modal'], images }, null, 2)}\n`,
    )
    if (dropPng !== null) rmSync(join(root, dropPng), { force: true })
  }
  return root
}

function readResponsive(root, tela) {
  return JSON.parse(readFileSync(join(root, '.visual', 'responsive', `${tela}.json`), 'utf8'))
}

function readA11y(root) {
  return JSON.parse(readFileSync(join(root, '.visual', 'a11y', 'report.json'), 'utf8'))
}

// ---------- responsive-report ----------

test('responsive: 1 JSON por tela com os 5 viewports e recomendacoes por viewport', () => {
  const root = makeTarget({
    screens: [['tela-a', SCREEN_WIDE_AND_TINY], ['tela-b', SCREEN_CLEAN]],
    capture: true,
  })
  const result = run(RESPONSIVE, ['--target', root])
  assert.equal(result.status, 0, result.stderr)

  for (const tela of ['tela-a', 'tela-b']) {
    const doc = readResponsive(root, tela)
    assert.equal(doc.schemaVersion, 1)
    assert.equal(doc.tela, tela)
    assert.deepEqual(doc.viewports.map((viewport) => viewport.label), MATRIX)
    for (const viewport of doc.viewports) {
      assert.ok(Array.isArray(viewport.findings), `${tela}/${viewport.label} sem findings`)
      assert.ok(Array.isArray(viewport.recommendations) && viewport.recommendations.length >= 1, `${tela}/${viewport.label} sem recomendacoes`)
    }
  }

  // tela-a: alvo de toque <44px e overflow devem virar recomendacoes estruturais.
  const docA = readResponsive(root, 'tela-a')
  const types = docA.recommendations.map((item) => item.type)
  assert.ok(types.includes('touch-target'), `sem touch-target em ${JSON.stringify(types)}`)
  assert.ok(types.includes('layout-break'), `sem layout-break em ${JSON.stringify(types)}`)
  assert.ok(types.includes('density'), `sem density em ${JSON.stringify(types)}`)
  const touch = docA.viewports.flatMap((viewport) => viewport.findings).filter((item) => item.type === 'touch-target')
  assert.ok(touch.some((item) => item.size && (item.size.w < 44 || item.size.h < 44)), 'nenhum alvo <44px apontado')
  const overflow = docA.viewports.filter((viewport) => viewport.metrics.overflowingElements > 0)
  assert.equal(overflow.length, MATRIX.length, 'o elemento de 2000px deve estourar os 5 viewports')

  // tela-b limpa: apenas recomendacoes de densidade (report-only, sem achismo).
  const docB = readResponsive(root, 'tela-b')
  assert.ok(docB.recommendations.every((item) => item.type === 'density'), JSON.stringify(docB.recommendations))
})

test('responsive: capture ausente -> erro guiado pedindo visual-capture (stale_state)', () => {
  const root = makeTarget({ screens: [['tela-a', SCREEN_CLEAN]] })
  const result = run(RESPONSIVE, ['--target', root])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /visual-capture/)
  assert.match(result.stderr, /tela-a|capture/)
})

test('responsive: PNG listado no manifesto ausente do disco -> erro guiado (stale_state)', () => {
  const root = makeTarget({
    screens: [['tela-a', SCREEN_CLEAN]],
    capture: true,
    dropPng: '.visual/tela-a/390x844__modal.png',
  })
  const result = run(RESPONSIVE, ['--target', root])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /PNGs do visual ausentes/)
  assert.match(result.stderr, /visual-capture/)
})

test('responsive: screenHash divergente -> captura desatualizada, erro guiado (stale_state)', () => {
  const root = makeTarget({ screens: [['tela-a', SCREEN_CLEAN]], capture: true, staleHash: true })
  const result = run(RESPONSIVE, ['--target', root])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /captura desatualizada/)
})

test('responsive: HTML malformado -> erro guiado nomeando a tela (malformed_input)', () => {
  const root = makeTarget({
    screens: [['tela-a', '<!doctype html><html><body>truncado']],
    capture: true,
  })
  const result = run(RESPONSIVE, ['--target', root])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /tela-a/)
  assert.match(result.stderr, /HTML malformado/)
})

// ---------- a11y-report ----------

const TOKENS_OK = {
  $extensions: { designPack: { contrastPairs: [{ fg: '#000000', bg: '#ffffff', minRatio: 4.5 }] } },
}

const COMPONENTS_OK = {
  toast: {
    name: 'toast',
    template: 'toast.html',
  },
}

function addA11yExtras(root, { tokens = TOKENS_OK, toastLive = true, focusBroken = false, zoomBlocked = false } = {}) {
  if (tokens !== null) writeFileSync(join(root, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`)
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'components', 'components.json'), `${JSON.stringify(COMPONENTS_OK, null, 2)}\n`)
  writeFileSync(
    join(root, 'components', 'toast.html'),
    `<div class="mock-toast"${toastLive ? ' aria-live="polite"' : ''}>mensagem</div>\n`,
  )
  if (focusBroken || zoomBlocked) {
    const file = join(root, 'c1', '01.html')
    let html = readFileSync(file, 'utf8')
    if (focusBroken) html = html.replace('<main>', '<main>\n  <p tabindex="3">ordem quebrada</p>')
    if (zoomBlocked) html = html.replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, user-scalable=no"')
    writeFileSync(file, html)
  }
  return root
}

test('a11y: sem --with-axe declara a lacuna axe e executa zoom/reduced-motion/aria-live', () => {
  const root = addA11yExtras(makeTarget({ screens: [['tela-a', SCREEN_CLEAN]] }))
  const result = run(A11Y, ['--target', root])
  assert.equal(result.status, 0, result.stderr)
  const report = readA11y(root)

  for (const id of ['zoom-200', 'reduced-motion', 'aria-live', 'keyboard', 'focus-order', 'contrast', 'template-contract', 'focus-contract']) {
    assert.ok(report.summary.checksExecuted.includes(id), `check ${id} nao executado: ${JSON.stringify(report.summary)}`)
  }

  // misleading_success: sem engine externa o relatorio PRECISA declarar a lacuna.
  const axeCheck = report.checks.find((check) => check.id === 'axe')
  assert.equal(axeCheck.status, 'gap')
  assert.ok(report.gaps.some((gap) => /axe/i.test(gap)), `lacuna axe ausente: ${JSON.stringify(report.gaps)}`)
  assert.ok(report.summary.checksGap.includes('axe'))

  // Sem --gate o modo relatorio nunca bloqueia (audit-only).
  assert.equal(result.status, 0)
})

test('a11y: fixture de contraste baixo -> --gate exit != 0 citando o criterio WCAG', () => {
  const tokens = {
    light: { color: { text: { $value: '#999999' }, bg: { $value: '#ffffff' } } },
    $extensions: {
      designPack: {
        contrastPairs: [
          { fg: '#888888', bg: '#ffffff', minRatio: 4.5 },
          { fg: 'color.text', bg: 'color.bg', minRatio: 4.5 },
        ],
      },
    },
  }
  const root = addA11yExtras(makeTarget({ screens: [['tela-a', SCREEN_CLEAN]] }), { tokens })

  // audit-only: acha o problema mas nao bloqueia.
  const audit = run(A11Y, ['--target', root])
  assert.equal(audit.status, 0, audit.stderr)

  const gated = run(A11Y, ['--target', root, '--gate'])
  assert.notEqual(gated.status, 0)
  const output = gated.stdout + gated.stderr
  assert.match(output, /1\.4\.3/)
  assert.match(output, /contrast/)
  const report = readA11y(root)
  const contrast = report.checks.find((check) => check.id === 'contrast')
  assert.ok(contrast.findings.length >= 2, JSON.stringify(contrast.findings))
  assert.ok(contrast.findings.every((item) => item.criterion === '1.4.3'), JSON.stringify(contrast.findings))
})

test('a11y: ordem de foco quebrada -> relatorio aponta o elemento e --gate exit != 0 (2.4.3)', () => {
  const root = addA11yExtras(makeTarget({ screens: [['tela-a', SCREEN_CLEAN]] }), { focusBroken: true })
  const gated = run(A11Y, ['--target', root, '--gate'])
  assert.notEqual(gated.status, 0)
  const report = readA11y(root)
  const focus = report.checks.find((check) => check.id === 'focus-order')
  const hit = focus.findings.find((item) => item.code === 'focus-order-positive-tabindex')
  assert.ok(hit, JSON.stringify(focus.findings))
  assert.match(hit.element, /tabindex="3"/)
  assert.equal(hit.criterion, '2.4.3')
  assert.equal(hit.screen, 'tela-a')
  assert.match(gated.stdout + gated.stderr, /2\.4\.3/)
})

test('a11y: zoom bloqueado no meta viewport -> finding 1.4.4', () => {
  const root = addA11yExtras(makeTarget({ screens: [['tela-a', SCREEN_CLEAN]] }), { zoomBlocked: true })
  const result = run(A11Y, ['--target', root])
  assert.equal(result.status, 0, result.stderr)
  const report = readA11y(root)
  const zoom = report.checks.find((check) => check.id === 'zoom-200')
  assert.ok(zoom.findings.some((item) => item.code === 'zoom-disabled' && item.criterion === '1.4.4'), JSON.stringify(zoom.findings))
})

test('a11y: --with-axe inclui resultados axe (ou erro guiado quando o engine falta)', () => {
  const requireFrom = createRequire(join(ROOT, 'noop.js'))
  let axeAvailable = true
  try {
    requireFrom.resolve('axe-core')
  } catch {
    axeAvailable = false
  }
  const root = addA11yExtras(makeTarget({ screens: [['tela-a', SCREEN_CLEAN]] }))
  const result = run(A11Y, ['--target', root, '--with-axe'])
  if (axeAvailable) {
    assert.equal(result.status, 0, result.stderr)
    const report = readA11y(root)
    const axeCheck = report.checks.find((check) => check.id === 'axe')
    assert.equal(axeCheck.status, 'executed')
    assert.ok(Array.isArray(axeCheck.findings))
    // Com engine executado, a lacuna axe nao pode ser declarada.
    assert.ok(!report.gaps.some((gap) => /axe-core\/pa11y nao executados/.test(gap)), JSON.stringify(report.gaps))
  } else {
    // Engine pedido e ausente: nunca degrada em silencio para um relatorio sem axe.
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /axe-core/)
    assert.match(result.stderr, /npm i --no-save axe-core/)
  }
})

test('a11y: HTML malformado -> erro guiado nomeando a tela (malformed_input)', () => {
  const root = makeTarget({ screens: [['tela-a', '<!doctype html><html><body>truncado']] })
  const result = run(A11Y, ['--target', root])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /tela-a/)
  assert.match(result.stderr, /HTML malformado/)
})

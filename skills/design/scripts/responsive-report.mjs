#!/usr/bin/env node
/**
 * responsive-report.mjs — Responsive Intelligence (plan todo 26, GAP-C4).
 *
 * Compares every screen across the frozen 5-viewport capture matrix (plan
 * todo 9 — the visual-capture.mjs data) and emits structural recommendations
 * per screen into <design-root>/.visual/responsive/<tela>.json:
 *
 *   - layout-break  horizontal overflow / elements escaping the viewport
 *   - density       content depth and interactive density per device class
 *   - content-order DOM order vs visual order (reading/focus order drift)
 *   - touch-target  interactive targets under 44px (WCAG 2.5.5/2.5.8)
 *
 * Input contract (stale-state guard — the report never audits a screen the
 * capture matrix has not settled):
 *   <design-root>/.visual/manifest.json must exist and cover every screen at
 *   EVERY matrix viewport with at least one PNG on disk whose screenHash
 *   matches the current screen file. Missing PNGs, a missing manifest or a
 *   stale screenHash die with a guided error naming the screen and asking
 *   for visual-capture.mjs first. The manifest's viewport coverage is the
 *   todo-9 data being compared; the measurements below are taken live via
 *   playwright-core (geometry cannot come from PNG bytes).
 *
 * Report-only (no thresholds, no gate — visual-thresholds.json stays owned by
 * the visual gate): findings and recommendations never change the exit code.
 *
 * The viewport matrix below is a deliberate mirror of visual-capture.mjs's
 * frozen VIEWPORTS (that script is a CLI and cannot be imported; the matrix is
 * plan-frozen, never configurable).
 *
 * Exit codes: 0 = report written (audit-only, findings included), 2 = usage
 * or structural input error (unknown arg, missing target, 0 screens,
 * malformed screen HTML, missing/stale capture data), 5 = playwright-core
 * missing.
 *
 * Usage:
 *   node skills/design/scripts/responsive-report.mjs [--target <design-root>] [--help]
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// ---------- frozen matrix (plan todo 9 — mirror of visual-capture.mjs) ----------

const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1440, height: 900, device: 'desktop' }),
  Object.freeze({ width: 1366, height: 768, device: 'desktop' }),
  Object.freeze({ width: 768, height: 1024, device: 'tablet' }),
  Object.freeze({ width: 390, height: 844, device: 'mobile' }),
  Object.freeze({ width: 360, height: 800, device: 'mobile' }),
])

const OUT_DIR = '.visual'
const REPORT_DIR = 'responsive'
const MANIFEST_NAME = 'manifest.json'
const SCHEMA_VERSION = 1
const LOAD_TIMEOUT_MS = 15_000
// Touch target thresholds: WCAG 2.5.8 (AA) minimum 24px, 2.5.5 (AAA) 44px —
// the plan's "<44px" recommendation trigger with AA-aware severity.
const TARGET_MIN_AA = 24
const TARGET_MIN_AAA = 44
const LIST_CAP = 10
// Infra folders that can never hold canvases (agent-map.mjs SKIP_DIRS mirror).
const SKIP_DIRS = new Set(['node_modules', '.history', 'snapshots', 'vendor', 'scripts', 'spec', OUT_DIR])

const usage =
  'usage: node skills/design/scripts/responsive-report.mjs [--target <design-root>] [--help]'

/** Guided failure inside resource-holding sections: thrown so the serve/
 *  browser cleanup in `finally` runs before the process exits. */
class GuidedError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

// ---------- args ----------

function die(message, code) {
  console.error(message)
  process.exit(code)
}

const argv = process.argv.slice(2)
let targetArg = 'design'
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(usage)
    process.exit(0)
  } else if (token === '--target') {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      die(`--target requires a value — ${usage}`, 2)
    }
    targetArg = value
    i += 1
  } else {
    die(`unknown argument: ${token} — ${usage}`, 2)
  }
}

const viewportLabel = ({ width, height }) => `${width}x${height}`

// ---------- playwright-core (dynamic require — visual-capture.mjs pattern) ----------

const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
let chromium
try {
  ;({ chromium } = requireFrom('playwright-core'))
} catch {
  die('responsive-report: playwright-core nao encontrado — rode "npm i playwright-core" nesta pasta e tente de novo.', 5)
}

// ---------- target + screen discovery (agent-map.mjs conventions) ----------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** The design root is the target root itself (project mode) and one level up
 *  in canvas mode (root canvas.json) — visual-capture.mjs designRootOf mirror. */
function designRootOf(targetRoot) {
  return existsSync(join(targetRoot, 'canvas.json')) ? dirname(targetRoot) : targetRoot
}

function readManifest(path) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    die(`responsive-report: ${path}: canvas.json invalido (${String(error.message)})`, 2)
  }
  if (!isPlainObject(manifest)) die(`responsive-report: ${path}: a raiz deve ser um objeto`, 2)
  if (!Array.isArray(manifest.screens)) die(`responsive-report: ${path}: "screens" deve ser uma lista`, 2)
  return manifest
}

function discoverCanvases(root) {
  const canvases = []
  if (existsSync(join(root, 'canvas.json'))) {
    canvases.push({ dir: root, relDir: '.', manifest: readManifest(join(root, 'canvas.json')) })
    return canvases
  }
  const walk = (dir) => {
    let entries
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
        canvases.push({ dir: full, relDir: relative(root, full).split('\\').join('/'), manifest: readManifest(join(full, 'canvas.json')) })
      }
      walk(full)
    }
  }
  walk(root)
  return canvases
}

function discoverScreens(designRoot) {
  const screens = []
  const seen = new Map()
  for (const canvas of discoverCanvases(designRoot)) {
    for (const [index, entry] of canvas.manifest.screens.entries()) {
      if (!isPlainObject(entry) || typeof entry.file !== 'string' || entry.file.length === 0) {
        die(`responsive-report: ${canvas.relDir}/canvas.json: screen #${index + 1} precisa de "file"`, 2)
      }
      const fileRel = canvas.relDir === '.' ? entry.file : `${canvas.relDir}/${entry.file}`
      const abs = resolve(designRoot, fileRel)
      if (!existsSync(abs)) {
        die(`responsive-report: ${fileRel}: listado em ${canvas.relDir}/canvas.json mas ausente no disco`, 2)
      }
      const tela = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : basename(entry.file, extname(entry.file))
      const previous = seen.get(tela)
      if (previous !== undefined) {
        die(`responsive-report: tela duplicada "${tela}" (${previous} e ${fileRel})`, 2)
      }
      seen.set(tela, fileRel)
      screens.push({ tela, file: fileRel, canvas: canvas.relDir })
    }
  }
  return screens
}

/** Structural screen-source check BEFORE any render: a truncated or garbage
 *  file must fail naming the screen (visual-capture.mjs assertScreenSource). */
function assertScreenSource(screen, html) {
  const where = `tela ${screen.tela} (${screen.file})`
  const missing = []
  if (html.length === 0) die(`responsive-report: ${where}: HTML malformado — arquivo vazio`, 2)
  if (html.includes('\u0000')) die(`responsive-report: ${where}: HTML malformado — bytes NUL no conteudo`, 2)
  if (!/<html[\s>]/i.test(html)) missing.push('<html>')
  if (!/<body[\s>]/i.test(html)) missing.push('<body>')
  if (!/<\/html>/i.test(html)) missing.push('</html>')
  if (missing.length > 0) {
    die(`responsive-report: ${where}: HTML malformado — falta ${missing.join(', ')} (arquivo truncado?)`, 2)
  }
}

// ---------- capture evidence (stale-state guard) ----------

/** PNG sanity (signature + IHDR dimensions) — the capture evidence must be a
 *  real image, never an empty placeholder (visual-capture.mjs assertPng). */
function assertPng(png, where) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (png.length <= 16 || !png.subarray(0, 8).equals(signature)) {
    die(`responsive-report: ${where}: PNG invalido no manifesto da captura`, 2)
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1 || height < 1) {
    die(`responsive-report: ${where}: PNG invalido (dimensoes ${width}x${height})`, 2)
  }
}

/**
 * Loads the visual-capture manifest and demands, per screen, one manifest
 * entry + PNG on disk for EVERY matrix viewport and a screenHash matching the
 * current screen file. Returns { manifest, pngByViewport } for the screen.
 */
function captureEvidenceFor(designRoot, screen) {
  const manifestPath = join(designRoot, OUT_DIR, MANIFEST_NAME)
  const captureHint = 'rode "node skills/design/scripts/visual-capture.mjs" antes (o relatorio compara a matriz ja capturada)'
  if (!existsSync(manifestPath)) {
    die(`responsive-report: capture do visual ausente (${OUT_DIR}/${MANIFEST_NAME}) para tela "${screen.tela}" — ${captureHint}`, 2)
  }
  let doc = null
  try {
    doc = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    die(`responsive-report: ${OUT_DIR}/${MANIFEST_NAME}: manifesto invalido (${String(error.message)}) — ${captureHint}`, 2)
  }
  const entries = isPlainObject(doc) && Array.isArray(doc.images) ? doc.images.filter(isPlainObject) : []
  const currentHash = sha256(readFileSync(resolve(designRoot, screen.file)))
  const pngByViewport = {}
  for (const viewport of VIEWPORTS) {
    const label = viewportLabel(viewport)
    const hit = entries.find((entry) => entry.screen === screen.tela && entry.viewport === label)
    if (hit === undefined) {
      die(`responsive-report: PNGs do visual ausentes para tela "${screen.tela}" (viewport ${label}) — ${captureHint}`, 2)
    }
    if (typeof hit.screenHash === 'string' && hit.screenHash !== currentHash) {
      die(`responsive-report: tela "${screen.tela}": captura desatualizada (screenHash ${hit.screenHash.slice(0, 12)} != ${currentHash.slice(0, 12)}) — a tela mudou depois da captura; ${captureHint}`, 2)
    }
    const pngRel = typeof hit.png === 'string' ? hit.png : `${OUT_DIR}/${screen.tela}/${label}__${hit.state ?? 'default'}.png`
    const pngAbs = resolve(designRoot, pngRel)
    if (!existsSync(pngAbs)) {
      die(`responsive-report: PNGs do visual ausentes para tela "${screen.tela}" (viewport ${label}): ${pngRel} nao esta no disco — ${captureHint}`, 2)
    }
    assertPng(readFileSync(pngAbs), `tela "${screen.tela}" ${label}: ${pngRel}`)
    pngByViewport[label] = pngRel
  }
  return { manifest: doc, pngByViewport }
}

// ---------- serve + browser (visual-capture.mjs patterns) ----------

function findSkillAsset(name) {
  for (const rel of [`../assets/${name}`, `../${name}`]) {
    const full = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(full)) return full
  }
  return null
}

const SERVE_SCRIPT = findSkillAsset('serve.mjs')
if (SERVE_SCRIPT === null) {
  die('responsive-report: serve.mjs nao encontrado (checked ../assets/serve.mjs and ../serve.mjs)', 2)
}

function gitShaOf(designRoot) {
  try {
    return execFileSync('git', ['-C', designRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const settle = (page) =>
  page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))
  })

// ---------- in-page measurement ----------

/**
 * Runs inside the page at the target viewport. Returns raw metrics plus the
 * offending elements; the node side turns them into findings/recommendations.
 */
function measureInPage() {
  const CAP = 10 // findings list cap (mirror of the node-side LIST_CAP)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary,' +
    ' [role="button"], [role="link"], [role="menuitem"], [data-go], [data-action],' +
    ' [data-toast], [data-overlay], [data-close], [tabindex]'
  const isVisible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0
  }
  const label = (el) => {
    const component = el.getAttribute('data-component')
    const id = el.id ? `#${el.id}` : ''
    const cls = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : ''
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${el.tagName.toLowerCase()}${component ? `[data-component=${component}]` : ''}${id}${cls}${text ? ` "${text}"` : ''}`
  }
  const all = [...document.querySelectorAll(INTERACTIVE)].filter(isVisible)
  const touchTargets = []
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) {
      touchTargets.push({ element: label(el), w: Math.round(r.width), h: Math.round(r.height) })
    }
  }
  const overflowing = []
  for (const el of document.querySelectorAll('body *')) {
    if (overflowing.length >= 20) break
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > vw + 1 || r.left < -1) {
      overflowing.push({ element: label(el), left: Math.round(r.left), right: Math.round(r.right) })
    }
  }
  // DOM order vs visual order over the interactive set (reading/focus order).
  const seq = all.map((el, index) => {
    const r = el.getBoundingClientRect()
    return { index, top: Math.round(r.top), left: Math.round(r.left) }
  })
  const visual = [...seq].sort((a, b) => (a.top - b.top) || (a.left - b.left))
  const orderInversions = []
  for (let k = 1; k < visual.length; k += 1) {
    if (orderInversions.length >= 10) break
    if (visual[k - 1].index > visual[k].index) {
      orderInversions.push({
        visualFirst: label(all[visual[k].index]),
        domFirst: label(all[visual[k - 1].index]),
      })
    }
  }
  return {
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    interactiveVisible: all.length,
    aboveFold: all.filter((el) => el.getBoundingClientRect().top < vh).length,
    contentScreens: Math.round((document.documentElement.scrollHeight / vh) * 100) / 100,
    horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
    overflowing: overflowing.slice(0, CAP),
    overflowingTotal: overflowing.length,
    touchTargets: touchTargets.slice(0, CAP),
    touchTargetsTotal: touchTargets.length,
    orderInversions: orderInversions.slice(0, CAP),
    orderInversionsTotal: orderInversions.length,
  }
}

// ---------- findings + recommendations ----------

function buildViewportReport(viewport, raw) {
  const label = viewportLabel(viewport)
  const findings = []
  const recommendations = []
  if (raw.horizontalOverflow || raw.overflowingTotal > 0) {
    for (const item of raw.overflowing) {
      findings.push({
        type: 'layout-break',
        severity: 'warn',
        element: item.element,
        detail: `elemento ultrapassa a largura do viewport (${item.left}..${item.right}px em ${label})`,
      })
    }
    recommendations.push({
      type: 'layout-break',
      severity: 'warn',
      text: `overflow horizontal em ${label} (${raw.overflowingTotal} elemento(s) fora do viewport, scrollWidth ${raw.scrollWidth}px) — trocar larguras fixas por max-width/fluidas`,
    })
  }
  for (const item of raw.touchTargets) {
    const under24 = item.w < TARGET_MIN_AA || item.h < TARGET_MIN_AA
    findings.push({
      type: 'touch-target',
      severity: under24 ? 'warn' : 'info',
      criterion: under24 ? '2.5.8' : '2.5.5',
      element: item.element,
      size: { w: item.w, h: item.h },
      detail: `alvo de toque ${item.w}x${item.h}px em ${label} (minimo ${under24 ? `${TARGET_MIN_AA}px WCAG 2.5.8` : `${TARGET_MIN_AAA}px WCAG 2.5.5`})`,
    })
  }
  if (raw.touchTargetsTotal > 0) {
    recommendations.push({
      type: 'touch-target',
      severity: raw.touchTargets.some((t) => t.w < TARGET_MIN_AA || t.h < TARGET_MIN_AA) ? 'warn' : 'info',
      text: `${raw.touchTargetsTotal} alvo(s) de toque abaixo de ${TARGET_MIN_AAA}px em ${label} — aumentar para ${TARGET_MIN_AAA}px (WCAG 2.5.5) ou no minimo ${TARGET_MIN_AA}px (WCAG 2.5.8)`,
    })
  }
  for (const item of raw.orderInversions) {
    findings.push({
      type: 'content-order',
      severity: 'warn',
      detail: `ordem visual diverge da ordem do DOM em ${label}: "${item.visualFirst}" aparece antes visualmente, mas "${item.domFirst}" vem antes no DOM`,
    })
  }
  if (raw.orderInversionsTotal > 0) {
    recommendations.push({
      type: 'content-order',
      severity: 'warn',
      text: `ordem de conteudo nao segue a ordem do DOM em ${label} (${raw.orderInversionsTotal} inversao(oes)) — teclado/leitores de tela leem outra sequencia; reordenar o DOM ou usar flex/grid order consciente`,
    })
  }
  recommendations.push({
    type: 'density',
    severity: 'info',
    text: `densidade ${viewport.device} (${label}): ${raw.contentScreens} tela(s) de conteudo, ${raw.interactiveVisible} interativo(s) visiveis (${raw.aboveFold} acima da dobra)`,
  })
  return {
    label,
    width: viewport.width,
    height: viewport.height,
    device: viewport.device,
    metrics: {
      scrollWidth: raw.scrollWidth,
      scrollHeight: raw.scrollHeight,
      contentScreens: raw.contentScreens,
      interactiveVisible: raw.interactiveVisible,
      aboveFold: raw.aboveFold,
      touchTargetsUnder44: raw.touchTargetsTotal,
      overflowingElements: raw.overflowingTotal,
      orderInversions: raw.orderInversionsTotal,
    },
    findings,
    recommendations,
  }
}

function buildScreenRecommendations(viewportReports) {
  const merged = []
  const byType = new Map()
  for (const report of viewportReports) {
    for (const recommendation of report.recommendations) {
      const key = `${recommendation.type}|${recommendation.severity}|${recommendation.text}`
      const hit = byType.get(key)
      if (hit === undefined) {
        byType.set(key, { ...recommendation, viewports: [report.label] })
      } else {
        hit.viewports.push(report.label)
      }
    }
  }
  for (const entry of byType.values()) merged.push(entry)
  // Per-device density roll-up (the plan's "densidade por dispositivo").
  for (const device of ['desktop', 'tablet', 'mobile']) {
    const reports = viewportReports.filter((report) => report.device === device)
    if (reports.length === 0) continue
    merged.push({
      type: 'density',
      severity: 'info',
      viewports: reports.map((report) => report.label),
      text: `densidade por dispositivo (${device}): ${reports.map((report) => `${report.label}=${report.metrics.contentScreens} tela(s)/${report.metrics.interactiveVisible} interativos`).join(', ')}`,
    })
  }
  return merged
}

// ---------- main ----------

const targetRoot = resolve(process.cwd(), targetArg)
if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory()) {
  die(`responsive-report: ${targetArg}: alvo nao encontrado (esperado um design-root com canvas.json)`, 2)
}
const designRoot = designRootOf(targetRoot)

let screens = discoverScreens(designRoot)
if (screens.length === 0) {
  die(`responsive-report: nenhuma tela encontrada em ${targetArg} (canvas.json manifests) — nada a comparar`, 2)
}

// Preflight: every screen source must be structurally sound BEFORE any render.
for (const screen of screens) {
  assertScreenSource(screen, readFileSync(resolve(designRoot, screen.file), 'utf8'))
}

// Capture evidence (stale-state guard) before launching the browser.
const evidence = new Map()
for (const screen of screens) {
  evidence.set(screen.tela, captureEvidenceFor(designRoot, screen))
}

const gitSHA = gitShaOf(designRoot)
const outRoot = join(designRoot, OUT_DIR, REPORT_DIR)
console.log(`responsive-report: target ${targetArg} — ${screens.length} telas x ${VIEWPORTS.length} viewports (matriz do todo 9)`)
console.log(`responsive-report: captura ${join(targetArg, OUT_DIR)}/${MANIFEST_NAME} ok (PNGs presentes, screenHash atual)`)
console.log(`responsive-report: saida ${join(targetArg, OUT_DIR, REPORT_DIR)}/ (report-only, sem gate)`)

const workRoot = mkdtempSync(join(tmpdir(), 'responsive-report-'))
const workDesign = join(workRoot, 'design')
cpSync(designRoot, workDesign, { recursive: true })
// The example root is a design-system seed, not a full design/ root: its
// screens link ../mock.js / ../mock.css. Layer the runtime into the served
// copy when the design root does not ship it (visual-capture.mjs precedent).
for (const runtime of ['mock.js', 'mock.css']) {
  const runtimeSource = findSkillAsset(runtime)
  if (!existsSync(join(workDesign, runtime)) && runtimeSource !== null) {
    cpSync(runtimeSource, join(workDesign, runtime))
  }
}

let server = null
let browser = null
let guided = null
try {
  server = spawn(process.execPath, [SERVE_SCRIPT, '0', '--no-open'], {
    cwd: workRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('serve.mjs nao subiu em 10s (porta efemera?)')), 10_000)
    server.stdout.on('data', (chunk) => {
      const match = /URL: (http:\/\/[\d.]+:\d+)/.exec(String(chunk))
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
      }
    })
    server.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`serve.mjs saiu antes de subuir (exit ${code})`))
    })
  })
  console.log(`responsive-report: servindo copia em ${base} (porta efemera)`)

  browser = await chromium.launch({
    headless: true,
    args: ['--font-render-hinting=none', '--disable-lcd-text', '--disable-gpu'],
  })

  mkdirSync(outRoot, { recursive: true })
  for (const screen of screens) {
    const viewportReports = []
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
      let raw = null
      try {
        const response = await page.goto(`${base}/${screen.file}`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
        if (!response || !response.ok()) {
          throw new GuidedError(`responsive-report: tela ${screen.tela} (${screen.file}): falha ao carregar (HTTP ${response ? response.status() : 'sem resposta'}) em ${viewportLabel(viewport)}`, 2)
        }
        await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => {})
        await settle(page)
        const bodyOk = await page.evaluate(() => {
          const body = document.body
          return body !== null && (body.children.length > 0 || body.textContent.trim().length > 0)
        })
        if (!bodyOk) {
          throw new GuidedError(`responsive-report: tela ${screen.tela} (${screen.file}): renderizou body vazio em ${viewportLabel(viewport)}`, 2)
        }
        raw = await page.evaluate(measureInPage)
      } catch (error) {
        if (error instanceof GuidedError) throw error
        throw new GuidedError(`responsive-report: tela ${screen.tela} (${screen.file}): falha ao medir em ${viewportLabel(viewport)} — ${String(error?.message ?? error).split('\n')[0]}`, 2)
      } finally {
        await page.close().catch(() => {})
      }
      viewportReports.push(buildViewportReport(viewport, raw))
    }

    const capture = evidence.get(screen.tela)
    const doc = {
      schemaVersion: SCHEMA_VERSION,
      tool: 'responsive-report',
      target: targetArg,
      tela: screen.tela,
      canvas: screen.canvas,
      file: screen.file,
      gitSHA,
      generatedAt: new Date().toISOString(),
      capture: {
        manifest: `${OUT_DIR}/${MANIFEST_NAME}`,
        gitSHA: isPlainObject(capture.manifest) ? capture.manifest.gitSHA ?? null : null,
        viewports: VIEWPORTS.map(viewportLabel),
        pngs: capture.pngByViewport,
      },
      viewports: viewportReports,
      recommendations: buildScreenRecommendations(viewportReports),
    }
    const outPath = join(outRoot, `${screen.tela}.json`)
    writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`)
    const findingsCount = viewportReports.reduce((sum, report) => sum + report.findings.length, 0)
    console.log(`responsive-report: ok ${screen.tela} -> ${join(targetArg, OUT_DIR, REPORT_DIR, `${screen.tela}.json`)} (${findingsCount} findings, ${doc.recommendations.length} recomendacoes)`)
  }
} catch (error) {
  guided = error instanceof GuidedError
    ? error
    : new GuidedError(`responsive-report: falha inesperada — ${String(error?.message ?? error).split('\n')[0]}`, 2)
} finally {
  if (browser !== null) await browser.close().catch(() => {})
  if (server !== null) server.kill()
  rmSync(workRoot, { recursive: true, force: true })
}
if (guided !== null) die(guided.message, guided.code)

console.log(`responsive-report: ${screens.length} relatorio(s) em ${join(targetArg, OUT_DIR, REPORT_DIR)}/ — relatorio apenas, nenhum gate aplicado`)
process.exit(0)

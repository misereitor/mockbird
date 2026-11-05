#!/usr/bin/env node
/**
 * a11y-report.mjs — Accessibility Intelligence (plan todo 26, GAP-C5).
 *
 * Aggregates the project's OWN existing rules (never re-implements them):
 *   - template-contract  rules/a11y.mjs — IMPORTED ({ id, run } contract)
 *   - contrast           validate.mjs:326-421 semantics over tokens.json
 *                        contrastPairs, math IMPORTED from lib/contrast.mjs
 *                        (the shared extraction of validate.mjs:326-421)
 *   - focus-contract     scripts/mock-check.mjs:395-454 — EXECUTED (the
 *                        overlay focus trap / [data-autofocus] / ESC restore /
 *                        #mock-live suite), never copied
 * plus report-level screen checks (keyboard, focus-order, aria-live,
 * zoom-200, reduced-motion) and OPTIONAL axe-core behind --with-axe.
 *
 * Without --with-axe the report runs WITHOUT the external engines and
 * DECLARES the gap (misleading-success rule: absent automation is always
 * named in `gaps`, never implied covered). With --with-axe and axe-core not
 * installed the run dies with a guided install hint — an explicit request is
 * never silently downgraded.
 *
 * Target: WCAG 2.2 AA, REPORT MODE (audit-only): findings are printed and
 * written to <design-root>/.visual/a11y/report.json with the WCAG criterion
 * per finding; the exit code stays 0 unless --gate is given (opt-in gate —
 * no new blocking gate without an explicit decision).
 *
 * Exit codes: 0 = report written (audit-only or clean gate), 1 = --gate and
 * error/warn findings exist, 2 = usage or structural input error (unknown
 * arg, malformed screen HTML naming the screen, --with-axe without engine),
 * 5 = playwright-core missing (only required for the axe surface).
 *
 * Usage:
 *   node skills/design/scripts/a11y-report.mjs [--target <design-root>]
 *     [--with-axe] [--gate] [--help]
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseColorLiteral, contrastRatio } from './lib/contrast.mjs'
import { run as a11yTemplateRule } from './rules/a11y.mjs'

const OUT_DIR = '.visual'
const REPORT_DIR = 'a11y'
const SCHEMA_VERSION = 1
const LOAD_TIMEOUT_MS = 15_000
const LIST_CAP = 20
// Infra folders that can never hold canvases (agent-map.mjs SKIP_DIRS mirror).
const SKIP_DIRS = new Set(['node_modules', '.history', 'snapshots', 'vendor', 'scripts', 'spec', OUT_DIR])

const usage =
  'usage: node skills/design/scripts/a11y-report.mjs [--target <design-root>] [--with-axe] [--gate] [--help]'

/** Guided failure inside resource-holding sections: thrown so the serve/
 *  browser cleanup in `finally` runs before the process exits. */
class GuidedError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

// ---------- WCAG 2.2 criterion map (every finding cites one) ----------

const CRITERIA = {
  'contrast-insufficient': { criterion: null, name: null, level: null }, // minRatio decides 1.4.3 vs 1.4.11
  'contrast-invalid-pair': { criterion: '1.4.3', name: 'Contrast (Minimum)', level: 'AA' },
  'contrast-unresolvable': { criterion: '1.4.3', name: 'Contrast (Minimum)', level: 'AA' },
  'keyboard-unreachable': { criterion: '2.1.1', name: 'Keyboard', level: 'A' },
  'focus-order-positive-tabindex': { criterion: '2.4.3', name: 'Focus Order', level: 'A' },
  'aria-live-invalid-value': { criterion: '4.1.3', name: 'Status Messages', level: 'AA' },
  'zoom-disabled': { criterion: '1.4.4', name: 'Resize Text', level: 'AA' },
  'reduced-motion-unguarded': { criterion: '2.3.3', name: 'Animation from Interactions', level: 'AAA' },
  'a11y-no-autofocus': { criterion: '2.4.3', name: 'Focus Order', level: 'A' },
  'a11y-toast-no-live': { criterion: '4.1.3', name: 'Status Messages', level: 'AA' },
  'focus-contract-runtime-fail': { criterion: '2.4.3', name: 'Focus Order', level: 'A' },
}

function finding(code, { screen = null, element = null, severity = 'error', criterion = null, criterionName = null, level = null, detail }) {
  const mapped = CRITERIA[code] ?? {}
  return {
    code,
    screen,
    element,
    criterion: criterion ?? mapped.criterion ?? null,
    criterionName: criterionName ?? mapped.name ?? null,
    level: level ?? mapped.level ?? null,
    severity,
    detail,
  }
}

// ---------- args ----------

function die(message, code) {
  console.error(message)
  process.exit(code)
}

const argv = process.argv.slice(2)
let targetArg = 'design'
let withAxe = false
let gate = false
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
  } else if (token === '--with-axe') {
    withAxe = true
  } else if (token === '--gate') {
    gate = true
  } else {
    die(`unknown argument: ${token} — ${usage}`, 2)
  }
}

// ---------- discovery (agent-map.mjs conventions) ----------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function designRootOf(targetRoot) {
  return existsSync(join(targetRoot, 'canvas.json')) ? dirname(targetRoot) : targetRoot
}

function readCanvasManifest(path) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    die(`a11y-report: ${path}: canvas.json invalido (${String(error.message)})`, 2)
  }
  if (!isPlainObject(manifest)) die(`a11y-report: ${path}: a raiz deve ser um objeto`, 2)
  if (!Array.isArray(manifest.screens)) die(`a11y-report: ${path}: "screens" deve ser uma lista`, 2)
  return manifest
}

function discoverCanvases(root) {
  const canvases = []
  if (existsSync(join(root, 'canvas.json'))) {
    canvases.push({ dir: root, relDir: '.', manifest: readCanvasManifest(join(root, 'canvas.json')) })
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
        canvases.push({ dir: full, relDir: relative(root, full).split('\\').join('/'), manifest: readCanvasManifest(join(full, 'canvas.json')) })
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
        die(`a11y-report: ${canvas.relDir}/canvas.json: screen #${index + 1} precisa de "file"`, 2)
      }
      const fileRel = canvas.relDir === '.' ? entry.file : `${canvas.relDir}/${entry.file}`
      const abs = resolve(designRoot, fileRel)
      if (!existsSync(abs)) {
        die(`a11y-report: ${fileRel}: listado em ${canvas.relDir}/canvas.json mas ausente no disco`, 2)
      }
      const tela = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : basename(entry.file, extname(entry.file))
      const previous = seen.get(tela)
      if (previous !== undefined) {
        die(`a11y-report: tela duplicada "${tela}" (${previous} e ${fileRel})`, 2)
      }
      seen.set(tela, fileRel)
      screens.push({ tela, file: fileRel, canvas: canvas.relDir })
    }
  }
  return screens
}

/** Structural screen-source check BEFORE any analysis (visual-capture.mjs
 *  assertScreenSource): malformed HTML dies naming the screen. */
function assertScreenSource(screen, html) {
  const where = `tela ${screen.tela} (${screen.file})`
  const missing = []
  if (html.length === 0) die(`a11y-report: ${where}: HTML malformado — arquivo vazio`, 2)
  if (html.includes('\u0000')) die(`a11y-report: ${where}: HTML malformado — bytes NUL no conteudo`, 2)
  if (!/<html[\s>]/i.test(html)) missing.push('<html>')
  if (!/<body[\s>]/i.test(html)) missing.push('<body>')
  if (!/<\/html>/i.test(html)) missing.push('</html>')
  if (missing.length > 0) {
    die(`a11y-report: ${where}: HTML malformado — falta ${missing.join(', ')} (arquivo truncado?)`, 2)
  }
}

// ---------- static markup scan (comments/script/style consumed wholesale) ----------

const TAG_SCAN_RE =
  /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const TRIGGER_ATTRS = ['data-go', 'data-action', 'data-toast', 'data-overlay', 'data-close', 'onclick']
const MOTION_RE = /(?:^|[;{\s])(?:animation|transition|scroll-behavior)\s*:/m
const GUARD_RE = /prefers-reduced-motion/

function parseAttrs(blob) {
  const attrs = {}
  ATTR_RE.lastIndex = 0
  let match
  while ((match = ATTR_RE.exec(blob)) !== null) {
    const name = match[1].toLowerCase()
    if (!(name in attrs)) attrs[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

function elementSnippet(tag, attrs) {
  const shown = ['id', 'class', 'data-component', 'tabindex', 'role', 'href', 'type', 'aria-live']
    .filter((name) => name in attrs)
    .map((name) => `${name}="${String(attrs[name]).slice(0, 40)}"`)
    .join(' ')
  return `<${tag}${shown ? ` ${shown}` : ''}>`
}

function isNativelyFocusable(tag, attrs) {
  if (tag === 'a' || tag === 'area') return 'href' in attrs
  if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true
  if (tag === 'input') return (attrs.type ?? 'text').toLowerCase() !== 'hidden'
  return 'contenteditable' in attrs && attrs.contenteditable !== 'false'
}

/** Screen-level static checks: keyboard reachability (2.1.1), focus order
 *  (2.4.3), aria-live values (4.1.3) and zoom-blocking viewport meta (1.4.4). */
function scanScreen(screen, html) {
  const findings = []
  TAG_SCAN_RE.lastIndex = 0
  let match
  while ((match = TAG_SCAN_RE.exec(html)) !== null) {
    const tag = match[1]
    if (tag === undefined) continue
    const name = tag.toLowerCase()
    const attrs = parseAttrs(match[2] ?? '')
    const element = elementSnippet(name, attrs)
    const tabindexValue = 'tabindex' in attrs ? Number(attrs.tabindex) : NaN

    const isTrigger = TRIGGER_ATTRS.some((attr) => attr in attrs)
    if (isTrigger) {
      const tabbable = isNativelyFocusable(name, attrs) || (Number.isFinite(tabindexValue) && tabindexValue >= 0)
      if (!tabbable) {
        findings.push(
          finding('keyboard-unreachable', {
            screen: screen.tela,
            element,
            detail: `gatilho interativo (${TRIGGER_ATTRS.filter((attr) => attr in attrs).join(', ')}) fora da ordem de tabulacao — inacessivel por teclado`,
          }),
        )
      }
    }
    if (Number.isFinite(tabindexValue) && tabindexValue > 0) {
      findings.push(
        finding('focus-order-positive-tabindex', {
          screen: screen.tela,
          element,
          detail: `tabindex="${attrs.tabindex}" impoe ordem de foco explicita e quebra a ordem natural do documento`,
        }),
      )
    }
    if ('aria-live' in attrs) {
      const value = String(attrs['aria-live']).toLowerCase()
      if (!['polite', 'assertive', 'off'].includes(value)) {
        findings.push(
          finding('aria-live-invalid-value', {
            screen: screen.tela,
            element,
            detail: `aria-live="${attrs['aria-live']}" invalido (valores aceitos: polite, assertive, off)`,
          }),
        )
      }
    }
    if (name === 'meta' && String(attrs.name ?? '').toLowerCase() === 'viewport') {
      const content = String(attrs.content ?? '')
      if (/user-scalable\s*=\s*(no|0)/i.test(content) || /maximum-scale\s*=\s*1(?:\.0+)?(?![\d.])/i.test(content)) {
        findings.push(
          finding('zoom-disabled', {
            screen: screen.tela,
            element: `<meta name="viewport" content="${content.slice(0, 60)}">`,
            detail: 'meta viewport bloqueia zoom do usuario (user-scalable/maximum-scale)',
          }),
        )
      }
    }
  }
  return findings
}

// ---------- check: reduced-motion (target-wide CSS) ----------

function checkReducedMotion(designRoot, screens) {
  const sources = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.css')) sources.push({ where: relative(designRoot, full).split('\\').join('/'), text: readFileSync(full, 'utf8') })
    }
  }
  walk(designRoot)
  for (const screen of screens) {
    const html = readFileSync(resolve(designRoot, screen.file), 'utf8')
    for (const style of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []) {
      sources.push({ where: `${screen.file} (<style>)`, text: style })
    }
  }
  const motionFiles = sources.filter((source) => MOTION_RE.test(source.text))
  if (motionFiles.length === 0) {
    return { status: 'executed', note: 'sem animacoes/transicoes no CSS do alvo', findings: [] }
  }
  const guarded = sources.some((source) => GUARD_RE.test(source.text))
  if (guarded) {
    return { status: 'executed', note: `movimento em ${motionFiles.length} arquivo(s) com guarda @media (prefers-reduced-motion)`, findings: [] }
  }
  return {
    status: 'executed',
    note: null,
    findings: [
      finding('reduced-motion-unguarded', {
        severity: 'warn',
        detail: `CSS declara animacao/transicao sem guarda prefers-reduced-motion: ${motionFiles.slice(0, 3).map((source) => source.where).join(', ')}`,
      }),
    ],
  }
}

// ---------- check: contrast (validate.mjs:326-421 semantics, math via lib/contrast.mjs) ----------

const COLOR_LITERAL_RE = /^(?:#(?:[0-9a-fA-F]{3,8})|rgba?\()/i

function resolveThemeColor(theme, name) {
  if (!isPlainObject(theme)) return null
  let node = theme
  for (const part of String(name).split('.')) {
    if (!isPlainObject(node) || !(part in node)) return null
    node = node[part]
  }
  const value = isPlainObject(node) ? node.$value : undefined
  return typeof value === 'string' ? parseColorLiteral(value) : null
}

function checkContrast(designRoot) {
  let raw = null
  try {
    raw = readFileSync(join(designRoot, 'tokens.json'), 'utf8')
  } catch {
    return { status: 'skipped', note: 'tokens.json ausente no design-root', findings: [] }
  }
  let tokens = null
  try {
    tokens = JSON.parse(raw)
  } catch (error) {
    return { status: 'executed', note: null, findings: [finding('contrast-invalid-pair', { detail: `tokens.json invalido (${String(error.message)})` })] }
  }
  const pairs = tokens?.$extensions?.designPack?.contrastPairs
  if (!Array.isArray(pairs)) {
    return { status: 'skipped', note: 'tokens.json sem $extensions.designPack.contrastPairs declarados', findings: [] }
  }
  const themes = isPlainObject(tokens) ? Object.keys(tokens).filter((key) => !key.startsWith('$')) : []
  const findings = []
  for (const [index, pair] of pairs.entries()) {
    const where = `tokens.json: contrastPairs[${index}]`
    if (!isPlainObject(pair) || typeof pair.fg !== 'string' || typeof pair.bg !== 'string' || !(typeof pair.minRatio === 'number' && pair.minRatio > 0)) {
      findings.push(finding('contrast-invalid-pair', { detail: `${where}: must be { "fg": <color|token>, "bg": <color|token>, "minRatio": <number> }` }))
      continue
    }
    const fgLiteral = COLOR_LITERAL_RE.test(pair.fg.trim())
    const bgLiteral = COLOR_LITERAL_RE.test(pair.bg.trim())
    const criterion = pair.minRatio >= 4.5 ? '1.4.3' : '1.4.11'
    const criterionName = pair.minRatio >= 4.5 ? 'Contrast (Minimum)' : 'Non-text Contrast'
    const level = 'AA'
    const pairLabel = `${where} (fg "${pair.fg}" on bg "${pair.bg}")`
    const report = (scope, ratio) =>
      findings.push(
        finding('contrast-insufficient', {
          criterion,
          criterionName,
          level,
          detail: `${pairLabel}${scope}: ratio ${ratio.toFixed(2)} < minRatio ${pair.minRatio}`,
        }),
      )

    if (fgLiteral && bgLiteral) {
      const ratio = contrastRatio(parseColorLiteral(pair.fg), parseColorLiteral(pair.bg))
      if (ratio < pair.minRatio) report('', ratio) // literals: theme-independent
      continue
    }
    for (const themeName of themes) {
      const fg = fgLiteral ? parseColorLiteral(pair.fg) : resolveThemeColor(tokens[themeName], pair.fg)
      const bg = bgLiteral ? parseColorLiteral(pair.bg) : resolveThemeColor(tokens[themeName], pair.bg)
      if (!fg || !bg) {
        findings.push(
          finding('contrast-unresolvable', {
            detail: `${pairLabel} (theme "${themeName}"): cannot resolve ${!fg ? `fg "${pair.fg}"` : `bg "${pair.bg}"`} as a color`,
          }),
        )
        continue
      }
      const ratio = contrastRatio(fg, bg)
      if (ratio < pair.minRatio) report(` (theme "${themeName}")`, ratio)
    }
  }
  return { status: 'executed', note: `${pairs.length} par(es) de contraste verificados em ${themes.length} tema(s)`, findings }
}

// ---------- check: template-contract (rules/a11y.mjs — imported) ----------

function checkTemplateContract(designRoot) {
  const componentsDir = join(designRoot, 'components')
  if (!existsSync(componentsDir) || !statSync(componentsDir).isDirectory()) {
    return { status: 'skipped', note: 'components/ ausente — regra a11y de templates fora de escopo', findings: [] }
  }
  const failures = []
  a11yTemplateRule({
    rootDir: designRoot,
    relLabel: (root, full) => relative(root, full).split('\\').join('/'),
    fail: (code, message) => failures.push({ code, message }),
  })
  return {
    status: 'executed',
    note: 'rules/a11y.mjs sobre components/',
    findings: failures.map((failure) => finding(failure.code, { detail: failure.message })),
  }
}

// ---------- check: focus-contract (scripts/mock-check.mjs:395-454 — executed) ----------

const MOCK_CHECK = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'scripts', 'mock-check.mjs')

function checkFocusContract() {
  if (!existsSync(MOCK_CHECK)) {
    return {
      status: 'gap',
      note: null,
      findings: [],
      gap: 'contratos de foco/aria-live do runtime (scripts/mock-check.mjs:395-454) nao executados — script ausente neste layout',
    }
  }
  const result = spawnSync(process.execPath, [MOCK_CHECK], { encoding: 'utf8', timeout: 120_000 })
  const a11yLines = String(result.stdout ?? '')
    .split('\n')
    .filter((line) => line.includes('(a11y)'))
    .map((line) => line.trim())
  if (result.status === 0) {
    return { status: 'executed', note: a11yLines.join(' | '), findings: [] }
  }
  const firstError = String(result.stderr ?? '').split('\n').find((line) => line.trim().length > 0) ?? `exit ${result.status}`
  return {
    status: 'executed',
    note: a11yLines.join(' | '),
    findings: [
      finding('focus-contract-runtime-fail', {
        detail: `scripts/mock-check.mjs:395-454 falhou (${firstError}) — contrato de foco/aria-live do runtime mock.js quebrado`,
      }),
    ],
  }
}

// ---------- check: axe-core (optional, --with-axe) ----------

async function checkAxe(screens, designRoot) {
  const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
  let axeSource = null
  let axeVersion = null
  try {
    const axePath = requireFrom.resolve('axe-core')
    axeSource = readFileSync(axePath, 'utf8')
    const pkg = JSON.parse(readFileSync(join(dirname(axePath), 'package.json'), 'utf8'))
    axeVersion = typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    die('a11y-report: --with-axe solicitado mas axe-core nao esta instalado — rode "npm i --no-save axe-core" (ou remova --with-axe: a lacuna fica declarada no relatorio)', 2)
  }
  let chromium
  try {
    ;({ chromium } = requireFrom('playwright-core'))
  } catch {
    die('a11y-report: playwright-core nao encontrado — necessario para --with-axe; rode "npm i playwright-core"', 5)
  }

  const workRoot = mkdtempSync(join(tmpdir(), 'a11y-report-'))
  const workDesign = join(workRoot, 'design')
  cpSync(designRoot, workDesign, { recursive: true })
  for (const runtime of ['mock.js', 'mock.css']) {
    const runtimeSource = fileURLToPath(new URL(`../assets/${runtime}`, import.meta.url))
    if (!existsSync(join(workDesign, runtime)) && existsSync(runtimeSource)) {
      cpSync(runtimeSource, join(workDesign, runtime))
    }
  }
  const serveScript = fileURLToPath(new URL('../assets/serve.mjs', import.meta.url))

  const findings = []
  let violations = 0
  let server = null
  let browser = null
  try {
    server = spawn(process.execPath, [serveScript, '0', '--no-open'], {
      cwd: workRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const base = await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error('serve.mjs nao subiu em 10s')), 10_000)
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
    browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })
    for (const screen of screens) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      try {
        const response = await page.goto(`${base}/${screen.file}`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
        if (!response || !response.ok()) {
          throw new GuidedError(`a11y-report: tela ${screen.tela} (${screen.file}): falha ao carregar para axe (HTTP ${response ? response.status() : 'sem resposta'})`, 2)
        }
        await page.addScriptTag({ content: axeSource })
        const results = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ['violations'] }))
        for (const violation of results.violations ?? []) {
          violations += 1
          const wcagTag = (violation.tags ?? []).find((tag) => /^wcag\d\d\d$/.test(tag))
          const criterion = wcagTag ? `${wcagTag[4]}.${wcagTag.slice(5)}` : null
          const impact = violation.impact ?? 'minor'
          findings.push(
            finding(`axe-${violation.id}`, {
              screen: screen.tela,
              element: violation.nodes?.[0]?.target?.join(' ') ?? null,
              criterion,
              criterionName: violation.help ?? `axe-core rule ${violation.id}`,
              level: null,
              severity: impact === 'critical' || impact === 'serious' ? 'error' : impact === 'moderate' ? 'warn' : 'info',
              detail: `axe-core ${violation.id} (${impact}): ${violation.nodes?.length ?? 0} no(s)`,
            }),
          )
        }
      } finally {
        await page.close().catch(() => {})
      }
    }
  } finally {
    if (browser !== null) await browser.close().catch(() => {})
    if (server !== null) server.kill()
    rmSync(workRoot, { recursive: true, force: true })
  }
  return {
    status: 'executed',
    note: `axe-core${axeVersion ? ` v${axeVersion}` : ''} sobre ${screens.length} tela(s)`,
    findings,
    axeViolations: violations,
  }
}

// ---------- main ----------

const targetRoot = resolve(process.cwd(), targetArg)
if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory()) {
  die(`a11y-report: ${targetArg}: alvo nao encontrado (esperado um design-root com canvas.json)`, 2)
}
const designRoot = designRootOf(targetRoot)

const screens = discoverScreens(designRoot)
if (screens.length === 0) {
  die(`a11y-report: nenhuma tela encontrada em ${targetArg} (canvas.json manifests) — nada a auditar`, 2)
}
const screenSources = new Map()
for (const screen of screens) {
  const html = readFileSync(resolve(designRoot, screen.file), 'utf8')
  assertScreenSource(screen, html) // malformed HTML dies naming the screen
  screenSources.set(screen.tela, html)
}

console.log(`a11y-report: target ${targetArg} — ${screens.length} telas (WCAG 2.2 AA, modo relatorio audit-only)`)

// Screen-level static checks (keyboard, focus-order, aria-live, zoom-200).
const staticFindings = []
for (const screen of screens) {
  staticFindings.push(...scanScreen(screen, screenSources.get(screen.tela)))
}

const checks = []
const gaps = []

// 1. template-contract (rules/a11y.mjs — imported, not copied)
{
  const result = checkTemplateContract(designRoot)
  checks.push({
    id: 'template-contract',
    source: 'skills/design/scripts/rules/a11y.mjs (importado)',
    covers: 'templates de overlay declaram [data-autofocus]; templates de toast referenciam regiao viva (data-live/aria-live)',
    status: result.status,
    note: result.note,
    findings: result.findings,
  })
  if (result.gap !== undefined) gaps.push(result.gap)
}

// 2. contrast (validate.mjs:326-421 semantics; math imported from lib/contrast.mjs)
{
  const result = checkContrast(designRoot)
  checks.push({
    id: 'contrast',
    source: 'validate.mjs:326-421 (semantica de contrastPairs; math via lib/contrast.mjs)',
    covers: 'WCAG 1.4.3/1.4.11 — contrastPairs de tokens.json resolvidos em todos os temas',
    status: result.status,
    note: result.note,
    findings: result.findings,
  })
}

// 3. focus-contract (scripts/mock-check.mjs:395-454 — executed)
{
  const result = checkFocusContract()
  checks.push({
    id: 'focus-contract',
    source: 'scripts/mock-check.mjs:395-454 (executado — foco inicial [data-autofocus], trap de Tab, restauracao ESC/data-close, #mock-live polite)',
    covers: 'contratos de foco e aria-live do runtime mock.js',
    status: result.status,
    note: result.note,
    findings: result.findings,
  })
  if (result.gap !== undefined) gaps.push(result.gap)
}

// 4-7. screen-level static checks
{
  const groups = [
    ['keyboard', '2.1.1 Keyboard (A) — gatilhos interativos alcancaveis por teclado', 'keyboard-unreachable'],
    ['focus-order', '2.4.3 Focus Order (A) — ordem de foco segue a ordem do documento', 'focus-order-positive-tabindex'],
    ['aria-live', '4.1.3 Status Messages (AA) — valores de aria-live validos', 'aria-live-invalid-value'],
    ['zoom-200', '1.4.4 Resize Text (AA) — meta viewport nao bloqueia zoom 200%', 'zoom-disabled'],
  ]
  for (const [id, covers, code] of groups) {
    checks.push({
      id,
      source: 'analise estatica das telas (contrato foco/aria-live: scripts/mock-check.mjs:395-454)',
      covers,
      status: 'executed',
      note: `${screens.length} tela(s) verificadas`,
      findings: staticFindings.filter((item) => item.code === code),
    })
  }
}

// 8. reduced-motion (target-wide CSS)
{
  const result = checkReducedMotion(designRoot, screens)
  checks.push({
    id: 'reduced-motion',
    source: 'analise estatica do CSS do alvo',
    covers: '2.3.3 Animation from Interactions (AAA) — guarda @media (prefers-reduced-motion: reduce) quando ha movimento',
    status: result.status,
    note: result.note,
    findings: result.findings,
  })
}

// 9. axe-core (optional engine)
if (withAxe) {
  let result
  try {
    result = await checkAxe(screens, designRoot)
  } catch (error) {
    if (error instanceof GuidedError) die(error.message, error.code)
    die(`a11y-report: falha inesperada no axe — ${String(error?.message ?? error).split('\n')[0]}`, 2)
  }
  checks.push({
    id: 'axe',
    source: `axe-core opcional (--with-axe)${result.axeViolations !== undefined ? ` — ${result.axeViolations} violacao(oes)` : ''}`,
    covers: 'regras axe-core WCAG 2.x sobre o DOM renderizado',
    status: result.status,
    note: result.note,
    findings: result.findings,
  })
} else {
  checks.push({
    id: 'axe',
    source: 'axe-core/pa11y (opcionais)',
    covers: 'automacao externa de acessibilidade sobre o DOM renderizado',
    status: 'gap',
    note: null,
    findings: [],
  })
  gaps.push('axe-core/pa11y nao executados (rode com --with-axe apos "npm i --no-save axe-core") — automacao externa de a11y nao coberta por este relatorio')
}

// ---------- report + output ----------

const findingsFlat = checks.flatMap((check) => check.findings)
const byCriterion = {}
for (const item of findingsFlat) {
  const key = item.criterion ?? 'sem-criterio'
  byCriterion[key] = (byCriterion[key] ?? 0) + 1
}

const report = {
  schemaVersion: SCHEMA_VERSION,
  tool: 'a11y-report',
  target: targetArg,
  gitSHA: (() => {
    try {
      return spawnSync('git', ['-C', designRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? null
    } catch {
      return null
    }
  })(),
  generatedAt: new Date().toISOString(),
  wcag: { target: '2.2', level: 'AA', mode: 'report (audit-only)', gate: gate ? 'opt-in --gate ativo' : 'desativado (padrao audit-only)' },
  checks,
  gaps,
  summary: {
    screens: screens.map((screen) => screen.tela),
    checksExecuted: checks.filter((check) => check.status === 'executed').map((check) => check.id),
    checksSkipped: checks.filter((check) => check.status === 'skipped').map((check) => check.id),
    checksGap: checks.filter((check) => check.status === 'gap').map((check) => check.id),
    findings: findingsFlat.length,
    byCriterion,
  },
}

const outDir = join(designRoot, OUT_DIR, REPORT_DIR)
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'report.json')
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(`a11y-report: checks executados: ${report.summary.checksExecuted.join(', ')}`)
if (report.summary.checksSkipped.length > 0) {
  console.log(`a11y-report: checks pulados: ${report.summary.checksSkipped.join(', ')}`)
}
if (gaps.length > 0) {
  console.log(`a11y-report: lacunas: ${gaps.join(' | ')}`)
}
for (const item of findingsFlat) {
  const where = item.screen ? ` screen=${item.screen}` : ''
  const what = item.element ? ` ${item.element}` : ''
  const criterion = item.criterion ? ` — WCAG ${item.criterion}${item.criterionName ? ` ${item.criterionName}` : ''}` : ''
  console.log(`a11y-report: [${item.severity}] ${item.code}${where}${what}: ${item.detail}${criterion}`)
}
console.log(`a11y-report: ${findingsFlat.length} finding(s) — relatorio ${join(targetArg, OUT_DIR, REPORT_DIR, 'report.json')} (WCAG 2.2 AA, audit-only)`)

const gated = findingsFlat.filter((item) => item.severity === 'error' || item.severity === 'warn')
if (gate && gated.length > 0) {
  console.error(`a11y-report: --gate: ${gated.length} finding(s) error/warn — WCAG 2.2 AA nao atingido (criterios: ${[...new Set(gated.map((item) => item.criterion ?? 'sem-criterio'))].join(', ')})`)
  process.exit(1)
}
process.exit(0)

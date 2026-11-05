#!/usr/bin/env node
/**
 * visual-capture.mjs — the capture matrix (plan todo 9, GAP-A4/GAP-F1).
 *
 * Walks every screen of a target design root (canvas.json manifests — the
 * agent-map.mjs/export-spec.mjs discovery convention) and captures the frozen
 * matrix 5 viewports × 7 states per screen:
 *
 *   viewports: 1440x900, 1366x768, 768x1024, 390x844, 360x800
 *   states:    modal, dropdown, form-invalid, loading, empty, error, success
 *
 * (7 states, NO "default": the default render is already covered by the
 * smoke.mjs per-viewport baselines — the matrix adds the 7 states on top, so
 * PNGs = telas × 5 × 7. A base render is still captured per screen+viewport
 * as an UNSAVED reference whose hash labels state cells that carry no visual
 * difference from it — "(sem efeito visual)" in the manifest.)
 *
 * States are activated through the mock.js RUNTIME mechanisms (the plan
 * contract: atributo data-state / ação declarativa) — NEVER CSS hacks:
 *
 *   1. declarative scenario — `<canvas>/data.json` "scenarios" keys matched
 *      against the canonical state name (plus pt-BR/en aliases) and applied
 *      via `?scenario=<nome>` (mock.js loadData overrides);
 *   2. declarative actions — the single mock.js click router: [data-overlay]
 *      and canvas-relative screen links open a .mock-overlay layer
 *      (Mock.overlay), [data-toast] fires the success toast, the [role=menu]
 *      keyboard handler (mock.js handleMenuKey) drives the dropdown surface
 *      and the row it activates carries data-state="active" (the component
 *      state vocabulary);
 *   3. native form validation — the first <form> is filled with
 *      constraint-violating values and validated through the constraint API
 *      (checkValidity -> 'invalid' events, :invalid applies). The interactive
 *      validation bubble and the focus ring are deliberately NOT triggered:
 *      both raster-jitter at rounded corners across runs, and pngHash
 *      determinism is the acceptance gate.
 *
 * A state with no surface on a screen is captured as the settled base screen
 * and the manifest entry says so in `activation` (base states are honest
 * documentation, never a fake painted via CSS). A screen whose runtime
 * (window.Mock) is missing degrades every activation to base with a warning.
 *
 * Output (the design/.visual/ payload — migration-guide §3.1 WP-P1):
 *   <target>/.visual/<tela>/<viewport>__<estado>.png
 *   <target>/.visual/manifest.json — one entry per PNG:
 *     { canvas, screen, file, png, viewport, state, gitSHA, screenHash,
 *       pngHash, timestamp, platform, activation }
 *   screenHash = sha256 of the screen HTML (identifies the screen content),
 *   pngHash = sha256 of the PNG bytes (the determinism proof: two runs on the
 *   same machine MUST agree per tela+viewport+estado).
 *
 * Partial runs: --screen <tela> (repeatable) captures a subset of screens and
 * MERGES the manifest (captured cells are replaced, the rest are kept);
 * --viewport <WxH> (repeatable) narrows the viewport columns. A full run
 * (no filters) rewrites the manifest wholesale. The manifest is only written
 * when EVERY requested cell succeeded — a failed run never leaves a
 * half-updated manifest behind.
 *
 * Guards (misleading-success is a failure class here):
 *   - 0 screens found = exit 2 naming the target — NEVER "exit 0, 0 images";
 *   - the expected count (telas × viewports × estados) is printed before the
 *     run and asserted after it (written === expected or exit 1);
 *   - every screen source is structurally validated BEFORE the first pixel is
 *     captured (malformed HTML fails naming the screen; no PNG is emitted);
 *   - every PNG is IHDR-checked (non-empty, real dimensions) before it lands.
 *
 * Determinism: fresh incognito context per cell, animations disabled
 * (toast captures allow transitions and wait for their computed end state),
 * fonts.ready + double rAF settle, bounded loads. No network at runtime —
 * everything is served from a temp copy of the design root (the captured
 * screens are NEVER modified).
 *
 * Exit codes: 0 = matrix captured + manifest written, 1 = capture failure
 * (named screen/state; manifest untouched), 2 = usage or structural input
 * error (unknown --viewport/--screen, missing target, 0 screens), 5 =
 * playwright-core missing.
 *
 * Usage:
 *   node skills/design/scripts/visual-capture.mjs [--target <design-root>]
 *     [--screen <tela>]... [--viewport <WxH>]... [--help]
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

// ---------- frozen matrix (plan todo 9 — never configurable) ----------

const VIEWPORTS = Object.freeze([
  Object.freeze([1440, 900]),
  Object.freeze([1366, 768]),
  Object.freeze([768, 1024]),
  Object.freeze([390, 844]),
  Object.freeze([360, 800]),
])

const STATES = Object.freeze([
  'long-text',
  'modal',
  'dropdown',
  'form-invalid',
  'loading',
  'empty',
  'error',
  'success',
])

/** Canonical state -> declarative scenario aliases (data.json "scenarios"). */
const STATE_SCENARIO_ALIASES = Object.freeze({
  'long-text': ['long-text', 'longtext', 'texto-longo'],
  modal: ['modal', 'overlay', 'dialog'],
  dropdown: ['dropdown', 'menu', 'select'],
  'form-invalid': ['form-invalid', 'invalid', 'invalido', 'form-erro'],
  loading: ['loading', 'carregando', 'skeleton', 'carregando-dados'],
  empty: ['empty', 'vazio', 'sem-dados', 'lista-vazia', 'zero'],
  error: ['error', 'erro', 'critico', 'critical', 'falha', 'failure'],
  success: ['success', 'sucesso', 'ok', 'concluido', 'done'],
})

const OUT_DIR = '.visual'
const MANIFEST_NAME = 'manifest.json'
const SCHEMA_VERSION = 1
const LOAD_TIMEOUT_MS = 15_000
const ACTIVATION_TIMEOUT_MS = 2_500
const PNG_MIN_BYTES = 128
// Infra folders that can never hold canvases (agent-map.mjs SKIP_DIRS mirror).
const SKIP_DIRS = new Set(['node_modules', '.history', 'snapshots', 'vendor', 'scripts', 'spec', OUT_DIR])

const usage =
  'usage: node design/scripts/visual-capture.mjs [--target <design-root>] [--screen <tela>]... ' +
  '[--viewport <WxH>]... [--help]'

// ---------- args ----------

function die(message, code) {
  console.error(message)
  process.exit(code)
}

const argv = process.argv.slice(2)
let targetArg = 'design'
const screenFilters = []
const viewportFilters = []
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(usage)
    process.exit(0)
  } else if (token === '--target' || token === '--screen' || token === '--viewport') {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      die(`${token} requires a value — ${usage}`, 2)
    }
    if (token === '--target') targetArg = value
    else if (token === '--screen') screenFilters.push(value)
    else viewportFilters.push(value)
    i += 1
  } else {
    die(`unknown argument: ${token} — ${usage}`, 2)
  }
}

const viewportLabel = ([width, height]) => `${width}x${height}`
const MATRIX_VIEWPORT_LABELS = VIEWPORTS.map(viewportLabel)

for (const raw of viewportFilters) {
  const match = /^(\d+)x(\d+)$/.exec(raw)
  const ok = match !== null && VIEWPORTS.some(([w, h]) => w === Number(match[1]) && h === Number(match[2]))
  if (!ok) {
    die(
      `visual-capture: viewport invalido: "${raw}" — a matriz e ${MATRIX_VIEWPORT_LABELS.join(', ')}`,
      2,
    )
  }
}

// ---------- playwright-core (dynamic require — smoke.mjs pattern) ----------

const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
let chromium
try {
  ;({ chromium } = requireFrom('playwright-core'))
} catch {
  die('playwright-core nao encontrado — rode "npm i playwright-core" nesta pasta e tente de novo.', 5)
}

// ---------- target + screen discovery (agent-map.mjs conventions) ----------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The design root is the target root itself (project mode, `--target design/`)
 *  and one level up in canvas mode (root canvas.json) — designRootOf mirror. */
function designRootOf(targetRoot) {
  return existsSync(join(targetRoot, 'canvas.json')) ? dirname(targetRoot) : targetRoot
}

function readManifest(path) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    die(`visual-capture: ${path}: canvas.json invalido (${String(error.message)})`, 2)
  }
  if (!isPlainObject(manifest)) die(`visual-capture: ${path}: a raiz deve ser um objeto`, 2)
  if (!Array.isArray(manifest.screens)) die(`visual-capture: ${path}: "screens" deve ser uma lista`, 2)
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
        die(`visual-capture: ${canvas.relDir}/canvas.json: screen #${index + 1} precisa de "file"`, 2)
      }
      const fileRel = canvas.relDir === '.' ? entry.file : `${canvas.relDir}/${entry.file}`
      const abs = resolve(designRoot, fileRel)
      if (!existsSync(abs)) {
        die(`visual-capture: ${fileRel}: listado em ${canvas.relDir}/canvas.json mas ausente no disco`, 2)
      }
      const tela = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : basename(entry.file, extname(entry.file))
      const previous = seen.get(tela)
      if (previous !== undefined) {
        die(`visual-capture: tela duplicada "${tela}" (${previous} e ${fileRel}) — .visual/${tela}/ colidiria`, 2)
      }
      seen.set(tela, fileRel)
      screens.push({ tela, file: fileRel, canvas: canvas.relDir, canvasDir: canvas.dir, name: entry.name ?? tela })
    }
  }
  return screens
}

/** Structural screen-source check BEFORE any pixel: a truncated or garbage
 *  file must fail naming the screen — never render into an empty PNG. */
function assertScreenSource(screen, html) {
  const where = `tela ${screen.tela} (${screen.file})`
  const missing = []
  if (html.length === 0) die(`visual-capture: ${where}: HTML malformado — arquivo vazio`, 1)
  if (html.includes('\u0000')) die(`visual-capture: ${where}: HTML malformado — bytes NUL no conteudo`, 1)
  if (!/<html[\s>]/i.test(html)) missing.push('<html>')
  if (!/<body[\s>]/i.test(html)) missing.push('<body>')
  if (!/<\/html>/i.test(html)) missing.push('</html>')
  if (missing.length > 0) {
    die(`visual-capture: ${where}: HTML malformado — falta ${missing.join(', ')} (arquivo truncado?)`, 1)
  }
}

// ---------- mock.js runtime state resolution ----------

/** The declarative scenario (data.json "scenarios") that expresses a canonical
 *  state on this canvas, or null. Canonical name first, then pt-BR/en aliases. */
function scenarioForState(state, scenarioKeys) {
  const candidates = [state, ...(STATE_SCENARIO_ALIASES[state] ?? [])]
  for (const candidate of candidates) {
    const hit = scenarioKeys.find((key) => key.toLowerCase() === candidate)
    if (hit !== undefined) return hit
  }
  return null
}

function pseudoLocalize(value) {
  return String(value).replace(/[A-Za-zÀ-ÿ]+/g, (word) => `［${word.replace(/[aeiou]/gi, (v) => `${v}${v}`)}］`)
}

async function inspectI18n(page) {
  return page.evaluate((pseudo) => {
    const issues = []
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const text = element.textContent?.trim() ?? ''
      if (!text || rect.width === 0 || rect.height === 0) continue
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
        issues.push({ selector: element.id ? `#${element.id}` : element.className ? `.${String(element.className).trim().split(/\s+/)[0]}` : element.tagName.toLowerCase(), reason: 'overflow', text: text.slice(0, 120) })
      }
      if (style.whiteSpace === 'nowrap' && element.scrollWidth > rect.width + 1) issues.push({ selector: element.tagName.toLowerCase(), reason: 'nowrap-overflow', text: text.slice(0, 120) })
    }
    return { pseudoLocale: pseudo, issues }
  }, 'de-DE-pseudo')
}

function scenarioKeysOf(canvasDir) {
  const dataPath = join(canvasDir, 'data.json')
  if (!existsSync(dataPath)) return []
  try {
    const data = JSON.parse(readFileSync(dataPath, 'utf8'))
    const scenarios = data?.scenarios
    return isPlainObject(scenarios) ? Object.keys(scenarios) : []
  } catch {
    return [] // validate.mjs reports malformed data.json; capture degrades to base
  }
}

// ---------- in-page activations (mock.js runtime mechanisms only) ----------

// Each snippet runs through the mock.js surfaces: the single data-* click
// router, the Mock.overlay screen-link router, the [role=menu] keyboard
// handler and native form validation. window.Mock must exist — without the
// runtime a click would NAVIGATE instead of overlaying, so activation is
// skipped entirely (documented in `activation`).

const ACTIVATE_SNIPPETS = {
  modal: () => {
    const trigger = document.querySelector('[data-overlay]')
    if (trigger) {
      trigger.click()
      return 'data-overlay'
    }
    const link = [...document.querySelectorAll('a[href]')].find((a) => {
      if (['data-go', 'data-overlay', 'data-toast', 'data-close', 'data-action'].some((attr) => a.hasAttribute(attr))) return false
      if (a.hasAttribute('download')) return false
      const frame = a.getAttribute('target')
      if (frame && frame !== '_self') return false
      const href = a.getAttribute('href') || ''
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return false
      const file = href.split(/[?#]/)[0]
      return /\.html?$/i.test(file) && !file.includes('/') && !file.includes('\\')
    })
    if (link) {
      link.click()
      return `screen-link:${link.getAttribute('href')}`
    }
    return null
  },
  dropdown: () => {
    const opener = document.querySelector('[aria-controls]')
    if (opener) {
      opener.click()
      return `aria-controls:${opener.getAttribute('aria-controls') || ''}`
    }
    const toggle = document.querySelector('[data-menu]')
    if (toggle) {
      toggle.click()
      return 'data-menu'
    }
    const menu = document.querySelector('[role="menu"], [data-menu]')
    const rows = [...document.querySelectorAll('[role="menuitem"], [data-component="menu-row"]')]
    if (menu || rows.length > 0) {
      const surface = menu || rows[0].parentElement
      const first = rows[0]
      if (first && first.matches('a[href], button, input, select, textarea, [tabindex]')) first.focus()
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      // the runtime handler activates the first row; express it through the
      // component's data-state vocabulary (menu-row: default/active/disabled)
      if (first) first.setAttribute('data-state', 'active')
      return 'menu-keyboard+data-state=active'
    }
    return null
  },
  'form-invalid': () => {
    const form = document.querySelector('form')
    if (!form) return null
    let touched = 0
    for (const el of form.querySelectorAll('input, textarea, select')) {
      if (el.tagName === 'SELECT') {
        if (el.required) {
          el.selectedIndex = -1
          el.dispatchEvent(new Event('change', { bubbles: true }))
          touched += 1
        }
        continue
      }
      const type = (el.type || 'text').toLowerCase()
      if (['hidden', 'submit', 'button', 'reset', 'file', 'image', 'checkbox', 'radio'].includes(type)) continue
      let value = null
      if (type === 'email') value = 'invalido@'
      else if (type === 'number') value = el.min !== '' && el.min !== undefined ? String(Number(el.min) - 1) : '-1'
      else if (type === 'url') value = 'nao-e-url'
      else if (el.pattern) value = '###'
      else if (el.minLength > 0) value = 'a'
      else if (el.required) value = ''
      if (value === null) continue
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      touched += 1
    }
    if (touched === 0) return null
    const invalid = !form.checkValidity() // fires 'invalid' events; :invalid applies
    // Deliberately no interactive validation and no focus(): the browser
    // bubble and the focus outline both raster-jitter at their rounded corners
    // across runs (px delta <= 3, observed on this corpus), and pngHash
    // equality is the acceptance gate. The invalid VALUES + :invalid state are
    // the captured visual contract of form-invalid.
    return invalid ? 'form:invalid' : 'form:sem-restricoes'
  },
  success: () => {
    const trigger = document.querySelector('[data-toast]')
    if (trigger) {
      trigger.click()
      return 'data-toast'
    }
    return null
  },
}

// ---------- capture plumbing ----------

function findSkillAsset(name) {
  for (const rel of [`../assets/${name}`, `../${name}`]) {
    const full = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(full)) return full
  }
  return null
}

const SERVE_SCRIPT = findSkillAsset('serve.mjs')
if (SERVE_SCRIPT === null) {
  die('visual-capture: serve.mjs nao encontrado (checked ../assets/serve.mjs and ../serve.mjs)', 3)
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** PNG sanity (never store an empty capture): signature + IHDR dimensions. */
function assertPng(png, where) {
  if (png.length <= PNG_MIN_BYTES) {
    die(`visual-capture: ${where}: PNG vazio (${png.length} bytes) — captura abortada`, 1)
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!png.subarray(0, 8).equals(signature)) {
    die(`visual-capture: ${where}: PNG invalido (assinatura) — captura abortada`, 1)
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1 || height < 1) {
    die(`visual-capture: ${where}: PNG invalido (dimensoes ${width}x${height}) — captura abortada`, 1)
  }
  return { width, height }
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

/** Screenshot policy: animations "disabled" freezes infinite animations and
 *  cuts transitions at their deterministic end frame; transition-driven
 *  surfaces (the toast) capture with "allow" AFTER waiting for the computed
 *  end state, so the frame is stable at opacity 1 on every run. */
async function captureCell(page, screen, url, state, scenario) {
  const where = `${screen.tela} ${state}`
  const response = await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
  if (!response || !response.ok()) {
    return { failure: `load failed (HTTP ${response ? response.status() : 'sem resposta'}) em ${url.replace(/^https?:\/\/[\d.]+:\d+/, '')}` }
  }
  await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => {})
  await settle(page)

  const hasRuntime = await page.evaluate(() => typeof window.Mock === 'object' && window.Mock !== null)
  let activation = 'base'
  let toastMode = false
  let failure = null

  if (scenario !== null) {
    activation = `scenario:${scenario}`
  } else if (state !== 'default') {
    if (!hasRuntime) {
      activation = 'base (mock.js ausente)'
    } else {
      const snippet = ACTIVATE_SNIPPETS[state]
      const activated = snippet ? await page.evaluate(snippet) : null
      if (activated === null) {
        activation = 'base (sem superficie declarada)'
      } else if (state === 'modal') {
        const layer = await page.waitForSelector('.mock-overlay', { timeout: ACTIVATION_TIMEOUT_MS }).catch(() => null)
        if (layer === null) {
          activation = `base (${activated} nao abriu overlay)`
          await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS }) // back to a pristine base
          await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => {})
        } else {
          activation = `overlay:${activated}`
        }
      } else if (state === 'success' && activated === 'data-toast') {
        activation = 'data-toast'
        toastMode = true
        await page
          .waitForFunction(
            () => {
              const el = document.getElementById('mock-toast')
              return el !== null && getComputedStyle(el).opacity === '1'
            },
            { timeout: ACTIVATION_TIMEOUT_MS },
          )
          .catch(() => {})
      } else {
        activation = activated
      }
      await settle(page)
    }
  }

  if (failure === null) {
    const bodyOk = await page.evaluate(() => {
      const body = document.body
      return body !== null && (body.children.length > 0 || body.textContent.trim().length > 0)
    })
    if (!bodyOk) failure = 'renderizou body vazio'
  }
  if (failure !== null) return { failure, activation }

  const png = await page.screenshot({ fullPage: true, animations: toastMode ? 'allow' : 'disabled', caret: 'hide' })
  assertPng(png, where)
  return { png, activation }
}

// ---------- manifest ----------

function entryKey(entry) {
  return `${entry.screen}|${entry.viewport}|${entry.state}`
}

function loadManifest(outRoot) {
  const manifestPath = join(outRoot, MANIFEST_NAME)
  if (!existsSync(manifestPath)) return new Map()
  try {
    const doc = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const entries = Array.isArray(doc?.images) ? doc.images : []
    const map = new Map()
    for (const entry of entries) {
      if (isPlainObject(entry)) map.set(entryKey(entry), entry)
    }
    return map
  } catch {
    return new Map() // a corrupt manifest is replaced wholesale on the next full run
  }
}

function writeManifest(outRoot, merged, screens, viewports, states, gitSHA, expectedImages) {
  const order = new Map()
  let rank = 0
  for (const screen of screens) {
    for (const viewport of viewports) {
      for (const state of states) {
        order.set(`${screen.tela}|${viewportLabel(viewport)}|${state}`, rank)
        rank += 1
      }
    }
  }
  const images = [...merged.values()].sort((a, b) => (order.get(entryKey(a)) ?? 1e9) - (order.get(entryKey(b)) ?? 1e9))
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    tool: 'visual-capture',
    target: targetArg,
    gitSHA,
    platform: process.platform,
    generatedAt: new Date().toISOString(),
    viewports: viewports.map(viewportLabel),
    states,
    expectedImages,
    images,
  }
  writeFileSync(join(outRoot, MANIFEST_NAME), `${JSON.stringify(doc, null, 2)}\n`)
  return images.length
}

// ---------- main ----------

const targetRoot = resolve(process.cwd(), targetArg)
if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory()) {
  die(`visual-capture: ${targetArg}: alvo nao encontrado (esperado um design-root com canvas.json)`, 2)
}
const designRoot = designRootOf(targetRoot)

let screens = discoverScreens(designRoot)
if (screens.length === 0) {
  die(`visual-capture: nenhuma tela encontrada em ${targetArg} (canvas.json manifests) — nada a capturar`, 2)
}

if (screenFilters.length > 0) {
  const wanted = new Set(screenFilters)
  const matched = screens.filter((screen) => wanted.has(screen.tela) || wanted.has(screen.file) || wanted.has(basename(screen.file, extname(screen.file))))
  for (const filter of screenFilters) {
    if (!matched.some((screen) => screen.tela === filter || screen.file === filter || basename(screen.file, extname(screen.file)) === filter)) {
      const available = screens.map((screen) => screen.tela).join(', ')
      die(`visual-capture: tela desconhecida: "${filter}" — telas disponiveis: ${available}`, 2)
    }
  }
  screens = matched
}

const viewports = viewportFilters.length > 0
  ? VIEWPORTS.filter(([w, h]) => viewportFilters.includes(`${w}x${h}`))
  : VIEWPORTS

// Preflight: every requested screen source must be structurally sound BEFORE
// the first pixel (a corrupted screen fails naming itself; no PNG emitted).
for (const screen of screens) {
  assertScreenSource(screen, readFileSync(resolve(designRoot, screen.file), 'utf8'))
}

const expectedImages = screens.length * viewports.length * STATES.length
const outRoot = join(designRoot, OUT_DIR)
const gitSHA = gitShaOf(designRoot)

console.log(`visual-capture: target ${targetArg} (design root ${relative(process.cwd(), designRoot) || '.'})`)
console.log(`visual-capture: ${screens.length} telas x ${viewports.length} viewports x ${STATES.length} estados = ${expectedImages} PNGs esperados`)
console.log(`visual-capture: saida ${join(targetArg, OUT_DIR)} (gitSHA ${gitSHA ?? 'sem git'})`)

// Scenario resolution per canvas (declarative data states).
const scenarioKeysByCanvas = new Map()
for (const screen of screens) {
  if (!scenarioKeysByCanvas.has(screen.canvasDir)) scenarioKeysByCanvas.set(screen.canvasDir, scenarioKeysOf(screen.canvasDir))
}

const workRoot = mkdtempSync(join(tmpdir(), 'visual-capture-'))
const workDesign = join(workRoot, 'design')
cpSync(designRoot, workDesign, { recursive: true })
// The example root is a design-system seed, not a full design/ root: its
// screens link ../mock.js / ../mock.css. Layer the runtime into the served
// copy when the design root does not ship it (smoke.mjs precedent).
for (const runtime of ['mock.js', 'mock.css']) {
  const runtimeSource = findSkillAsset(runtime)
  if (!existsSync(join(workDesign, runtime)) && runtimeSource !== null) {
    cpSync(runtimeSource, join(workDesign, runtime))
  }
}

let server = null
let browser = null
const failures = []
const captured = new Map() // entryKey -> manifest entry
const defaultHashes = new Map() // `${tela}|${viewport}` -> pngHash of the unsaved base reference
let written = 0
let activatedCount = 0

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
  console.log(`visual-capture: servindo copia em ${base} (porta efemera)`)

  browser = await chromium.launch({
    executablePath: existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
      ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      : undefined,
    headless: true,
    // Deterministic raster: grayscale text AA, no Skia runtime opts, fixed
    // color profile — rounded-corner AA jitter (px delta <= 3 observed on
    // focus outlines) breaks the pngHash equality the manifest promises.
    args: ['--font-render-hinting=none', '--disable-lcd-text', '--disable-skia-runtime-opts', '--force-color-profile=srgb', '--disable-gpu'],
  })

  for (const screen of screens) {
    const scenarioKeys = scenarioKeysByCanvas.get(screen.canvasDir)
    for (const [width, height] of viewports) {
      const viewport = viewportLabel([width, height])
      // Unsaved base reference (the "default" render the smoke baselines own):
      // its hash only annotates state cells byte-identical to the settled base
      // screen. A broken screen fails the same way in the state cells below.
      try {
        const refPage = await browser.newPage({ viewport: { width, height } })
        const ref = await captureCell(refPage, screen, `${base}/${screen.file}`, 'default', null)
        if (ref.png) defaultHashes.set(`${screen.tela}|${viewport}`, sha256(ref.png))
        await refPage.close().catch(() => {})
      } catch {
        /* annotation degrades; the state cells below fail loudly */
      }
      for (const state of STATES) {
        const where = `${screen.tela} ${viewport}__${state}`
        const page = await browser.newPage({ viewport: { width, height } })
        const errors = []
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
        page.on('console', (message) => {
          if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
            errors.push(`console.error: ${message.text()}`)
          }
        })
        let result
        try {
          const scenario = scenarioForState(state, scenarioKeys)
          const url = `${base}/${screen.file}${scenario ? `?scenario=${encodeURIComponent(scenario)}` : ''}`
          result = await captureCell(page, screen, url, state, scenario)
        } catch (error) {
          result = { failure: String(error?.message ?? error).split('\n')[0] }
        }
        await page.close().catch(() => {})
        if (result.failure === undefined && errors.length > 0) result.failure = errors.join(' | ')
        if (result.failure !== undefined) {
          failures.push(`${where} — ${result.failure}`)
          console.log(`visual-capture: FAIL ${where} — ${result.failure}`)
          continue
        }
        const pngRel = `${OUT_DIR}/${screen.tela}/${viewport}__${state}.png`
        mkdirSync(join(outRoot, screen.tela), { recursive: true })
        writeFileSync(join(designRoot, pngRel), result.png)
        written += 1
        if (!result.activation.startsWith('base')) activatedCount += 1
        const pngHash = sha256(result.png)
        // A state capture byte-identical to the base reference carries no
        // visual evidence of its activation — say so instead of implying one.
        const cellKey = `${screen.tela}|${viewport}`
        let activation = result.activation
        if (defaultHashes.has(cellKey) && defaultHashes.get(cellKey) === pngHash) {
          activation += ' (sem efeito visual)'
        }
        const entry = {
          canvas: screen.canvas,
          screen: screen.tela,
          file: screen.file,
          png: pngRel,
          viewport,
          state,
          gitSHA,
          screenHash: sha256(readFileSync(resolve(designRoot, screen.file))),
          pngHash,
          timestamp: new Date().toISOString(),
          platform: process.platform,
          activation,
        }
        captured.set(entryKey(entry), entry)
        console.log(`visual-capture: ok ${where} [${result.activation}]`)
      }
    }
  }
} finally {
  if (browser !== null) await browser.close().catch(() => {})
  if (server !== null) server.kill()
  rmSync(workRoot, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`visual-capture: ${failures.length} captura(s) falharam — manifesto nao atualizado:`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

// Misleading-success guard: the written count must equal the printed
// expectation — "exit 0, 0 imagens" can never pass for a capture run.
if (written !== expectedImages) {
  die(`visual-capture: contagem inconsistente — ${written} PNGs escritos, ${expectedImages} esperados`, 1)
}

const merged = loadManifest(outRoot)
for (const [key, entry] of captured) merged.set(key, entry)
const total = writeManifest(outRoot, merged, screens, viewports, STATES, gitSHA, expectedImages)

console.log(`visual-capture: ${written}/${expectedImages} PNGs em ${join(targetArg, OUT_DIR)}`)
console.log(`visual-capture: ${activatedCount}/${expectedImages} celulas com estado ativado via runtime mock.js (resto em base)`)
console.log(`visual-capture: manifest ${join(targetArg, OUT_DIR, MANIFEST_NAME)} — ${total} entradas`)
process.exit(0)

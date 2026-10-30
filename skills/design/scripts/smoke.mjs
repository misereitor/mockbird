#!/usr/bin/env node
/**
 * Smoke v2 for the design skill (plan todo 17, GAP-6): renders every screen
 * of a design root in emulated device contexts and asserts the plan contract
 * per screen x viewport — then freezes/compares pixel snapshots.
 *
 * Usage: node design/scripts/smoke.mjs [--config <path>] [--design <path>]
 *          [--all-devices] [--update-snapshots] [--print-viewport]
 *   --config            explicit validate.config.json path
 *   --design            design root whose screens are smoke-tested (default ./design)
 *   --all-devices       cross-check the emulated pairs (config smoke.viewports,
 *                       e.g. 390x844 & 375x667) for every `device: mobile`
 *                       screen; tablet/desktop screens run ONLY their derived
 *                       viewport (never a mobile pair)
 *   --update-snapshots  the ONLY declared baseline regeneration path (the
 *                       --update-metrics analogue): overwrite the snapshot
 *                       baselines of runs that pass every non-snapshot assert
 *   --print-viewport    print per-screen viewport JSON (screen id -> {width,height})
 *                       derived from each canvas.json via lib/viewport.mjs
 *                       (deriveViewport — the SINGLE viewport truth, todo 16)
 *                       and exit; no browser, no snapshots
 *
 * Viewports are NEVER hardcoded: every screen runs at deriveViewport(canvas.json)
 * (lib/viewport.mjs, todo 16) and the emulated pairs come from
 * config.smoke.viewports. Mobile screens ALWAYS run in a playwright-core
 * `devices[...]` emulation (device descriptor + viewport override) — NEVER the
 * physical window (the ~504px headless minimum makes an unemulated "mobile"
 * capture false, plan §13.2); tablet/desktop screens run a plain desktop
 * context at their derived viewport.
 *
 * Screens come from <canvas>/canvas.json manifests (the metrics census
 * convention): canvases are the top-level dirs of the design root minus
 * config.exemptDirs. A listed screen file missing on disk fails the run
 * (exit 1) naming the screen — a manifest that lies about its files is a
 * characterization failure.
 *
 * Per screen x viewport the run asserts, in order:
 *   1. no horizontal scroll — document.scrollingElement.scrollWidth <=
 *      window.innerWidth + 1px (on mobile emulation the layout viewport
 *      EXPANDS with overflowing content, so the reference is the narrower of
 *      innerWidth and documentElement.clientWidth — the meta-pinned layout
 *      width; see the probe note at the assert);
 *   2. the applied viewport IS the requested one — page.viewportSize() must
 *      match the run dimensions (plan §13.2 criterion 5: the ~504px minimum
 *      must fail loudly, never silently);
 *   3. zero console.error / pageerror while loading ("Failed to load
 *      resource" is filtered out — the scripts/viewer-accept.mjs precedent);
 *   4. loads bounded by the declared config.smoke.timeoutMs — a violation
 *      cites the declared timeout;
 *   5. a PNG snapshot at <design>/snapshots/<tela>-<w>x<h>.png compared
 *      pixel-by-pixel against the baseline with maxDiffPixelRatio =
 *      config.smoke.snapshotThreshold (declared in config — NEVER implicit;
 *      threshold.json + a deterministic manifest.json listing every
 *      screen x viewport with its assert results are written when the whole
 *      run is green). The manifest write is NON-REGRESSIVE (todo 28): entries
 *      are merged by (canvas, file, viewport) into any existing manifest, so
 *      a plain run (derived viewport only) updates its own entries and never
 *      rewrites the committed --all-devices manifest down to a subset.
 *
 * Baseline semantics: a missing baseline PNG is WRITTEN (first run); an
 * existing one is COMPARED and NEVER overwritten — the baseline is a freeze.
 * Regeneration is ONLY the declared --update-snapshots path. The exact diff
 * is printed per run; the freeze is the run with every diff at 0.
 *
 * [v1 -> v2] the v1 capture window (1600x1000 hardcoded) and <tela>.png
 * naming are superseded by plan mandate: snapshots are <tela>-<w>x<h>.png per
 * derived/emulated viewport.
 *
 * The served root is a throwaway COPY of the design root (serve.mjs writes
 * design/.history while it runs; the repo tree must stay clean), served by
 * serve.mjs on an ephemeral port (port 0) — resolved through the two-layout
 * findSkillAsset fallback (skills/design/assets/serve.mjs in the repo layout,
 * <design>/serve.mjs in the installed payload). When the design root does not
 * ship the mock runtime (example/ is a seed), mock.js/mock.css are layered
 * into the copy — the scripts/viewer-accept.mjs precedent.
 *
 * Requires playwright-core (devDependency) — dynamic require from the CWD,
 * the scripts/viewer-accept.mjs pattern: missing -> exit 5 with the guided
 * install command. Args are parsed BEFORE the require, so an invalid argument
 * without playwright-core installed exits 2 (usage) — documented todo-16
 * reorder. The browser engine is Playwright's own
 * (`npx playwright-core install chromium`).
 *
 * Exit codes: 0 = green (baseline written or diff within maxDiffPixelRatio),
 *   1 = smoke failure (screen missing on disk, viewport derivation failure,
 *   load error, timeout, console.error/pageerror, viewport mismatch,
 *   horizontal scroll, pixel diff over maxDiffPixelRatio),
 *   2 = bad usage / wrong-shape config key, 3 = missing/broken config or
 *   payload (guided: run setup-design.mjs), 5 = playwright-core absent.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { deriveViewport } from './lib/viewport.mjs'

// ---------- args ----------

const usage = 'usage: node design/scripts/smoke.mjs [--config <path>] [--design <path>] [--all-devices] [--update-snapshots] [--print-viewport]'
const argv = process.argv.slice(2)
let configArg = null
let designArg = './design'
let printViewport = false
let allDevices = false
let updateSnapshots = false
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--print-viewport') {
    printViewport = true
  } else if (token === '--all-devices') {
    allDevices = true
  } else if (token === '--update-snapshots') {
    updateSnapshots = true
  } else if (token === '--config' || token === '--design') {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      console.error(`${token} requires a path — ${usage}`)
      process.exit(2)
    }
    if (token === '--config') configArg = value
    else designArg = value
    i += 1
  } else {
    console.error(`unknown argument: ${token} — ${usage}`)
    process.exit(2)
  }
}
if (printViewport && (allDevices || updateSnapshots)) {
  console.error(`--print-viewport cannot be combined with --all-devices/--update-snapshots — ${usage}`)
  process.exit(2)
}

// ---------- playwright-core (dynamic require — viewer-accept.mjs pattern) ----------
// --print-viewport derives JSON from canvas.json only: no browser needed there.

const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
let chromium
let devices
if (!printViewport) {
  try {
    ;({ chromium, devices } = requireFrom('playwright-core'))
  } catch {
    console.error('playwright-core nao encontrado — rode "npm i playwright-core" nesta pasta e tente de novo.')
    process.exit(5)
  }
}

// ---------- config (validate.mjs discovery chain) ----------
//   --config <path> -> validate.config.json in the design root -> in the CWD
// Absent = exit 3 with guided setup — NEVER a silent fallback to hardcoded
// values. Wrong-shape keys consumed here = exit 2 (config integrity).

const CONFIG_NAME = 'validate.config.json'
const CONFIG_SEED_HINT = `run setup-design.mjs to seed it (or copy skills/design/assets/${CONFIG_NAME} from the skill folder)`

function configFatal(message, code) {
  console.error(message)
  process.exit(code)
}

function loadConfig() {
  let configPath = null
  if (configArg !== null) {
    if (!existsSync(configArg)) {
      configFatal(`${configArg}: ${CONFIG_NAME} not found — ${CONFIG_SEED_HINT}`, 3)
    }
    configPath = configArg
  } else {
    const candidates = [join(resolve(process.cwd(), designArg), CONFIG_NAME), join(process.cwd(), CONFIG_NAME)]
    configPath = candidates.find((candidate) => existsSync(candidate)) ?? null
    if (configPath === null) {
      configFatal(`${CONFIG_NAME} not found (checked ${candidates[0]} and ${candidates[1]}) — ${CONFIG_SEED_HINT}`, 3)
    }
  }
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') configFatal(`${configPath}: ${CONFIG_NAME} not found — ${CONFIG_SEED_HINT}`, 3)
    configFatal(`${configPath}: cannot read ${CONFIG_NAME} (or invalid JSON) — ${CONFIG_SEED_HINT}`, 3)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    configFatal(`${configPath}: ${CONFIG_NAME} must have a JSON object at its root`, 2)
  }
  const exemptDirsValue = parsed.exemptDirs
  if (!Array.isArray(exemptDirsValue) || exemptDirsValue.some((item) => typeof item !== 'string')) {
    configFatal(`${configPath}: ${CONFIG_NAME}: "exemptDirs" must be a list of strings`, 2)
  }
  const smoke = parsed.smoke
  if (smoke === null || typeof smoke !== 'object' || Array.isArray(smoke)) {
    configFatal(`${configPath}: ${CONFIG_NAME}: "smoke" must be a JSON object`, 2)
  }
  const { timeoutMs, snapshotThreshold, viewports } = smoke
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    configFatal(`${configPath}: ${CONFIG_NAME}: smoke.timeoutMs must be a positive integer`, 2)
  }
  if (typeof snapshotThreshold !== 'number' || !(snapshotThreshold >= 0 && snapshotThreshold <= 1)) {
    configFatal(`${configPath}: ${CONFIG_NAME}: smoke.snapshotThreshold must be a number in [0, 1]`, 2)
  }
  if (
    !Array.isArray(viewports) ||
    viewports.length === 0 ||
    viewports.some(
      (pair) => !Array.isArray(pair) || pair.length !== 2 || pair.some((value) => !Number.isInteger(value) || value < 1),
    )
  ) {
    configFatal(
      `${configPath}: ${CONFIG_NAME}: smoke.viewports must be a non-empty list of [width, height] pairs of positive integers`,
      2,
    )
  }
  return {
    configPath,
    raw: parsed,
    exemptDirs: new Set(exemptDirsValue),
    timeoutMs,
    snapshotThreshold,
    viewports: viewports.map(([width, height]) => ({ width, height })),
  }
}

/** canvasMeta.breakpoints — consumed by deriveViewport (config-driven, NEVER
 *  hardcoded). Wrong shape = exit 2 (config integrity), same guided line the
 *  v1 --print-viewport path used. */
function requireBreakpoints() {
  const breakpoints = config.raw?.canvasMeta?.breakpoints
  if (
    breakpoints === null ||
    typeof breakpoints !== 'object' ||
    Array.isArray(breakpoints) ||
    !Number.isFinite(breakpoints.mobileMax) ||
    !Number.isFinite(breakpoints.tabletMax) ||
    !(breakpoints.mobileMax < breakpoints.tabletMax)
  ) {
    configFatal(
      `${config.configPath}: ${CONFIG_NAME}: "canvasMeta.breakpoints" must be { "mobileMax": <number>, "tabletMax": <number> } with mobileMax < tabletMax`,
      2,
    )
  }
  return breakpoints
}

const config = loadConfig()

// ---------- screen discovery (canvas.json manifests) ----------

function discoverScreens(rootDir, exemptDirs) {
  const problems = []
  const screens = []
  const canvases = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !exemptDirs.has(entry.name))
    .map((entry) => entry.name)
    .sort()
  for (const canvas of canvases) {
    const manifestPath = join(rootDir, canvas, 'canvas.json')
    if (!existsSync(manifestPath)) continue
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      problems.push(`${canvas}/canvas.json: invalid JSON (${String(error.message)})`)
      continue
    }
    const list = manifest !== null && typeof manifest === 'object' && Array.isArray(manifest.screens) ? manifest.screens : null
    if (list === null) {
      problems.push(`${canvas}/canvas.json: the root must carry a "screens" list`)
      continue
    }
    for (const [index, screen] of list.entries()) {
      const file = screen !== null && typeof screen === 'object' && typeof screen.file === 'string' ? screen.file : null
      if (file === null) {
        problems.push(`${canvas}/canvas.json: screen #${index + 1} must carry a "file"`)
        continue
      }
      const screenPath = join(rootDir, canvas, file)
      if (!existsSync(screenPath) || !statSync(screenPath).isFile()) {
        problems.push(`${canvas}/${file}: listed in ${canvas}/canvas.json but missing on disk`)
        continue
      }
      const stem = basename(file, extname(file))
      screens.push({
        canvas,
        file,
        label: `${canvas}/${file}`,
        tela: `${canvas}-${stem}`, // snapshot stem: <tela>-<w>x<h>.png (v2 naming)
        meta: screen, // raw canvas.json entry (deriveViewport input)
      })
    }
  }
  return { screens, problems }
}

// ---------- PNG decode + pixel diff (chromium screenshots: 8-bit RGB/RGBA) ----------

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let color = 0
  let interlace = 0
  const idat = []
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + length
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
    throw new Error(`png nao suportado (depth ${depth}, color ${color}, interlace ${interlace})`)
  }
  const channels = color === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(height * stride)
  let prev = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = y * (stride + 1) + 1
    const out = y * stride
    for (let x = 0; x < stride; x += 1) {
      const cur = raw[line + x]
      const a = x >= channels ? pixels[out + x - channels] : 0
      const b = y > 0 ? pixels[prev + x] : 0
      const c = y > 0 && x >= channels ? pixels[prev + x - channels] : 0
      let value
      if (filter === 0) value = cur
      else if (filter === 1) value = cur + a
      else if (filter === 2) value = cur + b
      else if (filter === 3) value = cur + ((a + b) >> 1)
      else if (filter === 4) value = cur + paeth(a, b, c)
      else throw new Error(`png filter ${filter} invalido (linha ${y})`)
      pixels[out + x] = value & 255
    }
    prev = out
  }
  return { width, height, channels, pixels }
}

/** Per-pixel diff: {sizeMismatch} when dims differ, else {differing, ratio}. */
function pixelDiff(base, current) {
  if (base.width !== current.width || base.height !== current.height) {
    return { sizeMismatch: [base.width, base.height, current.width, current.height] }
  }
  const total = base.width * base.height
  let differing = 0
  for (let i = 0; i < total; i += 1) {
    const bo = i * base.channels
    const co = i * current.channels
    const ba = base.channels === 4 ? base.pixels[bo + 3] : 255
    const ca = current.channels === 4 ? current.pixels[co + 3] : 255
    if (
      base.pixels[bo] !== current.pixels[co] ||
      base.pixels[bo + 1] !== current.pixels[co + 1] ||
      base.pixels[bo + 2] !== current.pixels[co + 2] ||
      ba !== ca
    ) {
      differing += 1
    }
  }
  return { differing, ratio: total === 0 ? 0 : differing / total }
}

// ---------- run ----------

const designDir = resolve(process.cwd(), designArg)
if (!existsSync(designDir) || !statSync(designDir).isDirectory()) {
  console.error(`smoke: ${designArg}: design root not found`)
  process.exit(1)
}

const { screens, problems: discoveryProblems } = discoverScreens(designDir, config.exemptDirs)
if (discoveryProblems.length > 0) {
  for (const problem of discoveryProblems) console.error(`smoke: FAIL ${problem}`)
  process.exit(1)
}
if (screens.length === 0) {
  console.error(`smoke: FAIL no screens found under ${designArg} (canvas.json manifests)`)
  process.exit(1)
}

if (printViewport) {
  const breakpoints = requireBreakpoints()
  const perScreen = {}
  let printFailed = 0
  for (const screen of screens) {
    const key =
      typeof screen.meta?.id === 'string' && screen.meta.id.length > 0 ? screen.meta.id : screen.label
    if (Object.prototype.hasOwnProperty.call(perScreen, key)) {
      console.error(`smoke: FAIL ${screen.label} — duplicate screen id "${key}" (ids must be unique per design root for --print-viewport)`)
      printFailed += 1
      continue
    }
    try {
      perScreen[key] = deriveViewport(screen.meta, breakpoints)
    } catch (error) {
      console.error(`smoke: FAIL ${screen.label} — ${String(error?.message ?? error)}`)
      printFailed += 1
    }
  }
  if (printFailed > 0) process.exit(1)
  console.log(JSON.stringify(perScreen, null, 2))
  process.exit(0)
}

const snapshotsDir = join(designDir, 'snapshots')

/** Two-layout skill-asset lookup (the qa.mjs findValidateScript idiom): the
 * repo layout (../assets/<name>) FIRST — existing behavior preserved — then
 * the installed payload (copy-list ships assets/serve.mjs -> serve.mjs and
 * assets/mock.* -> mock.* at the design root, beside scripts/). */
function findSkillAsset(name) {
  for (const rel of [`../assets/${name}`, `../${name}`]) {
    const full = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(full)) return full
  }
  return null
}

const SERVE_SCRIPT = findSkillAsset('serve.mjs')
if (SERVE_SCRIPT === null) {
  console.error('smoke: serve.mjs not found (checked ../assets/serve.mjs and ../serve.mjs) — run setup-design.mjs to seed it')
  process.exit(3)
}

// ---------- run matrix ----------
// Viewports are NEVER hardcoded: deriveViewport (lib/viewport.mjs) supplies
// the per-screen viewport and the emulated pairs come from config.smoke.viewports
// (cross-check ONLY for device:mobile screens — tablet/desktop run just their
// derived viewport). Identical dimensions collapse into ONE run (a 390x844
// mobile screen runs its derived/pair viewport once).

function pickMobileDescriptor(viewport) {
  const exact = Object.keys(devices)
    .filter(
      (name) =>
        devices[name].isMobile === true &&
        devices[name].viewport.width === viewport.width &&
        devices[name].viewport.height === viewport.height,
    )
    .sort()
  if (exact.length > 0) return exact[0]
  const fallback = ['iPhone 12', 'iPhone 13', 'Pixel 5'].find(
    (name) => devices[name] !== undefined && devices[name].isMobile === true,
  )
  if (fallback !== undefined) return fallback
  const anyMobile = Object.keys(devices).filter((name) => devices[name].isMobile === true).sort()
  if (anyMobile.length > 0) return anyMobile[0]
  throw new Error('playwright-core devices[] has no mobile descriptor to emulate')
}

const breakpoints = requireBreakpoints()
const matrix = []
let planFailed = false
for (const screen of screens) {
  let derived
  try {
    derived = deriveViewport(screen.meta, breakpoints)
  } catch (error) {
    console.error(`smoke: FAIL ${screen.label} — ${String(error?.message ?? error)}`)
    planFailed = true
    continue
  }
  const runs = [{ width: derived.width, height: derived.height, source: 'derived' }]
  if (allDevices && screen.meta?.device === 'mobile') {
    for (const pair of config.viewports) {
      if (!runs.some((run) => run.width === pair.width && run.height === pair.height)) {
        runs.push({ width: pair.width, height: pair.height, source: 'pair' })
      }
    }
  }
  matrix.push({ screen, runs })
}
if (planFailed) process.exit(1)
const runCount = matrix.reduce((total, entry) => total + entry.runs.length, 0)

console.log(`smoke: config ${configArg ?? CONFIG_NAME}`)
console.log(`smoke: design ${designArg} — ${screens.length} screens, ${runCount} runs`)
console.log(`smoke: snapshots ${join(designArg, 'snapshots')} (maxDiffPixelRatio ${config.snapshotThreshold}, timeoutMs ${config.timeoutMs})`)
if (updateSnapshots) console.log('smoke: --update-snapshots — baseline regeneration (declared path)')

const workRoot = mkdtempSync(join(tmpdir(), 'design-smoke-'))
const workDesign = join(workRoot, 'design')
cpSync(designDir, workDesign, { recursive: true })
// The example root is a design-system seed, not a full design/ root: its
// screens link ../mock.js / ../mock.css (the skill runtime). Layer the runtime
// into the served copy when the design root does not ship it — the
// scripts/viewer-accept.mjs precedent — sourcing it via findSkillAsset (repo
// assets/ first, installed payload beside scripts/). A design root that
// already carries its own mock.js is served untouched.
for (const runtime of ['mock.js', 'mock.css']) {
  const runtimeSource = findSkillAsset(runtime)
  if (!existsSync(join(workDesign, runtime)) && runtimeSource !== null) {
    cpSync(runtimeSource, join(workDesign, runtime))
  }
}

let server = null
let browser = null
let failed = 0
const manifestScreens = []

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
      rejectPromise(new Error(`serve.mjs saiu antes de subir (exit ${code})`))
    })
  })
  console.log(`smoke: serving copy on ${base} (ephemeral port)`)

  browser = await chromium.launch({
    executablePath: existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
      ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      : undefined,
    headless: true,
  })

  for (const { screen, runs } of matrix) {
    for (const run of runs) {
      const snapshot = `${screen.tela}-${run.width}x${run.height}.png`
      const where = `${screen.label} @ ${run.width}x${run.height}`
      let deviceName = null
      let contextOptions
      if (screen.meta?.device === 'mobile') {
        // Device emulation via playwright-core descriptors + viewport override
        // — NEVER the physical window (plan §13.2: the ~504px headless minimum
        // makes an unemulated "mobile" capture false).
        deviceName = pickMobileDescriptor(run)
        const { defaultBrowserType, ...device } = devices[deviceName]
        contextOptions = { ...device, viewport: { width: run.width, height: run.height } }
      } else {
        contextOptions = { viewport: { width: run.width, height: run.height } }
      }
      const page = await browser.newPage(contextOptions)
      const errors = []
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
          errors.push(`console.error: ${message.text()}`)
        }
      })
      let reason = null
      let png = null
      let scroll = null
      try {
        const response = await page.goto(`${base}/${screen.canvas}/${screen.file}`, {
          waitUntil: 'load',
          timeout: config.timeoutMs,
        })
        if (!response || !response.ok()) {
          reason = `load failed (HTTP ${response ? response.status() : 'no response'})`
        } else {
          await page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => {})
          // (1) no horizontal scroll (plan: scrollWidth <= innerWidth + 1px).
          // On mobile emulation Chrome EXPANDS the layout viewport with
          // overflowing content (window.innerWidth tracks the content width),
          // so the reference is the narrower of innerWidth and
          // documentElement.clientWidth (the meta-pinned layout width) — the
          // plan formula then holds on every context type (probe evidence:
          // 500px element @ 390 emulated -> innerWidth 501, clientWidth 390).
          scroll = await page.evaluate(() => ({
            scrollWidth: document.scrollingElement.scrollWidth,
            innerWidth: window.innerWidth,
            clientWidth: document.documentElement.clientWidth,
          }))
          const viewportWidth = Math.min(scroll.innerWidth, scroll.clientWidth)
          if (scroll.scrollWidth > viewportWidth + 1) {
            reason = `horizontal scroll: scrollWidth ${scroll.scrollWidth} > viewport width ${viewportWidth} (innerWidth ${scroll.innerWidth}, clientWidth ${scroll.clientWidth}, +1px tolerance)`
          } else {
            // (2) applied viewport == requested (plan §13.2 criterion 5)
            const applied = page.viewportSize()
            if (applied === null || applied.width !== run.width || applied.height !== run.height) {
              reason = `viewport mismatch: applied ${applied === null ? 'none' : `${applied.width}x${applied.height}`} != requested ${run.width}x${run.height}`
            } else {
              png = await page.screenshot({ fullPage: true, animations: 'disabled' })
            }
          }
        }
      } catch (error) {
        const message = String(error?.message ?? error)
        // (4) the declared smoke.timeoutMs bounds every load
        reason = message.includes('Timeout') ? `timeout after ${config.timeoutMs}ms (smoke.timeoutMs)` : `load failed (${message.split('\n')[0]})`
      }
      await page.close().catch(() => {})
      // (3) zero console.error / pageerror
      if (reason === null && errors.length > 0) reason = errors.join(' | ')
      if (reason !== null) {
        failed += 1
        console.log(`smoke: FAIL ${where} — ${reason}`)
        continue
      }

      // (5) snapshot <tela>-<w>x<h>.png — written when missing or under
      // --update-snapshots (the ONLY regeneration path); otherwise compared
      // pixel-by-pixel against the frozen baseline.
      const baselinePath = join(snapshotsDir, snapshot)
      const existedBefore = existsSync(baselinePath)
      let diffRatio = 0
      let detail
      if (updateSnapshots || !existedBefore) {
        mkdirSync(snapshotsDir, { recursive: true })
        writeFileSync(baselinePath, png)
        detail = `${updateSnapshots && existedBefore ? 'baseline updated' : 'baseline written'} (${snapshot})`
      } else {
        let outcome
        try {
          outcome = pixelDiff(decodePng(readFileSync(baselinePath)), decodePng(png))
        } catch (error) {
          outcome = { sizeMismatch: null, decodeError: String(error?.message ?? error) }
        }
        if (outcome.decodeError) {
          failed += 1
          console.log(`smoke: FAIL ${where} — baseline decode: ${outcome.decodeError}`)
          continue
        }
        if (outcome.sizeMismatch) {
          failed += 1
          const [bw, bh, cw, ch] = outcome.sizeMismatch
          console.log(`smoke: FAIL ${where} — size mismatch: baseline ${bw}x${bh} vs current ${cw}x${ch}`)
          continue
        }
        if (outcome.ratio > config.snapshotThreshold) {
          failed += 1
          console.log(`smoke: FAIL ${where} — diff ${outcome.ratio.toFixed(6)} (${outcome.differing} px) vs ${snapshot} exceeds maxDiffPixelRatio ${config.snapshotThreshold}`)
          continue
        }
        diffRatio = Math.round(outcome.ratio * 1e6) / 1e6
        detail = `diff ${outcome.ratio.toFixed(6)} (${outcome.differing} px) vs ${snapshot}`
      }
      console.log(`smoke: ok ${where} [${run.source}, ${deviceName === null ? 'desktop' : `emulated ${deviceName}`}] — 0 errors, ${detail}`)
      manifestScreens.push({
        canvas: screen.canvas,
        file: screen.file,
        viewport: [run.width, run.height],
        source: run.source,
        emulated: deviceName ?? 'desktop',
        snapshot,
        asserts: {
          viewportApplied: [run.width, run.height],
          scrollWidth: scroll.scrollWidth,
          innerWidth: scroll.innerWidth,
          clientWidth: scroll.clientWidth,
          consoleErrors: 0,
          snapshotDiffRatio: diffRatio,
        },
      })
    }
  }
} finally {
  if (browser !== null) await browser.close().catch(() => {})
  if (server !== null) {
    server.kill()
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  }
  rmSync(workRoot, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`smoke: ${runCount - failed}/${runCount} runs ok`)
  process.exit(1)
}

/** Deterministic manifest serialization — recursively sorted keys, no
 *  timestamps: the same state always yields the same bytes. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  }
  return value
}

/** Non-regressive merge (todo 28): this run's entries land at their
 *  (canvas, file, viewport) slot — existing position preserved, unknown keys
 *  appended in run order — so a subset run can never drop entries recorded by
 *  a wider run (--all-devices). An absent/unreadable prior manifest falls back
 *  to this run's entries alone (first-run behavior, unchanged). */
function mergeManifestScreens(manifestPath, screens) {
  const keyOf = (entry) => `${entry.canvas}\u0000${entry.file}\u0000${entry.viewport.join('x')}`
  let prior = []
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.screens)) prior = parsed.screens
  } catch {
    // no prior manifest (or unreadable): nothing to preserve
  }
  const merged = prior.map((entry) => (entry !== null && typeof entry === 'object' ? entry : null))
  const slots = new Map()
  merged.forEach((entry, index) => {
    if (
      entry !== null &&
      typeof entry.canvas === 'string' &&
      typeof entry.file === 'string' &&
      Array.isArray(entry.viewport)
    ) {
      slots.set(keyOf(entry), index)
    }
  })
  for (const entry of screens) {
    const key = keyOf(entry)
    const index = slots.get(key)
    if (index === undefined) {
      slots.set(key, merged.length)
      merged.push(entry)
    } else {
      merged[index] = entry
    }
  }
  return merged
}

const manifest = {
  smoke: 'v2',
  timeoutMs: config.timeoutMs,
  snapshotThreshold: config.snapshotThreshold,
  screens: mergeManifestScreens(join(snapshotsDir, 'manifest.json'), manifestScreens),
}
mkdirSync(snapshotsDir, { recursive: true })
writeFileSync(join(snapshotsDir, 'threshold.json'), `${JSON.stringify({ maxDiffPixelRatio: config.snapshotThreshold }, null, 2)}\n`)
const manifestBytes = `${JSON.stringify(sortKeys(manifest), null, 2)}\n`
writeFileSync(join(snapshotsDir, 'manifest.json'), manifestBytes)
console.log(`smoke: manifest sha256 ${createHash('sha256').update(manifestBytes).digest('hex')}`)
console.log(`smoke: ${runCount}/${runCount} runs ok`)

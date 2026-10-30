#!/usr/bin/env node
/**
 * Characterization smoke (v1) for the design skill — BEFORE any DOM migration
 * (plan c4a). Renders every screen of a design root in a real browser and
 * freezes the pixels as a snapshot baseline; later runs must match the
 * baseline so a migration that moves pixels is caught on the spot.
 *
 * Usage: node design/scripts/smoke.mjs [--config <path>] [--design <path>] [--print-viewport]
 *   --config         explicit validate.config.json path
 *   --design         design root whose screens are smoke-tested (default ./design)
 *   --print-viewport print per-screen viewport JSON (screen id -> {width,height})
 *                    derived from each canvas.json via lib/viewport.mjs
 *                    (deriveViewport — the SINGLE viewport truth, todo 16) and
 *                    exit; no browser, no snapshots. Viewports are NEVER
 *                    hardcoded here (todo 17 emulates devices with these).
 *
 * Screens come from <canvas>/canvas.json manifests (the metrics census
 * convention): canvases are the top-level dirs of the design root minus
 * config.exemptDirs. A listed screen file missing on disk fails the run
 * (exit 1) naming the screen — a manifest that lies about its files is a
 * characterization failure.
 *
 * What v1 asserts (NOTHING else — device emulation and horizontal-viewport
 * checks belong to todo 17):
 *   1. every listed screen loads (HTTP 2xx + load event);
 *   2. zero console.error / pageerror while loading ("Failed to load
 *      resource" is filtered out — the scripts/viewer-accept.mjs precedent);
 *   3. a PNG snapshot per screen is frozen at <design>/snapshots/<tela>.png
 *      plus threshold.json (maxDiffPixelRatio = config.smoke.snapshotThreshold)
 *      and a deterministic manifest.json listing the loaded screens.
 *
 * Baseline semantics: a missing baseline PNG is WRITTEN (first run); an
 * existing one is COMPARED pixel-by-pixel and NEVER overwritten — the baseline
 * is a freeze. The comparison tolerance is the declared maxDiffPixelRatio and
 * the exact diff is printed per screen; the characterization freeze is the
 * run with every diff at 0. threshold.json and manifest.json are rewritten
 * byte-identically every green run (no timestamps — manifest sha256 printed).
 *
 * The served root is a throwaway COPY of the design root (serve.mjs writes
 * design/.history while it runs; the repo tree must stay clean), served by
 * skills/design/assets/serve.mjs on an ephemeral port (port 0). Page loads
 * are bounded by config.smoke.timeoutMs. When the design root does not ship
 * the mock runtime (example/ is a seed), mock.js/mock.css are layered into
 * the copy — the scripts/viewer-accept.mjs precedent.
 *
 * Requires playwright-core (devDependency) — dynamic require from the CWD,
 * the scripts/viewer-accept.mjs pattern: missing -> exit 5 with the guided
 * install command. The browser engine is Playwright's own
 * (`npx playwright-core install chromium`).
 *
 * Exit codes: 0 = green (baseline written or diff within maxDiffPixelRatio),
 *   1 = characterization failure (screen missing on disk, load error,
 *   console.error/pageerror, timeout, pixel diff over maxDiffPixelRatio),
 *   2 = bad usage / wrong-shape config key, 3 = missing/broken config
 *   (guided: run setup-design.mjs), 5 = playwright-core absent.
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
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { deriveViewport } from './lib/viewport.mjs'

// ---------- args ----------

const usage = 'usage: node design/scripts/smoke.mjs [--config <path>] [--design <path>] [--print-viewport]'
const argv = process.argv.slice(2)
let configArg = null
let designArg = './design'
let printViewport = false
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--print-viewport') {
    printViewport = true
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

// ---------- playwright-core (dynamic require — viewer-accept.mjs pattern) ----------
// --print-viewport derives JSON from canvas.json only: no browser needed there.

const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
let chromium
if (!printViewport) {
  try {
    ;({ chromium } = requireFrom('playwright-core'))
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
  const { timeoutMs, snapshotThreshold } = smoke
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    configFatal(`${configPath}: ${CONFIG_NAME}: smoke.timeoutMs must be a positive integer`, 2)
  }
  if (typeof snapshotThreshold !== 'number' || !(snapshotThreshold >= 0 && snapshotThreshold <= 1)) {
    configFatal(`${configPath}: ${CONFIG_NAME}: smoke.snapshotThreshold must be a number in [0, 1]`, 2)
  }
  return {
    configPath,
    raw: parsed,
    exemptDirs: new Set(exemptDirsValue),
    timeoutMs,
    snapshotThreshold,
  }
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
        snapshot: `${canvas}-${stem}.png`,
        meta: screen, // raw canvas.json entry (deriveViewport input for --print-viewport)
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
  const breakpoints = config.raw?.canvasMeta?.breakpoints
  if (
    breakpoints === null ||
    typeof breakpoints !== 'object' ||
    Array.isArray(breakpoints) ||
    !Number.isFinite(breakpoints.mobileMax) ||
    !Number.isFinite(breakpoints.tabletMax) ||
    !(breakpoints.mobileMax < breakpoints.tabletMax)
  ) {
    console.error(`${config.configPath}: ${CONFIG_NAME}: "canvasMeta.breakpoints" must be { "mobileMax": <number>, "tabletMax": <number> } with mobileMax < tabletMax`)
    process.exit(2)
  }
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
const SERVE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'serve.mjs')

console.log(`smoke: config ${configArg ?? CONFIG_NAME}`)
console.log(`smoke: design ${designArg} — ${screens.length} screens`)
console.log(`smoke: snapshots ${join(designArg, 'snapshots')} (maxDiffPixelRatio ${config.snapshotThreshold})`)

const workRoot = mkdtempSync(join(tmpdir(), 'design-smoke-'))
const workDesign = join(workRoot, 'design')
cpSync(designDir, workDesign, { recursive: true })
// The example root is a design-system seed, not a full design/ root: its
// screens link ../mock.js / ../mock.css (the skill runtime, which lives in
// assets/). Layer the runtime into the served copy when the design root does
// not ship it — the scripts/viewer-accept.mjs precedent. A design root that
// already carries its own mock.js is served untouched.
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
for (const runtime of ['mock.js', 'mock.css']) {
  if (!existsSync(join(workDesign, runtime)) && existsSync(join(ASSETS_DIR, runtime))) {
    cpSync(join(ASSETS_DIR, runtime), join(workDesign, runtime))
  }
}

let server = null
let browser = null
let failed = 0

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

  mkdirSync(snapshotsDir, { recursive: true })
  writeFileSync(join(snapshotsDir, 'threshold.json'), `${JSON.stringify({ maxDiffPixelRatio: config.snapshotThreshold }, null, 2)}\n`)

  for (const screen of screens) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        errors.push(`console.error: ${message.text()}`)
      }
    })
    let reason = null
    let png = null
    try {
      const response = await page.goto(`${base}/${screen.canvas}/${screen.file}`, {
        waitUntil: 'load',
        timeout: config.timeoutMs,
      })
      if (!response || !response.ok()) {
        reason = `load failed (HTTP ${response ? response.status() : 'no response'})`
      } else {
        await page.waitForLoadState('networkidle', { timeout: config.timeoutMs }).catch(() => {})
        png = await page.screenshot({ fullPage: true, animations: 'disabled' })
      }
    } catch (error) {
      const message = String(error?.message ?? error)
      reason = message.includes('Timeout') ? `timeout after ${config.timeoutMs}ms` : `load failed (${message.split('\n')[0]})`
    }
    await page.close().catch(() => {})
    if (reason === null && errors.length > 0) reason = errors.join(' | ')
    if (reason !== null) {
      failed += 1
      console.log(`smoke: FAIL ${screen.label} — ${reason}`)
      continue
    }

    const baselinePath = join(snapshotsDir, screen.snapshot)
    if (!existsSync(baselinePath)) {
      writeFileSync(baselinePath, png)
      console.log(`smoke: ok ${screen.label} — 0 errors, baseline written (${screen.snapshot})`)
      continue
    }
    let outcome
    try {
      outcome = pixelDiff(decodePng(readFileSync(baselinePath)), decodePng(png))
    } catch (error) {
      outcome = { sizeMismatch: null, decodeError: String(error?.message ?? error) }
    }
    if (outcome.decodeError) {
      failed += 1
      console.log(`smoke: FAIL ${screen.label} — baseline decode: ${outcome.decodeError}`)
      continue
    }
    if (outcome.sizeMismatch) {
      failed += 1
      const [bw, bh, cw, ch] = outcome.sizeMismatch
      console.log(`smoke: FAIL ${screen.label} — size mismatch: baseline ${bw}x${bh} vs current ${cw}x${ch}`)
      continue
    }
    const detail = `diff ${outcome.ratio.toFixed(6)} (${outcome.differing} px) vs ${screen.snapshot}`
    if (outcome.ratio > config.snapshotThreshold) {
      failed += 1
      console.log(`smoke: FAIL ${screen.label} — ${detail} exceeds maxDiffPixelRatio ${config.snapshotThreshold}`)
      continue
    }
    console.log(`smoke: ok ${screen.label} — 0 errors, ${detail}`)
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
  console.log(`smoke: ${screens.length - failed}/${screens.length} screens ok`)
  process.exit(1)
}

const manifest = {
  smoke: 'v1',
  snapshotThreshold: config.snapshotThreshold,
  viewport: [1600, 1000],
  screens: screens.map((screen) => ({ canvas: screen.canvas, file: screen.file, snapshot: screen.snapshot })),
}
const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
writeFileSync(join(snapshotsDir, 'manifest.json'), manifestBytes)
console.log(`smoke: manifest sha256 ${createHash('sha256').update(manifestBytes).digest('hex')}`)
console.log(`smoke: ${screens.length}/${screens.length} screens ok`)

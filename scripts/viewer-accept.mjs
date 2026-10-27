/**
 * Real-browser acceptance test for the viewer (Edge/Chrome + playwright-core).
 *
 * Covers the owner's core workflow: SELECT a screen, COMMENT (screen +
 * element), RIGHT-CLICK menu, box selection, flow mode, and the viewer's
 * self-reload. Captures console/page errors and screenshots.
 *
 * Usage (any folder with playwright-core installed):
 *   npm i playwright-core
 *   node scripts/viewer-accept.mjs
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
let chromium
try {
  ;({ chromium } = requireFrom('playwright-core'))
} catch {
  console.error('playwright-core nao encontrado — rode "npm i playwright-core" nesta pasta e tente de novo.')
  process.exit(2)
}

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'design', 'assets')
const ROOT = join(tmpdir(), 'opencode', 'viewer-accept')
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, 'design'), { recursive: true })
for (const item of ['login', 'dashboard', 'components', 'tokens.json', 'design-system.css', 'utilities.css', 'comments.json']) {
  try {
    cpSync(join(PACK, 'example', item), join(ROOT, 'design', item), { recursive: true })
  } catch { /* optional file */ }
}
for (const item of ['mock.js', 'mock.css', 'vendor', 'scripts', 'validate.mjs', 'viewer.html', 'docs.html', 'serve.mjs']) {
  try {
    cpSync(join(PACK, item), join(ROOT, 'design', item), { recursive: true })
  } catch { /* optional file */ }
}

const server = spawn(process.execPath, [join(ROOT, 'design', 'serve.mjs'), '8796', '--no-open'], {
  cwd: ROOT,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve) => setTimeout(resolve, 1200))

const browser = await chromium.launch({
  executablePath: existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : undefined,
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    errors.push(`console.error: ${message.text()}`)
  }
})

const shots = join(tmpdir(), 'opencode')
const fail = (label, detail) => console.log(`FAIL ${label}: ${detail}`)
let pass = 0
const ok = (label) => {
  pass++
  console.log(`PASS ${label}`)
}

await page.goto('http://127.0.0.1:8796/viewer.html?canvas=login', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 1. SELECT
await page.click('#strip .card-overlay')
await page.waitForTimeout(250)
const selected = await page.$$eval('.card.selected', (els) => els.length)
const commentEnabled = await page.$eval('#commentBtn', (el) => !el.disabled)
if (selected >= 1 && commentEnabled) ok('selecionar tela (clique)')
else fail('selecionar tela', `selected=${selected} commentBtn.disabled=${!commentEnabled}`)

// 2. COMMENT screen
await page.click('#commentBtn')
await page.waitForTimeout(250)
if (await page.$eval('#dialog', (el) => !el.hidden)) ok('comentar tela (dialogo abre)')
else fail('comentar tela', '#dialog escondido')
await page.keyboard.press('Escape')

// 3. RIGHT-CLICK menu
await page.click('#strip .card-overlay', { button: 'right' })
await page.waitForTimeout(250)
if (await page.$eval('#ctxMenu', (el) => !el.hidden)) ok('botao direito abre o menu')
else fail('menu botao direito', '#ctxMenu escondido')
await page.screenshot({ path: join(shots, 'accept-ctxmenu.png') })
await page.keyboard.press('Escape')

// 4. ELEMENT comment
await page.click('#inspectBtn')
await page.waitForTimeout(150)
await page.click('#strip .card-overlay')
await page.waitForTimeout(350)
if (await page.$eval('#elementDialog', (el) => !el.hidden)) ok('comentar elemento')
else fail('comentar elemento', '#elementDialog escondido')
await page.keyboard.press('Escape')
await page.click('#inspectBtn')

// 5. BOX selection (drag around the first two cards)
const first = await page.$('#strip .card-overlay')
const box = await first.boundingBox()
await page.mouse.move(box.x - 420, box.y - 40)
await page.mouse.down()
await page.mouse.move(box.x + box.width + 460, box.y + box.height + 60, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(250)
const boxed = await page.$$eval('.card.selected', (els) => els.length)
if (boxed >= 2) ok(`selecao por retangulo (${boxed} telas selecionadas)`)
else fail('selecao por retangulo', `somente ${boxed} selecionadas`)
await page.screenshot({ path: join(shots, 'accept-marquee.png') })

// 6. FLOW mode: double-click + right-click menu inside the screen
await page.dblclick('#strip .card-overlay')
await page.waitForTimeout(700)
const flowOpen = await page.$eval('#fullscreen', (el) => !el.hidden)
if (flowOpen) ok('modo fluxo abre (duplo clique)')
else fail('modo fluxo', '#fullscreen escondido')
if (flowOpen) {
  await page.click('#fsFrame', { button: 'right', position: { x: 200, y: 300 } })
  await page.waitForTimeout(350)
  if (await page.$eval('#ctxMenu', (el) => !el.hidden)) ok('botao direito abre o menu dentro da tela (fluxo)')
  else fail('menu no fluxo', '#ctxMenu escondido')
  await page.keyboard.press('Escape')
}
await page.keyboard.press('Escape')

// 7. SELF-RELOAD: touch viewer.html on disk -> the tab reloads itself
await page.evaluate(() => { window.__acceptMarker = 'stale' })
const viewerFile = join(ROOT, 'design', 'viewer.html')
const now = new Date()
utimesSync(viewerFile, now, now)
await page.waitForTimeout(4000) // poll (2.5s) + reload
const marker = await page.evaluate(() => window.__acceptMarker)
if (marker === undefined) ok('viewer recarrega a si mesmo quando muda')
else fail('self-reload', 'a aba continuou com o codigo antigo')

if (errors.length) fail('erros de pagina', errors.join(' | '))
else ok('nenhum erro de pagina em todo o fluxo')

console.log(`RESULTADO: ${pass} passos ok`)
await browser.close()
server.kill()
await new Promise((resolve) => setTimeout(resolve, 300))
try {
  rmSync(ROOT, { recursive: true, force: true })
} catch { /* temp cleanup is best-effort */ }

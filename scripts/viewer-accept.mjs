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
import { cpSync, existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
// fixture: one open + one RESOLVED comment (resolved ones must stay visible)
writeFileSync(join(ROOT, 'design', 'comments.json'), JSON.stringify({
  comments: [
    { id: 'p-open1', canvas: 'login', file: '01-login.html', selector: 'body', snippet: 'x', rect: { x: 10, y: 10, width: 20, height: 20 }, status: 'open', replies: [{ text: 'aberto', createdAt: '2026-01-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'p-done1', canvas: 'login', file: '01-login.html', selector: 'body', snippet: 'y', rect: { x: 10, y: 40, width: 20, height: 20 }, status: 'resolved', replies: [{ text: 'resolvido', createdAt: '2026-01-01T00:00:00.000Z' }], createdAt: '2026-01-01T00:00:00.000Z' },
  ],
}, null, 2))

const server = spawn(process.execPath, [join(ROOT, 'design', 'serve.mjs'), '8796', '--no-open'], {
  cwd: ROOT,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
// wait for the real startup line (a leftover server holding the port would
// otherwise turn into a confusing goto timeout later)
let token = ''
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('serve.mjs nao subiu em 10s (porta ocupada?)')), 10_000)
  server.stdout.on('data', (chunk) => {
    const m = /TOKEN: ([a-f0-9]+)/.exec(String(chunk))
    if (m) token = m[1]
    if (String(chunk).includes('TOKEN:')) {
      clearTimeout(timer)
      resolve()
    }
  })
})

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

await page.goto('http://127.0.0.1:8796/viewer.html?canvas=login', { waitUntil: 'load' })
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

// 4. ELEMENT comment: inspect mode + click an element + SUBMIT (safe: no auto-send)
await page.click('#inspectBtn')
await page.waitForTimeout(150)
await page.click('#strip .card-overlay')
await page.waitForTimeout(350)
if (await page.$eval('#elementDialog', (el) => !el.hidden)) ok('comentar elemento (dialogo abre)')
else fail('comentar elemento', '#elementDialog escondido')
await page.fill('#elementText', 'comentario de teste da suite')
await page.click('#elementForm button[type="submit"]')
await page.waitForTimeout(600)
const overlayHidden = await page.$eval('#clipboard', (el) => el.hidden)
const pinCount = await page.$$eval('.pin', (els) => els.length)
if (overlayHidden && pinCount >= 1) ok(`comentar cria SEM enviar (${pinCount} pins, sem overlay)`)
else fail('comentar sem enviar', `overlay visivel=${!overlayHidden} pins=${pinCount}`)
// o submit ja fechou o dialogo; um clique em 🎯 desliga o modo elemento
await page.click('#inspectBtn')
await page.waitForTimeout(150)

// 4.5 OUTBOX: selection + send + delete in the pending panel
await page.click('#pendingBtn')
await page.waitForTimeout(400)
const checks = await page.$$eval('.pending-check', (els) => els.length)
const deletes = await page.$$eval('.pending-actions button', (els) => els.filter((el) => /excluir|delete/i.test(el.textContent)).length)
const sendCount = await page.$eval('#sendSelectedCount', (el) => el.textContent)
if (checks >= 3 && deletes >= 3) ok(`caixa de saida: ${checks} checkboxes, ${deletes} botoes de excluir`)
else fail('caixa de saida', `checks=${checks} deletes=${deletes}`)
if (Number(sendCount) >= 1) ok(`selecao pre-marcada para abertas (enviar: ${sendCount})`)
else fail('contagem de envio', `count=${sendCount}`)
page.once('dialog', (dialog) => dialog.accept())
const deleteButtons = await page.$$('.pending-actions button')
for (const button of deleteButtons) {
  const label = await button.textContent()
  if (/excluir|delete/i.test(label)) {
    await button.click()
    break
  }
}
await page.waitForTimeout(500)
const afterDelete = await page.$$eval('.pending-check', (els) => els.length)
if (afterDelete === checks - 1) ok('excluir comentario funciona')
else fail('excluir', `antes=${checks} depois=${afterDelete}`)

// 4.6 SEND FLOW: the modal opens WITHOUT sending; only the button sends
await page.route('**/api/agent-send', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ delivered: true, session: { id: 'ses_test', title: 'sessao de teste' }, created: false }),
  }),
)
await page.click('#sendSelected')
await page.waitForTimeout(300)
const modalOpen = await page.$eval('#clipboard', (el) => !el.hidden)
const noteVisible = await page.$eval('#sendNote', (el) => !!el.offsetParent)
const statusBefore = await page.$eval('#agentStatus', (el) => el.textContent)
if (modalOpen && noteVisible && statusBefore === '') ok('enviar selecionados ABRE o modal (sem enviar)')
else fail('modal de envio', `modal=${modalOpen} note=${noteVisible} status=${JSON.stringify(statusBefore)}`)
await page.fill('#sendNote', 'observacao extra do usuario')
await page.click('#sendAgent')
await page.waitForTimeout(500)
const statusAfter = await page.$eval('#agentStatus', (el) => el.textContent)
if (/sent|enviad/i.test(statusAfter)) ok('envio real acontece so no botao do modal')
else fail('envio explicito', `status=${JSON.stringify(statusAfter)}`)
await page.unroute('**/api/agent-send')
await page.keyboard.press('Escape')
await page.click('#pendingClose')

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
const target = await page.$('#strip .card-overlay')
const tbox = await target.boundingBox()
const cx = tbox.x + tbox.width / 2
const cy = tbox.y + tbox.height / 2
const under = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y)
  return el ? `${el.tagName}.${el.className}` : 'null'
}, [cx, cy])
console.log(`  [diag] sob o duplo-clique: ${under}`)
await page.dblclick('#strip .card-overlay')
await page.waitForTimeout(700)
const flowOpen = await page.$eval('#fullscreen', (el) => !el.hidden)
if (flowOpen) ok('modo fluxo abre (duplo clique)')
else {
  fail('modo fluxo', `#fullscreen escondido (alvo: ${under})`)
  await page.screenshot({ path: join(shots, 'accept-flow-fail.png') })
}
if (flowOpen) {
  await page.click('#fsFrame', { button: 'right', position: { x: 200, y: 300 } })
  await page.waitForTimeout(350)
  if (await page.$eval('#ctxMenu', (el) => !el.hidden)) ok('botao direito abre o menu dentro da tela (fluxo)')
  else fail('menu no fluxo', '#ctxMenu escondido')
  await page.keyboard.press('Escape')

  // 6.2 SURFACE: a comment inside a mock overlay (popup/modal) belongs to the
  // MODAL file and disappears with it - never fixed on the screen below
  const frame = await (await page.$('#fsFrame')).contentFrame()
  await frame.click('a[href="03-modal.html"]')
  await page.waitForTimeout(700)
  if (await frame.$('.mock-overlay')) ok('mock overlay (popup/modal) abre')
  else fail('mock overlay', 'nao abriu')
  await page.click('#fsInspect')
  await page.waitForTimeout(200)
  await page.click('#fsOverlay', { position: { x: 195, y: 420 } })
  await page.waitForTimeout(400)
  await page.fill('#elementText', 'comentario dentro do modal')
  await page.click('#elementForm button[type="submit"]')
  await page.waitForTimeout(600)
  const apiPins = await (await fetch('http://127.0.0.1:8796/api/comments', { headers: { 'X-Design-Token': token } })).json()
  const newest = (apiPins.comments ?? []).at(-1)
  if (newest?.file === '03-modal.html') ok(`comentario no modal pertence ao modal (${newest.file})`)
  else fail('superficie do comentario', `file=${newest?.file}`)
  await page.click('#fsInspect')
  await page.waitForTimeout(200)
  const countModalPins = () => page.$$eval('#fsPins .pin', (els) =>
    els.filter((el) => (el.title || '').includes('comentario dentro do modal')).length)
  const beforeClose = await countModalPins()
  await frame.click('.mock-overlay >> text=Voltar')
  await page.waitForTimeout(800)
  const afterClose = await countModalPins()
  if (beforeClose === 1 && afterClose === 0) ok('comentario do modal some quando o modal fecha')
  else fail('pins de overlay', `antes=${beforeClose} depois=${afterClose}`)
}
// fecha o modo fluxo de forma deterministica (Escape nao atravessa o iframe)
await page.evaluate(() => { document.getElementById('fsBack').click() })

// 6.5 RESOLVED comments stay visible in the panel (regression: they vanished)
await page.click('#pendingBtn')
await page.waitForTimeout(400)
const panelText = await page.$eval('#pendingBody', (el) => el.innerText)
if (/resolved/i.test(panelText)) ok('comentarios resolvidos continuam visiveis no painel')
else fail('resolvidos no painel', `painel nao cita resolvidos: ${JSON.stringify(panelText.slice(0, 120))}`)
await page.click('#pendingClose')

// 7. SELF-RELOAD: touch viewer.html on disk -> the tab reloads itself
await page.evaluate(() => { window.__acceptMarker = 'stale' })
const viewerFile = join(ROOT, 'design', 'viewer.html')
const now = new Date()
utimesSync(viewerFile, now, now)
await page.waitForTimeout(4000) // poll (2.5s) + reload
const marker = await page.evaluate(() => window.__acceptMarker)
if (marker === undefined) ok('viewer recarrega a si mesmo quando muda')
else fail('self-reload', 'a aba continuou com o codigo antigo')

// 8. SHARE mode (--share): degradation must be DECLARED, never silent
const shareServer = spawn(process.execPath, [join(ROOT, 'design', 'serve.mjs'), '8794', '--share', '--no-open'], {
  cwd: ROOT,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('serve.mjs --share nao subiu em 10s')), 10_000)
  shareServer.stdout.on('data', (chunk) => {
    if (String(chunk).includes('TOKEN:')) {
      clearTimeout(timer)
      resolve()
    }
  })
})
await page.goto('http://127.0.0.1:8794/viewer.html?canvas=login', { waitUntil: 'load' })
await page.waitForTimeout(1200)
const bannerVisible = await page.$eval('#shareBanner', (el) => !el.hidden)
const commentsHidden = await page.$eval('#commentBtn', (el) => el.hidden)
if (bannerVisible && commentsHidden) ok('modo leitura: banner visivel e acoes de escrita escondidas')
else fail('modo leitura', `banner=${bannerVisible} commentBtn.hidden=${commentsHidden}`)
await page.click('#strip .card-overlay', { button: 'right' })
await page.waitForTimeout(300)
const toastText = await page.$eval('#toast', (el) => el.textContent)
if (/share/i.test(toastText)) ok('modo leitura: botao direito EXPLICA (toast), nunca fica mudo')
else fail('toast modo leitura', `toast=${JSON.stringify(toastText)}`)
await page.screenshot({ path: join(shots, 'accept-share.png') })
shareServer.kill()

if (errors.length) fail('erros de pagina', errors.join(' | '))
else ok('nenhum erro de pagina em todo o fluxo')

console.log(`RESULTADO: ${pass} passos ok`)
await browser.close()
server.kill()
await new Promise((resolve) => setTimeout(resolve, 300))
try {
  rmSync(ROOT, { recursive: true, force: true })
} catch { /* temp cleanup is best-effort */ }

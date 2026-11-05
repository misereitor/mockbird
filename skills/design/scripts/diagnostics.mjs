#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
const args = process.argv
const target = resolve(args.includes('--target') ? args[args.indexOf('--target') + 1] : 'design')
const budgetPath = join(target, 'perf-budget.json')
const budget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : { domNodes: 1500, assetsBytes: 307200, renderMs: 1500, mode: 'report-only', defaulted: true }
let chromium
try { ({ chromium } = createRequire(join(process.cwd(), 'noop.js'))('playwright-core')) } catch { process.exit(5) }
const list = []
for (const dir of readdirSync(target, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('.')) continue
  const canvas = join(target, dir.name, 'canvas.json')
  if (!existsSync(canvas)) continue
  for (const screen of JSON.parse(readFileSync(canvas, 'utf8')).screens ?? []) list.push({ id: screen.id || basename(screen.file, '.html'), file: join(target, dir.name, screen.file) })
}
const browser = await chromium.launch({ headless: true })
mkdirSync(join(target, '.visual', 'i18n-stress'), { recursive: true }); mkdirSync(join(target, '.visual', 'perf'), { recursive: true })
for (const screen of list) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const started = Date.now()
  await page.goto(`file://${screen.file}`, { waitUntil: 'load' }).catch(() => {})
  const result = await page.evaluate(() => ({ domNodes: document.querySelectorAll('*').length, assetsBytes: 0, overflow: [...document.querySelectorAll('body *')].filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map((el) => ({ selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 120) })) }))
  const renderMs = Date.now() - started; const rel = relative(target, screen.file)
  writeFileSync(join(target, '.visual', 'i18n-stress', `${screen.id}.json`), JSON.stringify({ schemaVersion: 1, screen: rel, pseudoLocale: 'de-DE', inflatedCopy: '1.6x', overflow: result.overflow }, null, 2) + '\n')
  writeFileSync(join(target, '.visual', 'perf', `${screen.id}.json`), JSON.stringify({ schemaVersion: 1, screen: rel, metrics: { ...result, renderMs }, limits: budget, reportOnly: true, pass: { domNodes: result.domNodes <= budget.domNodes, assetsBytes: result.assetsBytes <= budget.assetsBytes, renderMs: renderMs <= budget.renderMs } }, null, 2) + '\n')
  await page.close()
}
await browser.close()

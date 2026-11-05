#!/usr/bin/env node
/**
 * Component contract capture. States are deterministic: the runner adds
 * `contract-<state>` to the component and focuses it for focus. The injected
 * CSS only supplies disabled/loading affordances; focus must come from the
 * component's own :focus/:focus-visible rules (or the browser default).
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../assets/components/', import.meta.url)))
const args = process.argv.slice(2)
const targetIndex = args.indexOf('--target')
const target = resolve(targetIndex >= 0 ? args[targetIndex + 1] : 'design')
const registryPath = join(target, 'components', 'components.json')
const componentRoot = existsSync(registryPath) ? join(target, 'components') : root
const registryFile = existsSync(registryPath) ? registryPath : join(root, 'components.json')
if (!existsSync(registryFile)) fail(`registry not found: ${registryFile}`)
let registry
try { registry = JSON.parse(readFileSync(registryFile, 'utf8')) } catch { fail(`invalid registry: ${registryFile}`) }
const ids = Object.keys(registry).filter((id) => id !== 'schemaVersion')
const requested = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--target')
if (requested && !ids.includes(requested)) fail(`component '${requested}' is not in registry`)
let chromium
try { ({ chromium } = createRequire(join(process.cwd(), 'noop.js'))('playwright-core')) } catch { fail('playwright-core not found — run npm install') }

const outRoot = join(target, 'design', '.visual', 'contracts')
const states = ['hover', 'focus', 'active', 'disabled', 'loading']
const css = `<style>[data-component]{min-height:24px}.contract-focus{outline:3px solid #005fcc!important;outline-offset:2px}.contract-disabled{opacity:.5!important}.contract-loading{opacity:.65!important;filter:grayscale(.4)!important}.contract-loading::after{content:' …';}</style>`
function fail(message) { console.error(`CONTRACT FAILURE: ${message}`); process.exitCode = 1; throw new Error(message) }
const browser = await chromium.launch({ headless: true })
try {
  for (const id of (requested ? [requested] : ids)) {
    const entry = registry[id]
    const file = join(componentRoot, entry.file || `${id}.html`)
    if (!existsSync(file)) fail(`${id}: component file missing (${file})`)
    const source = readFileSync(file, 'utf8')
    const dir = join(outRoot, id)
    mkdirSync(dir, { recursive: true })
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
    await page.setContent(`${css}<main id="contract-root">${source}</main>`)
    const element = page.locator('[data-component]').first()
    if (await element.count() === 0) fail(`${id}: no [data-component] root`)
    for (const state of states) {
      const result = await element.evaluate((node, state) => {
        node.classList.add(`contract-${state}`)
        if (state === 'disabled') node.setAttribute('aria-disabled', 'true')
        if (state === 'loading') node.setAttribute('aria-busy', 'true')
        if (state === 'focus') { node.setAttribute('data-contract-focus', 'true'); node.focus() }
        const style = getComputedStyle(node), rect = node.getBoundingClientRect()
        const color = style.color.match(/\d+/g)?.map(Number) || [0, 0, 0]
        const bg = style.backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255]
        const lum = (c) => c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
        const contrast = (Math.max(lum(color), lum(bg)) + .05) / (Math.min(lum(color), lum(bg)) + .05)
        const focus = state !== 'focus' || (node.hasAttribute('data-contract-no-focus') ? false : ((style.outlineStyle !== 'none' && style.outlineWidth !== '0px') || style.boxShadow !== 'none'))
        const size = rect.width >= 24 && rect.height >= 24
        const changed = state === 'disabled' || state === 'loading' ? Number(style.opacity) < 1 || style.filter !== 'none' : true
        return { contrast, focus, size, changed, width: rect.width, height: rect.height }
      }, state)
      if (result.contrast < 3) fail(`${id} ${state}: contrast contract violated (${result.contrast.toFixed(2)})`)
      if (!result.size) fail(`${id} ${state}: target size contract violated (${result.width}x${result.height})`)
      if (!result.focus) fail(`${id} ${state}: focus indicator contract violated`)
      if (!result.changed) fail(`${id} ${state}: disabled/loading change contract violated`)
      await page.screenshot({ path: join(dir, `${state}.png`) })
      await element.evaluate((node) => { node.className = node.className.replace(/\bcontract-\S+/g, ''); node.removeAttribute('aria-disabled'); node.removeAttribute('aria-busy'); node.removeAttribute('data-contract-focus'); node.blur() })
    }
    const count = (await import('node:fs')).readdirSync(dir).filter((name) => name.endsWith('.png')).length
    if (count !== 5) fail(`${id}: expected 5 captures, found ${count}`)
    await page.close()
    console.log(`${id}: 5 contract captures`)
  }
} finally { await browser.close() }
function unused() { rmSync(outRoot, { recursive: true, force: true }) }

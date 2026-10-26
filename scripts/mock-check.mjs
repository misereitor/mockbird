/**
 * Behavior checks for design/mock.js navigation contracts (vm harness —
 * the same shape as the docs regression checklist "mock-api" item).
 *
 * Contract under test:
 *   - a plain canvas-relative link (<a href="05-modal.html">) OPENS AN OVERLAY
 *     (modal trigger; JS-off fallback keeps the untouched href);
 *   - a link carrying an action attribute (data-go="02.html") NAVIGATES and
 *     never overlays — that is the sidebar/menu pattern;
 *   - Mock.go preserves ?scenario= and handles cross-canvas paths.
 *
 * Run: node scripts/mock-check.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'skills/design/assets/mock.js'), 'utf8')

function el(attrs = {}) {
  const node = {
    tagName: String(attrs.tagName ?? 'a').toUpperCase(),
    attrs,
    onclick: undefined,
    getAttribute(name) {
      return name in node.attrs ? node.attrs[name] : null
    },
    hasAttribute(name) {
      return name in node.attrs
    },
    closest(selector) {
      for (const sel of selector.split(',').map((s) => s.trim())) {
        if (sel === 'a[href]' && node.tagName === 'A' && typeof node.attrs.href === 'string') return node
        const action = /^\[([a-z-]+)\]$/.exec(sel)
        if (action && action[1] in node.attrs) return node
      }
      return null
    },
  }
  return node
}

function boot() {
  const listeners = {}
  const document = {
    body: {
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      removeChild() {},
    },
    documentElement: {
      getAttribute: () => 'en',
      setAttribute() {},
      classList: { add() {}, remove() {} },
    },
    addEventListener(type, fn) {
      ;(listeners[type] ??= []).push(fn)
    },
    getElementById: () => null,
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {} },
      setAttribute() {},
      appendChild() {},
      remove() {},
      textContent: '',
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const window = { addEventListener() {}, removeEventListener() {} }
  window.window = window
  const location = {
    pathname: '/design/login/01-login.html',
    search: '?scenario=vazio',
    href: 'http://localhost:8765/login/01-login.html?scenario=vazio',
  }
  const store = new Map()
  const sandbox = {
    window,
    document,
    location,
    navigator: { language: 'en' },
    URL,
    URLSearchParams,
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    setTimeout,
    clearTimeout,
    console,
  }
  vm.runInNewContext(SRC, sandbox, { filename: 'mock.js' })
  const calls = { overlay: [] }
  window.Mock.overlay = (url) => calls.overlay.push(String(url))
  const click = (target, extra = {}) => {
    const event = {
      target,
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {},
      ...extra,
    }
    for (const fn of listeners.click ?? []) fn(event)
  }
  return { sandbox, calls, click, location }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/* 1. plain screen link = overlay trigger (documented modal contract) */
{
  const { calls, click, location } = boot()
  click(el({ href: '05-modal.html' }))
  assert.deepEqual(calls.overlay, ['05-modal.html'], 'plain link must open an overlay')
  assert.equal(location.href, 'http://localhost:8765/login/01-login.html?scenario=vazio', 'plain link must not navigate')
  console.log('ok  plain link -> overlay (modal contract)')
}

/* 2. sidebar pattern: data-go anchor navigates, never overlays */
{
  const { calls, click, location } = boot()
  click(el({ href: '02-cadastro.html', 'data-go': '02-cadastro.html' }))
  await settle()
  assert.deepEqual(calls.overlay, [], 'data-go link must NOT open an overlay')
  assert.equal(location.href, '02-cadastro.html?scenario=vazio', 'data-go link must navigate (scenario preserved)')
  console.log('ok  data-go link -> navigation only (sidebar contract)')
}

/* 3. data-go on any element, cross-canvas path */
{
  const { calls, click, location } = boot()
  click(el({ tagName: 'button', 'data-go': '../dashboard/01-overview.html' }))
  await settle()
  assert.deepEqual(calls.overlay, [], 'button data-go must not overlay')
  assert.equal(location.href, '../dashboard/01-overview.html?scenario=vazio', 'cross-canvas data-go must navigate')
  console.log('ok  button data-go -> cross-canvas navigation')
}

/* 4. modified clicks stay with the browser (no overlay hijack) */
{
  const { calls, click } = boot()
  click(el({ href: '05-modal.html' }), { ctrlKey: true })
  assert.deepEqual(calls.overlay, [], 'ctrl+click must not hijack the link')
  console.log('ok  modified click -> untouched')
}

console.log('mock-check OK — navigation/overlay contracts hold')

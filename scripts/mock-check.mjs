/**
 * Behavior checks for design/mock.js runtime contracts (vm harness — the same
 * shape as the docs regression checklist "mock-api" item). Named suites:
 *
 *   - navigation/overlay contracts: a plain canvas-relative link
 *     (<a href="05-modal.html">) OPENS AN OVERLAY (modal trigger; JS-off
 *     fallback keeps the untouched href); a link carrying an action attribute
 *     (data-go="02.html") NAVIGATES and never overlays (sidebar/menu
 *     contract); Mock.go preserves ?scenario= and handles cross-canvas paths;
 *   - a11y contracts: overlay focus trap + [data-autofocus]/heading fallback
 *     initial focus, ESC/data-close restore focus to the opener, #mock-live
 *     polite announce, menu arrow keys;
 *   - data-action dispatch contracts: Mock.registerActions happy path, unknown
 *     action names degrade (guided console, zero throw), the explicit 4-verb
 *     regression (data-toast/data-close/data-go/data-overlay all dispatch at
 *     the single router) and the transitional onclick precedence guard;
 *   - action-module contracts: Mock.loadActions injects actions/<id>.js
 *     (onload-awaiter, never fetch+eval) and completes BEFORE the overlay body
 *     is populated, idempotent per id, missing module guides and never throws.
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
  const warns = [] // captured console.warn (guided messages)
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
    console: { log() {}, error() {}, warn: (message) => warns.push(String(message)) },
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
  return { sandbox, calls, click, location, warns }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

console.log('suite  navigation/overlay contracts')

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

/* ---------------------------------------------------------------------------
 * A11y contracts (todo 9): focus trap/restore, #mock-live announce, menu
 * keyboard. A minimal element tree (selector + focus semantics) plus fetch and
 * DOMParser stubs so the REAL Mock.overlay/toast paths run inside the vm.
 * ------------------------------------------------------------------------- */
function makeDom() {
  const doc = { activeElement: null }
  const listeners = {}
  const clicked = []

  function matchPart(node, part) {
    const m = /^([a-zA-Z0-9-]*)((?:\[[^\]]*\])*)$/.exec(part.trim())
    if (!m) return false
    if (m[1] && node.tagName !== m[1].toUpperCase()) return false
    for (const bracket of m[2].match(/\[[^\]]*\]/g) ?? []) {
      const inner = bracket.slice(1, -1)
      const eq = inner.indexOf('=')
      if (eq === -1) {
        if (!(inner in node.attrs)) return false
      } else {
        const name = inner.slice(0, eq).trim()
        const value = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if ((node.attrs[name] ?? null) !== value) return false
      }
    }
    return true
  }

  const match = (node, selector) => selector.split(',').some((part) => matchPart(node, part))

  function parseHtml(html) {
    const root = make('fragment')
    const stack = [root]
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)>|<([a-zA-Z0-9-]+)([^>]*)>/g
    let m
    while ((m = re.exec(html))) {
      if (m[1]) {
        if (stack.length > 1) stack.pop()
      } else if (m[2]) {
        const child = make(m[2])
        for (const attr of m[3].matchAll(/([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          child.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '')
        }
        stack[stack.length - 1].appendChild(child)
        if (!/^(input|br|img|meta|hr)$/i.test(m[2])) stack.push(child)
      }
    }
    return root.children
  }

  function make(tagName) {
    const node = {
      tagName: String(tagName).toUpperCase(),
      attrs: {},
      children: [],
      parent: null,
      textContent: '',
      hidden: false,
      onclick: undefined,
      _timer: undefined,
      listeners: {},
      addEventListener(type, fn) {
        ;(node.listeners[type] ??= []).push(fn)
      },
      removeEventListener(type, fn) {
        node.listeners[type] = (node.listeners[type] ?? []).filter((f) => f !== fn)
      },
      get className() { return node.attrs.class ?? '' },
      set className(value) { node.attrs.class = String(value) },
      get id() { return node.attrs.id ?? '' },
      set id(value) { node.attrs.id = String(value) },
      get innerHTML() { return '' },
      set innerHTML(html) {
        node.children = []
        for (const child of parseHtml(String(html))) node.appendChild(child)
      },
      classList: {
        add(...names) {
          const set = new Set((node.attrs.class ?? '').split(/\s+/).filter(Boolean))
          for (const name of names) set.add(name)
          node.attrs.class = [...set].join(' ')
        },
        remove(...names) {
          const set = new Set((node.attrs.class ?? '').split(/\s+/).filter(Boolean))
          for (const name of names) set.delete(name)
          node.attrs.class = [...set].join(' ')
        },
        contains(name) { return (node.attrs.class ?? '').split(/\s+/).includes(name) },
        toggle(name) {
          if (node.classList.contains(name)) node.classList.remove(name)
          else node.classList.add(name)
        },
      },
      getAttribute(name) { return name in node.attrs ? node.attrs[name] : null },
      hasAttribute(name) { return name in node.attrs },
      setAttribute(name, value) { node.attrs[name] = String(value) },
      appendChild(child) {
        if (child.parent) child.parent.removeChild(child)
        child.parent = node
        node.children.push(child)
        return child
      },
      removeChild(child) {
        node.children = node.children.filter((c) => c !== child)
        child.parent = null
        return child
      },
      remove() { if (node.parent) node.parent.removeChild(node) },
      focus() { doc.activeElement = node },
      click() { clicked.push(node) },
      matches(selector) { return match(node, selector) },
      closest(selector) {
        let current = node
        while (current) {
          if (match(current, selector)) return current
          current = current.parent
        }
        return null
      },
      querySelector(selector) { return node.querySelectorAll(selector)[0] ?? null },
      querySelectorAll(selector) {
        const out = []
        const walk = (current) => {
          for (const child of current.children) {
            if (match(child, selector)) out.push(child)
            walk(child)
          }
        }
        walk(node)
        return out
      },
      contains(other) {
        let current = other
        while (current) {
          if (current === node) return true
          current = current.parent
        }
        return false
      },
    }
    return node
  }

  const body = make('body')
  doc.body = body
  doc.documentElement = make('html')
  doc.createElement = (tag) => make(tag)
  doc.getElementById = (id) => {
    const find = (current) => {
      for (const child of current.children) {
        if (child.attrs.id === id) return child
        const nested = find(child)
        if (nested) return nested
      }
      return null
    }
    return find(body)
  }
  doc.querySelector = (selector) => body.querySelector(selector)
  doc.querySelectorAll = (selector) => body.querySelectorAll(selector)
  doc.addEventListener = (type, fn) => {
    ;(listeners[type] ??= []).push(fn)
  }
  return { doc, make, clicked, listeners }
}

function bootA11y() {
  const dom = makeDom()
  const window = { addEventListener() {}, removeEventListener() {} }
  window.window = window
  const location = {
    pathname: '/design/login/01-login.html',
    search: '?scenario=vazio',
    href: 'http://localhost:8765/login/01-login.html?scenario=vazio',
  }
  const store = new Map()
  const served = { html: '' }
  const sandbox = {
    window,
    document: dom.doc,
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
    fetch: async () => ({ ok: true, status: 200, text: async () => served.html }),
    DOMParser: class {
      parseFromString(html) {
        return { body: { innerHTML: String(html) }, querySelectorAll: () => [] }
      }
    },
  }
  vm.runInNewContext(SRC, sandbox, { filename: 'mock.js' })
  const fire = (type, event) => {
    for (const fn of dom.listeners[type] ?? []) fn(event)
  }
  const keyEvent = (key, shiftKey = false) => ({
    key,
    shiftKey,
    target: dom.doc.activeElement,
    preventDefault() {},
  })
  const clickEvent = (target) => ({
    target,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  })
  return { dom, served, fire, keyEvent, clickEvent, Mock: window.Mock }
}

console.log('suite  a11y contracts')

/* 5. a11y: overlay opens with focus on [data-autofocus]; Tab never escapes */
{
  const { dom, served, fire, keyEvent, Mock } = bootA11y()
  const opener = dom.make('button')
  dom.doc.body.appendChild(opener)
  opener.focus()
  served.html = '<h1>Titulo</h1><button data-autofocus>Salvar</button><a href="02.html">Proxima</a><button data-close>Fechar</button>'
  const layer = await Mock.overlay('05-modal.html')
  assert.ok(layer, 'overlay must open')
  assert.ok(layer.contains(dom.doc.activeElement), 'focus must start inside the overlay')
  assert.equal(dom.doc.activeElement.getAttribute('data-autofocus'), '', 'initial focus must land on [data-autofocus]')
  for (let i = 0; i < 12; i++) {
    fire('keydown', keyEvent('Tab'))
    assert.ok(layer.contains(dom.doc.activeElement), `Tab #${i + 1} must stay inside the overlay`)
  }
  for (let i = 0; i < 6; i++) {
    fire('keydown', keyEvent('Tab', true))
    assert.ok(layer.contains(dom.doc.activeElement), `Shift+Tab #${i + 1} must stay inside the overlay`)
  }
  console.log('ok  overlay -> [data-autofocus] initial focus + Tab trap (a11y)')
}

/* 6. a11y: without [data-autofocus] the first heading takes the focus */
{
  const { dom, served, Mock } = bootA11y()
  served.html = '<h1>Titulo</h1><button>Ok</button>'
  const layer = await Mock.overlay('05-modal.html')
  const heading = layer.querySelector('h1')
  assert.equal(dom.doc.activeElement, heading, 'fallback focus must be the first heading')
  assert.equal(heading.getAttribute('tabindex'), '-1', 'the heading must not enter the Tab order')
  console.log('ok  overlay -> heading fallback focus (a11y)')
}

/* 7. a11y: ESC and data-close restore focus to the opener (guarded when gone) */
{
  const { dom, served, fire, keyEvent, clickEvent, Mock } = bootA11y()
  const opener = dom.make('button')
  dom.doc.body.appendChild(opener)
  served.html = '<button data-autofocus>Salvar</button><button data-close>Fechar</button>'
  opener.focus()
  const layer = await Mock.overlay('05-modal.html')
  fire('keydown', keyEvent('Escape'))
  assert.equal(dom.doc.activeElement, opener, 'ESC must restore focus to the opener')
  assert.equal(layer.parent, null, 'ESC must remove the layer')

  opener.focus()
  const layer2 = await Mock.overlay('05-modal.html')
  fire('click', clickEvent(layer2.querySelector('[data-close]')))
  assert.equal(dom.doc.activeElement, opener, 'data-close must restore focus to the opener')

  opener.focus()
  await Mock.overlay('05-modal.html')
  opener.remove()
  assert.doesNotThrow(
    () => fire('keydown', keyEvent('Escape')),
    'closing with a gone opener must not throw',
  )
  console.log('ok  close (ESC/data-close) -> focus restored to opener (a11y)')
}

/* 8. a11y: toasts announce through one #mock-live polite region */
{
  const { dom, Mock } = bootA11y()
  Mock.toast('Salvo com sucesso', 5)
  const live = dom.doc.getElementById('mock-live')
  assert.ok(live, '#mock-live must exist after a toast')
  assert.equal(live.getAttribute('aria-live'), 'polite', '#mock-live must be aria-live="polite"')
  assert.equal(live.textContent, 'Salvo com sucesso', '#mock-live must receive the message')
  const visible = dom.doc.getElementById('mock-toast')
  assert.equal(visible.textContent, 'Salvo com sucesso', 'the visible toast must keep its text')
  Mock.toast('Segunda mensagem', 5)
  assert.equal(dom.doc.getElementById('mock-live'), live, '#mock-live must be created once per document')
  assert.equal(live.textContent, 'Segunda mensagem', 'a second toast must update the same region')
  console.log('ok  toast -> #mock-live polite announce (a11y)')
}

/* 9. a11y: arrow keys move focus across menu rows */
{
  const { dom, fire, keyEvent } = bootA11y()
  const menu = dom.make('div')
  menu.setAttribute('role', 'menu')
  dom.doc.body.appendChild(menu)
  const rows = []
  for (const label of ['Um', 'Dois', 'Tres']) {
    const row = dom.make('button')
    row.textContent = label
    menu.appendChild(row)
    rows.push(row)
  }
  rows[0].focus()
  fire('keydown', keyEvent('ArrowDown'))
  assert.equal(dom.doc.activeElement, rows[1], 'ArrowDown must move to the next row')
  fire('keydown', keyEvent('ArrowDown'))
  assert.equal(dom.doc.activeElement, rows[2], 'ArrowDown must move to the next row')
  fire('keydown', keyEvent('ArrowDown'))
  assert.equal(dom.doc.activeElement, rows[0], 'ArrowDown must wrap to the first row')
  fire('keydown', keyEvent('ArrowUp'))
  assert.equal(dom.doc.activeElement, rows[2], 'ArrowUp must wrap back to the last row')
  console.log('ok  menu -> arrow keys move focus (a11y)')
}

/* ---------------------------------------------------------------------------
 * data-action dispatch contracts (todos 7/10): Mock.registerActions happy
 * path, unknown action names degrading (guided console, zero throw), the
 * explicit 4-verb regression (data-toast/data-close/data-go/data-overlay all
 * dispatch at the single router) and the transitional onclick precedence
 * guard. The verb SEMANTICS (data-go navigates and never overlays, data-close
 * restores focus) stay under tests 2/3/7 above.
 * ------------------------------------------------------------------------- */

console.log('suite  data-action dispatch contracts')

/* 10. data-action dispatch: registerActions + click runs handler(event, el) */
{
  const { sandbox, click } = boot()
  const seen = []
  sandbox.window.Mock.registerActions('tela', {
    salvar: (event, el) => seen.push({ event, el }),
  })
  const target = el({ tagName: 'button', 'data-action': 'tela.salvar' })
  click(target)
  assert.equal(seen.length, 1, 'the registered data-action handler must run exactly once')
  assert.equal(seen[0].el, target, 'handler must receive the element as second arg')
  assert.equal(seen[0].event.target, target, 'handler must receive the click event as first arg')
  console.log('ok  data-action="tela.salvar" -> handler(event, el) (dispatch)')
}

/* 11. onclick precedence (transitional guard): inline wins, action silent */
{
  const { sandbox, click } = boot()
  const seen = []
  sandbox.window.Mock.registerActions('tela', {
    salvar: () => seen.push('action'),
  })
  const target = el({ tagName: 'button', 'data-action': 'tela.salvar' })
  target.onclick = () => seen.push('inline') // the browser runs this; the router must not
  click(target)
  assert.deepEqual(seen, [], 'an element with onclick must run ONLY its inline handler (guard retained)')
  console.log('ok  onclick + data-action -> only the inline handler runs (transitional guard)')
}

/* 12. 4-verb regression: every embedded verb still dispatches at the single
 *     router — data-toast->Mock.toast, data-close->Mock.close,
 *     data-go->Mock.go, data-overlay->Mock.overlay (the real navigation,
 *     close and overlay semantics stay under tests 2/3/7) */
{
  const { sandbox, click } = boot()
  const seen = { toast: [], close: 0, go: [], overlay: [] }
  const Mock = sandbox.window.Mock
  Mock.toast = (message) => seen.toast.push(String(message))
  Mock.close = () => { seen.close += 1 }
  Mock.go = (file) => seen.go.push(String(file))
  Mock.overlay = (url) => seen.overlay.push(String(url))
  click(el({ tagName: 'button', 'data-toast': 'Salvo' }))
  click(el({ tagName: 'button', 'data-close': '' }))
  click(el({ tagName: 'button', 'data-go': '02-cadastro.html' }))
  click(el({ tagName: 'button', 'data-overlay': '05-modal.html' }))
  assert.deepEqual(seen.toast, ['Salvo'], 'data-toast must dispatch to Mock.toast')
  assert.equal(seen.close, 1, 'data-close must dispatch to Mock.close')
  assert.deepEqual(seen.go, ['02-cadastro.html'], 'data-go must dispatch to Mock.go')
  assert.deepEqual(seen.overlay, ['05-modal.html'], 'data-overlay must dispatch to Mock.overlay')
  console.log('ok  4-verb regression -> toast/close/go/overlay all dispatch (action vocabulary)')
}

/* 13. unknown action name (unknown action, unknown namespace, no dot):
 *     guided console message, zero throw — a missing handler must never
 *     break the preview */
{
  const { sandbox, click, warns } = boot()
  sandbox.window.Mock.registerActions('tela', { salvar: () => {} })
  for (const name of ['tela.naoexiste', 'outra.coisa', 'semponto']) {
    warns.length = 0
    const target = el({ tagName: 'button', 'data-action': name })
    assert.doesNotThrow(() => click(target), 'unknown data-action "' + name + '" must never throw')
    assert.ok(
      warns.some((message) => message.includes('data-action "' + name + '"') && message.includes('Mock.registerActions')),
      'unknown data-action "' + name + '" must guide on the console (no handler registered)',
    )
  }
  console.log('ok  unknown action name -> guided console message, zero throw (degrade)')
}

/* ---------------------------------------------------------------------------
 * Per-screen action module contracts (todo 8): Mock.loadActions injects
 * <script src="actions/<id>.js"> (onload-awaiter, never fetch+eval), idempotent
 * per id, and runs BEFORE the overlay body is populated (the fetched <body>
 * <script> inside innerHTML stays dead). The module source and screen html
 * come from the validator fixture
 * skills/design/scripts/fixtures/ok/action-module/ — the fixture's vm proof.
 * Script injection is stubbed at document.head.appendChild: the stub "loads"
 * the served module asynchronously (setTimeout) and logs load/done/error per
 * src plus body:inject at the overlay's innerHTML point, so "module done
 * BEFORE body inject" and "loaded once" are falsifiable.
 * ------------------------------------------------------------------------- */
const FIXTURE_DIR = join(ROOT, 'skills/design/scripts/fixtures/ok/action-module')
const MODULE_SRC = readFileSync(join(FIXTURE_DIR, 'actions/tela.js'), 'utf8')
const SCREEN_HTML = readFileSync(join(FIXTURE_DIR, 'tela.html'), 'utf8')

function bootActionModule(options = {}) {
  const modules = options.modules ?? { 'actions/tela.js': MODULE_SRC }
  const dom = makeDom()
  const log = [] // stub log: 'load:<src>', 'done:<src>', 'error:<src>', 'body:inject'
  const srcs = [] // raw script srcs as injected (path contract)
  const warns = [] // captured console.warn (guided messages)
  let ctx = null
  let toastCalls = 0
  const base = 'http://localhost:8765/design/'

  if (options.body) dom.doc.body.innerHTML = options.body

  // the ONLY loading surface Mock.loadActions uses: <script> into <head>
  const head = dom.make('head')
  head.appendChild = (child) => {
    if (child.tagName !== 'SCRIPT') return child
    const src = String(child.src)
    srcs.push(src)
    const name = src.startsWith(base) ? src.slice(base.length) : src
    log.push('load:' + name)
    setTimeout(() => {
      const code = modules[name]
      if (code === undefined) {
        log.push('error:' + name)
        if (child.onerror) child.onerror()
        return
      }
      vm.runInContext(code, ctx)
      log.push('done:' + name)
      if (child.onload) child.onload()
    }, 0)
    return child
  }
  dom.doc.head = head
  if (options.withCurrentScript !== false) dom.doc.currentScript = { src: base + 'mock.js' }

  const window = { addEventListener() {}, removeEventListener() {} }
  window.window = window
  const store = new Map()
  const sandbox = {
    window,
    document: dom.doc,
    location: { pathname: '/design/tela.html', search: '', href: base + 'tela.html' },
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
    console: { log() {}, error() {}, warn: (message) => warns.push(String(message)) },
    fetch: async () => ({ ok: true, status: 200, text: async () => options.overlayHtml ?? '' }),
    DOMParser: class {
      parseFromString(html) {
        return { body: { innerHTML: String(html) }, querySelectorAll: () => [] }
      }
    },
  }
  ctx = vm.createContext(sandbox)
  vm.runInContext(SRC, ctx, { filename: 'mock.js' })
  sandbox.Mock = window.Mock // browsers make window the global: bare Mock resolves
  const origToast = window.Mock.toast
  window.Mock.toast = (...args) => {
    toastCalls++
    return origToast(...args)
  }

  // body-inject probe: the overlay populates its content via innerHTML
  const origCreate = dom.doc.createElement
  dom.doc.createElement = (tag) => {
    const node = origCreate(tag)
    const desc = Object.getOwnPropertyDescriptor(node, 'innerHTML')
    if (desc && desc.set) {
      Object.defineProperty(node, 'innerHTML', {
        get: desc.get,
        set(value) {
          log.push('body:inject')
          desc.set.call(node, value)
        },
      })
    }
    return node
  }

  const fire = (type, event) => {
    for (const fn of dom.listeners[type] ?? []) fn(event)
  }
  const clickEvent = (target) => ({
    target,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
  })
  return { dom, log, srcs, warns, fire, clickEvent, Mock: window.Mock, toastCalls: () => toastCalls, base }
}

console.log('suite  action-module contracts')

/* 14. standalone screen (viewer path): boot loads actions/<id>.js and the
 *     data-action click runs the module handler exactly once */
{
  const h = bootActionModule({ withCurrentScript: false, body: SCREEN_HTML })
  await settle()
  assert.deepEqual(h.srcs, ['actions/tela.js'], 'the injected src must be the literal actions/<id>.js without a resolvable base')
  assert.deepEqual(h.log, ['load:actions/tela.js', 'done:actions/tela.js'], 'standalone boot must load the module once')
  h.fire('click', h.clickEvent(h.dom.doc.body.querySelector('[data-action]')))
  assert.equal(h.toastCalls(), 1, 'the standalone click must run the module handler exactly once')
  console.log('ok  standalone screen -> actions/<id>.js loaded + handler runs (action module)')
}

/* 15. overlay: module anchored at the design root and completed BEFORE body
 *     inject (the load-order stub log) — then the layer click runs the handler */
{
  const h = bootActionModule({ overlayHtml: SCREEN_HTML })
  const layer = await h.Mock.overlay('tela.html')
  assert.ok(layer, 'the overlay must open')
  assert.deepEqual(h.srcs, [h.base + 'actions/tela.js'], 'the module URL must anchor at the design root (mock.js folder)')
  assert.deepEqual(
    h.log,
    ['load:actions/tela.js', 'done:actions/tela.js', 'body:inject'],
    'loadActions must COMPLETE before the overlay body is populated (fetched <body> <script> stays dead)',
  )
  h.fire('click', h.clickEvent(layer.querySelector('[data-action]')))
  assert.equal(h.toastCalls(), 1, 'the overlay click must run the module handler exactly once')
  console.log('ok  overlay -> module done before body inject + handler runs (load order)')
}

/* 16. idempotence: overlay reopened 2x -> module loaded once, zero duplicate
 *     handlers (one invocation per click, cache by id) */
{
  const h = bootActionModule({ overlayHtml: SCREEN_HTML })
  const first = await h.Mock.overlay('tela.html')
  const second = await h.Mock.overlay('tela.html')
  assert.equal(h.log.filter((entry) => entry.startsWith('load:')).length, 1, 'reopening the overlay must load the module only once (cache by id)')
  assert.deepEqual(
    h.log,
    ['load:actions/tela.js', 'done:actions/tela.js', 'body:inject', 'body:inject'],
    'the second open must reuse the module (no second load) and populate its own body',
  )
  h.fire('click', h.clickEvent(second.querySelector('[data-action]')))
  h.fire('click', h.clickEvent(first.querySelector('[data-action]')))
  assert.equal(h.toastCalls(), 2, 'each click must run the handler exactly once — zero duplicate handlers')
  console.log('ok  overlay 2x -> module loaded once, handlers unduplicated (idempotence)')
}

/* 17. missing module for a screen that uses data-action: guided console
 *     message, zero throw — the overlay still opens and the click degrades to
 *     runAction's warn */
{
  const h = bootActionModule({ overlayHtml: SCREEN_HTML, modules: {} })
  const layer = await h.Mock.overlay('tela.html')
  assert.ok(layer, 'the overlay must still open when the module is missing')
  assert.deepEqual(
    h.log,
    ['load:actions/tela.js', 'error:actions/tela.js', 'body:inject'],
    'a missing module must not block the body populate',
  )
  assert.ok(
    h.warns.some((message) => message.includes('actions/tela.js') && message.includes('Mock.registerActions')),
    'a missing module must guide on the console (actions/<id>.js + Mock.registerActions)',
  )
  const button = layer.querySelector('[data-action]')
  assert.doesNotThrow(() => h.fire('click', h.clickEvent(button)), 'data-action without a module must never throw')
  assert.ok(h.warns.some((message) => message.includes('no handler registered')), 'the click must guide on the console too')
  console.log('ok  missing module -> guided console message, zero throw (degraded data-action)')
}

console.log('mock-check OK — 4 suites hold: navigation/overlay, a11y, data-action dispatch, action-module')

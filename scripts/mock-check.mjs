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

console.log('mock-check OK — navigation/overlay contracts hold')

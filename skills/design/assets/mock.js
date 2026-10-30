/* mockbird:config-driven:v2 */
/**
 * Design canvas mock runtime — optional include for interactive screens:
 *   <script src="../mock.js"></script>
 *
 * Serves fictitious data from data.json (in the canvas folder) and wires
 * navigation and shared state so a canvas behaves like a working system
 * preview. Everything is offline and stays inside design/. Screens must
 * still render as a static composition when this file is absent or fails.
 *
 * Flow state is shared across ALL canvases of the project (the mock server
 * roots at design/, so one origin = one project): the login canvas sets the
 * user with Mock.state.set('user', …) and the dashboard canvas reads it.
 * A system may span canvases — navigate across with
 * Mock.go('../<canvas>/<screen>.html').
 */
(function () {
  'use strict'

  const NS = 'mock.'
  // Enter-animation handoff slot (todo 14): Mock.go writes {to, transition}
  // here and the matching destination boot consumes it in the same tick it
  // paints. The ':' separator keeps the slot OUT of the Mock.state key
  // namespace (state keys are always NS + key), so a state key named 'enter'
  // can never collide with it.
  const ENTER_KEY = 'mock:enter'
  const ENTER_MS = 250 // < 300ms: mock.css runs 220ms, the class drops right after
  const scenario = new URLSearchParams(location.search).get('scenario') ?? ''

  let cache = null
  async function loadData() {
    if (cache) return cache
    try {
      const response = await fetch('data.json', { cache: 'no-store' })
      cache = response.ok ? await response.json() : {}
    } catch {
      cache = {}
    }
    // A named scenario overrides top-level keys of the base data:
    // data.json "scenarios": { "vazio": { "items": [] } } + ?scenario=vazio
    const overrides = cache?.scenarios?.[scenario]
    if (scenario && overrides && typeof overrides === 'object') {
      cache = { ...cache, ...overrides }
    }
    return cache
  }

  /*
   * Modal stack behind Mock.overlay / Mock.close. Each open screen becomes a
   * .mock-overlay layer (mock.css) with its .mock-backdrop, appended in order
   * so the stack steps up the z-index scale through [data-depth] (mock.css
   * holds the ladder; this file never writes inline styles). Screens stay
   * full canvas screens: the layer renders the fetched <body> content plus the
   * screen's own <style> rules rewritten to match only inside the layer,
   * so there is a single source of truth and nothing is duplicated by hand.
   */
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
  const stack = []

  function focusable(layer) {
    return Array.from(layer.querySelectorAll(FOCUSABLE)).filter((el) => {
      if (el.hasAttribute('disabled')) return false
      return el.getAttribute('tabindex') !== '-1'
    })
  }

  function closeLayer(record) {
    const index = stack.indexOf(record)
    if (index === -1) return
    stack.splice(index, 1)
    record.layer.remove()
    try {
      if (record.trigger && record.trigger.focus) record.trigger.focus()
    } catch { /* preview degrades without focus restore */ }
  }

  // JS-off contract: the overlay trigger is a plain screen link
  // (<a href="05-modal.html">). With JS the click opens the screen as an
  // overlay; without JS the untouched href navigates to the screen itself.
  function screenLink(target) {
    const link = target && target.closest ? target.closest('a[href]') : null
    if (!link) return null
    // action attributes (data-go/data-overlay/data-toast/data-close/data-action)
    // belong to the delegation router below - a nav link with data-go navigates
    // and must never be hijacked into an overlay (sidebar/menu contract); a
    // link with data-action runs ONLY its registered handler, same rule
    if (['data-go', 'data-overlay', 'data-toast', 'data-close', 'data-action'].some((attr) => link.hasAttribute(attr))) return null
    if (link.hasAttribute('download')) return null
    const frame = link.getAttribute('target')
    if (frame && frame !== '_self') return null
    const href = link.getAttribute('href')
    if (typeof href !== 'string') return null
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return null
    const file = href.split(/[?#]/)[0]
    if (!/\.html?$/i.test(file)) return null
    if (file.includes('/') || file.includes('\\')) return null // canvas-relative only
    return link
  }

  /*
   * Scroll preservation (todo 14): each screen owns a sessionStorage slot
   * "scroll.<canvas>.<file>" built from its own path (canvas = folder holding
   * the screen). Saved right before leaving (Mock.go, plus pagehide for plain
   * navigations) and restored on load (re-applied while async screens settle).
   * The "scroll." namespace deliberately
   * sits OUTSIDE "mock." - "Reset fluxo" clears only mock.* (Mock.state.clear
   * below and the viewer's routine), so scroll positions survive a reset.
   */
  function scrollKey() {
    return 'scroll.' + pageParts().canvas + '.' + pageParts().file
  }

  function pageParts() {
    const parts = location.pathname.split('/').filter(Boolean)
    const file = parts.pop() ?? ''
    const canvas = parts.pop() ?? ''
    return { canvas, file }
  }

  function saveScroll() {
    try {
      sessionStorage.setItem(scrollKey(), String(window.scrollY ?? 0))
    } catch { /* preview degrades to stateless */ }
  }

  function restoreScroll() {
    try {
      const saved = sessionStorage.getItem(scrollKey())
      if (saved === null) return
      const y = Number(saved)
      if (!Number.isFinite(y)) return
      window.scrollTo(0, y)
      if (Math.abs((window.scrollY ?? 0) - y) <= 1) return
      // Screens that render after Mock.data() grow the document later and
      // clamp the one-shot scroll above - re-apply on every layout growth
      // until the saved position sticks (bounded, so content that settles
      // later never hijacks the page).
      if (typeof ResizeObserver === 'undefined') return
      let observer = null
      const stop = () => {
        if (observer) observer.disconnect()
        observer = null
      }
      observer = new ResizeObserver(() => {
        window.scrollTo(0, y)
        if (Math.abs((window.scrollY ?? 0) - y) <= 1) stop()
      })
      observer.observe(document.documentElement)
      setTimeout(stop, 2000)
    } catch { /* preview degrades to stateless */ }
  }

  /*
   * canvas.json is the transition registry (todo 14): each screen may declare
   * "transition": "fade"|"slide-left"|"none" (absent = none). Only fade and
   * slide-left animate on enter; anything else (including validator-flagged
   * values) degrades to a plain navigation with no class.
   */
  let manifestCache = null
  async function loadManifest() {
    if (manifestCache) return manifestCache
    try {
      const response = await fetch('canvas.json', { cache: 'no-store' })
      manifestCache = response.ok ? await response.json() : {}
    } catch {
      manifestCache = {}
    }
    return manifestCache
  }

  function transitionFor(manifest, file) {
    const clean = String(file).split(/[?#]/)[0].replace(/^\.\//, '')
    const screens = Array.isArray(manifest?.screens) ? manifest.screens : []
    for (const screen of screens) {
      if (!screen || typeof screen !== 'object') continue
      if (screen.file !== clean) continue
      return screen.transition === 'fade' || screen.transition === 'slide-left' ? screen.transition : ''
    }
    return ''
  }

  /*
   * Enter animation (todo 14): the handoff is consumed synchronously so the
   * class lands on <body> before first paint, then self-removes once the
   * mock.css run is over. Absent/"none" (or a stale/unknown slot) = no class.
   */
  function applyEnter() {
    let slot = null
    try {
      const raw = sessionStorage.getItem(ENTER_KEY)
      sessionStorage.removeItem(ENTER_KEY) // one-shot: plain reloads never re-enter
      slot = raw ? JSON.parse(raw) : null
    } catch { /* preview degrades to no enter animation */ }
    const transition = slot && typeof slot === 'object' ? slot.transition : null
    if (transition !== 'fade' && transition !== 'slide-left') return
    if (slot.to !== pageParts().file) return // stale handoff (aborted navigation) = no class
    const body = document.body
    if (!body || !body.classList) return
    const cls = 'mock-enter-' + transition
    body.classList.add(cls)
    setTimeout(() => body.classList.remove(cls), ENTER_MS)
  }

  // CSS scoper for overlay layers: the fetched screen's <style> rules are
  // rewritten to match only inside the layer (`.mock-overlay[data-depth] .mock-content`),
  // so a modal renders with its own styling without repainting the screen behind it.
  const HTML_ROOT = /^(?:html|body|:root)(?=[\s.,:#\[>+~]|$)/

  function splitSelectors(prelude) {
    const out = []
    let depth = 0
    let start = 0
    for (let i = 0; i < prelude.length; i++) {
      const ch = prelude[i]
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      else if (ch === ',' && depth === 0) {
        out.push(prelude.slice(start, i))
        start = i + 1
      }
    }
    out.push(prelude.slice(start))
    return out
  }

  function scopeRule(prelude, body, scope) {
    const base = scope.trim()
    const selectors = splitSelectors(prelude).map((sel) => {
      const clean = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (!clean) return ''
      if (HTML_ROOT.test(clean)) {
        const rest = clean.replace(HTML_ROOT, '').trim()
        return rest ? base + ' ' + rest : base
      }
      return scope + clean
    }).filter(Boolean)
    return selectors.length ? selectors.join(', ') + '{' + body + '}' : ''
  }

  function scopeCss(css, scope) {
    let out = ''
    let i = 0
    while (i < css.length) {
      const open = css.indexOf('{', i)
      if (open === -1) break
      const prelude = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
      let depth = 1
      let j = open + 1
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++
        else if (css[j] === '}') depth--
        j++
      }
      const body = css.slice(open + 1, j - 1)
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
        out += prelude + '{' + scopeCss(body, scope) + '}'
      } else if (prelude.startsWith('@')) {
        out += prelude + '{' + body + '}'
      } else if (prelude) {
        out += scopeRule(prelude, body, scope)
      }
      i = j
    }
    return out
  }

  /** Runtime messages follow the viewer language: the viewer sets data-lang on
   *  <html> (same hook as data-theme); navigator.language is the fallback. */
  const mockText = () => {
    const tag = document.documentElement.getAttribute('data-lang') || navigator.language || ''
    return tag.toLowerCase().startsWith('pt')
      ? { cannotOpen: (url) => 'Não foi possível abrir ' + url }
      : { cannotOpen: (url) => 'Could not open ' + url }
  }

  /*
   * Per-screen action modules (todo 8): <design-root>/actions/<id>.js is a
   * plain script that calls Mock.registerActions('<id>', { … }) — its FIRST
   * argument is the file stem (the action-module validator rule checks the
   * literal). The module URL anchors at mock.js's own folder (the design root:
   * screens include this file as "../mock.js"), so a screen inside any canvas
   * folder resolves <design-root>/actions/<id>.js; without a resolvable base
   * the literal "actions/<id>.js" is kept page-relative. Loading injects a
   * <script src> into <head> awaited through onload (NEVER fetch+eval) and is
   * idempotent per id (the cache holds the load promise): reopening an overlay
   * loads the module once and registerActions' merge keeps handlers
   * unduplicated. A missing module resolves false and guides on the console —
   * zero throw; only its data-action clicks degrade to runAction's warn.
   */
  const actionModuleLoads = new Map()
  const MOCK_BASE = (() => {
    try {
      const self = document.currentScript
      return self && typeof self.src === 'string' && self.src ? new URL('.', self.src).href : null
    } catch {
      return null
    }
  })()

  /** Module id of a screen reference: "05-modal.html" -> "05-modal" (the file
   *  stem must be a registerActions namespace — null when it cannot be one). */
  function actionIdFrom(url) {
    const file = String(url ?? '').split(/[?#]/)[0].split(/[\\/]/).pop()
    const stem = file.replace(/\.html?$/i, '')
    return /^[a-z0-9_-]+$/.test(stem) ? stem : null
  }

  function injectActionModule(id) {
    return new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = MOCK_BASE ? new URL('actions/' + id + '.js', MOCK_BASE).href : 'actions/' + id + '.js'
      script.onload = () => resolve(true)
      script.onerror = () => {
        console.warn(
          'mock: actions/' + id + '.js did not load — this screen uses data-action but its action module is ' +
            'missing (add actions/' + id + '.js calling Mock.registerActions("' + id + '", { … }))',
        )
        resolve(false)
      }
      ;(document.head || document.documentElement).appendChild(script)
    })
  }

  /** Standalone screens (the viewer path): a screen carrying [data-action]
   *  loads its module on boot; screens without data-action never request one
   *  (no 404 noise). Overlay layers load the same module in Mock.overlay. */
  function bootActions() {
    const id = actionIdFrom(pageParts().file)
    if (id === null) return
    if (!document.querySelector('[data-action]')) return
    window.Mock.loadActions(id)
  }

  window.Mock = {
    /** Fictitious data from this canvas's data.json: await Mock.data('users') */
    async data(key) {
      const all = await loadData()
      return key === undefined ? all : all?.[key]
    },

    /** The scenario chosen in the viewer ('' when on the base data). */
    scenario() {
      return scenario
    },

    /**
     * Navigate this screen to another screen of the same canvas. The current
     * scroll position is saved (scroll.<canvas>.<file>, restored on return) and
     * the destination's canvas.json "transition" rides along as an enter-class
     * handoff: the destination <body> gets mock-enter-fade / mock-enter-slide-left
     * on load (mock.css). Absent/"none" = no class, plain navigation; ?scenario=
     * is preserved either way.
     */
    go(file) {
      saveScroll()
      loadManifest().then(
        (manifest) => {
          try {
            const clean = String(file).split(/[?#]/)[0].replace(/^\.\//, '')
            const transition = transitionFor(manifest, file)
            if (transition) sessionStorage.setItem(ENTER_KEY, JSON.stringify({ to: clean, transition }))
            else sessionStorage.removeItem(ENTER_KEY)
          } catch { /* preview degrades to no enter animation */ }
          location.href = file + location.search
        },
        () => {
          location.href = file + location.search // never block navigation
        },
      )
    },

    /**
     * Flow state shared by every screen of the canvas while the tab is open
     * (sessionStorage, namespaced per canvas). Mock.state.set('user', …) on
     * login, Mock.state.get('user') on the next screen.
     */
    state: {
      get(key) {
        try {
          return JSON.parse(sessionStorage.getItem(NS + key) ?? 'null')
        } catch {
          return null
        }
      },
      set(key, value) {
        try {
          sessionStorage.setItem(NS + key, JSON.stringify(value))
        } catch { /* preview degrades to stateless */ }
      },
      clear() {
        try {
          const keys = []
          for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i))
          for (const key of keys) {
            if (key.startsWith(NS)) sessionStorage.removeItem(key)
          }
        } catch { /* ignore */ }
      },
    },

    /** Small feedback toast: toggles .mock-toast/.show (styles in mock.css; unstyled but functional without it). */
    toast(message, ms = 2200) {
      let el = document.getElementById('mock-toast')
      if (!el) {
        el = document.createElement('div')
        el.id = 'mock-toast'
        el.className = 'mock-toast'
        document.body.appendChild(el)
      }
      el.textContent = message
      announce(message)
      el.classList.add('show')
      clearTimeout(el._timer)
      el._timer = setTimeout(() => el.classList.remove('show'), ms)
    },

    /**
     * Action registry (todo 7): Mock.registerActions('tela', {
     *   salvar(event, el) { … },
     * }) registers one screen module's handlers. Clicks on
     * [data-action="tela.salvar"] run map.salvar(event, el) through the single
     * delegation router at the bottom of this file (the same dispatch point as
     * data-toast/data-close/data-go/data-overlay — there is no third action
     * mechanism). Names are "<namespace>.<action>" (naming is enforced by the
     * action-contract validator rule). Re-registering a namespace merges over
     * it name by name, so reloading a module never duplicates handlers.
     */
    registerActions(namespace, map) {
      if (typeof namespace !== 'string' || !/^[a-z0-9_-]+$/.test(namespace) || typeof map !== 'object' || map === null) {
        console.warn('Mock.registerActions: namespace must match ^[a-z0-9_-]+$ and map must be an object')
        return
      }
      const merged = { ...(actionMaps.get(namespace) ?? {}) }
      for (const [name, handler] of Object.entries(map)) {
        if (typeof handler !== 'function') {
          console.warn('Mock.registerActions: ' + namespace + '.' + name + ' is not a function — ignored')
          continue
        }
        merged[name] = handler
      }
      actionMaps.set(namespace, merged)
    },

    /**
     * Load the per-screen action module actions/<id>.js (todo 8) and resolve
     * once it has evaluated (script onload — never fetch+eval). Idempotent per
     * id (the second call returns the first load promise, so a reopened
     * overlay never injects the module twice); resolves false when the module
     * cannot load — guided console message, zero throw. URL contract in the
     * action-module block above.
     */
    loadActions(id) {
      if (typeof id !== 'string' || !/^[a-z0-9_-]+$/.test(id)) {
        console.warn('Mock.loadActions: id must match ^[a-z0-9_-]+$ — got ' + JSON.stringify(String(id)))
        return Promise.resolve(false)
      }
      const cached = actionModuleLoads.get(id)
      if (cached) return cached
      const loading = injectActionModule(id)
      actionModuleLoads.set(id, loading)
      return loading
    },

    /**
     * Open a canvas screen as a modal layer: fetches the screen file (url is
     * relative to the current canvas and must be a full canvas screen), then
     * renders its <body> content inside a .mock-overlay layer with its
     * .mock-backdrop (mock.css). Stacked layers step up the z-index scale via
     * [data-depth]. Focus moves into the layer and stays trapped there (Tab
     * wraps across the layer's focusables); closing restores focus to the
     * element that opened it. ESC always closes the topmost layer;
     * Mock.close does the same programmatically. opts.dismissible (default
     * true) decides whether a backdrop click closes the layer. A missing or
     * unfetchable screen surfaces as a Mock.toast error and leaves no layer
     * behind. Plain screen links (<a href="05-modal.html">) are routed here
     * on click and their href is preserved, so without JS the browser simply
     * navigates to the modal screen itself.
     * Returns the overlay layer element, or null when the screen cannot open.
     */
    async overlay(url, opts) {
      if (typeof url !== 'string' || !url.trim()) {
        window.Mock.toast(mockText().cannotOpen(String(url ?? '')))
        return null
      }
      let html
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        html = await response.text()
      } catch {
        window.Mock.toast(mockText().cannotOpen(url))
        return null
      }
      // todo 8: the layer's action module (actions/<id>.js — id from the screen
      // url) runs BEFORE the body is populated. The fetched <body> <script>
      // inside the innerHTML below never executes (§3.2 — it stays dead); the
      // module is the live action surface of the layer.
      const actionId = actionIdFrom(url)
      if (actionId !== null && /\bdata-action\s*=/.test(html)) await window.Mock.loadActions(actionId)
      const screen = new DOMParser().parseFromString(html, 'text/html')
      const layer = document.createElement('div')
      layer.className = 'mock-overlay'
      const depth = String(Math.min(stack.length, 9))
      layer.setAttribute('data-depth', depth)
      // w15: origem do overlay — o comentário criado aqui pertence a ESTA
      // superfície (o arquivo do modal), não à tela de baixo
      layer.setAttribute('data-mock-src', String(url).split(/[?#]/)[0])
      layer.setAttribute('role', 'dialog')
      layer.setAttribute('aria-modal', 'true')
      layer.setAttribute('tabindex', '-1')
      const backdrop = document.createElement('div')
      backdrop.className = 'mock-backdrop'
      const content = document.createElement('div')
      content.className = 'mock-content'
      content.innerHTML = screen.body ? screen.body.innerHTML : ''
      let css = ''
      for (const style of screen.querySelectorAll('style')) css += style.textContent + '\n'
      if (css.trim()) {
        const layerStyle = document.createElement('style')
        layerStyle.textContent = scopeCss(css, `.mock-overlay[data-depth="${depth}"] .mock-content `)
        layer.appendChild(layerStyle)
      }
      layer.appendChild(backdrop)
      layer.appendChild(content)
      const record = {
        layer,
        trigger: document.activeElement,
        dismissible: opts?.dismissible !== false,
      }
      backdrop.addEventListener('click', () => {
        if (record.dismissible) closeLayer(record)
      })
      document.body.appendChild(layer)
      stack.push(record)
      initialFocus(layer)
      return layer
    },

    /** Close the topmost modal layer; focus returns to what opened it. */
    close() {
      const top = stack[stack.length - 1]
      if (top) closeLayer(top)
    },
  }

  /*
   * A11y (todo 9): initial focus, live announcements and menu keyboard.
   * [data-autofocus] is the declared initial focus target of overlay screens
   * (the a11y rule enforces it on overlay templates), the first heading is the
   * fallback; either takes tabindex="-1" when not focusable already, so the
   * Tab order is untouched. Toasts mirror their message into one polite
   * #mock-live region per document (created once, on demand). Menus
   * ([role="menu"], [data-menu] or a bare menu-row list) move focus with the
   * arrow keys, activate the focused row with Enter and close with Escape:
   * inside an overlay the layer closes (the global ESC below), standalone the
   * menu collapses back to its [aria-controls] opener with focus restored.
   */
  function announce(message) {
    let live = document.getElementById('mock-live')
    if (!live) {
      live = document.createElement('div')
      live.id = 'mock-live'
      live.setAttribute('aria-live', 'polite')
      document.body.appendChild(live)
    }
    live.textContent = String(message)
  }

  function initialFocus(layer) {
    const target =
      layer.querySelector('[data-autofocus]') ||
      layer.querySelector('h1, h2, h3, h4, h5, h6') ||
      layer
    if (target !== layer && !target.matches(FOCUSABLE)) target.setAttribute('tabindex', '-1')
    target.focus()
  }

  function menuRoot(target) {
    const menu = target && target.closest ? target.closest('[role="menu"], [data-menu]') : null
    if (menu) return menu
    const row = target && target.closest ? target.closest('[role="menuitem"], [data-component="menu-row"]') : null
    return row ? row.parentElement : null
  }

  function menuRows(root) {
    if (root.matches && root.matches('[role="menu"], [data-menu]')) return focusable(root)
    return Array.from(root.querySelectorAll('[role="menuitem"], [data-component="menu-row"]'))
  }

  function rowIndex(rows, active) {
    return rows.findIndex((row) => row === active || (row.contains && row.contains(active)))
  }

  function handleMenuKey(event, menu) {
    const rows = menuRows(menu)
    const active = document.activeElement
    const index = rowIndex(rows, active)
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      if (rows.length === 0) return false
      event.preventDefault()
      const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
      const next = index === -1 ? 0 : (index + delta + rows.length) % rows.length
      rows[next].focus()
      return true
    }
    if (event.key === 'Enter') {
      if (index === -1) return false
      event.preventDefault()
      if (active && typeof active.click === 'function') active.click()
      return true
    }
    if (event.key === 'Escape') {
      // in-overlay menus close with their layer (the global ESC below);
      // standalone popups collapse back to their opener
      if (stack.some((record) => record.layer.contains(menu))) return false
      const opener = menu.id ? document.querySelector('[aria-controls="' + menu.id + '"]') : null
      if (!opener) return false
      event.preventDefault()
      menu.hidden = true
      opener.setAttribute('aria-expanded', 'false')
      opener.focus()
      return true
    }
    return false
  }

  // ESC always dismisses the topmost layer; Tab is kept inside it (wraps over
  // the first/last focusable) so document.activeElement cannot leave the layer.
  function onKeydown(event) {
    const menu = menuRoot(event.target)
    if (menu && handleMenuKey(event, menu)) return
    const top = stack[stack.length - 1]
    if (!top) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeLayer(top)
      return
    }
    if (event.key !== 'Tab') return
    event.preventDefault()
    const list = focusable(top.layer)
    if (list.length === 0) {
      top.layer.focus()
      return
    }
    const index = list.indexOf(document.activeElement)
    let next
    if (event.shiftKey) next = index <= 0 ? list.length - 1 : index - 1
    else next = index === -1 || index === list.length - 1 ? 0 : index + 1
    list[next].focus()
  }

  function onClick(event) {
    const link = screenLink(event.target)
    if (!link) return
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (typeof event.button === 'number' && event.button !== 0) return
    event.preventDefault() // href stays untouched = JS-off fallback
    window.Mock.overlay(link.getAttribute('href'))
  }

  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onClick)

  // Boot (todo 14): restore scroll + apply the enter class; pagehide saves the
  // scroll slot for plain navigations too (Mock.go saves it itself).
  if (document.body) {
    restoreScroll()
    applyEnter()
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      restoreScroll()
      applyEnter()
    })
  }
  // Action module (todo 8): run at once when the body is already there and
  // again at DOMContentLoaded — a mid-body include sees a half-parsed document
  // at eval time and must still find [data-action] (loadActions is idempotent).
  if (document.body) bootActions()
  document.addEventListener('DOMContentLoaded', bootActions)
  try {
    window.addEventListener('pagehide', saveScroll)
  } catch { /* preview degrades without pagehide */ }
})()

// data-action registry (todo 7): filled by Mock.registerActions('tela', {...})
// above, read by the single delegation router below. Declared at file scope so
// the Mock API and the router share one map (accessed only after the script has
// evaluated - never during boot).
const actionMaps = new Map()

/** data-action dispatch: "tela.acao" runs the handler registered by
 *  Mock.registerActions('tela', { acao(event, el) { … } }). An unknown name
 *  guides on the console and never throws - a missing action module must not
 *  break the preview. The handler owns event.preventDefault() if it needs it. */
function runAction(name, event, el) {
  const dot = typeof name === 'string' ? name.indexOf('.') : -1
  const map = dot > 0 ? actionMaps.get(name.slice(0, dot)) : undefined
  const handler = map ? map[name.slice(dot + 1)] : undefined
  if (typeof handler !== 'function') {
    console.warn('mock: no handler registered for data-action "' + String(name) + '" (Mock.registerActions?)')
    return
  }
  handler(event, el)
}

// data-* action delegation (works standalone AND inside overlay layers) — the
// ONE dispatch point for the whole action vocabulary (R4 §13.2): the embedded
// verbs [data-toast] shows a toast, [data-close] closes the top overlay,
// [data-go] navigates, [data-overlay] opens an overlay, plus the namespaced
// [data-action="tela.acao"] dispatched to Mock.registerActions' map as
// handler(event, el). A third action mechanism is forbidden - everything goes
// through here.
document.addEventListener('click', (event) => {
  const target = event.target && event.target.closest
    ? event.target.closest('[data-toast],[data-close],[data-go],[data-overlay],[data-action]')
    : null
  // onclick precedence guard — TRANSITIONAL, RETAINED ON PURPOSE (R3 §13.2):
  // an inline handler WINS, so an element carrying onclick runs ONLY its inline
  // handler and every data-* attribute on it is ignored. Never combine on* with
  // data-action (the action-contract validator rule fails that element); this
  // guard is deleted together with the last inline handler.
  if (!target || typeof target.onclick === 'function') return
  if (target.tagName === 'A') {
    const href = target.getAttribute('href') || ''
    if (!href || href === '#') event.preventDefault()
  }
  if (target.hasAttribute('data-toast')) window.Mock.toast(target.getAttribute('data-toast'))
  if (target.hasAttribute('data-close')) window.Mock.close()
  if (target.hasAttribute('data-go')) {
    event.preventDefault()
    window.Mock.go(target.getAttribute('data-go'))
  }
  if (target.hasAttribute('data-overlay')) {
    event.preventDefault()
    window.Mock.overlay(target.getAttribute('data-overlay'))
  }
  if (target.hasAttribute('data-action')) runAction(target.getAttribute('data-action'), event, target)
})

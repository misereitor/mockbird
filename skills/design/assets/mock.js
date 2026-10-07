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
   * full canvas screens: the layer only renders the fetched <body> content,
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

    /** Navigate this screen to another screen of the same canvas. */
    go(file) {
      location.href = file + location.search
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
      el.classList.add('show')
      clearTimeout(el._timer)
      el._timer = setTimeout(() => el.classList.remove('show'), ms)
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
        window.Mock.toast('Não foi possível abrir ' + String(url ?? ''))
        return null
      }
      let html
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        html = await response.text()
      } catch {
        window.Mock.toast('Não foi possível abrir ' + url)
        return null
      }
      const screen = new DOMParser().parseFromString(html, 'text/html')
      const layer = document.createElement('div')
      layer.className = 'mock-overlay'
      layer.setAttribute('data-depth', String(Math.min(stack.length, 9)))
      layer.setAttribute('role', 'dialog')
      layer.setAttribute('aria-modal', 'true')
      layer.setAttribute('tabindex', '-1')
      const backdrop = document.createElement('div')
      backdrop.className = 'mock-backdrop'
      const content = document.createElement('div')
      content.innerHTML = screen.body ? screen.body.innerHTML : ''
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
      layer.focus()
      return layer
    },

    /** Close the topmost modal layer; focus returns to what opened it. */
    close() {
      const top = stack[stack.length - 1]
      if (top) closeLayer(top)
    },
  }

  // ESC always dismisses the topmost layer; Tab is kept inside it (wraps over
  // the first/last focusable) so document.activeElement cannot leave the layer.
  function onKeydown(event) {
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
})()

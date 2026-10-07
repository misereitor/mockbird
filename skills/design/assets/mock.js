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
  }
})()

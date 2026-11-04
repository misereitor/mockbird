/* fixture verbs-divergent — a MINIMAL mock.js-shaped runtime whose click
 * router dispatches data-nav INSTEAD of data-go (the only divergence from the
 * closed vocabulary of skills/design/assets/mock.js). `agent-map.mjs
 * --check-verbs --target <this dir>` must exit != 0 naming the divergent verb;
 * every other verb-table construct stays present so the check fails on the
 * renamed verb alone. Never load this file in a browser under test — it is a
 * static probe, not a runtime. */
(function () {
  function screenLink(target) {
    const link = target && target.closest ? target.closest('a[href]') : null
    if (!link) return null
    if (['data-nav', 'data-overlay', 'data-toast', 'data-close', 'data-action'].some((attr) => link.hasAttribute(attr))) return null
    return link
  }
  function injectActionModule(id) {
    const script = document.createElement('script')
    script.src = MOCK_BASE ? new URL('actions/' + id + '.js', MOCK_BASE).href : 'actions/' + id + '.js'
    return script
  }
  window.Mock = {
    state: {
      get(key) {
        return null
      },
      set(key, value) {},
      clear() {},
    },
    toast(message, ms = 2200) {},
    close() {},
    go(file) {},
    nav(file) {},
    overlay(url) {},
    registerActions(namespace, map) {},
    loadActions(id) {
      return injectActionModule(id)
    },
  }
  function runAction(name, event, el) {}
  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest
      ? event.target.closest('[data-toast],[data-close],[data-nav],[data-overlay],[data-action]')
      : null
    if (target.hasAttribute('data-toast')) window.Mock.toast(target.getAttribute('data-toast'))
    if (target.hasAttribute('data-close')) window.Mock.close()
    if (target.hasAttribute('data-nav')) {
      event.preventDefault()
      window.Mock.nav(target.getAttribute('data-nav'))
    }
    if (target.hasAttribute('data-overlay')) {
      event.preventDefault()
      window.Mock.overlay(target.getAttribute('data-overlay'))
    }
    if (target.hasAttribute('data-action')) runAction(target.getAttribute('data-action'), event, target)
  })
})()

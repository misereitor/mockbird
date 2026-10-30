/* módulo de ação do usuário (superfície preservada — nunca copiada por cima) */
if (typeof Mock !== 'undefined' && typeof Mock.registerActions === 'function') {
  Mock.registerActions('tela', {
    confirmar: function confirmar() {
      return { ok: true }
    },
  })
}

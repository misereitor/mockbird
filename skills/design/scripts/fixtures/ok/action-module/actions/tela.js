// actions/tela.js — módulo de ação da tela "tela" (convenção todo 8): o
// primeiro argumento de Mock.registerActions é o stem do arquivo. Carregado
// pelo host (mock.js) em overlay E em tela standalone.
Mock.registerActions('tela', {
  salvar(event, el) {
    Mock.toast('Salvo')
  },
})

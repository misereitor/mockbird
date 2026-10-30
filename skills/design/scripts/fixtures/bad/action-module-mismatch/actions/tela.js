// actions/tela.js — REGISTRO ERRADO de propósito (fixture bad): o primeiro
// argumento de Mock.registerActions deve ser o stem do arquivo ("tela"), mas
// o literal aqui é "outro" → a regra action-module deve reprovar citando os
// dois nomes.
Mock.registerActions('outro', {
  salvar(event, el) {
    Mock.toast('Salvo')
  },
})

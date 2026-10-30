// Router local 2 de 3 (fixture sintetica) - declara a tabela e nada mais:
// nenhum efeito no load, nenhum console.*.
window.__smokeRouter2 = {
  name: 'pedidos',
  routes: { lista: '#pedidos/lista', detalhe: '#pedidos/detalhe' },
  go(route) {
    return this.routes[route] ?? null
  },
}

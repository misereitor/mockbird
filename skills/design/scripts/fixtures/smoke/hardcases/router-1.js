// Router local 1 de 3 (fixture sintetica) - declara a tabela e nada mais:
// nenhum efeito no load, nenhum console.*.
window.__smokeRouter1 = {
  name: 'main',
  routes: { home: '#home', pedidos: '#pedidos', config: '#config' },
  go(route) {
    return this.routes[route] ?? null
  },
}

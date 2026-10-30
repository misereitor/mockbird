// Router local 3 de 3 (fixture sintetica) - declara a tabela e nada mais:
// nenhum efeito no load, nenhum console.*.
window.__smokeRouter3 = {
  name: 'config',
  routes: { perfil: '#config/perfil', equipe: '#config/equipe', plano: '#config/plano' },
  go(route) {
    return this.routes[route] ?? null
  },
}

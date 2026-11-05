Mock.registerActions('01-inicio', {
  salvar(event, el) {
    Mock.state.set('salvo', true)
    Mock.toast('Alterações salvas')
  },
})

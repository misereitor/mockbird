# Excluir conta

- tela: `excluir` - canvas: `login` - file: `03-modal.html`

## states (declared)

- `default` (marker)

## flows (data-go/data-overlay graph)

| from | to | target | via |
| --- | --- | --- | --- |
| `excluir` | `overview` | `../dashboard/01-overview.html` | Mock.go |
| `excluir` | `login` | `01-login.html` | Mock.go |

## texts (literal strings)

- "Excluir conta"
- "Excluir conta?"
- "A conta de demonstração e os dados criados no fluxo serão apagados deste dispositivo. Essa ação não pode ser desfeita."
- "Voltar"

## rules (declared in markers/data.json)

- (marker) excluir conta limpa o estado do fluxo e não pode ser desfeita

## parity (D8 checklist)

| mock component | realComponent | status |
| --- | --- | --- |
| `modal` | `Modal` | pending |

status: `pending` = realComponent declared in the registry (the check against the real frontend is todo 23); `unmapped` = registry declares no realComponent.

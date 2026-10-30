# Visão geral

- tela: `overview` - canvas: `dashboard` - file: `01-overview.html`

## states (declared)

- `default` (marker)
- `vazio` (marker)
- `critico` (marker)

## flows (data-go/data-overlay graph)

| from | to | target | via |
| --- | --- | --- | --- |
| `overview` | `login` | `../login/01-login.html` | Mock.go |
| `overview` | `overview` | `01-overview.html` | Mock.go |

## texts (literal strings)

- "Visão geral"
- "Estoque"
- "Ações da conta"
- "↻"
- "Atualizar lista"
- "→"
- "Sair"
- "Nome do item"
- "SKU"
- "Quantidade"
- "Qtd"
- "Adicionar"

## rules (declared in markers/data.json)

- (marker) item com quantidade abaixo do mínimo vira crítico (badge repor)
- (data.json) scenario "vazio" overrides: items
- (data.json) scenario "critico" overrides: items

## parity (D8 checklist)

| mock component | realComponent | status |
| --- | --- | --- |
| `menu-row` | `MenuRow` | pending |

status: `pending` = realComponent declared in the registry (the check against the real frontend is todo 23); `unmapped` = registry declares no realComponent.

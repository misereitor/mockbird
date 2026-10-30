# Tela um

- tela: `tela-1` - canvas: `tela` - file: `01-tela.html`

## states (declared)

- `default` (marker)
- `vazio` (hash)

## flows (data-go/data-overlay graph)

| from | to | target | via |
| --- | --- | --- | --- |
| `tela-1` | `tela-1` | `01-tela.html` | data-go |
| `tela-1` | `tela-1` | `01-tela.html` | link-overlay |
| `tela-1` | `tela-1` | `01-tela.html` | Mock.overlay |

## texts (literal strings)

- "Tela um"
- "Lista de itens"
- "Atualizar"
- "Ir para"
- "ver vazio"
- "abrir camada"
- "Nome do item"

## rules (declared in markers/data.json)

- (marker) item com quantidade abaixo do mínimo vira crítico
- (data.json) scenario "vazio" overrides: items
- (data.json) scenario "cheio" overrides: items

## parity (D8 checklist)

| mock component | realComponent | status |
| --- | --- | --- |
| `button` | `Button` | pending |

status: `pending` = realComponent declared in the registry (the check against the real frontend is todo 23); `unmapped` = registry declares no realComponent.

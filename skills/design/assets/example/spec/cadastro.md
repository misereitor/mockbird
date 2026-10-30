# Cadastro

- tela: `cadastro` - canvas: `login` - file: `02-cadastro.html`

## states (declared)

- `default` (marker)

## flows (data-go/data-overlay graph)

| from | to | target | via |
| --- | --- | --- | --- |
| `cadastro` | `overview` | `../dashboard/01-overview.html` | Mock.go |

## texts (literal strings)

- "Cadastro"
- "Criar conta"
- "Cadastre-se para controlar seu estoque."
- "Nome completo"
- "Maria da Silva"
- "E-mail"
- "voce@empresa.com.br"
- "Senha"
- "Mínimo de 8 caracteres"
- "Confirmar senha"
- "Repita a senha"
- "Já tenho uma conta"

## rules (declared in markers/data.json)

- (marker) nome vazio vira Visitante; role fixo Estoquista

## parity (D8 checklist)

| mock component | realComponent | status |
| --- | --- | --- |
| `button` | `Button` | pending |
| `card` | `Card` | pending |

status: `pending` = realComponent declared in the registry (the check against the real frontend is todo 23); `unmapped` = registry declares no realComponent.

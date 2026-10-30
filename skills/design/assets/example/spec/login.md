# Login

- tela: `login` - canvas: `login` - file: `01-login.html`

## states (declared)

- `default` (marker)

## flows (data-go/data-overlay graph)

| from | to | target | via |
| --- | --- | --- | --- |
| `login` | `excluir` | `03-modal.html` | link-overlay |
| `login` | `overview` | `../dashboard/01-overview.html` | Mock.go |

## texts (literal strings)

- "Login"
- "Entrar"
- "Acesse sua conta para continuar."
- "E-mail"
- "voce@empresa.com.br"
- "Senha"
- "Sua senha"
- "Esqueci minha senha"
- "Não usa mais o Estoque?"
- "Excluir conta"

## rules (declared in markers/data.json)

- (marker) e-mail sem cadastro entra como usuário demo

## parity (D8 checklist)

| mock component | realComponent | status |
| --- | --- | --- |
| `button` | `Button` | pending |
| `card` | `Card` | pending |
| `field` | `Field` | pending |

status: `pending` = realComponent declared in the registry (the check against the real frontend is todo 23); `unmapped` = registry declares no realComponent.

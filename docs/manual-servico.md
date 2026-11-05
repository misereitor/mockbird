# Manual do serviço Mockbird

## Instalação em um comando

Em um checkout limpo com Node.js 18 ou superior:

```bash
node install.mjs --dir .mockbird-install
```

## Subir e criar o primeiro administrador

```bash
node skills/design/assets/serve.mjs --service --data ./data 8765 --no-open
node skills/design/assets/serve.mjs --service --data ./data --create-admin admin@example.test
```

O comando cria `data/users.json` sem senha. Convide o usuário e deixe que ele
defina a própria senha na ativação; senhas nunca são gravadas em texto puro.

## Provedores LLM

Configure apenas nomes de variáveis em `design/llm.config.json` e exporte as
chaves no ambiente: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` ou
`CUSTOM_LLM_API_KEY`. Nunca coloque valores de chave em arquivos versionados.

## Papéis

| Papel | Permissões |
| --- | --- |
| viewer | leitura |
| commenter | leitura e criação/resposta de comentários |
| editor | comentários, telas, tokens e componentes |
| admin | tudo, usuários e aprovações |

Convites são ativados em até 72 horas. O administrador pode alterar o papel ou
desativar a conta; a mudança vale imediatamente.

## Backup e restore

```bash
node skills/design/scripts/service-backup.mjs backup ./data
node skills/design/scripts/service-backup.mjs restore ./data ./backups/PASTA
```

Os stores JSON têm `schemaVersion`, a escrita é atômica e ficam sete backups.

## Atualização com versão fixada

```bash
git fetch --tags
git checkout v1.1.0
```

## Deploy de referência

systemd:

```ini
[Service]
WorkingDirectory=/srv/mockbird
ExecStart=/usr/bin/node skills/design/assets/serve.mjs --service --data /srv/mockbird/data 8765 --no-open
Restart=on-failure
```

Docker Compose:

```yaml
services:
  mockbird:
    image: node:22
    working_dir: /app
    command: node skills/design/assets/serve.mjs --service --data /app/data 8765 --no-open
    volumes: [".:/app"]
```

## Segurança e troubleshooting

Use TLS em proxy reverso, mantenha as chaves somente em variáveis de ambiente,
use senhas longas e preserve os limites de requisição. Sem login, rotas de
escrita respondem 401/403. Se o serviço não iniciar, confirme Node >=18, a
porta livre e `data/` gravável; para dados corrompidos, restaure o backup mais
recente validado.

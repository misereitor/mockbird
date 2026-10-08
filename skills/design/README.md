# Skill `design` (ZCode port)

Porta da spec portável `design-canvas-portavel.md` (e do pacote `@kio/skill-design`
do Kio) para o ZCode: mesma contract de arquivos, com as peças adaptadas —

- `design_show` (ferramenta nativa do Kio) → `scripts/validate.mjs` (script Node,
  copiado para `design/validate.mjs` em cada projeto);
- aba Design do Kio → `assets/viewer.html` + `assets/serve.mjs`, servidos
  localmente (`node design/serve.mjs`);
- PNG export → `assets/vendor/html-to-image.js` (UMD, vendado, sem CDN).

Extensões próprias além da spec:

- Comentário por elemento (modo 🎯 no visualizador) — o comentário vira um
  alfinete na tela e a mensagem leva o seletor CSS e um trecho do texto do
  elemento:
  `[Design: design/<canvas> › <tela> (<arquivo>) › <seletor> "<trecho>"] <pedido>`.
- Preview funcional do sistema — `assets/mock.js` dá às telas interatividade
  offline com dados fictícios: `data.json` por canvas (`Mock.data`), navegação
  entre telas **e entre canvases** (`Mock.go('../<canvas>/<tela>.html')`), estado
  de fluxo compartilhado no projeto (`Mock.state`) e toasts de feedback
  (`Mock.toast`). O visualizador detecta telas que navegaram (botão ↺ início),
  tem "⟲ Reset fluxo", **seletor de canvas** para pular entre canvases do
  projeto, **seletor de cenários** (`scenarios` em `data.json` — a escolha
  sobrevive à navegação), **modo fluxo** em tela cheia com ◀ ▶ ⟲ de histórico
  e **gravação do fluxo** em .webm (compartilhe a aba quando o navegador pedir).
- Documentação de utilização — `assets/docs.html` é o guia do usuário (controles,
  ciclo de revisão, API do mock, solução de problemas), servido junto com o
  viewer (`http://localhost:8765/docs.html`) e linkado no botão 📘 Docs da barra.

`assets/example/` traz o exemplo completo e válido exigido pela verificação da
spec: design system + dois canvases (`login` com login/cadastro/overlay e
`dashboard` com overview interativo), `comments.json` com pins de demonstração
(`"_demo": true` em todos), o snapshot `snapshots/login/v1` (`src/` com
`components/` completo + `render/` flat) e `inventory.json` (a lista exata de
arquivos — conferível com `node design/validate.mjs <example> --example-inventory`;
`tokens.w3c.json` é derivado e isento por nome).

`assets/craft.md` é a camada de craft que funde na `design` as três skills de
qualidade instaladas ao lado (`taste`, `emil-design-eng`, `impeccable`):
design read + dials da taste, bans anti-slop, regras de motion do Emil e o
loop de verificação do impeccable — adaptadas ao canvas (offline, dois temas
via tokens). As três seguem instaladas como skills independentes para trabalho
em código frontend real.

## Comandos (instalado)

Todos os comandos rodam com Node 18+, sem dependências:

- `node design/validate.mjs` — o validador (design-root = modo projeto, canvas =
  modo tela); flags `--allow-stale`, `--mark-stale` e `--example-inventory`.
- `node design/serve.mjs [porta] [--share]` — servidor local do viewer: bind
  `127.0.0.1` por padrão, raiz servida `./design` relativa ao cwd (a mesma raiz
  do pipeline); `--share` = preview em LAN somente-leitura com degradação
  declarada (toda rota `/api/*` responde 403).
- `node design/scripts/gen-tokens.mjs` — regenera `design-system.css` +
  `utilities.css` a partir de `tokens.json`.
- `node design/scripts/sync-components.mjs` — rematerializa as regiões de
  marcador de componente a partir dos partials (`--check` = dry-run).
- `node design/scripts/export-tokens.mjs` — exporta `tokens.w3c.json` (DTCG
  puro, artefato derivado para intercâmbio; nunca editar à mão).

Instalação do pack: `node install.mjs --target <agente>` (destino conhecido) ou
`node install.mjs --dir <pasta>` (qualquer pasta, instalação por projeto).

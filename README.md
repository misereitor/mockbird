# Design Pack

Quatro skills que, juntas, fazem o agente parar de entregar layout genérico e
entregar interface com qualidade profissional — incluindo um **canvas de
telas** para você ver mockups HTML lado a lado no navegador.

| Skill | O que faz |
|---|---|
| `design` | Canvas de telas que funciona como **preview funcional do sistema**: mockups em HTML real em `design/<canvas>/` com design system por projeto, dados fictícios em `data.json` + runtime `mock.js` (login navega, formulários funcionam, listas reagem), validador, e visualizador local (zoom, tema claro/escuro, dispositivo, **cenários de dados** com seletor, **modo fluxo** em tela cheia com histórico ◀ ▶ ⟲, **gravação do fluxo** em .webm, export PNG, comentário por tela **e por elemento** — modo 🎯 vira alfinetes numerados com o seletor CSS do ponto comentado; ⟲ Reset fluxo reinicia o cenário). Sistemas com vários fluxos vivem em **vários canvases** com navegação entre eles e estado compartilhado (o login do canvas A loga o usuário no canvas B) — o visualizador tem seletor de canvas. Inclui a **camada de craft** que funde as três skills abaixo em cada tela que ela constrói. |
| `taste` | Anti-slop: lê o brief, define a direção (dials de variância/movimento/densidade), bane os clichês de IA (roxo de gradiente, 3 cards iguais, em-dash, paleta bege+latão…) e tem mapa de brief → design system real. |
| `emil-design-eng` | Filosofia de polish e animação do Emil Kowalski (criador do Sonner/Vaul, ex-Vercel/Linear): quando NÃO animar, curvas de easing, durações, detalhes invisíveis que fazem UI "sentir-se certa". |
| `impeccable` | 24 comandos de design (`/impeccable audit`, `critique`, `polish`, `harden`, `typeset`…) com engine binário próprio. Créditos: Paul Bakaus — https://impeccable.style |

A `design` é o ponto de entrada: quando você pede telas/mockups, ela já aplica
as regras das outras três (via `assets/craft.md`). As três também funcionam
sozinhas para trabalho em código frontend real.

## Requisitos

- **Node.js 18+** (o validador e o visualizador da skill `design` rodam em Node;
  não há outras dependências — tudo é offline, sem CDN).
- Um agente com suporte a **Agent Skills** (`SKILL.md` com frontmatter):
  ZCode, OpenCode, Claude Code, Codex, Cursor, Gemini CLI e afins.

## Instalação

Dentro da pasta deste pacote:

```bash
node install.mjs --target opencode   # OpenCode (global: ~/.config/opencode/skill)
node install.mjs --target zcode      # ZCode (~/.agents/skills)
node install.mjs --target claude     # Claude Code (~/.claude/skills)
node install.mjs --target codex      # Codex CLI (~/.codex/skills)
node install.mjs --target cursor     # Cursor (~/.cursor/skills)
node install.mjs --target gemini     # Gemini CLI (~/.gemini/skills)
node install.mjs --target agents     # padrão aberto (~/.agents/skills)
node install.mjs --dir .claude/skills  # ou qualquer pasta (instalação por projeto)
node install.mjs --list              # ver todos os destinos
```

Recomendação: instale **as quatro juntas** (comportamento padrão). A camada de
craft da `design` referencia as irmãs por caminho relativo (`../taste`,
`../emil-design-eng`, `../impeccable`), então elas precisam morar lado a lado.

Depois, **reinicie a sessão** do agente para as skills carregarem.

## Primeiro uso

1. Peça as telas ("landing page para o app X", "tela de login e cadastro"…)
   ou digite `/design`. Na primeira vez em um projeto, a skill cria a pasta
   `design/` (pergunta a marca), copia validador + visualizador para lá e
   valida tudo antes de te dar o link.
2. Abra o link do visualizador (algo como
   `http://localhost:8765/viewer.html?canvas=login`): telas lado a lado,
   tema claro/escuro, tamanho de dispositivo, cenários de dados, zoom,
   export PNG e botão "Comentar esta tela" — o comentário volta para o
   agente no formato exato
   `[Design: design/<canvas> › <tela> (<arquivo>)] <pedido>` e ele ajusta
   só aquela tela. Cenário, tema e dispositivo ficam lembrados por canvas.
   A documentação de utilização completa fica em `docs.html` (botão
   📘 Docs na barra do visualizador).
3. A skill `impeccable` baixa seu engine binário na primeira execução (uma
   vez só, precisa de rede). Se falhar, ela continua sem engine com fallback.

## Solução de problemas

- **OpenCode não detectou as skills**: algumas versões leem `skill/` (singular)
  e outras `skills/` (plural). Instale no padrão aberto — `node install.mjs
  --target agents` — que o OpenCode também lê, ou use
  `node install.mjs --dir <caminho>` apontando para o diretório da sua versão.
- **Porta 8765 ocupada**: `node design/serve.mjs 8766` e ajuste o link.
- **Skills não aparecem**: confirme que o agente suporta `SKILL.md` e que a
  pasta escolhida é a que ele lê (`node install.mjs --list` mostra os caminhos).

## Créditos e licenças

- `design` — porte para Agent Skills da spec portável "design canvas"
  (originalmente para o harness Kio, `@kio/skill-design`), com o visualizador
  escrito para este pacote. Export de PNG via
  [html-to-image](https://github.com/bubkoo/html-to-image) (MIT, vendado em
  `design/assets/vendor/`).
- `impeccable` — Paul Bakaus, Apache-2.0, https://impeccable.style
- `emil-design-eng`, `taste` — coleções de Emil Kowalski (MIT) e Leonxlnx
  (MIT), distribuídas conforme suas licenças originais.

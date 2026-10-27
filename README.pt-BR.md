# Mockbird

[![CI](https://github.com/misereitor/mockbird/actions/workflows/ci.yml/badge.svg)](https://github.com/misereitor/mockbird/actions/workflows/ci.yml)

> Idioma: [English](README.md) · **Português (BR)**

Quatro skills que, juntas, fazem o agente parar de entregar layouts genéricos
e começar a entregar interfaces de nível profissional — incluindo uma **tela
de canvas** para você ver os mockups HTML lado a lado no navegador.

Os mockups são HTML real e interativo: logins navegam, formulários validam,
listas reagem. Cada projeto ganha seu próprio design system, e tudo é
validado antes de você ver.

| Skill | O que faz |
|---|---|
| `design` | Canvas de telas que funciona como **preview funcional do sistema**: mockups HTML reais em `design/<canvas>/`, design system por projeto, dados fictícios em `data.json` + runtime `mock.js` (login navega, formulários funcionam, listas reagem), validador e viewer local (zoom, tema claro/escuro, tamanho de dispositivo, **cenários de dados** com seletor, **modo fluxo** em tela cheia com histórico ◀ ▶ ⟲, **gravação de fluxo** em .webm, exportação PNG, comentários por tela **e por elemento** — o modo 🎯 cria pinos numerados com o seletor CSS do ponto comentado; ⟲ Reset flow reinicia o cenário). Sistemas com múltiplos fluxos vivem em **múltiplos canvases** com navegação entre eles e estado compartilhado (o login do canvas A autentica no canvas B) — o viewer tem seletor de canvas. Inclui a **camada craft** que funde as três skills abaixo em cada tela construída. |
| `taste` | Anti-slop: lê o briefing, define a direção (controles de variância/movimento/densidade), ban clichês de IA (gradientes roxos, três cartões idênticos, travessões, paletas bege+bronze…) e mapeia briefing → design system real. |
| `emil-design-eng` | A filosofia de polimento e animação do Emil Kowalski (criador do Sonner/Vaul, ex-Vercel/Linear): quando NÃO animar, curvas de easing, durações, os detalhes invisíveis que fazem a UI "parecer certa". |
| `impeccable` | 24 comandos de design (`/impeccable audit`, `critique`, `polish`, `harden`, `typeset`…) com motor binário próprio. Créditos: Paul Bakaus — https://impeccable.style |

O `design` é o ponto de entrada: quando você pede telas/mockups ele já aplica
as regras das outras três (via `assets/craft.md`). As três também funcionam
de forma independente em código frontend real.

## Requisitos

- **Node.js 18+** (o validador, o viewer do skill `design` e todas as
  ferramentas rodam no Node 18 puro — sem outras dependências, tudo offline,
  sem CDN).
- Um agente com suporte a **Agent Skills** (`SKILL.md` com frontmatter):
  ZCode, OpenCode, Claude Code, Codex, Cursor, Gemini CLI e companhia.

## Instalação

> **Usando OpenCode v2?** O caminho recomendado é o **plugin de auto-update**
> ([veja abaixo](#plugin-opencode-v2-auto-update)) — ele mantém skills e
> projetos atualizados sozinhos. O `install.mjs` continua sendo o caminho
> para os demais agentes e para instalações estáticas.

Na pasta deste pacote. As duas flags de instalação são `--target <agente>`
(destino conhecido) e `--dir <pasta>` (qualquer pasta, instalação por projeto):

```bash
node install.mjs --target opencode   # OpenCode (global: ~/.config/opencode/skills + commands/)
node install.mjs --target zcode      # ZCode (~/.agents/skills)
node install.mjs --target claude     # Claude Code (~/.claude/skills)
node install.mjs --target codex      # Codex CLI (~/.codex/skills)
node install.mjs --target cursor     # Cursor (~/.cursor/skills)
node install.mjs --target gemini     # Gemini CLI (~/.gemini/skills)
node install.mjs --target agents     # padrão aberto (~/.agents/skills)
node install.mjs --dir .claude/skills  # ou qualquer pasta (instalação por projeto)
node install.mjs --list              # ver todos os destinos
```

Destinos OpenCode também recebem os **slash commands** (`/design`, `/taste`,
`/emil-design-eng`, `/impeccable`) na pasta `commands/`. Sem eles, invoque as
skills mencionando (`@design`) ou apenas peça — skills não são slash commands
no OpenCode v2; o agente carrega a skill certa sozinho.

Recomendação: instale **as quatro juntas** (comportamento padrão). A camada
craft do `design` referencia as skills irmãs por caminho relativo (`../taste`,
`../emil-design-eng`, `../impeccable`), então elas precisam ficar lado a lado.

Depois **reinicie a sessão do seu agente** para as skills carregarem.

## Plugin OpenCode v2 (auto-update)

O diretório `plugin/` faz o Mockbird se comportar como um **plugin do
OpenCode v2** que se atualiza sozinho. O `setup()` roda toda vez que o
OpenCode abre um projeto e faz quatro coisas:

1. **Auto-update** — `git pull --ff-only` neste repositório (intervalo mínimo
   de 10 minutos entre pulls; offline ou sem remote mantém a versão local,
   sem erros).
2. **Skills sem cópias** — as quatro skills são registradas direto de
   `skills/` via `ctx.skill.transform`. Fonte única de verdade: nada de
   manter cópias em `~/.agents/skills`, `~/.claude/skills` ou
   `~/.config/opencode/skills`.
3. **Espelho de runtime** — os arquivos de runtime (`viewer.html`, `mock.js`,
   `mock.css`, `docs.html`, `serve.mjs`, `validate.mjs`, `vendor/`,
   `scripts/`) são espelhados na pasta `design/` do projeto atual. Arquivo
   cujo conteúdo diverge ganha um backup `<arquivo>.bak` da versão local
   antes de ser atualizado. `components/` é apenas *seed*: preenchido quando
   falta, nunca sobrescrito (os registros crescem por projeto).
4. **Slash commands** — `/design`, `/taste`, `/emil-design-eng`,
   `/impeccable` (um por skill, a partir de `commands/*.md`) mais o
   `/design-sync`, que força o `git pull`, recarrega as skills e re-espelha
   o `design/` do projeto sob demanda.

Instale (uma vez por máquina) — **faça clone do repositório** (um download
ZIP não tem `.git`, então o auto-update ficaria desativado):

```bash
git clone https://github.com/misereitor/mockbird.git
cd mockbird/plugin && npm install   # dependência @opencode/plugin (API v2)
```

E registre o caminho na sua configuração global
(`~/.config/opencode/opencode.json`):

```jsonc
{
  "plugins": ["/caminho/para/mockbird/plugin"]   // Windows: "C:/caminho/para/mockbird/plugin"
}
```

A partir daí o fluxo de atualização é só: **commit + push aqui** → na próxima
vez que o OpenCode abrir em qualquer projeto, o `git pull` traz tudo e o
`design/` do projeto é espelhado automaticamente.

Observações:

- Projetos sem pasta `design/` nunca são tocados (o plugin nunca cria
  `design/` — o skill cria, no primeiro uso).
- `node plugin/smoke.mjs <projeto>` testa o espelhamento à mão, sem abrir o
  OpenCode.
- Diagnósticos: cada `setup()` escreve o que fez em
  `%TEMP%\mockbird-plugin.log` (a saída de `console.log` do plugin não aparece
  no log do OpenCode).
- O `install.mjs` continua valendo para Claude Code, Codex, Cursor, Gemini e
  instalações por projeto.

## Primeiro uso

1. Peça as telas ("landing page do app X", "tela de login e cadastro"…) ou
   digite `/design`. No primeiro uso em um projeto, o skill cria a pasta
   `design/` (ele pergunta a marca), copia validador + viewer para lá e
   valida tudo antes de te passar o link.
2. Abra o link do viewer (algo como
   `http://localhost:8765/viewer.html?canvas=login`): telas lado a lado,
   tema claro/escuro, tamanho de dispositivo, cenários de dados, zoom,
   exportação PNG e um botão "Comment this screen" — o comentário volta para
   o agente no formato exato
   `[Design: design/<canvas> › <screen> (<file>)] <pedido>` e ele ajusta
   só aquela tela. Cenário, tema e dispositivo são lembrados por canvas. A
   documentação completa de uso fica em `docs.html` (botão 📘 Docs na toolbar
   do viewer).
   **Projetos complexos**: marque as telas com `"group"` no `canvas.json`
   para ter blocos com título, ative **▦ Grade** para uma visão que quebra em
   linhas, digite `/` para buscar telas, **📱 Moldura** coloca molduras de
   dispositivo em telas mobile/tablet, as telas carregam conforme você rola,
   e o `Comparar` aceita quaisquer duas telas lado a lado (não só snapshots).
   **Idioma**: o viewer e os docs são bilíngues — inglês por padrão, seguindo
   o idioma do navegador (português incluso) — `?lang=pt` / `?lang=en` forçam
   e o botão 🌐 alterna na hora. Os nomes citados aqui são os da interface em
   português.
3. O skill `impeccable` **baixa um binário de terceiros** — seu motor, dos
   releases do [pbakaus/impeccable](https://github.com/pbakaus/impeccable) —
   na primeira execução (uma vez, precisa de rede). O launcher valida o
   binário (probe + cache com versão fixa), você pode pré-instalar o seu
   próprio via a variável de ambiente `IMPECCABLE_BIN`, e se o download
   falhar o skill segue sem o motor via fallback.

Os comandos que vivem no `design/` do projeto são `node design/validate.mjs`,
`node design/serve.mjs [porta] [--share] [--open[=canvas]] [--no-open]`,
`node design/scripts/gen-tokens.mjs`, `node design/scripts/sync-components.mjs`
e `node design/scripts/export-tokens.mjs` (instalados). O servidor abre o
navegador padrão no viewer (`--open=<canvas>` cai direto num canvas,
`--no-open` suprime, a variável de ambiente `BROWSER` escolhe um navegador
específico).

## Solução de problemas

- **O OpenCode não detectou as skills**: algumas versões leem `skill/`
  (singular) e outras `skills/` (plural). Instale no padrão aberto —
  `node install.mjs --target agents` — que o OpenCode também lê, ou use
  `node install.mjs --dir <pasta>` apontando para o diretório da sua versão.
- **Porta 8765 em uso**: `node design/serve.mjs 8766` e ajuste o link.
- **Skills não aparecem**: confirme que seu agente suporta `SKILL.md` e que a
  pasta escolhida é a que ele lê (`node install.mjs --list` mostra os
  caminhos).

## Contribuindo

Issues e pull requests são bem-vindos — veja [CONTRIBUTING.md](CONTRIBUTING.md)
para os invariantes, comandos de teste e checklist de PR. Alguns pontos:

- Mantenha as quatro skills instaláveis lado a lado — a camada craft do
  `design` referencia `../taste`, `../emil-design-eng` e `../impeccable`.
- O validador, o viewer e o runtime mock viajam dentro da pasta `design/` de
  cada projeto; mudanças neles são espelhadas pelo plugin (e pela copy list
  do `SKILL.md`), então atualize os dois lados juntos.
- `node plugin/smoke.mjs <projeto>` espelha um projeto à mão; rode o
  validador contra o canvas de exemplo em `skills/design/assets/example/`
  depois de mexer no `validate.mjs`.
- Ao contribuir você concorda que suas contribuições são licenciadas sob a
  licença MIT deste repositório.

## Changelog

- **Editar + preview na rede lado a lado (v1.0.15)**: rode
  `node design/serve.mjs` (sua instância de edição completa) e
  `node design/serve.mjs 8766 --share` (a somente leitura para a rede) no
  mesmo projeto — o start do share agora imprime uma URL `LAN:` pronta para
  colar (em vez de `0.0.0.0`), quem vê acompanha suas edições ao vivo, e só
  a instância de edição grava em disco: a instância `--share` não registra
  mais histórico de arquivos (somente leitura em espírito e em disco, e sem
  revisões duplicadas com as duas rodando).
- **O modo leitura se explica (v1.0.14)**: sob `--share` o botão direito não
  fazia *nada* (o menu do elemento se recusava a abrir em silêncio) — agora
  ele responde "Modo leitura (--share): comentários indisponíveis — rode sem
  --share para comentar". Degradação declarada, nunca silêncio. O modo leitura
  agora está coberto pela suíte de aceitação (12/12).
- **Versão na tela (v1.0.13)**: o viewer mostra uma etiqueta pequena de versão
  no rodapé à direita, e o CI falha se ela divergir do `package.json` — todo
  relato diz exatamente qual versão está rodando (acaba a ambiguidade de aba
  desatualizada).
- **Comentários resolvidos continuam visíveis (v1.0.12)**: comentários não
  podem mais "sumir" — os resolvidos caíam do painel de pendentes por
  completo (que então mostra "nada pendente") enquanto ficavam acinzentados na
  tela. O painel agora mantém uma seção **Resolvidos (N)** com **Reabrir** em
  um clique, e todo resolver/reabrir se anuncia num toast ("listado em
  Pendentes › Resolvidos"). Travado na suíte de aceitação (10/10).
- **O viewer se atualiza sozinho + aceitação em browser de verdade (v1.0.11)**:
  o viewer agora vigia o **próprio** arquivo e recarrega a aba sozinho quando
  ele muda — os fixes chegam na sua tela sem F5 (era por isso que as mudanças
  "não funcionavam": a aba rodava JS antigo). Nova suíte de aceitação
  `npm run test:ui` (Edge/Chrome + `playwright-core`) que roda o fluxo
  central num browser de verdade — selecionar, comentar, menu do botão direito
  (lista e modo fluxo), seleção por retângulo, auto-reload — 9/9 verde.
- **Contrato do mouse, finalmente (v1.0.10)**: o esquerdo seleciona (clique ou
  arraste a caixa de seleção), o botão do meio move, e o **botão direito abre
  o menu do elemento** (💬/📋/🧩) — sempre. O botão direito tinha virado gesto
  de pan (e um guard pós-gesto engolia o menu): os dois foram removidos; o
  direito nunca é gesto agora.
- **Resgate: histórico por arquivo + botão direito de volta (v1.0.9)**: com o
  servidor rodando, toda mudança em qualquer arquivo de `design/` vira uma
  revisão (`design/.history/`, as 20 mais recentes por arquivo) e o novo
  painel 🕘 **Histórico** restaura **exatamente um arquivo, uma versão** —
  nada mais no sistema é tocado (telas independentes; arquivos compartilhados
  restauram por inteiro; a visualização atualiza sozinha; cada restauração
  também vira uma nova revisão). Também: o botão direito do mouse volta a
  panoramizar (foi derrubado sem querer na redefinição de interações) e o
  clique direito continua abrindo o menu de elemento — sem abrir um depois
  de um arraste.
- **Correção do click preso + versão silenciosa (v1.0.8)**: soltar o mouse
  dentro do iframe de uma tela (ou trocar de janela no meio do arraste)
  podia perder o `pointerup` e deixar o canvas "grudado" seguindo o mouse —
  os gestos do canvas agora terminam em `pointerup`/`pointercancel`/blur,
  são repassados de dentro dos iframes e cada gesto novo curta qualquer
  gesto remanescente. A numeração também fica quieta: a era 1.0.x sobe o
  dígito de patch (os releases antigos foram renumerados — `v1.0.1`…`v1.0.7`).
- **Comentários direto ao agente (v1.0.7)**: comentar no visualizador agora
  entrega a mensagem `[Design: …]` direto na sua sessão do OpenCode — sem
  copiar/colar. O overlay mostra exatamente o que aconteceu ("Enviado ao
  agente — sessão: X"); quando o agente está inalcançável cai honestamente no
  fallback da cópia. Nova rota `POST /api/agent-send` (mesmo contrato de
  localhost+token, 403 no `--share`) fala com o serviço local do OpenCode e
  escolhe a sessão mais recente do projeto (criando uma se preciso).
- **Seleção por retângulo + canvas de ferramenta (v1.0.6)**: arraste no canvas vazio
  para selecionar por retângulo todos os telas tocadas (Shift+clique soma à
  seleção, clique no vazio limpa; o botão PNG exporta a seleção inteira). O
  mouse passa a se comportar como em ferramentas de design: o botão do meio
  panoramiza em qualquer lugar (sobre as telas e dentro do modo fluxo),
  arrastar sobre uma tela também panoramiza, e o arraste-comentar foi para o
  modo 🎯 Elemento. Reloads mantêm você no lugar: o ⟳ do modo fluxo
  recarrega a tela atual (o ⟲ Reset fluxo reinicia do começo), o reload da
  fita preserva zoom/pan e o F5 volta para a mesma tela e histórico do fluxo.
- **Atualização ao vivo das telas (v1.0.5)**: o visualizador agora vigia cada
  HTML de tela, o `data.json` e o runtime compartilhado
  (`mock.js`/`mock.css`, `design-system.css`, `utilities.css`) — o arquivo
  que mudou atualiza só o que mudou (uma tela editada re-aponta o próprio
  iframe; o modo fluxo também atualiza), então edições feitas pelo agente
  aparecem sem tocar em nada. O `serve.mjs` agora envia `Last-Modified` para
  detecção barata de mudança, com fallback de hash por GET em servidores
  antigos.
- **Correção de navegação por sidebar (v1.0.4)**: um link de tela com
  `data-go` — o padrão de sidebar/menu, mantendo um `href` real como fallback
  sem JS — abria um overlay *e* navegava ao mesmo tempo; agora o `data-go`
  vai direto para o `Mock.go` (preservando `?scenario=` e a transição de
  entrada). A skill de design agora exige o padrão para navegação persistente
  (itens de sidebar/menu trocam de tela de verdade; links comuns continuam
  sendo o gatilho de overlay/modal) e o `npm run test:mock` trava os
  contratos de navegação/overlay.
- **Slash commands + correção da descoberta no OpenCode (v1.0.3)**: `/design`,
  `/taste`, `/emil-design-eng` e `/impeccable` agora existem como slash
  commands de verdade — registrados pelo plugin a partir de `commands/*.md`
  (um por skill) e instalados pelo `install.mjs` na pasta `commands/` do
  OpenCode. Skills sozinhas não são slash commands no OpenCode v2 (menções
  `@design` e o carregamento automático continuam funcionando). Também foi
  corrigido o caminho de instalação global: `~/.config/opencode/skills`
  (plural — o V2 nunca descobriu a pasta singular `skill/` antiga).
- **i18n do viewer/docs (v1.0.2)**: a interface do viewer e o `docs.html`
  falam inglês por padrão e seguem o idioma do navegador (PT-BR incluso) —
  `?lang=pt` / `?lang=en` forçam, o botão 🌐 alterna e mantém seu lugar.
  Toda string vive num dicionário `I18N` único (EN + PT, com verificação
  automática de sincronia) e o `docs.html` carrega os dois idiomas lado a
  lado. Os toasts de erro do `mock.js` também seguem o idioma do viewer.
- **Viewer para projetos complexos (v1.0.1)**: blocos `"group"` no
  `canvas.json`, ▦ Grade (visão quebra em linhas), busca de telas (`/`),
  📱 Moldura (molduras de dispositivo), telas com lazy-load e tela-vs-tela no
  `Comparar` (A/B agora aceita telas vivas, não só snapshots). O `serve.mjs`
  abre o navegador padrão no viewer (`--open[=canvas]`, `--no-open`, env
  `BROWSER`) e o viewer esconde ações que o navegador não consegue fazer
  (`data-require` — degradação declarada). Mais: testes unitários no CI,
  `CONTRIBUTING.md`, templates de issue/PR e releases por tag (tag `v*` →
  release no GitHub).
- **CI + core em JS puro (v1.0.0)**: GitHub Actions roda o smoke test, o
  instalador, o validador e a suite de segurança em Linux/Windows ×
  Node 18/20/22/24. A lógica do plugin foi para `plugin/core.mjs` (JS puro),
  então `node plugin/smoke.mjs` agora roda no Node 18 puro. Primeira release
  versionada: `v1.0.0`.
- **Nada de janelas de console no Windows**: as chamadas `git` do auto-update
  agora nascem ocultas (`windowsHide` / `CREATE_NO_WINDOW`) — abrir um
  projeto não pisca mais uma janela de CMD; todo o resto já rodava
  in-process.
- **Plugin OpenCode v2 (`plugin/`)**: o Mockbird agora roda como plugin
  auto-atualizável do OpenCode — `git pull` na abertura (intervalo de 10
  min), skills registradas direto do repositório (sem cópias) e espelhamento
  automático do `design/` de cada projeto (arquivos alterados ganham um
  `<arquivo>.bak`; `components/` só é preenchido quando falta). Comando
  `/design-sync` força a sincronização. Migração: registre a pasta `plugin/`
  do repositório clonado em `~/.config/opencode/opencode.json` (`plugins`).
- **Bind padrão `127.0.0.1` + raiz servida `./design`** (mudança de
  comportamento): `node design/serve.mjs` serve só a máquina local — a API de
  escrita (`/api/*`) nunca é exposta à rede — e serve `./design` relativo ao
  cwd (a mesma raiz que o pipeline gen/sync/validate usa), nunca a pasta do
  próprio script.
- **`--share` — caminho de migração para testar no celular/LAN**:
  `node design/serve.mjs 8766 --share` faz bind em `0.0.0.0` para abrir
  `http://<ip-da-maquina>:8766/viewer.html?canvas=…` no celular. É
  **somente leitura com degradação declarada**: toda rota `/api/*` responde
  **403** (leituras incluídas — nada vaza) e o viewer esconde ações de
  escrita **e** os recursos alimentados pela `/api` (pinos, painel de
  comentários pendentes, reply/resolve) com o aviso "read-only mode —
  comments and snapshots unavailable".
- **Contrato de degradação (futuro)**: UIs de snapshot/comparação que
  chegarem depois também precisam ficar escondidas sob `--share` — basta
  marcá-las com `data-share-hide` no HTML e o `syncShareDegradation()` do
  viewer as esconde.
- **Snapshots, comparação e revert (w5)**: o painel **Snapshots** do viewer
  salva um estado do canvas (`src/` + `render/` achatado), compara dois
  estados nos modos **Side by side** e **Onion skin** e restaura com o botão
  **"Revert to this snapshot"** (com confirmação) — uso direto da API:
  `POST /api/revert {"canvas": "<canvas>", "label": "<label>"}` (400 =
  manifesto inválido, nada restaurado; 500 = pipeline falhou, rollback).

## Créditos e licenças

- `design` — porta Agent Skills da especificação portátil "design canvas"
  (originalmente para o harness Kio, `@kio/skill-design`), com o viewer
  escrito para este pacote. Exportação PNG via
  [html-to-image](https://github.com/bubkoo/html-to-image) (MIT, embutido em
  `design/assets/vendor/`).
- `impeccable` — Paul Bakaus, Apache-2.0, https://impeccable.style
  ([pbakaus/impeccable](https://github.com/pbakaus/impeccable))
- `emil-design-eng` — Emil Kowalski, MIT
  ([emilkowalski/skills](https://github.com/emilkowalski/skills))
- `taste` — Leonxlnx, MIT
  ([Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill))
- Todo o resto deste repositório: MIT (veja [LICENSE](LICENSE)).

Cada skill traz seu próprio arquivo de licença (`skills/<name>/LICENSE`),
copiado em toda instalação junto com o skill.

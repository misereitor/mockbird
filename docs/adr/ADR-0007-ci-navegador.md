# ADR-0007 — Provisionamento de navegador no CI e exclusões explícitas da matriz

## Status

Aceito em 2026-11-05. Registrado pelo todo 15 do plano `mockbird-evolution`
(GAP-A5, GAP-F3). Este ADR não foi substituído nem revisado.

## Contexto

O pipeline promove os smokes visuais ao CI (`npm run ci` passa a encadear
`smoke:screen`, `test:ui` e `visual:gate`), mas `playwright-core` 1.64.1 (devDep
fixado) não embute navegadores: em um runner limpo,
`chromium.launch()` falha com "Executable doesn't exist" a menos que o chromium
seja provisionado explicitamente. As máquinas de desenvolvimento escondem o
problema porque os navegadores já vivem em `~/.cache/ms-playwright` — o CI é
justamente onde a ausência de provisionamento aparece.

Três restrições concretas condicionam o desenho:

1. **Node 18 não suporta a pilha de navegador.** A matriz mantém node 18 porque
   o núcleo do plugin roda em Node 18+ (`plugin/smoke.mjs:2`), mas
   `playwright-core` 1.64 declara `engines.node >= 20` e o CLI aborta de fato:
   `You are running Node.js 18.20.4. Playwright requires Node.js 20 or higher.`
   (verificado com Node 18.20.4 real, não só pelo campo engines).
2. **Baselines de screenshot são únicos por viewport, não por plataforma.**
   `skills/design/assets/example/snapshots/<tela>-<w>x<h>.png` são congelamentos
   renderizados no linux com fontes de sistema
   (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` em
   `design-system.css:36`) e comparados com `maxDiffPixelRatio` plano 0.02
   (`validate.config.json` `smoke.snapshotThreshold`) — o smoke de tela não usa
   os limiares por plataforma do `lib/image-diff.mjs` (esses valem para o diff
   de capturas do `visual-gate`). Rasterização cross-OS (ClearType no windows,
   hinting distinto) estoura 0.02 em telas densas de texto: a perna windows
   não tem como passar no `smoke:screen` sem baselines congelados no próprio
   windows.
3. **Provisionamento nunca pode ser mascarado.** Falha para baixar navegador ou
   dependências de sistema deve derrubar o job; `|| true` transformaria um CI
   sem checks visuais reais em sucesso verde (proibido pelo plano).

Alternativas consideradas e rejeitadas:

- `npx playwright install --with-deps chromium`: o `npx` sem pacote local
  instalado baixaria o pacote `playwright` do registry numa versão não fixada.
  Usa-se a CLI do devDep fixado: `npx playwright-core install --with-deps chromium`.
- Canal de navegador do runner (Chrome/Edge pré-instalado): versão do navegador
  flutua com a imagem do runner e quebra o congelamento dos baselines; além
  disso os scripts só resolvem Edge automaticamente no caminho fixo do windows
  (`scripts/viewer-accept.mjs:77`, `skills/design/scripts/smoke.mjs:476`) e caem
  para o chromium registrado do playwright nos demais SOs.
- Rodar a cadeia completa em toda a matriz mascarando o `smoke:screen` no
  windows: proibido — seria `|| true` com outro nome.

## Decisão

1. **Provisionamento explícito de navegador antes dos checks visuais** em
   `.github/workflows/ci.yml`:
   `npx playwright-core install --with-deps chromium` (a CLI do devDep
   playwright-core 1.64.1; `--with-deps` instala as libs de SO no runner
   debian). O passo roda imediatamente antes do `npm run ci` e qualquer falha
   sua reprova o job.
2. **`npm run ci` (cadeia completa, 10 checks, 3 visuais) roda apenas em
   células com suporte a navegador e baselines válidos**: `ubuntu-latest` ×
   node 20/22/24.
3. **Exclusões explícitas da matriz, nunca mascaradas** — as células restantes
   (`ubuntu-latest` × node 18; `windows-latest` × node 18/20/22/24) rodam
   `npm run ci:base`: a mesma cadeia menos `smoke:screen` e `test:ui`, com
   `visual:gate` mantido. O motivo de cada exclusão é o item de Contexto 1
   (node 18) e o item 2 (windows).
4. **A cadeia `ci` nunca perde checks para ficar verde.** Se um check visual
   falhar, o CI fica vermelho apontando o check; a correção é o baseline (via
   `--update-snapshots`, caminho declarado de regeneração) ou o código.

## Consequências

- O log de todo job verde da cadeia completa contém os 3 checks visuais
  (`smoke:screen`, `test:ui`, `visual:gate`) parseáveis; as células excluídas
  ainda executam `visual:gate` (compara 0 pares enquanto não houver baseline
  congelado em `<target>/.visual/baseline/` — aviso, semântica do gate, não
  bloqueio).
- Custo de CI sobe (download do chromium ~170 MB + deps de SO por célula
  ubuntu elegível); é o custo declarado de ter checks visuais reais.
- A perna windows perde `test:ui` no CI, embora o script resolva Edge no
  windows. Reabilitação futura, sem mascarar nada: validar `test:ui` numa
  perna windows e adicionar a condição correspondente; para `smoke:screen` no
  windows é preciso congelar baselines por plataforma (hoje o naming
  `<tela>-<w>x<h>.png` não tem variante de SO) e revisar o limiar 0.02.
- Mudar a cadeia `ci` para excluir um check visual exige atualizar este ADR —
  a cadeia é contrato de aceitação do plano (todo 15).

## Reversibilidade

- **Reversível por configuração**: as exclusões são condições `if:` nomeadas no
  workflow; ampliar (ou restringir) células é uma edição de condição, com este
  ADR atualizado junto.
- **Trocar o mecanismo de provisionamento** (ex.: cache de
  `~/.cache/ms-playwright` via `actions/cache`, ou navegador do runner) é
  ortogonal ao passo: o contrato é "navegador disponível antes dos checks
  visuais, falha de provisionamento reprova".
- **Reverter para o CI sem navegador** exigiria remover `smoke:screen` e
  `test:ui` da cadeia `ci`, que é o estado GAP-A5 que este ADR fecha — exigiria
  um ADR substituto que registre por que o projeto aceita CI sem checks
  visuais.

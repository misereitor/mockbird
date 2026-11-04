# Mapa de camadas Core/Skills/Adapters e ownership por subsistema

> Todo 3 do plano `mockbird-evolution`. Fonte primária: `docs/auditoria.json`
> (classificação por arquivo/grupo feita no todo 1; narrativa em
> `docs/auditoria-tecnica.md`). **gitSHA auditado:**
> `05131bec8813f3e06348e8772c8967fd83bda00b` — este mapa não reclassifica
> nada: camada e subsistema de cada arquivo saem do audit; o que o mapa faz é
> agregar por diretório, fixar o **dono único por capacidade** e registrar as
> fronteiras decididas. Verificação mecânica: `node docs/camadas.check.mjs`
> (exit 0 = mapa completo e coerente com a árvore e com o audit). Decisões de
> remap da taxonomia: `docs/adr/ADR-0005-remap-taxonomia.md`.

## 1. Como ler este mapa

### 1.1 As três camadas (definição travada)

| Camada | Definição | Exemplos neste repo |
| --- | --- | --- |
| Core | Código executável determinístico + dados/contratos que os motores consomem ou geram | `skills/design/scripts/validate.mjs`, `skills/design/scripts/smoke.mjs`, `skills/design/assets/serve.mjs`, `skills/design/assets/mock.js`, fixtures/corpus |
| Skills | Instrução/documentação escrita à mão para humanos e LLMs | `skills/design/assets/craft.md`, `skills/taste/SKILL.md`, `skills/impeccable/reference/`, `docs/migration-guide.md` |
| Adapters | Superfícies de integração/entrega (provider/plugin glue) | `plugin/core.mjs`, `plugin/index.ts`, `commands/`, `.github/`, launchers, bundles vendorizados |

### 1.2 Regra de ownership

- **Owner único por capacidade**: cada capacidade tem exatamente UM subsistema
  dono (tabela §2). Um arquivo pode SERVIR vários subsistemas — a coluna
  "Subsistemas servidos" da tabela §3 registra isso — mas a capacidade não tem
  dois donos.
- **Atribuição de todo planejado (9-62), nesta ordem de força:**
  1. título do todo que nomeia um dos 8 subsistemas (ex.: todo 18 "Design Memory" → 7);
  2. agrupamento do plano cujo título é nome de subsistema (ex.: "Implementation QA: …" → 6);
  3. subsistema dono do artefato primário que o todo estende (pelo `docs/auditoria.json`);
  4. capacidade transversal de gate/CI/CI-tooling/CLI → 8; natureza de revisão ou
  avaliação humana → 5; operação/serviço do runtime → 2.
- Contestações e alternativas descartadas: `docs/adr/ADR-0005-remap-taxonomia.md`.

### 1.3 Staleness — o que invalida este mapa

1. `docs/auditoria.json` regenerado com **gitSHA novo** (o check exige que o
   gitSHA embutido aqui bata com o do audit e lista o drift desde ele).
2. Diretório de produto novo (skill novo, raiz nova, subárvore nova fora das
   linhas da tabela §3) — o check falha por cobertura até existir linha nova.
3. Arquivo auditado que muda de camada/subsistema — a coluna "Subsistemas
   servidos" deixa de bater com a recomputação e o check falha nomeando a linha.
4. Todo 9-62 concluído — mover o número da coluna "Planejado" para "Existe hoje"
   na tabela §2 (a partição exata 9-62 continua obrigatória enquanto houver
   planejados; se o todo ganhar número novo no plano, atualizar a coluna).
5. Mudança na lista de exclusões do audit (prefixos prospectivos) — recalcular
   as contagens citadas na coluna "Existe hoje (audit)".

## 2. Ownership por subsistema (enum fixo 1-8)

| Subsistema | Camada dona | Arquivos donos (capacidade → arquivo) | Existe hoje (audit) | Planejado (todos 9-62) |
| --- | --- | --- | --- | --- |
| 1 Design Intelligence | Skills | critérios/dials → `skills/design/assets/craft.md`; gosto/anti-slop → `skills/taste/SKILL.md`; engenharia de design → `skills/emil-design-eng/SKILL.md` | 5 entradas (todas Skills) — prosa completa, com contradições entre si abertas | 17, 19, 20, 21 |
| 2 Prototype Engine | Core | runtime → `skills/design/assets/mock.js`; canvas → `skills/design/assets/viewer.html`; servidor → `skills/design/assets/serve.mjs`; contratos do runtime → `scripts/mock-check.mjs`; aceitação → `scripts/viewer-accept.mjs` | 20 entradas (16 Core, 3 Skills, 1 Adapters) + fixtures-seguranca (1) | 16, 35, 53, 54, 55, 56, 58, 59, 62 |
| 3 Design System | Core | tokens → `skills/design/scripts/gen-tokens.mjs`; registry/marcadores → `skills/design/scripts/sync-components.mjs` + `skills/design/scripts/marker-parser.mjs`; TSX → `skills/design/scripts/codegen.mjs`; contratos → `skills/design/assets/tokens.contract.md` | 40 entradas (todas Core) + fixtures-consumidores (116), marker (1), codegen (1) | 22, 23, 24, 25, 26, 45 |
| 4 Visual QA | Core | smoke de telas → `skills/design/scripts/smoke.mjs`; viewports → `skills/design/scripts/lib/viewport.mjs`; baselines → `skills/design/assets/example/snapshots/manifest.json` | 4 entradas (todas Core) + fixtures-smoke (22) | 9, 10, 11, 12, 13, 37, 40, 41 |
| 5 Review Engine | Skills | revisão/auditoria → `skills/impeccable/SKILL.md`; playbooks → `skills/impeccable/reference/`; live variant → `skills/impeccable/scripts/live-browser.js`; comentários → `skills/design/assets/example/comments.json` | 55 entradas (44 Skills, 9 Core, 3 Adapters) | 46, 57 |
| 6 Implementation QA | Core | validador → `skills/design/scripts/validate.mjs`; regras → `skills/design/scripts/rules/`; rig R1-R4 → `skills/design/scripts/qa.mjs`; config → `skills/design/assets/validate.config.json` | 15 entradas (todas Core) + fixtures-validador (190) | 27, 28, 29, 30, 31, 38 |
| 7 Design Memory | Core | spec por tela → `skills/design/scripts/export-spec.mjs`; agent map → `skills/design/scripts/agent-map.mjs`; busca direta → `skills/design/scripts/find.mjs` | 28 entradas (todas Core) + fixtures de mapa/busca (15) | 18, 43 |
| 8 Agent Orchestration & Quality Gates | Adapters | plugin → `plugin/core.mjs` + `plugin/index.ts`; comandos → `commands/`; CI/release → `.github/workflows/ci.yml`; setup por projeto → `skills/design/scripts/setup-design.mjs` + `skills/design/scripts/copy-list.json`; guias → `docs/migration-guide.md` | 20 entradas (15 Adapters, 4 Core, 1 Skills) + fixtures-setup-legacy (10) | 14, 15, 32, 33, 34, 36, 39, 42, 44, 47, 48, 49, 50, 51, 52, 60, 61 |

### 2.1 Existe hoje × planejado, por subsistema

- **1 Design Intelligence (Skills)** — Existe: camada de craft fundida, dials
  VARIANCE/MOTION/DENSITY, bans de gosto. Planejado: 17 brief auditável com
  detecção de contradições; 19 três direções comparáveis; 20 UX/task
  simulation; 21 context inspector.
- **2 Prototype Engine (Core)** — Existe: runtime mock offline (data/state/go/
  overlay/toast, action modules), viewer de 5,1 mil linhas, servidor zero-dep
  com API tokenizada. Planejado: 16 CSP + sanitização; 35 segurança do
  viewer/servidor; 53 serviço multi-projeto; 54 autenticação; 55 usuários e
  papéis; 56 autorização por rota; 58 persistência/backup; 59 segurança do
  serviço; 62 manual do serviço.
- **3 Design System (Core)** — Existe: pipeline de tokens determinístico,
  registry schema v2 com rematerializador por marcadores, codegen TSX, 14
  partials seed, contrato de tokens travado por regra. Planejado: 22 catálogo
  com variantes/estados; 23 discovery; 24 governança + health; 25 contract
  testing de estados; 26 responsive + a11y; 45 sandbox de tokens.
- **4 Visual QA (Core)** — Existe: smoke v2 por viewport derivado com baseline
  pixel a pixel e manifesto. Planejado: 9 captura matricial 5×7; 10 diff
  determinístico + SSIM; 11 Visual Critic estruturado; 12 score por critério +
  gate por diff; 13 orquestrador com relatório único; 37 calibração de recall
  do crítico; 40 bisect visual; 41 estresse i18n + perf budget.
- **5 Review Engine (Skills)** — Existe: skill impeccable completa (41
  playbooks), live variant mode, fluxo de comentários com pins. Planejado: 46
  avaliação cega A/B; 57 superfícies multiusuário de comentário (autoria,
  papéis, resolve restrito).
- **6 Implementation QA (Core)** — Existe: validador determinístico com 10
  regras carregadas por extensão, rig R1-R4, baseline de métricas, config v2.
  Planejado: 27 aprovação por hash ligada a DEC-ids; 28 parity
  protótipo×frontend; 29 mapa/auditoria de interações; 30 docs geradas; 31
  evolution + experiments; 38 slop-lint executável.
- **7 Design Memory (Core)** — Existe: export de spec por tela, snapshots
  versionados, agent map gerado, busca direta arquivo:linha. Planejado: 18
  memória de decisões DEC-xxx com impacto/consulta; 43 lições exportáveis
  entre projetos. (O nome do subsistema cobre hoje artefatos de
  especificação/memória de TELA; a memória de DEC é justamente o todo 18.)
- **8 Agent Orchestration & Quality Gates (Adapters)** — Existe: plugin
  OpenCode (MIRROR/SEED, pull, sync, carimbo de versão), 5 comandos, CI/release
  no GitHub, setup por projeto via copy-list, i18n-check, guia de migração.
  Planejado: 14 benchmark; 15 CI real; 32 contrato DesignAgent; 33 orquestração
  de papéis; 34 update pinado; 36 sync schema↔instrução; 39 corpus dourado;
  42 maturity scorecard; 44 compat de contrato público; 47 done:check; 48-52
  conector LLM + loop embutido; 60 CLI única; 61 pack portátil.

## 3. Mapa por diretório de produto (1 linha por diretório)

Subsistemas servidos = conjunto por subárvore recomputado do `docs/auditoria.json`
(conferido pelo check; linha mista declara todos). Camada = camada dominante
pelo audit; "(misto)" quando a subárvore tem mais de uma camada.

| Diretório | Camada | Subsistemas servidos | Arquivo dono | Papel |
| --- | --- | --- | --- | --- |
| .github | Adapters | 8 | `.github/workflows/ci.yml` | entrega contínua, release por tag, templates |
| commands | Adapters | 8 | `commands/design.md` | comandos registrados pelo plugin |
| docs | Skills | 8 | `docs/migration-guide.md` | guias operacionais escritos à mão |
| plugin | Adapters | 8 | `plugin/core.mjs` | adaptador OpenCode: MIRROR/SEED, pull, sync, carimbo |
| scripts | Core | 2,8 | `scripts/mock-check.mjs` | suítes determinísticas fora do skill design |
| skills/design | Core (misto) | 1,2,3,4,5,6,7,8 | `skills/design/SKILL.md` | skill principal; concentra 7 dos 8 subsistemas |
| skills/design/scripts | Core | 2,3,4,6,7,8 | `skills/design/scripts/validate.mjs` | motoras determinísticas (validador, QA, smoke, codegen, spec, map) |
| skills/design/scripts/fixtures | Core | 2,3,4,6,7,8 | `skills/design/scripts/fixtures/` | corpus de fixtures auditado por grupo (11 grupos) |
| skills/design/scripts/lib | Core | 3,4 | `skills/design/scripts/lib/token-groups.mjs` | bibliotecas compartilhadas (viewport, token-groups) |
| skills/design/scripts/rules | Core | 6 | `skills/design/scripts/rules/` | 10 regras do validador, carregadas por extensão |
| skills/design/assets | Core (misto) | 1,2,3,4,5,6,7 | `skills/design/assets/viewer.html` | runtime + viewer + servidor + craft + contratos |
| skills/design/assets/components | Core | 3 | `skills/design/assets/components/components.json` | 14 partials seed + registry schema v2 |
| skills/design/assets/example | Core | 2,3,4,5,6,7 | `skills/design/assets/example/` | corpus de exemplo (telas, specs, snapshots, comments) |
| skills/design/assets/vendor | Adapters | 2 | `skills/design/assets/vendor/html-to-image.js` | bundle vendorizado de terceiros (export PNG) |
| skills/emil-design-eng | Skills | 1 | `skills/emil-design-eng/SKILL.md` | instrução de engenharia de design |
| skills/impeccable | Core (misto) | 5 | `skills/impeccable/SKILL.md` | skill de revisão/auditoria (v4.4.0) |
| skills/impeccable/reference | Skills | 5 | `skills/impeccable/reference/` | 41 playbooks + papéis degraded |
| skills/impeccable/scripts | Core (misto) | 5 | `skills/impeccable/scripts/live-browser.js` | live variant mode + launchers + bundle vendado |
| skills/taste | Skills | 1 | `skills/taste/SKILL.md` | instrução de gosto/anti-slop |

## 4. Fronteiras de camada decididas (com evidência)

- **`plugin/core.mjs` = Adapters, não Core.** O algoritmo de sync é
  determinístico, mas o PAPEL do arquivo é entrega/integração: MIRROR/SEED
  (`plugin/core.mjs:46-82`), auto-pull periódico (`plugin/core.mjs:36` e
  `plugin/core.mjs:152-165`), carimbo de versão. É a regra do audit
  (Adapters = superfícies de integração/entrega) e o exemplo do bloco do todo 3.
  A hipótese "Core glue" fica registrada e descartada no ADR-0005.
- **`plugin/index.ts` = Adapters** (adaptador tipado OpenCode v2) e
  **`plugin/core.test.mjs` / `plugin/smoke.mjs` = Adapters** (testam o
  adaptador, não o motor).
- **`skills/design/scripts/*.mjs` = Core**, mesmo vivendo sob um diretório de
  skill: são ferramentas determinísticas (validador, smoke, codegen, spec, map).
  Diretório de skill não decide camada; o conteúdo decide.
- **`skills/*/SKILL.md`, `skills/design/assets/craft.md`,
  `skills/impeccable/reference/` = Skills** (instrução escrita à mão).
  `skills/design/assets/docs.html` = Skills (guia de uso, ainda que servido).
- **`skills/design/assets/serve.mjs` = Core** (o bloco do todo 3 lista serve
  entre os motores determinísticos; o audit concorda — sub 2/Core). A autenticação
  por token de share é funcionalidade do motor, não cola de provider; a camada
  Adapters cobre plugin/comandos/.github/launchers/bundles.
- **`scripts/*.mjs` = Core** (suítes determinísticas: contratos do runtime,
  aceitação do viewer, consistência i18n) — `scripts/i18n-check.mjs` serve ao
  subsistema 8, os outros ao 2.
- **`commands/*.md` = Adapters** apesar de serem instruções: a superfície é de
  entrega (carregados pelo plugin via loadCommands) e o audit classifica assim.
- **Bundles vendorizados e launchers = Adapters**
  (`skills/design/assets/vendor/html-to-image.js`,
  `skills/impeccable/scripts/modern-screenshot.umd.js`,
  `skills/impeccable/scripts/impeccable`, `skills/impeccable/scripts/impeccable.cmd`).
- **`docs/*.md` = Skills** (documentação escrita à mão; o dono de conteúdo do
  guia de migração é o subsistema 8 — entrega/entregabilidade do tool).
- **`skills/design/scripts/setup-design.mjs` e `skills/design/scripts/copy-list.json`
  = Core** (algoritmo determinístico de setup), divergindo do exemplo
  "install.mjs" do bloco do todo 3 — decisão registrada no ADR-0005.

## 5. Tensões da taxonomia (resumo; detalhe no ADR-0005)

- Tamanho de skill ≠ subsistema: `skills/design` tem 471 arquivos e serve aos 8
  subsistemas; `skills/taste` tem 2 arquivos e serve ao 1. Ownership é por
  capacidade, nunca por tamanho de diretório.
- A onda do serviço com contas (todos 53-59, 62) não tem subsistema nomeado no
  enum: dono = 2 (Prototype Engine), que já é dono de `skills/design/assets/serve.mjs`.
- Gates transversais (14, 15, 39, 42, 44, 47, 60, 61) ficam com 8, mesmo quando
  consomem motores de 4 ou material de 3.
- 30 e 31 ficam com 6 pelo agrupamento do plano, embora estendam artefatos de 7.

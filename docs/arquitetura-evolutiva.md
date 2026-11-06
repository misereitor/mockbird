# Arquitetura evolutiva do Mockbird

## Confiabilidade do Visual Critic

O Visual Critic só é considerado confiável quando o recall determinístico é
medido contra um corpus de falhas isoladas. `npm run critic:calibrate` calcula o
recall a partir dos resultados emitidos pelo crítico; `--gate` rejeita qualquer
categoria abaixo de 0,8. O corpus e o relatório não substituem os fixtures de
regressão: ambos devem permanecer verdes.

> Todo 2 do plano `mockbird-evolution`. Este documento consolida a auditoria do
> todo 1 e fixa os contratos que os próximos todos implementam. Ele é a fonte de
> verdade para *o que existe*, *o que será construído* e *sob quais regras*.
>
> - **Base auditada (o que existe):** `docs/auditoria.json` + `docs/auditoria-tecnica.md`
>   (todo 1), no gitSHA auditado `31f3b806100be290bdba44822f8461d61cd234ec`
>   (`docs/auditoria.json#gitSHA`).
> - **Base planejada (o que será construído):** plano `mockbird-evolution`
>   (linhas IS/GAP do escopo, todos 1-62, ondas 0-10, verificadores finais
>   F1-F4). Referências a "todo N" apontam para os blocos desse plano.
> - **Verificação deste documento:** `node docs/arquitetura-evolutiva.check.mjs`
>   — exit 0 confirma as 10 seções, os 4 ADRs, os contratos da §5 e todas as
>   citações `arquivo:linha` (arquivo existe e linha está no arquivo).
> - **Convenção de citação:** token em `código` com formato
>   `caminho/arquivo.ext:linha` é afirmação sobre o repositório real, verificada
>   pelo script acima; artefatos que este plano ainda vai criar são citados em
>   *itálico*, nunca em `código`.

## 1. Inventário de recursos existentes

Consolida o todo 1 (auditoria técnica classificada). A fonte máquina é
`docs/auditoria.json` (1 entrada por arquivo + 1 entrada por grupo de fixtures,
cada uma com evidência `arquivo:linha` presa ao texto real da linha); a narrativa
é `docs/auditoria-tecnica.md`. Números exatos e reproduzíveis: `docs/auditoria.json#totals`.

### 1.1 Método

- Cobertura de 100% de `find plugin scripts skills commands docs .github -type f`
  no gitSHA auditado, menos 16 exclusões explícitas e justificadas
  (`docs/auditoria.json#exclusions`): PNGs de baseline, um lockfile, os três
  arquivos da própria auditoria e — como declaração prospectiva — os entregáveis
  deste todo 2 e do todo 3 (*docs/arquitetura-evolutiva.md*, *docs/camadas.md*
  e verificadores/ADRs associados).
- Classe decidida pelo código lido, com linha citada — nunca por auto-descrição
  de README ou comentário. Fixtures (~350 arquivos) auditadas por categoria:
  1 entrada por grupo com a lista completa de members (decisão do dono).
- Regras de classificação e de camada registradas em `docs/auditoria.json#taxonomy`
  (`existe` / `parcial` / `refatorar` / `construir`; `Core` / `Skills` / `Adapters`
  — ver §6 e ADR-0002).

### 1.2 Números consolidados

| Métrica | Valor |
| --- | --- |
| arquivos no escopo (`filesInFind`) | 555 |
| entradas de arquivo | 188 |
| grupos de fixtures (members totais) | 11 grupos / 356 members |
| exclusões explícitas | 16 |
| classe das entradas de arquivo | `existe` 177 · `parcial` 3 · `refatorar` 8 · `construir` 0 |
| classe dos grupos de fixtures | `existe` 2 · `parcial` 9 |
| camada das entradas de arquivo | Core 116 · Skills 53 · Adapters 19 |
| subsistema das entradas de arquivo | 1:5 · 2:20 · 3:40 · 4:4 · 5:56 · 6:15 · 7:28 · 8:20 |

Fonte: `docs/auditoria.json#totals` e contagem por campo das entradas do mesmo
arquivo. Os 8 subsistemas são a enumeração fixa do plano: 1 Design Intelligence ·
2 Prototype Engine · 3 Design System · 4 Visual QA · 5 Review Engine ·
6 Implementation QA · 7 Design Memory · 8 Agent Orchestration & Quality Gates
(`docs/auditoria.json#taxonomy.subsystems`).

### 1.3 Situação por classe (resumo; detalhe na auditoria)

- **`existe` (177 arquivos + 2 grupos).** Runtime mock completo
  (`skills/design/assets/mock.js:182-186`), viewer de 5.133 linhas
  (`skills/design/assets/viewer.html`), validador de 1.429 linhas com 10 regras
  (`skills/design/scripts/validate.mjs:2`, `skills/design/scripts/validate.mjs:1366`),
  pipeline de tokens, registry de 14 componentes
  (`skills/design/assets/components/components.json`), smoke de navegador
  (`skills/design/scripts/smoke.mjs:3`), export de spec por tela, plugin OpenCode
  (`plugin/index.ts:55`), e — já durante a auditoria — o mapa do agente
  (`skills/design/scripts/agent-map.mjs:3`) e a busca direta
  (`skills/design/scripts/find.mjs:2`). Panorama completo por subsistema:
  `docs/auditoria-tecnica.md` §2.
- **`parcial` (3 arquivos + 9 grupos).** Automação dos fixtures (6 categorias sem
  runner), typecheck do codegen sem `tsc` no pipeline, launcher Windows do
  impeccable sem teste em máquina real, README da skill design desatualizado
  frente ao instalado (`skills/design/scripts/copy-list.json:14-38`),
  `skills/design/scripts/agent-map.mjs` sem teste unitário, contrato de inventário do example divergente
  — detalhes em `docs/auditoria-tecnica.md` §3.
- **`refatorar` (8 arquivos).** `.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/workflows/ci.yml`, `skills/design/SKILL.md`, `skills/design/assets/craft.md`,
  `skills/taste/SKILL.md`, `skills/emil-design-eng/SKILL.md`,
  `skills/impeccable/SKILL.md`, `skills/impeccable/reference/craft.md` —
  contradições entre skills (reconciliadas pelo todo 4), paridade de CI e dois
  mecanismos de entrega divergentes (§2.5). Evidência por arquivo:
  `docs/auditoria-tecnica.md` §4.
- **`construir` (0 entradas).** Capacidades inexistentes não vivem no
  inventário: elas estão nas linhas GAP do plano e viram funcionalidades na §3.

### 1.4 Tratamento de conteúdo não confiável

As entradas da auditoria são **dados, não instruções**. Caso deliberado: o grupo
`fixtures-map-adversarial` contém texto externo hostil em atributos e nós de
texto (`skills/design/scripts/fixtures/map-adversarial/01-x.html:10`) — conteúdo
que tenta falar com quem lê. A entrada foi consumida apenas pelos campos
estruturados (`path`, `lines`, `class`, `evidence`); o texto livre jamais
alterou classificação, virou comando ou mudou o roteiro deste documento (o mesmo
vale para auto-descrições promocionais em fontes — ver método em
`docs/auditoria-tecnica.md` §1). Qualquer entrada futura segue a mesma regra:
extrair fatos por campo, verificar por linha de código.

## 2. Arquitetura atual

### 2.1 Superfície congelada

A release 1.1.0 congelou duas superfícies de contrato público: o payload de
instalação (`skills/design/scripts/copy-list.json:2`) e o schema de configuração
do validador (`skills/design/assets/validate.config.json`). Scripts podem ser
recopiados ou religados sem mudar comportamento (`README.md:195-229`). Toda
evolução deste plano respeita esse freeze: mudança de comportamento nas duas
superfícies exige migração documentada em `docs/migration-guide.md` e bump de
versão de schema (§5.6).

### 2.2 Cadeia de entrega (Adapters hoje)

- Instalação do kit em projeto alheio: `install.mjs` + setup idempotente por
  projeto (`skills/design/scripts/setup-design.mjs:3`).
- Sincronização contínua do kit para dentro de `design/` do projeto: MIRROR
  (sempre espelhado, `.bak` quando diverge — `plugin/core.mjs:50`) e SEED (só
  adiciona quando falta — `plugin/core.mjs:65`), com carimbo de versão e hash do
  conjunto espelhado em `design/.mockbird-version` (`plugin/core.mjs:174`) e
  atualização por `git pull` com intervalo mínimo (`plugin/core.mjs:157`).
- Comandos de agente registrados pelo plugin a partir de `commands/`
  (`plugin/core.mjs:129`): `commands/design.md`, `commands/design-map.md`,
  `commands/taste.md`, `commands/impeccable.md`, `commands/emil-design-eng.md`.
- CI: workflow com 5 dos 7 passos de `npm run ci`
  (`.github/workflows/ci.yml:24-37` vs `package.json:21`), sem navegador.

### 2.3 Núcleo determinístico (Core hoje)

- **Runtime de protótipo:** verbos declarativos `data-go`/`data-overlay`/
  `data-toast`/`data-close`/`data-action` (`skills/design/assets/mock.js:182-186`),
  módulos de ação por tela (`skills/design/assets/mock.js:377-430`), viewer
  (`skills/design/assets/viewer.html`) e servidor local com API de comentários
  (`skills/design/assets/serve.mjs:25`).
- **Validação:** `skills/design/scripts/validate.mjs` (1.429 linhas,
  config-driven — `skills/design/scripts/validate.mjs:2`) com 10 regras carregadas
  por extensão (`skills/design/scripts/validate.mjs:1366`; regras em
  `skills/design/scripts/rules/`), contraste WCAG em
  `skills/design/scripts/validate.mjs:326-421`, rig de QA R1-R4 e baseline de
  métricas congelada.
- **QA de navegador:** smoke por viewport derivado
  (`skills/design/scripts/lib/viewport.mjs:2`), decodificador PNG + pixel-diff
  caseiro (`skills/design/scripts/smoke.mjs:307-390`) e limiar gravado por
  execução (`skills/design/scripts/smoke.mjs:680`).
- **Design system:** geração/exportação de tokens
  (`skills/design/scripts/lib/token-groups.mjs:2`), registry de componentes com
  rematerialização por marcadores, codegen e contrato de tokens travado por
  regra de sincronia.
- **Memória e acesso (novos desta onda):** mapa do agente
  (`skills/design/scripts/agent-map.mjs:3`), busca direta
  (`skills/design/scripts/find.mjs:2`) e export de spec por tela, cuja paridade
  com o frontend real ainda é `pending` por construção
  (`skills/design/scripts/export-spec.mjs:33`).

### 2.4 Instrução (Skills hoje)

Quatro skills escritas à mão: `skills/design/SKILL.md` (construção de telas),
`skills/taste/SKILL.md` (anti-slop de landing/portfolio),
`skills/impeccable/SKILL.md` (revisão/polish, com 41 playbooks em `reference/`)
e `skills/emil-design-eng/SKILL.md` (design engineering). A camada de critérios
de craft está fundida em `skills/design/assets/craft.md`.

### 2.5 Tensões em aberto (fechamento previsto)

1. **Dois mecanismos de entrega divergentes.** O MIRROR do plugin
   (`plugin/core.mjs:50`) não embarca `rules/`, enquanto o payload de instalação
   (`skills/design/scripts/copy-list.json:14-38`) embarca: projetos sincronizados
   só pelo plugin rodam o validador sem regras. A guarda hoje é checklist manual
   de PR (`.github/PULL_REQUEST_TEMPLATE.md:8`). Fechamento parcial: integridade
   do espelho no todo 34; **unificação dos listões não tem todo dedicado no
   plano — pendência de ownership do subsistema 8**, que quando assumida exige
   ADR.
2. **Paridade de CI.** Faltam `test:mock` e `check:i18n` e qualquer navegador
   (`package.json:21`, `.github/workflows/ci.yml:24-37`) — fechado pelo todo 15
   (+ ADR-0007 de navegador).
3. **Contradições entre skills** (dials, Tailwind, motion, loop de QA, alias
   `craft`) — fechado pelo todo 4 com regra vencedora por escopo e ADR-0006.
4. **Artefatos gerados sem casa nem retenção** (capturas, scores, relatórios) —
   fechado pelos todos 9/12/13 (§6).

## 3. Funcionalidades propostas (8 subsistemas)

A enumeração abaixo é a taxonomia aprovada do plano; ela é registrada aqui e em
`docs/auditoria.json#taxonomy.subsystems`. **Ownership por arquivo é do todo 3**
(*docs/camadas.md*); se a taxonomia não mapear na realidade, a correção vira
ADR-0005 (todo 3) — nunca se força o mapa. Os todos 1-3 (auditoria, este
documento, camadas) são fundação transversal e não pertencem a um subsistema.
Classificações são indicativas onde marcadas.

| # | Subsistema | Já existe (evidência) | Proposto neste plano (todos) |
| --- | --- | --- | --- |
| 1 | Design Intelligence | craft fundido + taste + emil (com contradições — §2.5) | brief validado com detecção de contradições (17); 3 direções visuais comparáveis (19); UX Intelligence + Task Simulation (20); Design Context Inspector (21); sandbox de tokens what-if (45, indicativo); fonte única de critérios (4) |
| 2 | Prototype Engine | runtime mock, viewer 5.1k linhas, serve local (`skills/design/assets/mock.js:182-186`) | hardening de execução de mockups (CSP + sanitização, 16); carimbo de versão + migração de payloads já entregues (5); superfícies multiusuário no viewer sem coedição (57, indicativo) |
| 3 | Design System | tokens determinísticos, registry de 14 componentes, contrato de tokens | catálogo com variantes/estados/docs automáticas (22); discovery/reuso antes de criar (23); governança + health report (24); contract testing de estados (25); responsive + a11y expandida com axe opcional (26) |
| 4 | Visual QA | smoke por viewport, pixel-diff caseiro (`skills/design/scripts/smoke.mjs:307-390`), baselines de pixels | captura matricial 5 viewports × 7 estados (9); diff compartilhado + SSIM vendorizado com limiar por plataforma (10); Visual Critic estruturado só-diagnóstico (11); Quality Score com histórico + gate por diff (12); orquestrador com relatório único (13); benchmark com 8 briefings (14); CI real com navegador (15); calibração do critic com recall (37); corpus dourado (39); bisect de regressão (40); estresse i18n + perf budget (41) |
| 5 | Review Engine | skill impeccable completa, comentários com pins (`skills/design/assets/serve.mjs:25`) | aprovação por hash ligada a DEC-ids (27); interaction intelligence (29); avaliação cega em experimentos (46, indicativo) |
| 6 | Implementation QA | validador 1.429 linhas + 10 regras, rig R1-R4, `scripts/mock-check.mjs` | parity protótipo↔frontend por estilos computados (28); design-to-documentation automático (30); slop-lint determinístico (38); consumer fixtures de contrato público (44) |
| 7 | Design Memory | export-spec por tela, snapshots versionados, agent-map (`skills/design/scripts/agent-map.mjs:3`), find (`skills/design/scripts/find.mjs:2`) | pacote de contexto por tela (7); Design Memory DEC-xxx com impacto/consulta (18); design evolution + experimentos (31); lições entre projetos (43) |
| 8 | Agent Orchestration & Quality Gates | plugin OpenCode (`plugin/index.ts:55`), comandos, release por tag, i18n-check | contrato DesignAgent model-agnostic (32); orquestração de papéis com avaliadores read-only (33); atualização segura do plugin (34); segurança completa (35); skills com carregamento progressivo (36); scorecard de maturidade (42); definition of done executável (47); conector LLM nativo multi-provedor (48-52); serviço único com contas e papéis (53-56, 58-59); CLI descobrível (60); pack portátil (61); manual do serviço (62) |

**Nota de taxonomia (declarada, não forçada):** os todos 53-59 e 62 (serviço com
contas) não cabem com folga em nenhum dos 8 subsistemas — são plataforma nova
(GAP-I1..I8). Estão listados no subsistema 8 como melhor aproximação; a decisão
formal de remap pertence ao todo 3 (ADR-0005). Fora do plano, declaradamente:
editor visual tipo Figma, site builder, modelo de LLM próprio, coedição
simultânea, SaaS gerenciado/billing (guardrails do plano).

## 4. Dependências entre funcionalidades

As ondas agrupam **ordem de execução**; os subsistemas (§3) agrupam **ownership**.
São dimensões ortogonais: uma onda mistura subsistemas de propósito (ex.: onda 1
é Visual QA; onda 5 é plataforma).

- **Estrutura de ondas** (do plano): onda 0 fundação (todos 1-8) → onda 1 quality
  foundation (9-16) → onda 2 design intelligence (17-21) → onda 3 design system
  (22-26) → onda 4 implementation QA (27-31) → onda 5 plataforma (32-36) →
  ondas 6-10 e final F1-F4 (detalhe na §7).
- **Restrições críticas de dependência** (por que a ordem é essa):
  - 1 bloqueia 2, 3, 4 (documento de arquitetura e camadas partem da auditoria).
  - 4 bloqueia 11 (os critérios do Visual Critic são extraídos do craft
    reconciliado).
  - 10 bloqueia 11, 12, 13 (critic, score e gate consomem a lib de diff).
  - 9 bloqueia 13, 15 (captura alimenta o orquestrador e o CI).
  - 16 bloqueia 17-26 e 29 (hardening antes de qualquer onda que execute
    mockups).
  - 18 bloqueia 21, 27, 31 (DEC-ids são a espinha dorsal de inspector,
    aprovação e evolução).
  - 22 bloqueia 23, 25, 30 (catálogo antes de discovery/contract/docs).
  - 32 bloqueia 33 (contrato antes da orquestração de papéis).
  - 36 bloqueia 44 (sincronização schema↔instrução antes de fixtures de
    compatibilidade).
  - 53 bloqueia 54-59 e 62 (serviço antes de contas/papéis/operação).
- **Paralelismo alvo:** 5-8 todos por onda; onda 0 executa 1 primeiro e depois
  2/3/4 em paralelo (este documento é o todo 2) e 5/6/8 desde o início.
- **Fronteira de onda:** `npm run ci` verde em checkout limpo antes de avançar
  (estratégia de commit do plano).
- **Matriz completa** (todo → dependências → bloqueia): tabela de dependências do
  plano — este documento não duplica as 62 linhas para não criar fonte paralela.

## 5. Contratos de integração

Todo artefato gerado e consumido por mais de um componente é JSON (ou MD
derivado) com campo `schemaVersion` obrigatório — fechamento direto do GAP-F2.
Os cinco contratos abaixo são os nominais do plano; os campos são os definidos
nos respectivos todos e não mudam sem o processo da §5.6.

### 5.1 report — relatório de crítica visual, orquestração e scores

- **Dono do schema:** todo 11 (*skills/design/assets/critic-report.schema.json*).
- **Formato:** `{schemaVersion, screen, viewport, state, score, issues: [{severity:
  blocker|major|minor, category: hierarquia|composicao|tipografia|espacamento|
  consistencia|responsividade|acessibilidade|microinteracao, element, problem,
  suggestion, evidence}], deterministic: {...}, vision: {model, run, optIn}}`.
- **Agregações do mesmo contrato-família:** *design/.visual/report.json* do
  orquestrador (todo 13) — `{schemaVersion, gitSHA, timestamp, platform,
  screens: [{capture, diff, critic, score, a11y}], summary: {blockers, gate}}` —
  e *design/.visual/scores.json* do score (todo 12) — `{schemaVersion, entries:
  [{gitSHA, timestamp, screen, perCriteria, overall}]}`.
- **Produtores/consumidores:** visual-critic (11) produz; visual-score (12),
  orquestrador (13), benchmark (14), bisect (40) e o loop de agente (49) consomem.

### 5.2 brief — design brief validado

- **Dono do schema:** todo 17 (*skills/design/assets/design-brief.schema.json*).
- **Formato:** `{schemaVersion, audience, goal, visualDirection, constraints,
  tone, platform, must, mustNot}`.
- **Validação:** *validate-brief.mjs* rejeita campo desconhecido e detecta
  contradições (ex.: tone "sóbrio" vs visualDirection "neon maximalista") com
  severidade; telas não são construídas sobre brief inválido quando o fluxo está
  ativo (regra registrada no SKILL.md junto do schema).

### 5.3 decisions — memória de decisões (DEC-xxx)

- **Dono do schema:** todo 18 (*design/decisions.json* no projeto alvo).
- **Formato:** `{schemaVersion, decisions: [{id: "DEC-001", category, decision,
  reason, status: active|superseded, scope, screens: [], createdAt, supersedes}]}`.
- **Regras:** decisão sem `reason` é rejeitada; decisão não é apagada — é
  supercedida (`status: superseded`); consulta/impacto obrigatória antes de criar
  ou mudar tela (join por DEC-id com approvals e evolução).

### 5.4 approvals — aprovação por hash

- **Dono do schema:** todo 27 (*design/approvals.json* no projeto alvo).
- **Formato:** `{schemaVersion, approvals: [{screen, contentHash: sha256, status:
  draft|review|changes-requested|approved|implemented, decIds: [], reviewedBy,
  at}]}`.
- **Regra central:** conteúdo da tela mudou (hash atual ≠ hash aprovado) → status
  volta automaticamente para `review`, verificado por *approve.mjs* e pelo
  orquestrador. Escopo do hash: o arquivo da tela (mudanças em *mock.css* e
  *tokens.json* não reabrem aprovação — limite declarado do plano).

### 5.5 DesignAgent — contrato model-agnostic de papéis de IA

- **Dono do schema:** todo 32 (*skills/design/assets/design-agent.schema.json* +
  contrato em texto).
- **Interface:** `{role, capabilities, generate(request) -> screens,
  review(reportSchema) -> issues, improve(issues) -> patch}` com IO padronizado
  em JSON e campo `schemaVersion`, independente de provedor.
- **Adaptadores:** *skills/design/scripts/agent-adapters/* com
  *stub-deterministic.mjs* (offline, padrão de teste, sempre disponível) e
  adaptadores opt-in de exemplo (openai-compatible, google-genai; chave só em
  variável de ambiente). Todo passe de LLM do sistema (critic vision, benchmark,
  multi-agente) fala com este contrato — ver ADR-0001.

### 5.6 Regras comuns a todos os contratos

1. `schemaVersion` obrigatório em todo payload gerado; consumidores verificam o
   campo antes de interpretar.
2. Evolução aditiva (campo novo) preserva `schemaVersion`; mudança incompatível
   sobe o número e gera seção de migração em `docs/migration-guide.md` (padrão já
   usado pelo guia).
3. Anti-fake: artefatos de execução embutem `gitSHA`, hash de conteúdo e
   timestamp; verificador re-executa e compara hash — presença de arquivo não é
   evidência.
4. Determinismo: mesma entrada → mesmo conteúdo (hash estável); onde houver
   ruído de plataforma, ele é nomeado no payload (`platform`) e resolvido por
   limiar por plataforma, nunca escondido.
5. Offline: nenhum contrato exige rede para ser produzido no modo
   determinístico; passes de modelo são opt-in e marcados (`vision: {optIn}`).

## 6. Estrutura de diretórios (Core / Skills / Adapters)

### 6.0 Painéis do viewer

O viewer expõe um registro mínimo, sem bundler: `registerViewerPanel(nome,
painel)` cadastra um módulo e `activateViewerPanel(nome)` ativa o painel pelo
nome. O módulo recebe `{ state, root, screen }` e é responsável por renderizar
seu conteúdo; o viewer permanece responsável apenas pelo ciclo de vida e pela
área de ativação. O painel Contexto usa essa fronteira para ler
*brief.json*, *tokens.json*, *decisions.json*, *approvals.json* e
*comments.json*, exibindo estado vazio explícito quando não há dados e erro
identificando o arquivo quando um JSON é inválido. Painéis futuros (como
comparação 3-up e previews) devem registrar módulos independentes, sem copiar
markup ou reescrever o viewer.

Regra de camada (definição exata em `docs/auditoria.json#taxonomy.layerRule` e
ADR-0002): **Core** = código executável determinístico + dados/contratos;
**Skills** = instrução escrita à mão; **Adapters** = superfícies de
integração/entrega. Todo arquivo pertence a exatamente uma camada.

### 6.1 Árvore atual (atribuição de camada indicativa; por-arquivo no todo 3)

| Caminho | Camada | Conteúdo |
| --- | --- | --- |
| `plugin/` | Adapters | plugin OpenCode (`plugin/index.ts:55`), núcleo de sincronização (`plugin/core.mjs:50`), testes (`plugin/core.test.mjs`) |
| `scripts/` | Core/Adapters | `scripts/mock-check.mjs`, `scripts/viewer-accept.mjs`, `scripts/i18n-check.mjs` |
| `skills/design/scripts/` | Core | motores: validate, qa, smoke, sync-components, marker-parser, gen-tokens, export-spec, codegen, agent-map, find, setup-design + `skills/design/scripts/lib/` + `skills/design/scripts/rules/` + `skills/design/scripts/fixtures/` |
| `skills/design/assets/` | Core | runtime (`skills/design/assets/mock.js:182-186`), viewer (`skills/design/assets/viewer.html`), serve (`skills/design/assets/serve.mjs:25`), corpus `example/`, contrato de tokens, config do validador |
| `skills/design/SKILL.md`, `skills/design/assets/craft.md`, `skills/taste/`, `skills/impeccable/`, `skills/emil-design-eng/` | Skills | instrução escrita à mão (SKILL.md, craft.md, reference/) |
| `commands/` | Adapters | comandos de agente carregados pelo plugin (`plugin/core.mjs:129`) |
| `docs/` | Skills | guias e documentação (`docs/migration-guide.md`, auditoria, este documento) |
| `.github/` | Adapters | CI (`.github/workflows/ci.yml:24-37`), template de PR |
| `install.mjs` | Adapters | instalador do kit |

### 6.2 Onde a evolução aterrissa (decisão por artefato)

- **Código novo de motor determinístico** → `skills/design/scripts/` (script) ou
  `skills/design/scripts/lib/` (lib compartilhada, padrão de
  `skills/design/scripts/lib/viewport.mjs:2`). Exemplos deste plano:
  *image-diff.mjs*, *ssim.mjs*, *visual-capture.mjs*, *visual-critic.mjs*,
  *visual-score.mjs*, *visual-gate.mjs*, *visual-orchestrator.mjs*,
  *approve.mjs*, *decisions.mjs*, *parity.mjs*, *contract-test.mjs*.
- **Regras de validação** → `skills/design/scripts/rules/` (carregadas por
  extensão — `skills/design/scripts/validate.mjs:1366`).
- **Fixtures e corpora** → `skills/design/scripts/fixtures/` (bom/ruim por
  categoria), corpus dourado e benchmark com a mesma disciplina de grupo.
- **Schemas/contratos** → `skills/design/assets/*.schema.json` junto do runtime
  que os consome (regra: schema e instrução no mesmo commit).
- **Adaptadores de IA** → *skills/design/scripts/agent-adapters/* (ADR-0001).
- **ADRs** → `docs/adr/` (nunca apagados; supersessão por novo arquivo).
- **Artefatos por PROJETO consumidor** (dentro de `design/` do projeto alvo):
  *design/.visual/* (capturas, manifest, scores, relatórios — fechamento do
  GAP-F1), *design/.map/* (packs por tela + índice), *design/decisions.json*,
  *design/approvals.json*, *design/visual-thresholds.json*,
  *design/explorations/<NN>/direction.json*. Adoção em projetos existentes é
  migrada pelo padrão de `docs/migration-guide.md` (todo 5 já acrescentou a
  seção de migração de payloads).

### 6.3 Versionamento (fronteira do que entra em commit)

- **Versionados:** baselines visuais, *design/visual-thresholds.json*,
  *design/.visual/scores.json*, *design/approvals.json*, *design/decisions.json*,
  *catalog.json*, schemas e docs.
- **Não versionados:** capturas transitórias por execução, relatórios de runs
  pagos do benchmark, evidências em `.omo/evidence/`.
- **Nunca removidos em commit:** `.bak` e `design/.mockbird-version`
  (integridade de projetos semeados).

## 7. Roadmap (ondas 0-5 deste plano)

Execução imediata do plano, onda por onda (todo 2 é este documento). Nada aqui
promete infraestrutura fora do plano; as ondas 6-10 e a onda final também fazem
parte do plano e estão registradas em seguida para completude.

| Onda | Todos | Ordem/paralelismo | Fecha |
| --- | --- | --- | --- |
| 0 — Fundação | 1 auditoria · 2 este documento · 3 camadas/ownership · 4 regra única entre skills · 5 carimbo+migração · 6 agent-map · 7 pack por tela · 8 find | 1 primeiro; 2/3/4 pós-1 em paralelo; 5/6/8 desde o início; 7 pós-6 | GAP-E5, GAP-F4, GAP-F5, GAP-J1..J3 |
| 1 — Quality Foundation | 9 captura 5×7 · 10 diff+SSIM · 11 Visual Critic · 12 score+gate · 13 orquestrador · 14 benchmark · 15 CI real · 16 hardening CSP | 9∥10; 11 pós-4,10; 12 pós-10,11; 13 pós-9-12; 14 pós-11,12; 15 pós-9-13; 16 paralelo e bloqueia onda 2 | GAP-A1..A5, GAP-F1, GAP-G1, GAP-E4 |
| 2 — Design Intelligence | 17 brief · 18 Design Memory DEC · 19 exploração 3-up · 20 UX Intelligence · 21 Context Inspector | 17∥18∥20; 21 pós-17,18; 19 pós-17,21 | GAP-B1..B5 |
| 3 — Design System | 22 catálogo · 23 discovery · 24 governança · 25 contract testing · 26 responsive+a11y | 22∥24∥26; 23 e 25 pós-22 | GAP-C1..C5 |
| 4 — Implementation QA | 27 aprovação por hash · 28 parity · 29 interaction intelligence · 30 design-to-doc · 31 evolution/experiments | 27 pós-18; 28 pós-27; 29∥30 (30 pós-22); 31 pós-18,27 | GAP-D1..D4 |
| 5 — Plataforma | 32 DesignAgent · 33 orquestração de papéis · 34 plugin seguro · 35 segurança · 36 skills progressivas | 32∥34∥35∥36; 33 pós-32 | GAP-E1..E3, GAP-H4, GAP-H5 |

**Ondas seguintes (continuidade do plano, mesma régua):** onda 6 maturidade e
confiança (37-42), onda 7 conhecimento e contratos (43-47), onda 8 conector LLM
nativo (48-52), onda 9 serviço e contas (53-59), onda 10 DX e distribuição
(60-62) e onda final de verificação F1-F4 (compliance do plano, qualidade de
código, QA manual real, fidelidade ao estado ideal) — todas com dependências e
QA happy+failure descritos nos blocos dos respectivos todos.

**Regras de passagem:** um commit atômico por todo verificado (mensagem de
conventional commit da linha `Commit` do bloco); fronteira de onda exige
`npm run ci` verde; verificadores finais rodam em paralelo após todos os todos e
todos precisam de APPROVE antes de o plano ser declarado completo.

## 8. Critérios de aceitação

### 8.1 Invariantes (valem para todos os todos)

1. **Avaliadores nunca editam código** — por mecanismo: permissão read-only +
   snapshot hash do workspace antes/depois (ADR-0003).
2. **Score é instrumento de rastreio; o gate bloqueia apenas por diff
   determinístico (pixelRatio/SSIM acima do limiar da plataforma), contrato
   quebrado ou limiar verificável — nunca por score.** Declaração exigida pelo
   todo 12 e assumida por todos os componentes de visual QA.
3. **Todo payload gerado tem `schemaVersion`**; evolução aditiva; mudança
   incompatível = bump + migração em `docs/migration-guide.md` (§5.6).
4. **Garantia offline**: sem chave e sem rede, todo fluxo completa no modo
   determinístico/stub; chamada paga só com flag explícita e orçamento.
5. **Zero dependências npm obrigatórias novas** (ADR-0004).
6. **Aprovação é durável ou não é aprovação**: conteúdo aprovado muda → status
   volta para `review` (todo 27).
7. **Caminho atual preservado**: plugin + skills + modo kit local continuam
   funcionando; serviço e conector são adição, não substituição.
8. **Anti-fake**: artefatos embutem `gitSHA` + hash de conteúdo + timestamp e o
   verificador re-executa comparando hash — presença de arquivo não é evidência.

Clarificação (todo 12): `skills/design/scripts/visual-score.mjs` apenas
registra — agrega as issues do critic e a cobertura da matriz de captura em
scores 0-100 por critério e anexa o histórico *design/.visual/scores.json*
(append-only, truncado — nunca arredonda para cima). A decisão de bloqueio é
exclusiva de `skills/design/scripts/visual-gate.mjs`, que decide APENAS por
diff determinístico (pixelRatio/SSIM vs limiar da plataforma) ou contrato
quebrado — e não lê score.

### 8.2 Aceitação por resultado-alvo (espelho da tabela de Success criteria do plano)

| Resultado | Todos | Prova executável |
| --- | --- | --- |
| IS-1 entrega profissional validada | 11, 13, 20, 25, 32-36 | orquestrador emite relatório único completo com gate verde no example; 5 estados por componente capturados e assertidos |
| IS-2 qualidade mensurável | 10, 12, 14, 15 | score baixo não bloqueia e 1 px acima do limiar bloqueia; baseline quebrada → CI vermelho |
| IS-3 decisões registradas | 18, 27, 31 | add→list→impact com DEC-xxx; mudança de tela gera evolução com what/why/decIds/scoreDelta |
| IS-4 aprovação por hash + parity | 27, 28 | tela aprovada editada → verify exit≠0 e status `review`; tabela de divergências px/radius/font/spacing nos 5 viewports |
| IS-5 aprendizado com evidência | 14, 15, 36, 37, 39 | dry-run schema-válido com spend=0; regressão 1px no corpus dourado → `golden:check` exit≠0 |
| IS-6 autonomia sem refém | 48-52 | loop completo em stub termina com proposta de aprovação (spend 0); sem chaves e sem rede tudo completa em stub |
| IS-7 serviço com papéis | 53-59, 62 | matriz 4 papéis × rotas toda verde; viewer editando → 403 auditado; login→sessão→logout |
| IS-8 acesso direto do agente | 6, 7, 8 | pack por tela com linhas que batem com grep e hash estável; find retorna arquivo:linha esperados; contratos mortos reportados e `--check-verbs` reprova divergência |

### 8.3 Definition of done por tarefa

Nenhuma tarefa está aceita sem: (a) critérios do bloco do todo atendidos; (b) QA
agente-executado happy **e** failure (com injeção de falha real — ex.: mutar uma
cópia em `/tmp` e ver o verificador falhar nomeando o item); (c) evidência em
*.omo/evidence/task-N-mockbird-evolution.md* com os artefatos nomeados; (d) um
commit atômico com a mensagem da linha `Commit`. Nenhum critério depende de
intervenção humana.

## 9. Estratégia de testes (Q3a: TDD em motores determinísticos, tests-after em docs/assets)

- **TDD (Q3a) para motores determinísticos:** image-diff/SSIM, critic
  determinístico, agregação de score, parity, contract-testing, approve/decisions
  nascem com teste primeiro em `node:test` + fixtures em
  `skills/design/scripts/fixtures/` (padrão bom/ruim já usado pelo validador e
  por `scripts/mock-check.mjs`). Cada motor novo entra com teste de regressão que
  prova que a suíte detecta injeção de bug (não apenas que ela roda).
- **tests-after para docs/assets/schemas/brief:** geração de documentos,
  schemas e briefs é verificada por validação estrutural + QA happy/failure do
  bloco do todo, sem teste que apenas pine texto.
- **Inventário de verificação hoje:** `plugin/core.test.mjs` (unidade do plugin),
  `skills/design/scripts/find.test.mjs`, `skills/design/scripts/setup-design.test.mjs`
  (ambos ainda fora de `npm test` — pendência da §2.5), `scripts/mock-check.mjs`
  (comportamento do runtime), `skills/design/scripts/fixtures/security-suite.mjs`
  (único gate de navegador/segurança no CI hoje), validador + rig R1-R4 sobre o
  example, smoke de plugin (`plugin/smoke.mjs`), aceitação do viewer
  (`scripts/viewer-accept.mjs`) e checagem de i18n (`scripts/i18n-check.mjs`).
- **QA agente-executado (todo todo):** cenário happy + cenário failure com
  ferramenta e invocação nomeadas no bloco do todo; artefato de evidência por
  cenário. Injeção de falha é obrigatória e real (cópia mutada, hash corrompido,
  path inexistente) — verificador que só passa não prova nada.
- **Contrato anti-fake:** artefatos com `gitSHA` + hash + timestamp; re-execução
  com comparação de hash; não-escrita de avaliadores por snapshot antes/depois;
  benchmark com modo stub `spend=0` que produz relatório schema-válido.
- **Conector e serviço (ondas 8-9):** HTTP mockado com fixtures de provedor,
  garantia offline obrigatória no CI (sem rede e sem chaves), matriz table-driven
  4 papéis × rotas executada por inteiro, e2e de login/editor/viewer e varredura
  de segredos no CI.
- **CI alvo (todo 15):** `npm run ci` completo em checkout limpo, com navegador
  provisionado (decisão registrada em ADR-0007), scripts desambiguados (fim da
  colisão `npm run smoke` de `package.json:14`) e relatório listando checks
  visuais executados (N>0).

## 10. ADRs

Decisões arquiteturais ficam em `docs/adr/`, uma por arquivo, numeradas em
ordem de registro. **Nenhum ADR é apagado ou editado no que diz à decisão**;
mudança de rumo = novo ADR que supersede o anterior e registre a migração. Todo
ADR usa as seções `Status`, `Contexto`, `Decisão`, `Consequências`,
`Reversibilidade` — a reversibilidade é registrada sempre, porque decisões sem
saída declarada viram prisão.

### 10.1 Registro

| ADR | Decisão | Dono | Situação |
| --- | --- | --- | --- |
| `docs/adr/ADR-0001-nucleo-deterministico-papeis-llm.md` | núcleo determinístico + papéis LLM substituíveis (contrato DesignAgent) | todo 2 | aceito |
| `docs/adr/ADR-0002-camadas-core-skills-adapters.md` | camadas Core/Skills/Adapters como mapa do repositório | todo 2 | aceito |
| `docs/adr/ADR-0003-avaliadores-nunca-editam-codigo.md` | avaliadores nunca editam — read-only + snapshot hash | todo 2 | aceito |
| `docs/adr/ADR-0004-politica-de-dependencias-zero-obrigatorias.md` | zero dependências npm obrigatórias | todo 2 | aceito |
| *docs/adr/ADR-0005-remap-taxonomia.md* | remap da taxonomia de subsistemas, se a realidade não mapear | todo 3 | reservado |
| *docs/adr/ADR-0006-regra-unica-entre-skills.md* | regra vencedora por escopo entre skills | todo 4 | reservado |
| *docs/adr/ADR-0007-ci-navegador.md* | navegador/estratégia de browser no CI | todo 15 | reservado |
| *docs/adr/ADR-0008-atualizacao-plugin.md* | política de atualização do plugin (opt-in vs tag pinada) | todo 34 | reservado |

### 10.2 Registro de reversibilidade (decisão → como reverter)

| ADR | Reversibilidade registrada |
| --- | --- |
| ADR-0001 | adaptadores são trocáveis sem mexer no Core; reverter "LLM só diagnostica" exige ADR substituto com contenção equivalente |
| ADR-0002 | camadas são metadados documentais (remap por ADR, precedente ADR-0005); regime de teste por camada só muda por ADR |
| ADR-0003 | read-only + snapshot vive nos executáveis de avaliação e testes de não-escrita; reverter exige ADR substituto (consumidores assumem a garantia) |
| ADR-0004 | dependência obrigatória nova só por ADR substituto (justificativa + offline + teste); implementações locais são libs contidas em `skills/design/scripts/lib/` |

Os ADRs reservados (0005-0008) seguem o mesmo template e entram nos commits dos
respectivos todos — schema/instrução/decisão no mesmo commit, nunca depois.

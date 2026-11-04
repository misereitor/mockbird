# Auditoria técnica do repositório Mockbird

> Todo 1 do plano `mockbird-evolution` — classificação existe / parcial /
> refatorar / construir de cada arquivo de código ou documento, mapeada aos 8
> subsistemas propostos. A fonte de dados máquina é `docs/auditoria.json`
> (1 entrada por arquivo + 1 entrada por categoria de fixtures, cada uma com
> evidência `arquivo:linha` presa ao texto real da linha). Contagens exatas,
> `gitSHA` e timestamp: `docs/auditoria.json#totals` e `#gitSHA`. Verificação:
> `node docs/auditoria.json.check.mjs` (exit 0 = cobertura total conferida).

## 1. Escopo e método

- Cobertura: 100% de `find plugin scripts skills commands docs .github -type f`
  no commit registrado em `gitSHA`, menos uma lista explícita de exclusões
  (binários PNG de baseline, `plugin/package-lock.json` e os três arquivos
  desta própria auditoria — auto-referência). Nenhum arquivo de produto foi
  alterado.
- Classe decidida pelo **código lido**, com linha citada em cada entrada —
  nunca por afirmação de README ou comentário. Exemplo deliberado:
  `codegen.mjs:4` se auto-descreve como "GAP-8 bridge half" (soa incompleto),
  mas a leitura do contrato declarado (`codegen.mjs:3-56`) e da integração
  real (`sync-components.mjs:93`, `codegen.mjs:282` `runCodegen`) mostra o
  escopo prometido implementado → classe `existe`, não `parcial`. O inverso
  também vale: `i18n-check.mjs:2` se declara "(CI)" e o workflow nunca o
  executa (`.github/workflows/ci.yml` termina em :37).
- Camadas: `Core` = código determinístico + dados/contratos que os motores
  consomem ou geram; `Skills` = instrução/documentação escrita à mão
  (SKILL.md, craft.md, reference/, guias, LICENSE); `Adapters` = superfícies
  de integração/entrega (plugin, commands, .github, launchers, bundles
  vendorizados). Detalhe da regra em `docs/auditoria.json#taxonomy.layerRule`.
- Fixtures (~350 arquivos em `skills/design/scripts/fixtures/`) são auditadas
  **por categoria** (decisão do dono): 1 entrada por grupo com a lista completa
  de `members` + amostra de até 10 membros conferida linha a linha. Grupo novo
  = entrada incremental — foi o caso durante esta auditoria (ver §6).
- Subsistemas (enum fixo do plano): 1 Design Intelligence · 2 Prototype Engine
  · 3 Design System · 4 Visual QA · 5 Review Engine · 6 Implementation QA ·
  7 Design Memory · 8 Agent Orchestration & Quality Gates.

## 2. O que existe (e está de pé)

| subsistema | o que existe hoje (evidência) |
| --- | --- |
| 2 Prototype Engine | runtime mock completo (`mock.js:2-16` — data/state/go/overlay/toast, action modules, `$ref`), visualizador 5,1k linhas (`viewer.html:7`), servidor com API tokenizada (`serve.mjs:25`), corpus de exemplo verde no validador (verificado: `validate.mjs` sobre `assets/example` → exit 0, 4 telas) |
| 3 Design System | pipeline de tokens determinístico (`gen-tokens.mjs:4`, `export-tokens.mjs:4`, `lib/token-groups.mjs:2`), registry schema v2 + rematerializador por marcadores (`sync-components.mjs:4`, `marker-parser.mjs:3`), contrato `tokens.contract.md:1` travado por `rules/contract-doc-sync.mjs:3` |
| 6 Implementation QA | validador de 1.429 linhas (`validate.mjs:3`) + 10 regras carregadas por extensão (`validate.mjs:1366`), rig R1-R4 (`qa.mjs:3`), baseline de métricas congelada (`example/metrics.json:2`), suíte de comportamento do runtime (`mock-check.mjs:2` — verificado: 5 suites, exit 0) |
| 7 Design Memory | export de spec por tela com estados/fluxos/textos/regras/paridade (`export-spec.mjs:3`), snapshots versionados `src/`+`render/` (`example/snapshots/login/v1/`), e — já durante esta auditoria — o agent map gerado (`agent-map.json:2` com `gitSHA`+`contentHash`) e a busca direta `find.mjs:3` |
| 8 Agent Orchestration | plugin OpenCode v2 (`index.ts:55`, `core.mjs:50-65` MIRROR/SEED, `core.mjs:174` carimbo `.mockbird-version`), comandos `/design` etc. (`commands/design.md:5`), setup por projeto "nunca brick" (`setup-design.mjs:3`, `copy-list.json:2`), release por tag (`release.yml:19`), i18n do viewer/docs (`i18n-check.mjs:2` — verificado: exit 0) |
| 4 Visual QA | smoke v2 por viewport derivado (`smoke.mjs:3`, `lib/viewport.mjs:2`) com baselines de pixels e manifesto (`example/snapshots/manifest.json:2`), aceitação em navegador real do viewer (`viewer-accept.mjs:2`) |
| 5 Review Engine | skill impeccable v4.4.0 completa (`impeccable/SKILL.md:1-15`, 41 playbooks em `reference/`), live variant mode (`live-browser.js:2`), fluxo de comentários com pins (`example/comments.json:2`, API `serve.mjs:25`) |
| 1 Design Intelligence | camada de craft fundida (`craft.md:1-26`) + taste (`taste/SKILL.md:1`) + emil (`emil-design-eng/SKILL.md:1`) — conteúdo completo, mas com contradições entre si (§4) |

## 3. O que é parcial

1. **Automação dos fixtures** — o corpus existe e é rico (bad/ok/consumers/
   smoke/legacy-project/marker + os novos map-dead/verbs-divergent/
   map-adversarial), mas 6 categorias não têm runner: nada no repo percorre
   `bad/`/`ok/` inteiros (só os pares pontuais citados em
   `rules/spec-undeclared.mjs:13`, `mock-check.mjs:591`, `qa.mjs:78`).
   Só `security-suite.mjs` tem gate real (`ci.yml:37`).
2. **Typecheck do codegen** — `fixtures/tsconfig.codegen.json:1` habilita
   strict sobre o TSX gerado, mas nenhum passo executa `tsc` (sem typescript
   em `package.json`).
3. **Launcher Windows do impeccable** — auto-declarado testado apenas por dry
   parsing, "not yet on a real Windows machine" (`impeccable.cmd:7`).
4. **README da skill design** — "Comandos (instalado)" (`README.md:46`) lista
   5 ferramentas; o copy-list instala mais 8 (`copy-list.json:14-38`).
5. **`agent-map.mjs` sem testes unitários** — o gerador do todo 6 tem contrato
   completo e auto-verificação pontual (`agent-map.mjs:3-30`,
   `--check-verbs`), mas nenhum `*.test.mjs` próprio no repo (a verificação
   hoje é manual sobre `fixtures/map-*` e `verbs-divergent`).
6. **Contrato de inventário do example** — verificado durante a auditoria:
   `validate.mjs --example-inventory` saiu **exit 1** com
   `inventory-extra: agent-map.json` e `agent-map.md` (artefatos gerados pelo
   todo 6 ainda não listados em `inventory.json`). Gap de conteúdo pequeno e
   citado: adicionar as duas linhas à lista fecha o contrato.

## 4. O que precisa de refatoração (com evidência)

1. **Dois mecanismos de entrega divergentes.** `plugin/core.mjs:50-62`
   (MIRROR) não embarca `rules/`, enquanto `copy-list.json:24-37` embarca.
   `validate.mjs:29` e `validate.mjs:1366` mostram o efeito: sem `rules/` ao
   lado, as 10 regras simplesmente não rodam em projetos sincronizados só pelo
   plugin. A sincronização entre os dois listões é gate **manual** de PR
   (`PULL_REQUEST_TEMPLATE.md:8`) e ainda aponta a copy list do `SKILL.md`,
   não a fonte única `copy-list.json` (`setup-design.mjs:41`).
2. **Paridade do CI.** `.github/workflows/ci.yml:24-37` executa 5 dos 7 passos
   de `npm run ci` (`package.json:21`) — faltam `test:mock` e `check:i18n`;
   nenhum teste com navegador roda em lugar algum do CI (`test:ui`,
   `smoke.mjs` de telas). `setup-design.test.mjs:2` e `find.test.mjs:2` também
   ficam fora de `npm test`.
3. **Contradições entre skills** (reconciliação = todo 4, com regra vencedora
   por escopo): dials `craft.md:20-26` (7/4 produto) vs `taste/SKILL.md:51`
   (8/6/4); loop de QA "até limpar" `design/SKILL.md:394` vs passes limitados
   `craft.md:98-101` e `impeccable/SKILL.md:15`; valores arbitrários de
   Tailwind `design/SKILL.md:320` vs uso livre `taste/SKILL.md:929`; caminho
   inexistente `taste/SKILL.md:843` (`skills/taste-skill/blocks/`); resposta
   inicial engessada `emil-design-eng/SKILL.md:10`; alias `craft` depreciado e
   com nome colidido (`impeccable/reference/craft.md:1` vs
   `assets/craft.md:1`); allowlists "transicionais" já vazias na prática
   (`design/SKILL.md:414` e `:534` vs `validate.config.json:10,37`).
4. **Vendored impeccable** — o launcher busca um binário que não está no repo
   (baixado no primeiro run, `scripts/impeccable:2-4`): dependência externa
   implícita num pacote que se vende "zero deps".

## 5. O que deve ser construído (por subsistema)

| subsistema | capacidade ausente (hoje inexistente como código) |
| --- | --- |
| 1 Design Intelligence | motor de decisão único de dials/escopo (a regra vencedora por superfície, após o todo 4) e leitura de brief auditável |
| 2 Prototype Engine | geração de telas dirigida por contrato a partir de brief/spec (hoje telas são escritas à mão); estados interativos além do mock |
| 3 Design System | **checagem de paridade contra o frontend real** — hoje o status fica `pending` por construção (`export-spec.mjs:33`) e o mapeamento breakpoints 640/900 vs Tailwind do real é lacuna global declarada (`example/spec/parity.md:35`) |
| 4 Visual QA | matriz de captura 5 viewports × 7 estados por tela (todo 9) e gate de navegador no CI (hoje zero browsers) |
| 5 Review Engine | ciclo de revisão integrado canvas→comentário→correção (hoje é passo manual do SKILL.md `:4b`) e triagem dos pins resolvidos |
| 6 Implementation QA | runner automatizado das categorias de fixtures (§3.1), gate `tsc` do codegen e testes dos módulos `rules/` isolados |
| 7 Design Memory | histórico comparável entre versões de design (diff de agent-map/spec/snapshots entre tags) e memória de decisões reutilizável |
| 8 Agent Orchestration | unificação MIRROR × copy-list (§4.1), paridade de CI (§4.2), fachada CLI `mockbird` (todo 60) e empacotamento do `/design-map` no fluxo `/design` |

## 6. Decisões de auditoria e corrida entre faixas

- **Fixtures por categoria** (decisão do dono): 11 grupos com a lista completa
  de members; amostra de até 10 membros por grupo conferida linha a linha
  (grupos menores amostram todos). `check.mjs` prova: união dos members ==
  `skills/design/scripts/fixtures/` inteiro, sem duplicatas e sem fora-do-escopo.
- **Faixas paralelas da Wave 0.** Os todos 5, 6 e 8 do plano rodam em paralelo
  e commitaram nesta mesma worktree durante a varredura (`e5e1c44` find +
  `fixtures/find-target`, `e4e2370` carimbo do plugin, `05131be` agent-map +
  `/design-map`). Todos os entregáveis são conteúdo real do repositório e
  entraram na auditoria como qualquer outro arquivo (incluindo **entradas
  incrementais** de grupo — o caso previsto pela decisão do dono "grupo novo =
  entrada nova incremental": `fixtures-find-target`, `fixtures-map-dead`,
  `fixtures-map-adversarial`, `fixtures-verbs-divergent`). As saídas dos
  todos 2-4 desta mesma onda (`docs/arquitetura-evolutiva.md`, `docs/camadas.md`,
  `docs/adr/` e seus verificadores) ficam fora do escopo deste F1 e estão na
  lista explícita de exclusões como declaração prospectiva documentada.
- **Staleness é detectável por construção.** `auditoria.json` embute `gitSHA` +
  timestamp e prende o texto de cada linha citada (`evidenceText`). O check
  falha (exit 1) se: o `gitSHA` não existe mais; qualquer arquivo auditado
  mudou de tamanho de linhas; qualquer linha citada não confere mais; algum
  arquivo novo não coberto aparecer. Mudanças commitadas desde o `gitSHA` são
  sempre listadas no stdout (informacional) — ver comprovações em
  `.omo/evidence/task-1-mockbird-evolution.md`.
- **Textos externos não mudam classe.** Entradas hostis de teste
  (`fixtures/map-adversarial/01-x.html:10` — "texto externo hostil…") e
  comentários auto-promotores nos fontes não alteram classificação sem
  evidência de código (exemplos no §1).

## 7. Como reproduzir a verificação

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/auditoria.json','utf8'))"   # JSON válido
node docs/auditoria.json.check.mjs      # exit 0 + totais + amostra aleatória com linhas citadas
```

As injeções de falha (path inexistente, JSON vazio/truncado, `gitSHA`
desconhecido, linhas divergentes) e seus exits observados estão no arquivo de
evidência citado acima.

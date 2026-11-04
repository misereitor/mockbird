# ADR-0002 — Camadas Core / Skills / Adapters como mapa do repositório

## Status

Aceito em 2026-11-04. Registrado pelo todo 2 do plano `mockbird-evolution`
(GAP-E5). A classificação foi validada na auditoria do todo 1
(`docs/auditoria.json#taxonomy.layerRule`, `docs/auditoria-tecnica.md`).

## Contexto

O repositório mistura código executável, instrução escrita à mão e superfícies
de integração no mesmo árvore: o validador vive ao lado de SKILL.md, o plugin
OpenCode ao lado de bundles vendorizados. A auditoria do todo 1 classificou 555
arquivos e precisou de uma regra de camada explícita para decidir onde cada
arquivo aterrissa; sem mapa de camadas e ownership, cada contribuição nova
decide por conta própria e o código determinístico acaba contaminado de prosa
(ou o contrário). O plano resolve isso com o todo 3 (mapa por arquivo +
ownership por subsistema), e este ADR fixa a taxonomia que esse mapa usa.

## Decisão

1. **Três camadas, mutuamente exclusivas por arquivo:**
   - **Core** — código executável determinístico e os dados/contratos que os
     motores consomem ou geram (validador, regras, image-diff, serve, corpus de
     exemplo, config, fixtures).
   - **Skills** — instrução/documentação escrita à mão para humanos e LLMs
     (SKILL.md, craft.md, reference/, READMEs, guias, LICENSE).
   - **Adapters** — superfícies de integração e entrega (plugin OpenCode,
     commands registrados pelo plugin, `.github`, launchers, bundles
     vendorizados de terceiros).
2. **A camada determina o regime de teste**: Core exige teste automatizado
   (`node:test` + fixtures); Skills exige validação de consistência e corpus de
   regressão; Adapters exige teste de integração (plugin, instalação, CI).
3. **Ownership por subsistema (1 Design Intelligence · 2 Prototype Engine ·
   3 Design System · 4 Visual QA · 5 Review Engine · 6 Implementation QA ·
   7 Design Memory · 8 Agent Orchestration & Quality Gates) fica em
   *docs/camadas.md* (todo 3)** — um dono por capacidade.
4. **Camada e subsistema são classificações ortogonais**: a camada diz *o que o
   arquivo é*; o subsistema diz *a quem ele serve*. Ondas de execução do plano
   são uma terceira dimensão, ainda diferente (agrupam ordem de construção).
5. **Se a taxonomia não mapear na realidade, o remap vira ADR**
   (*docs/adr/ADR-0005-remap-taxonomia.md*, produzido pelo todo 3) — nunca se
   força o mapa para caber na teoria.

## Consequências

- Todo arquivo novo precisa declarar camada e subsistema (matriz de
  ownership do todo 3); revisão de PR passa a ter pergunta fixa: "que camada?".
- A regra já foi aplicada à auditoria inteira sem ambiguidade residual nos 188
  arquivos + 11 grupos de fixtures (ver contagens em `docs/auditoria.json#totals`).
- Limitação aceita: bundles vendorizados ficam em Adapters mesmo sendo código
  executável — a camada descreve papel no sistema, não linguagem do arquivo.

## Reversibilidade

- **Camadas são metadados documentais**: nenhum código de produção depende dos
  rótulos hoje; reverter ou renomear camadas é editar *docs/camadas.md* e este
  ADR, sem migração.
- **Remaps de taxonomia** (ex.: subsistema que não cabe na realidade) são
  reversíveis por ADR dedicado, com a mesma semântica usada para criar
  (precedente: ADR-0005 do todo 3).
- **Reverter a regra 2** (regime de teste por camada) exigiria ADR substituto,
  porque afeta a política de verificação dos próximos todos.

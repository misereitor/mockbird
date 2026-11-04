# ADR-0005 — Remap da taxonomia de 8 subsistemas para a realidade do repositório

## Status

Aceito (2026-11-04) — registra as decisões de mapeamento do todo 3
(`docs/camadas.md`) quando a taxonomia fixa de 8 subsistemas não mapeou limpo
na árvore real. O enum 1-8 NÃO foi renumerado nem redefinido; onde coube mal,
atribuímos o subsistema mais próximo e registramos aqui.

## Contexto

O plano fixa o enum: 1 Design Intelligence | 2 Prototype Engine | 3 Design
System | 4 Visual QA | 5 Review Engine | 6 Implementation QA | 7 Design Memory
| 8 Agent Orchestration & Quality Gates. A árvore real não distribui o
conteúdo nesses 8 recipientes de forma uniforme:

- skills/design concentra 471 arquivos e serve aos 8 subsistemas
  (validador e fixtures são maioria: subsistemas 6 e 3), enquanto
  skills/taste e skills/emil-design-eng têm 2 arquivos cada (subsistema 1) e
  skills/impeccable tem 55 (subsistema 5). Tamanho de diretório não é peso de
  subsistema.
- O bloco do todo 3 cita um arquivo de instalação na camada Adapters; o
  instalador real do repositório é skills/design/scripts/setup-design.mjs e o
  docs/auditoria.json o classifica Core (algoritmo determinístico de setup,
  junto com skills/design/scripts/copy-list.json).
- A onda do serviço com contas (todos 53-59 e 62) não tem subsistema nomeado
  no enum: é hospedagem multiusuário com autenticação, papéis humanos,
  persistência e manual de operação.
- Vários capacidades planejadas são gates transversais (benchmark, CI, corpus
  dourado, maturity, compat, done:check, CLI, pack) que consomem motores de
  outros subsistemas.
- O subsistema 7 "Design Memory" abriga hoje artefatos de especificação e
  memória de tela (export-spec, snapshots versionados, agent map, busca
  direta) — a memória de decisões DEC-xxx ainda não existe (é o todo 18).

## Decisão

1. **Ownership por capacidade, nunca por tamanho de diretório.** Cada
   capacidade tem exatamente um subsistema dono; arquivos podem servir vários
   (a tabela de diretórios de docs/camadas.md declara o conjunto servido por
   subárvore, conferido contra o audit). skills/design declara os 8
   subsistemas servidos sem virar "dono de tudo": os donos são os arquivos
   listados por capacidade na tabela de ownership.
2. **Regra de atribuição de todo planejado, em ordem de força:** (a) título do
   todo que nomeia subsistema do enum (todo 18 "Design Memory" → 7; todo 33
   "Agent Orchestration" → 8); (b) agrupamento do plano cujo título é nome de
   subsistema ("Implementation QA: …" → todos 27-31); (c) subsistema dono do
   artefato primário estendido segundo o audit; (d) capacidade transversal de
   gate/CI/tooling/CLI → 8, revisão/avaliação humana → 5, operação do runtime → 2.
3. **Serviço com contas (53-59, 62) → subsistema 2 (Prototype Engine).** O
   artefato evoluído é skills/design/assets/serve.mjs (dono sub 2 no audit) e a
   capacidade é servir/executar protótipos para pessoas. Contas humanas não são
   orquestração de agentes (8 trata de agentes e gates). Exceção interna: todo
   57 (superfícies de comentário com autoria/papel) → 5, porque o fluxo de
   comentários pertence ao Review Engine (audit: skills/design/assets/example/comments.json
   é sub 5). Alternativa descartada: colocar toda a onda em 8.
4. **Gates transversais → 8:** todos 14 (benchmark), 15 (CI real), 39 (corpus
   dourado), 42 (maturity), 44 (compat de contrato público), 47 (done:check),
   60 (CLI), 61 (pack portátil). Alternativas descartadas: 14 → 4 (usa motores
   visuais, mas gateia a melhoria do tool); 39 → 3 (o material é de padrões do
   design system, mas a régua existe para gatear o tool); 44 → 3/6 (fixtures
   consumidores são sub 3 no audit, mas a capacidade é o gate de compat).
5. **Fronteiras de camada:** plugin/core.mjs e plugin/index.ts = Adapters
   (papel de entrega/integração — MIRROR/SEED, pull, sync — apesar de o sync
   ser determinístico; a hipótese "Core glue" é descartada aqui); comando em
   commands/ = Adapters (superfície registrada pelo plugin); bundle vendorizado
   e launcher = Adapters; skills/design/scripts/*.mjs = Core (ferramenta
   determinística mesmo sob diretório de skill); serve.mjs = Core (motor);
   setup-design.mjs e copy-list.json = Core, divergindo do exemplo do bloco do
   todo 3 (instalação é algoritmo determinístico; a entrega é do MIRROR/SEED do
   plugin).
6. **Contestações de todo registradas com alternativa:** 16/35 (hardening do
   viewer/servidor) → 2 (por artefato; alternativa 8), mesmo padrão do grupo de
   segurança do audit (fixtures-seguranca é sub 2); 30 (docs geradas) e 31
   (evolution + experiments) → 6 pelo agrupamento do plano, embora estendam
   export-spec.mjs (sub 7) e guardem história (quase 7) — alternativa 7
   registrada; 38 (slop-lint) → 6 (regra do validador; alternativa 8 como
   gate); 40 (bisect visual) → 4 (motores de captura/score; o join com DEC-ids
   é contribuição do 7); 46 (avaliação cega) → 5 (natureza de avaliação humana;
   alternativas 6/7 por ser extensão dos experiments do 31); 36 (sync
   schema↔instrução) → 8 (gate de sincronização; alternativa 1).
7. **Não forçar o mapa:** os fatos auditados (sub 7 abrigando specs/snapshots/
   agent-map/find hoje) são mantidos como estão; nenhuma entrada do audit foi
   reclassificada por este ADR.

## Consequências

- Quem pergunta "quem é dono de X?" responde com a tabela de ownership de
  docs/camadas.md: capacidade → camada dona → arquivo dono → existe/planejado.
- A coluna Planejado particiona os todos 9-62 sem sobreposição — quando um todo
  for concluído, ele sai da coluna Planejado e entra em "Existe hoje" do
  subsistema dono (o check docs/camadas.check.mjs continua exigindo a partição).
- skills/design continua sendo o ponto quente de mudança: qualquer diretório
  novo fora das linhas existentes quebra a cobertura do check e obriga linha
  nova — é proposital (drift de inventário vira falha, não silêncio).
- A camada Adapters fica pequena e intencional (plugin, comandos, .github,
  launchers, bundles): se um dia existir conector de provedor LLM (todo 48), o
  adaptador de provedor entra em Adapters por esta mesma regra.

## Reversibilidade

Reversível sem migração: este ADR só decide atribuição e fronteiras de camada;
nenhum arquivo foi movido, renomeado ou reclassificado. Para reverter uma
atribuição, alterar as células afetadas de docs/camadas.md e a linha
correspondente deste ADR (as duas mudanças juntas), e rodar
`node docs/camadas.check.mjs` — o check não valida a "melhor" atribuição, mas
garante que mapa, árvore e audit continuem coerentes. Se o enum de
subsistemas for revisado no plano, este ADR vira superseded e o mapa é
regenerado pela regra nova.

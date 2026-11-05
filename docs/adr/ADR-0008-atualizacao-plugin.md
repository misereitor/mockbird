# ADR-0008 — Atualização pinada do plugin e verificação de integridade do carimbo

## Status

Aceito em 2026-11-05. Registrado pelo todo 34 do plano `mockbird-evolution`
(GAP-E3). Este ADR não foi substituído nem revisado.

## Contexto

O plugin se auto-atualizava com `git pull --ff-only` em todo setup de projeto
(`plugin/core.mjs` `pullPack`, limitado por `PULL_INTERVAL_MS`) — sem pin de
versão, sem registro da versão aplicada e sem verificação de integridade do
carimbo `design/.mockbird-version` (GAP-E3): o comportamento de projetos
existentes mudava sem aprovação, e uma divergência local virava `.bak` em
silêncio (sem aviso no log e sem status consumível pelo inspector, todo 21).

Restrições concretas do desenho:

1. **Pull silencioso é proibido pelo plano** (todo 34): nenhuma atualização
   pode mudar o comportamento de um projeto existente sem aprovação explícita.
2. **Rollback orquestrado e canais complexos estão fora de escopo** — a
   solução tem que ser pin + verificação, nada mais.
3. **O núcleo roda em Node 18+ plain JS** (`plugin/core.mjs`), compartilhado
   com `plugin/smoke.mjs`; a superfície testável é `plugin/core.test.mjs`.
4. **`design/.mockbird-version` (todo 5)** já registra semver + SHA-256 dos
   arquivos MIRROR + data, mas os checksums por arquivo não eram conferidos a
   cada `syncProject`.

Alternativas consideradas e rejeitadas:

- **`autoUpdate: true` com pull flutuante**: mantém atualização sem pin — o
  HEAD remoto mudaria o comportamento sem o usuário escolher a versão; o
  GAP-E3 não fecha.
- **Pin por commit SHA**: opaco demais para o usuário; o repositório já
  publica releases por tag semver (`release.yml`, tags `v*`).
- **Rollback orquestrado / canais de atualização**: proibido pelo plano
  (fora de escopo).

## Decisão

1. **`mockbird.autoUpdate` é opt-in e o próprio valor é o pin.** A chave (a
   opção `autoUpdate` do plugin `mockbird` em `ctx.options` — `PluginOptions`
   é um registro plano) fica ausente/off por padrão: **zero chamadas git** e
   toda atualização é recusada com mensagem explícita. Quando presente, o
   valor precisa ser a tag semver pinada (`vX.Y.Z` ou `X.Y.Z`); qualquer
   outro valor (`true`, `latest`, tag malformada) é recusado da mesma forma.
2. **Atualização pinada, nunca pull flutuante.** Com o pin definido, a
   atualização executa `git fetch --tags` + `git checkout <pin>` — exatamente
   a versão aprovada. Falha (offline, conflito) mantém a versão local com
   mensagem não fatal. A atualização vale para o auto-update do setup (com o
   throttle existente) e para o `/design-sync`, que sem pin apenas recusa a
   atualização, recarrega as skills e re-sincroniza o `design/`.
3. **Integridade verificada a cada `syncProject`.** `verifyStamp()` confere os
   checksums SHA-256 por arquivo espelhado contra o campo `files` do carimbo e
   o hash composto `mirrorHash` contra o registro, nomeando arquivos
   adulterados (`tampered`), apagados (`missing`) e registro editado/stale
   (`recordMismatch`). A versão aplicada (semver) fica registrada no carimbo
   (`version`) e é relida por `verifyStamp` — superfície do inspector.
4. **Divergência sinaliza, nunca em silêncio.** Cada arquivo divergente recebe
   `.bak` com a versão local (já existente) e cada problema de integridade ou
   divergência gera uma linha `WARNING` em `LOG_FILE`, entra em
   `summary.warnings`/`describe()` e no carimbo: `status` (`ok`/`warning`) +
   `integrity` (`{ok, tampered, missing, recordMismatch}`) — status
   consumível pelo inspector (todo 21).
5. **Cobertura em `plugin/core.test.mjs`**: recusa sem flag com zero chamadas
   git; pin executa exatamente fetch+checkout da tag e recusa pins
   malformados; checksum detecta arquivo MIRROR adulterado (com re-verificação
   fresca); versão aplicada registrada/relida; sonda de falha QA assertando
   `.bak` + aviso no log (silêncio ≠ passa).

## Consequências

- Projetos existentes param de receber atualizações do pack até configurar
  `mockbird.autoUpdate` — é exatamente o objetivo: a versão só move com pin
  aprovado. O `/design-sync` segue re-sincronizando `design/` e reporta a
  recusa quando não há pin.
- Com pin, o checkout do pack fica na tag (`checkout <pin>`); a versão aplicada
  é registrada em `design/.mockbird-version` por cada sync.
- Toda divergência (edição local ou upgrade do kit) agora gera `WARNING` no
  log e derruba `status` para `warning` — o ruído é intencional: silêncio não
  pode significar sucesso.
- O carimbo ganha campos aditivos (`status`, `integrity`); consumidores antigos
  não quebram e o inspector lê tudo do próprio `design/.mockbird-version`.
- `pullPack` passa a receber o valor de `mockbird.autoUpdate` e retorna
  `{ok, applied, message}`; o throttle (`PULL_INTERVAL_MS`) continua valendo
  para o caminho pinado.

## Reversibilidade

- **Reversível por configuração**: mudar o pin move a versão; remover a chave
  volta ao estado "sem atualizações". Nenhum dado de projeto é afetado.
- **Reverter para pull flutuante sem pin** reintroduziria o GAP-E3 e exigiria
  um ADR substituto que registre por que o projeto aceita mudar o
  comportamento de projetos existentes sem aprovação.
- Os campos novos do carimbo são aditivos e `verifyStamp` é somente leitura:
  removê-los no futuro não afeta o espelhamento em si.

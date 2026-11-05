# ADR-0009 — Segurança completa do viewer e do servidor local

## Status

Aceito em 2026-11-05. Registrado pelo todo 35 do plano `mockbird-evolution`
(GAP-E4), sobre a base mínima do todo 16 (CSP inicial com hashes de
`<script>`, `sanitizeCommentText`, X-Content-Type-Options/Referrer-Policy,
guards de rota). Este ADR não foi substituído nem revisado.

## Contexto

O `serve.mjs` local concentra duas superfícies: o viewer/docs (HTML servido com
token injetado em memória) e a API de escrita sobre `design/` (comentários,
snapshot, revert, history/restore, screen-size, agent-send). O texto que entra
por comentários/pins é conteúdo externo não confiável (§1.4 do documento de
arquitetura) e os parâmetros de rota são malformáveis. Sob a base do todo 16
restavam abertos:

1. `style-src 'unsafe-inline'` — qualquer código de estilo inline servido ou
   injetado rodava sem allow-list.
2. Iframes de previews autorizados sem `sandbox` — um mockup podia se conceder
   top navigation, popups e downloads.
3. Métodos errados em rotas de escrita caíam num `404` genérico; não havia
   rate limit contra brute-force de token ou inundação da API.
4. Campos não declarados num payload de escrita eram aceitos/ignorados sem
   recusa explícita — a escrita em `design/` não era restrita a campos
   declarados.
5. O pipeline do revert (gen → sync → validate) rodava sobre qualquer
   `validate.config.json`, inclusive schemas desconhecidos, e o sync/mirror
   reescrevia o root sem backup persistente com retenção.

Restrições do plano: nenhuma dependência nova de servidor; bind além de
localhost apenas com `--share` explícito; a security-suite (12/12) permanece
verde e cresce; `scripts/viewer-accept.mjs` (44 passos, playwright-core) roda
verde depois da mudança.

## Decisão

1. **CSP enforced, sem `'unsafe-inline'`, por hash de valor.** `cspFor` passou
   a hashear os bytes SERVIDOS finais (pós-rewrite de token e pós-varredura de
   iframe): `<script>`/`<style>` inline pelo texto do bloco e atributos
   `style=` pelo valor do atributo sob `'unsafe-hashes'` (CSP3). A política
   sai como header `Content-Security-Policy` — nunca `Report-Only`.
   **report-only → enforce documentado:** a opção de lançar em report-only
   primeiro foi considerada e REJEITADA — o único consumidor é o próprio tool,
   e a bateria (security-suite #12 + viewer-accept com captura de erros de
   console) já reprova qualquer violação; report-only atrasaria a detecção sem
   ganho. Se enforce quebrar um consumidor, o caminho de correção é acrescentar
   o hash do conteúdo legítimo (ou removê-lo), nunca voltar a report-only sem
   ADR novo.
2. **Sandbox de iframe em todo HTML servido.** Varredura no servidor: `<iframe>`
   sem atributo `sandbox` ganha `allow-scripts allow-same-origin allow-forms`
   (o mesmo trio que o viewer já declara nos próprios frames de preview);
   iframes que declaram o próprio sandbox ficam byte-intactos. Interiores de
   `<script>`/`<style>`/comentários nunca são reescritos (strings de JS e CSS
   preservadas).
3. **Proteção de rotas.** Allow-list de métodos por rota (verbo errado →
   `405 {"error":"method-not-allowed"}` + header `Allow`; antes: 404);
   `X-Design-Token` obrigatório em toda `/api/*` (mantido do todo 16) e
   `--share` recusa `/api/*` mesmo com token (mantido — a revisão da auth do
   share confirmou o desenho atual: token fica `null` no HTML servido e a
   degradação read-only é declarada; o que faltava era cobertura, hoje nas
   asserts #6/#8/#9); rate limit simples: janela fixa de 300 chamadas por
   minuto por endereço remoto em `/api/*` → `429 {"error":"rate-limited"}` +
   `Retry-After`; `.history/` e `.backups/` são estado do servidor e nunca são
   servidos estaticamente (404 sem vazamento; listagens de diretório também os
   omitem).
4. **Escrita só em payload declarado.** Whitelist por rota: comentários aceitam
   apenas `{id, canvas, file, selector, snippet, rect, status, replies,
   _demo}`; itens de reply apenas `{text, at, createdAt}`; `rect` apenas
   `{x, y, width, height}` numéricos finitos; snapshot/revert `{canvas,
   label}`; screen-size `{canvas, file, width, height}`; history-restore
   `{file, revision}`; agent-send `{text}`. Qualquer chave fora do declarado →
   `400 {"error":"invalid"}` antes de qualquer handler — nada é persistido em
   `design/` fora dos campos declarados.
5. **Config versionado.** `validate.config.json` ganha `schemaVersion: 1`
   (seed em `skills/design/assets/validate.config.json`; validate.mjs só lê
   chaves conhecidas, então a adição é neutra para o validador). Antes de o
   revert disparar gen → sync → validate, o servidor segue a mesma cadeia de
   descoberta do validate.mjs (raiz validada → CWD) e recusa versão não
   inteira ou desconhecida com `400 {"error":"config-schema"}`, sem tocar o
   root. Campo ausente = config legado (pré-versionamento), ainda aceito.
   `.backups` entra em `exemptDirs`: backups podem conter arquivos de um
   estado pré-revisão que reprovariam o walker de bans.
6. **Backup persistente antes de sync/mirror.** Todo revert tira
   `design/.backups/<timestamp>/` com o root como estava ANTES de
   restore → gen → sync → validate reescrevê-lo (sem `snapshots/`, `.history/`
   e `.backups/`). Retenção: os 5 mais novos (`BACKUP_KEEP`) sobrevivem; os
   mais antigos são podados. O rollback transacional do revert (cópia temporária
   + rollback total em 500) permanece como estava.

## Consequências

- **Style attrs por hash.** Navegadores sem suporte a `'unsafe-hashes'` para
  atributos `style` (Firefox antigo) ignoram os hashes e bloqueiam os 2
  atributos do `docs.html` (cosmético). O viewer não usa atributo `style`
  (0 ocorrências verificadas) e não é afetado.
- **Trade-off do trio de sandbox.** `allow-same-origin` + `allow-scripts` é
  necessário: o mock.js dos previews faz `fetch` de `data.json` e origem opaca
  quebraria o carregamento. O isolamento remanescente bloqueia top navigation,
  popups, downloads e modais — exatamente a superfície explorável de um
  mockup malicioso.
- **405 muda a resposta** de verbos errados em rotas conhecidas (antes 404).
  O viewer usa só os verbos declarados (viewer-accept 44/44 verde).
- **Rate limit 300/min por IP.** O polling do viewer é estático (`pollFiles`);
  `/api/*` é orientado a eventos — margem folgada para o uso real e suficiente
  para inviabilizar brute-force de token de 128 bits e inundação.
- **Projetos instalados antigos** (config sem `schemaVersion`) continuam
  funcionando; instalações novas copiam o seed já versionado.
- **Backups aumentam o root** (~5× o tamanho do design). Aceito: é o custo de
  resgate antes de sync/mirror.

## Reversibilidade

- **CSP:** voltar `style-src 'unsafe-inline'` é uma linha em `cspFor`, mas
  reverte este ADR e reprova a assert #12 da security-suite (proposital).
  Hashes podem ser removidos página a página.
- **Sandbox de iframe:** remover `sandboxIframes` dos caminhos de HTML servido
  restaura o comportamento anterior (assert #15 fica vermelha).
- **405 / payload declarado / rate limit:** remover `ROUTE_METHODS`,
  `checkDeclaredPayload` ou `rateRetryAfter` de `handleApi` restaura o
  comportamento anterior (asserts #13/#14/#19 ficam vermelhas — cada guarda é
  coberta por teste que reprova quando a proteção é removida).
- **schemaVersion:** aceitar qualquer versão = remover `checkConfigSchema`; o
  campo no config continua inócuo para validate.mjs.
- **Backups:** remover `backupDesign` + apagar `design/.backups/` não afeta
  mais nada (o rollback transacional do revert continua independente).

Verificação registrada: `node skills/design/scripts/fixtures/security-suite.mjs`
→ 19/19 (evidência em
`.omo/evidence/task-35-mockbird-evolution.md`), com sondas de mutação — cada
proteção removida reprova exatamente a sua assert — e `scripts/viewer-accept.mjs`
44/44.

# DesignAgent — contrato model-agnostic (generate / review / improve)

> Contrato de integração de papéis de IA do Mockbird. Plano todo 32 (GAP-E2);
> interface nominal fixada por `docs/arquitetura-evolutiva.md` §5.5; regras
> comuns (schemaVersion, anti-fake, determinismo, offline) da §5.6.
> Schema normativo: `skills/design/assets/design-agent.schema.json`.
> Consumidores: visual-critic `--vision` (todos 11/14/32), benchmark
> (`benchmarks/run.mjs`, todo 14) e orquestração multi-agente (todo 33).

## 1. Princípio

Todo passe de LLM do sistema fala com ESTE contrato — nunca com um SDK ou
provedor diretamente. O contrato é independente de provedor: o mesmo payload
entra e sai do stub offline e dos adaptadores reais. **Proibido:** provedor
hardcoded no core; chamada paga sem flag de opt-in + teto de orçamento.

## 2. Descritor do agente

```json
{ "role": "critic-vision", "capabilities": ["generate", "review", "improve"] }
```

- `role`: papel desempenhado (papéis do sistema: os do orquestrador, todo 33).
- `capabilities`: operações implementadas; toda capacidade declarada precisa ser
  exercitável com IO schema-válido.

## 3. Operações (IO JSON, `schemaVersion` obrigatório)

| Operação | Request ($def) | Response ($def) | Saída nominal |
| --- | --- | --- | --- |
| `generate(request)` | `GenerateRequest` | `GenerateResponse` | `screens: [{screen, html}]` |
| `review(reportSchema)` | `ReviewRequest` | `ReviewResponse` | `issues: [Issue]` |
| `improve(issues)` | `ImproveRequest` | `ImproveResponse` | `patch: {screen, html, rationale, decIds}` |

- `review(reportSchema)`: a entrada é o payload de análise no formato de
  relatório (`screen/viewport/state/html/screenshotPng` — recorte de
  `critic-report.schema.json`; `screenshotPng` em base64); a saída são `issues`
  no shape exato do relatório (severity/category/element/problem/suggestion/
  evidence).
- `improve(issues) -> patch`: o patch carrega `rationale` obrigatório (why —
  melhoria sem explicação é rejeitada) e `decIds` (§5.3).
- Todo request carrega `budgetTokens` (inteiro ≥ 1) = teto da operação; toda
  response reporta `tokensUsed` ≤ teto.

**Envelope da response** (sempre do runtime, nunca do texto do modelo):
`{schemaVersion, operation, adapter, model, tokensUsed, ...corpo}`.

**Alias legado `analyze()`**: os consumidores dos todos 11/14 (visual-critic,
benchmark) chamam `analyze({screen, viewport, state, html, screenshotPng(bytes),
budgetTokens})` → `{schemaVersion, model, tokensUsed, issues}`. Todo adapter
implementa `analyze()` como alias de `review()` com esse envelope antigo; o
conteúdo de `issues` é idêntico ao de `review()` para a mesma entrada
(provado em `contract.test.mjs`).

## 4. Versionamento do schema (§5.6)

1. `schemaVersion` é obrigatório em todo payload (request e response).
2. **Evolução aditiva** (campo novo opcional) preserva `schemaVersion = 1`.
3. **Mudança incompatível** sobe o número e gera seção de migração em
   `docs/migration-guide.md`.
4. Consumidores verificam `schemaVersion` **antes de interpretar** e recusam
   qualquer valor ≠ 1 (`validate.mjs#validatePayload` faz a verificação
   primeiro) — estado obsoleto ou futuro nunca é interpretado em silêncio.

## 5. Fronteira de confiança (texto externo é não confiável)

Resposta de modelo é tratada como não confiável em todo adapter:

1. só JSON é aceito (fences markdown são descartadas; resto → erro);
2. o envelope (`schemaVersion/operation/adapter/model/tokensUsed`) é do runtime
   — o texto externo não controla identidade, versão nem gasto;
3. o corpo só é aceito depois de validado contra o $def da operação; violação →
   `ContractViolationError` **nomeando o campo pelo caminho JSON** (ex.:
   `$.issues[0].severity: fora do enum [...]`);
4. `__proto__`/campos extras caem no `additionalProperties: false` do schema.

## 6. Adaptadores (`skills/design/scripts/agent-adapters/`)

| id | módulo | env | default | offline |
| --- | --- | --- | --- | --- |
| `stub` (`stub-deterministic`) | `stub-deterministic.mjs` | — | **sim** | sim |
| `openai-compatible` | `openai-compatible.mjs` | `OPENAI_API_KEY` (obrigatória), `OPENAI_BASE_URL`, `OPENAI_MODEL` | não | não |
| `google-genai` | `google-genai.mjs` | `GOOGLE_API_KEY` (obrigatória), `GOOGLE_GENAI_BASE_URL`, `GOOGLE_GENAI_MODEL` | não | não |

**Seleção (opt-in; nunca provedor pago por padrão):**
`--adapter <id>` no visual-critic → `DESIGN_AGENT_ADAPTER` →
`createDesignAgent({ adapter })` (default `stub`).

**Regras duras:**

- chave de provedor só em variável de ambiente (nunca hardcoded);
- chamada paga só com opt-in explícito (`--vision`/`--model`) + `budgetTokens`
  ≥ 1; sem teto a chamada é recusada **antes** de qualquer fetch;
- `tokensUsed` real acima do teto → erro `teto violado`;
- adaptadores reais são HTTP simples com `fetch` nativo (zero dependências).

## 7. Exit codes documentados (quem consome o contrato via CLI)

| Situação | Comportamento |
| --- | --- |
| adapter sem chave de env | `AdapterConfigError` nomeando a variável; CLI → **exit 2** guiado |
| id de adapter desconhecido | `AdapterConfigError` nomeando os ids válidos; CLI → **exit 2** |
| `--adapter` sem `--vision` | erro guiado `--adapter só faz sentido com --vision`; **exit 2** |
| payload fora do schema | `ContractViolationError` nomeando o campo; **exit ≠ 0** |
| `schemaVersion` ≠ 1 | recusado antes da interpretação; **exit ≠ 0** |

## 8. Stub determinístico (testes sempre disponíveis)

`stub-deterministic.mjs` cumpre `generate/review/improve` offline e
determinístico (mesma entrada ⇒ mesma saída; sensível a entrada — não é
"sortudo"). `review` usa sinal visual real (uniformidade dos pixels do
screenshot); `generate`/`improve` derivam HTML deterministicamente do request
(texto não confiável é escapado). Contabilidade de tokens nominal, sempre ≤
teto. É o adapter padrão de testes e do modo offline.

## 9. Verificação

```
node --test skills/design/scripts/agent-adapters/contract.test.mjs   # contrato + probes
node --test skills/design/scripts/critic.test.mjs                    # 26/26 do critic
node skills/design/scripts/visual-critic.mjs --target <dir> --vision \
  --budget-tokens <N> --adapter stub                                  # ponta a ponta offline
```

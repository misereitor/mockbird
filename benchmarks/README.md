# Benchmarks — corpus fixo de regressão (todo 14)

O benchmark do Mockbird mede variações de skill/modelo contra **os mesmos 8
briefings fixos** (`benchmarks/briefings/01-08`). Regra de regressão
(docs/arquitetura-evolutiva.md §9, IS-5): **nenhuma alteração nas Skills é
"melhoria" sem passar pelo corpus inteiro**. Não existe flag de subconjunto —
todo run cobre os 8 briefings.

## Uso

```bash
npm run bench:dry                        # stub determinístico, spend=0, zero rede
node benchmarks/run.mjs --dry-run        # equivalente
node benchmarks/run.mjs --model <id> --budget-tokens <N>   # run real (opt-in)
node benchmarks/run.mjs --check benchmarks/results/dry-<gitSHA>.json
```

- **`--dry-run`** — stub determinístico: mesmo entrada → mesmo relatório
  (só `timestamp` varia; o script imprime `deterministicHash` com timestamp
  normalizado para comparar execuções). `spend=0`, `networkCalls=0`.
- **Run real** — *runs pagos exigem `--model` e `--budget-tokens`*: sem as duas
  flags o run não executa (`exit 2`, mensagem `runs pagos exigem --model e
  --budget-tokens`). `--budget-tokens` deve ser inteiro `>= 1` (`0` não é teto
  válido → `teto violado`). O passe de modelo é o contrato DesignAgent
  (§5.5 — hoje o stub determinístico offline; adaptadores reais entram pelo seam
  do todo 32) e registra gasto por briefing em `spend`/`token-usage`, sempre sob
  o teto por execução.
- **`--check`** — valida um relatório contra `benchmarks/schema.json` + os
  invariantes 8×8. É o "check embutido": relatório gerado com métrica faltando
  reprova (mutation probe).

Garantia offline: nenhum run deste checkout toca a rede. Um wrapper de
`globalThis.fetch` bloqueia e conta qualquer tentativa; `networkCalls` é
impresso/assertado em todo caminho de saída.

## Métricas (8 por briefing)

`design`, `ux`, `a11y`, `functional`, `consistency`, `tokens-compliance`
(qualidade — instrumentos determinísticos dos todos 11/12 sobre o artefato quando
o conector existir; hoje `corpus-stub`, nomeado em `source`) + `execution-time`
(wall-clock; 0 em dry-run) e `token-usage` (contabilidade do contrato
DesignAgent; 0 em dry-run). Ver `benchmarks/schema.json` (com `schemaVersion`).

## Resultados (versionamento)

- `benchmarks/results/dry-<gitSHA>.json` — **versionado**, um arquivo por SHA do
  checkout. Re-run no mesmo SHA sobrescreve (conteúdo idêntico normalizado); SHA
  novo cria arquivo novo, preservando o histórico de runs.
- Relatórios de run real (`real-*.json`) — **não versionados**
  (não versionar relatórios de run do benchmark pagos: ver docs,
  §6.3/registro de versionamento).
- Todo relatório embute `gitSHA`, `contentHash` por briefing e `timestamp`
  (anti-fake, §5.6): presença de arquivo não é evidência — re-executar e
  comparar hash.

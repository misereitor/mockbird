# ADR-0001 — Núcleo determinístico com papéis LLM substituíveis

## Status

Aceito em 2026-11-04. Registrado pelo todo 2 do plano `mockbird-evolution`
(GAP-E5). Este ADR não foi substituído nem revisado.

## Contexto

O valor do Mockbird é independente do modelo de programação usado (linha IS-1 do
plano): a qualidade entregue deve vir de ferramentas, contexto e critérios
verificáveis, não de "pensar mais". Ao mesmo tempo o plano exige autonomia sem
refém (IS-6): o sistema deve usar LLMs para gerar, revisar e melhorar quando
houver chave e orçamento, e continuar 100% funcional no modo offline
determinístico quando não houver (GAP-H1..H5, GAP-E1, GAP-E2).

O repositório já tem núcleo determinístico implementado: o validador de 1.429
linhas com regras carregadas por extensão
(`skills/design/scripts/validate.mjs:2`, `skills/design/scripts/validate.mjs:1366`),
o rig de QA R1-R4, o smoke de navegador
(`skills/design/scripts/smoke.mjs:3`) e a suíte de comportamento do runtime
(`scripts/mock-check.mjs`). O que falta é o lado de papéis de IA: hoje eles vivem
como prosa solta em quatro skills (GAP-E1) e qualquer uso de modelo depende de
harness externo (GAP-H1).

## Decisão

1. **Toda verificação de qualidade roda em motores determinísticos do Core.**
   Gate, diff, contrato e limiar são decididos por código que roda igual em
   qualquer máquina, sem rede.
2. **Toda participação de LLM acontece exclusivamente pelo contrato
   DesignAgent** (operações `generate`/`review`/`improve`, IO padronizado em JSON
   com campo `schemaVersion` — todo 32), consumido por adaptadores
   substituíveis em *skills/design/scripts/agent-adapters/* (planejado).
3. **O adaptador padrão é o stub determinístico offline** (sempre presente,
   sempre testável). Adaptadores de provedor real (openai-compatible,
   google-genai) são opt-in, com chave só em variável de ambiente e teto de
   tokens por chamada.
4. **Saída de LLM é somente diagnóstica.** Um papel de IA emite issues no
   relatório; nunca escreve arquivo de produto e nunca decide gate — bloqueio
   vem apenas de diff determinístico, contrato ou limiar verificável.
5. **Papéis são implementações do contrato, não pessoas nem modelos fixos.**
   Design Architect, UI Designer, UX Reviewer, Visual Critic, A11y Auditor e
   Frontend Reviewer são feixes de capacidades declarados no contrato (todo 33),
   com roteamento de provedor por papel (todo 51).

## Consequências

- Trocar de provedor ou de modelo vira troca de adaptador; o Core não importa
  SDK nem conhece provedor (nenhuma dependência nova — ver ADR-0004).
- Sem chave e sem rede, todos os fluxos completam em stub com custo zero; a
  garantia offline é exigência de CI (todo 52).
- O agnosticismo é provado por teste de contrato com HTTP mockado e fixtures de
  provedor, não por afirmação (todo 52).
- Custo de modelo fica visível e limitado: chamada paga só com flag explícita e
  orçamento (todos 14, 50).
- Limitação aceita: qualidade de geração com LLM fica abaixo do que um modelo
  dedicado entregaria embutido; a troca é deliberada (ver "What it will NOT do"
  no plano: sem modelo de LLM próprio).

## Reversibilidade

- **Reversível no nível de adaptadores**: remover, trocar ou adicionar provedores
  não afeta o Core nem os contratos — só o diretório de adaptadores.
- **Reverter as restrições 4 e 5** ("LLM só diagnostica"; "papel nunca escreve")
  exigiria um ADR substituto que registre o mecanismo de contenção equivalente
  (hoje: permissão read-only + snapshot hash antes/depois — ADR-0003). Enquanto
  este ADR estiver ativo, a restrição é mecânica, não de disciplina.
- **Nada no repositório atual depende de provedor de IA**; portanto a reversão
  não exige migração de dados — apenas decisão registrada.

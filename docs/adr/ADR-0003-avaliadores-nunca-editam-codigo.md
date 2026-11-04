# ADR-0003 — Avaliadores nunca editam código (por mecanismo, não por disciplina)

## Status

Aceito em 2026-11-04. Registrado pelo todo 2 do plano `mockbird-evolution`.
Guardrail permanente do plano (seção "Must NOT have"): "Avaliadores NUNCA
editam código — não por disciplina, por mecanismo".

## Contexto

Qualidade medida só vale se quem mede não puder consertar a própria medição. O
plano separa quem constrói de quem avalia (IS-2, GAP-E1, GAP-E2, GAP-G1): o
Visual Critic, o A11y Auditor e os papéis de revisão diagnosticam; a correção é
ato de um papel que escreve. Sem separação mecânica, dois riscos aparecem: (a) o
avaliador "melhora" o alvo e a avaliação vira autoavaliação; (b) a nota vira
verdade absoluta e passa a bloquear por gosto. O estado atual do repositório não
tem esse mecanismo — os papéis vivem como prosa em quatro skills (GAP-E1) e o
planejamento de orquestração (todo 33) precisa de uma regra dura para seguir.

## Decisão

1. **Papel avaliador roda mecanicamente read-only**: sem permissão de escrita no
   workspace durante a execução.
2. **Prova por snapshot hash do workspace antes/depois**: qualquer escrita
   detectada na comparação derruba o run como falha — a não-escrita é assertada
   por teste, não prometida em prompt (padrão do verificador do todo 11).
3. **Modo single nunca avalia a própria escrita**: a nota/decisão de passagem
   vem do pipeline determinístico (diff, contrato, limiar), não do autor.
4. **Score é instrumento de rastreio; bloqueio vem apenas de diff
   determinístico, contrato ou limiar verificável** (ver
   `docs/arquitetura-evolutiva.md` §8). Nenhum gate do sistema decide por nota.
5. **Saída de avaliador é relatório estruturado** (issues com severidade,
   categoria, elemento, problema, sugestão e evidência — §5 do documento de
   arquitetura), consumível por papel que escreve e por histórico.

## Consequências

- "Não editar" deixa de ser instrução de prompt e vira propriedade verificada:
  o teste de não-escrita falha se o avaliador for corrompido para gravar arquivo.
- Correção e avaliação viram rodadas alternadas (gerar → avaliar → corrigir →
  avaliar de novo), com teto de rodadas e saída por lista de pendências (regra
  reconciliada pelo todo 4).
- Limitação aceita: um avaliador não pode aplicar micro-correções mesmo quando
  seria conveniente — o custo é deliberado para preservar a confiança na nota.

## Reversibilidade

- **Mecanismo reversível apenas por ADR substituto**: trocar read-only +
  snapshot por outra contenção com prova equivalente exige decisão registrada,
  porque enfraquece uma garantia que consumidores do relatório assumem.
- **Implementação isolada**: a verificação vive nos executáveis de avaliação
  (todos 11 e 33) e nos testes de não-escrita; remover o mecanismo não exige
  migração de dados, apenas reverter esses componentes.
- **Restrição 4 (score nunca gate) é praticamente irreversível sem quebrar
  consumidores**: o `visual:gate` do todo 12 é escrito sobre essa semântica;
  mudá-la exigiria novo ADR + revisão do orquestrador (todo 13).

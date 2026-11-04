# 08 — Redesign de painel legado de suporte

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: redesign de um sistema interno de atendimento ao cliente usado há 8 anos,
com usuários dependentes da rotina atual. Regra do brief: evolução, não revolução.

## audience

Agentes de suporte e supervisores que usam o sistema há anos, 6-8 horas por dia,
com atalhos e posições de tela gravados na memória muscular. Têm resistência
justificada a mudança: qualquer quebra de fluxo custa tickets por hora e gera
reclamação imediata.

## goal

Reduzir o tempo médio de atendimento sem quebrar nenhum fluxo existente: cada
função do sistema antigo precisa existir no novo, no mesmo lugar relativo, com
nomenclatura conhecida. Ganho principal esperado: menos ruído visual e menos
cliques em tarefas repetitivas.

## visualDirection

Modernizar a superfície, preservar a geografia. Manter a tríade clássica (fila à
esquerda, conversa ao centro, contexto do cliente à direita) mas com respiro,
tipografia legível e uma densidade controlada. Substituir ícones ambíguos por
rótulos, introduzir tokens novos sem mudar posições. Cores de status preservadas
na semântica (mesma cor = mesmo significado do sistema antigo).

## constraints

Sem bibliotecas externas; mapeamento 1:1 de funcionalidades documentado (lista
antigo → novo); atalhos de teclado do sistema antigo preservados; nomenclatura de
campos e ações idêntica; comparar métricas antes/depois (tempo por atendimento,
cliques por ticket) com dados mockados; WCAG 2.1 AA não pode regredir em relação
ao sistema antigo; 1280px-1920px (ambiente de trabalho com fones); plano de
migração incremental (novos recursos só após a paridade).

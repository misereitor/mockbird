# 06 — Portal de dados abertos municipais (portal com dados)

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: portal de transparência de uma prefeitura média, com orçamento, contratos
e licitações navegáveis e exportáveis.

## audience

Cidadãos comuns em busca de uma informação específica, jornalistas investigando
gastos e auditores internos cruzando séries históricas. Mistura altíssima de leigo
e técnico: a interface precisa servir os dois sem tutorial.

## goal

Encontrar e exportar dados orçamentários por período, secretia e categoria em
poucos passos: filtrar → conferir (tabela + gráfico resumo) → baixar CSV com os
filtros aplicados. Toda tabela precisa responder "de onde veio este número"
(fonte, data de atualização, link para o ato oficial).

## visualDirection

Sóbrio e institucional, credibilidade acima de personalidade. Tabelas densas com
zebra leve, números alinhados à direita, cabeçalhos fixos; gráficos simples de
barra/linha com paleta acessível e rótulos diretos (sem depender de legenda
flutuante). Linguagem clara em pt-BR ("Quanto foi gasto", não "Execução
orçamentária"). Faixa de metadados em toda página de dado.

## constraints

Sem bibliotecas externas nem CDN; semântica de tabela real (caption, th com scope);
WCAG 2.1 AA no mínimo, AAA em contraste onde possível; exportação CSV com nome de
arquivo autoexplicativo e cabeçalho estável; paginação de até 50 linhas com dados
mockados (≥ 300 registros); filtro refletido na URL (deep link); 360px-1920px;
ordenação por coluna com estado anunciado (aria-sort).

# 01 — Painel operacional de logística (dashboard)

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: dashboard de acompanhamento de entregas de uma transportadora regional com
frota própria, operado em turno por equipes de despacho.

## audience

Gestores de operação e despachantes sem formação técnica, 25-55 anos, que passam o
dia inteiro neste painel e alternam entre escaneamento rápido por anomalias e
investigação de casos pontuais. Usam monitor de 24" no posto e tablet na rua.
Pouca paciência para metáforas decorativas: querem números e status.

## goal

Em menos de 10 segundos o usuário identifica quantas entregas estão atrasadas, em
qual região e qual a causa dominante; em menos de 3 cliques ele aciona uma ação
corretiva (reagendar, realocar motorista, notificar cliente) sem sair do painel.

## visualDirection

Denso mas calmo. Grade de cards com hierarquia forte: um bloco dominante de KPIs de
atraso no topo, série temporal de volume no meio, tabela de ocorrências embaixo.
Tipografia tabular para números, cor reservada para semântica de status (verde =
ok, âmbar = atenção, vermelho = crítico) sempre acompanhada de ícone e rótulo —
nunca cor sozinha. Fundo claro; contraste alto. Sem sombras decorativas, sem
gradientes. Microinterações discretas de atualização (badge de "há X min").

## constraints

Sem bibliotecas externas (HTML/CSS/JS puro com os tokens do projeto); breakpoints
1280, 1600 e 1920; dados mockados realistas (pelo menos 40 linhas de ocorrência);
WCAG 2.1 AA em contraste, foco e rótulos; navegação completa por teclado; números
com separador pt-BR e datas relativas ("há 2 h"); ações destrutivas pedem
confirmação; atualização simulada não pode causar salto de layout.

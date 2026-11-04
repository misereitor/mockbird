# 05 — App mobile-first de treinos (fitness)

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: aplicativo de registro de treinos na academia, usado durante o próprio
treino, com uma mão só.

## audience

Frequentadores de academia iniciantes a intermediários, 18-45 anos, que registram
treino no celular entre séries, com a tela molhada de suor e luz forte do ambiente.
Querem velocidade: zero fricção, zero leitura longa. Ocasionalmente revêem o
histórico em casa, no sofá.

## goal

Registrar uma série (exercício, carga, repetições) em menos de 15 segundos, com uma
mão só e sem erro de digitação; ao final, ver o resumo do treino e evolução das
cargas nas últimas 4 semanas.

## visualDirection

Mobile-first de verdade (base 360px): bottom navigation com 3-4 itens, alvos de
toque grandes (mínimo 44px), contraste alto para leitura em ambiente claro/externo.
Tipografia grande para números de carga/repetições; stepper de +/- em vez de teclado
sempre que possível. Cor de destaque única para "registrado". Sem sombras: hierarquia
por blocos e peso tipográfico. Modo escuro opcional respeitando prefers-color-scheme.

## constraints

Sem bibliotecas externas; sem rolagem horizontal; botões essenciais na metade
inferior da tela; teclado numérico quando digitação for inevitável; feedback tátil
visual imediato ao registrar (não depender de toast que some rápido); dados
mockados de histórico (8 semanas); WCAG 2.1 AA incluindo alvos de toque; 360-430px
como alvo principal, com degradação digna em 768px.

# 04 — PDP de e-commerce de moda sustentável

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: página de produto (PDP) de uma marca de moda com produção de baixo
impacto, com carrinho rápido.

## audience

Consumidores urbanos de 25-40 anos que compram roupa online com consciência
ambiental: leem composição do tecido, origem e cuidados antes de decidir. Comparam
preço por uso, se importam com troca fácil e avaliação de outros compradores.

## goal

Gerar confiança suficiente para a compra na primeira visita: o produto, preço,
parcelamento, prazo de entrega e política de troca ficam visíveis sem rolagem
profunda no desktop; a ação "Adicionar à sacola" nunca sai da tela. Secundário:
capturar interesse (favoritos) mesmo sem compra.

## visualDirection

Fotografia grande como protagonista, fundo neutro, tipografia discreta e capsula
de ação fixa. Badges de sustentabilidade (tecido reciclado, produção local) em
selos pequenos e sóbrios, com tooltip explicativo — sem greenwashing visual.
Blocos de informação em ordem de decisão: variações → preço → frete → detalhes →
avaliações. Cor de ação única e consistente.

## constraints

Sem bibliotecas externas; galeria de imagens com navegação por teclado e texto
alternativo descritivo; seletores de tamanho/cor sem recarregar página, com estado
esgotado visível; cálculo de frete por CEP mockado; preço com "ou 6x de R$ X sem
juros"; WCAG 2.1 AA (incluindo foco visível na galeria); 360px-1920px; sacola com
contador acessível (aria-live).

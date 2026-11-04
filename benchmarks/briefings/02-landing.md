# 02 — Landing page de SaaS de agendamento para clínicas

Corpo de briefing fixo do benchmark (corpus de regressão — ver benchmarks/README.md).
Cenário: página de aquisição de um SaaS de agendamento e prontuário leve para
clínicas pequenas de saúde.

## audience

Donos e gestores de clínicas pequenas (2-10 profissionais) — odontologia, fisio,
estética — que compram software poucas vezes por ano, desconfiam de burocracia e
decidem por indicação e prova concreta. Navegam primeiro no celular, depois
conferem no desktop do consultório.

## goal

Converter para um teste gratuito sem cartão. A proposta de valor precisa ficar
clara em uma frase sob o primeiro viewport, com um único CTA dominante ("Começar
teste grátis") repetido em pontos estratégicos; objeções de preço, segurança de
dados e migração respondidas antes do rodapé.

## visualDirection

Editorial e humano, nada de "stock photo de gente sorrindo com tablet". Tipografia
com escala generosa, muito espaço em branco, um único acento de cor. Hero com uma
representação real do produto (agenda preenchida) em vez de arte abstrata. Prova
social em faixa enxuta: 2-3 depoimentos curtos com nome e especialidade + números
de uso. Rodapé sóbrio com selos de segurança e LGPD.

## constraints

Sem bibliotecas externas nem CDN; performance primeiro (hero ≤ 100 KB, sem script
bloqueante); responsivo a partir de 360px; hierarquia de headings semântica (um
h1); formulário de e-mail de captura com validação inline e mensagem de sucesso;
WCAG 2.1 AA; links de navegação âncora para seções longas; versão pt-BR apenas.

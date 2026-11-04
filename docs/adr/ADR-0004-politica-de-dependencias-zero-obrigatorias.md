# ADR-0004 — Política de zero dependências obrigatórias

## Status

Aceito em 2026-11-04. Registrado pelo todo 2 do plano `mockbird-evolution`.
Guardrail do plano ("Conector LLM consome modelos de terceiros via fetch nativo:
sem SDK novo"). Desvios conhecidos estão registrados em "Consequências".

## Contexto

O Mockbird é distribuído como kit que é instalado dentro de projetos alheios
(`install.mjs`, setup por projeto em `skills/design/scripts/setup-design.mjs:3`)
e consumido por agentes de programação em máquinas que não controlamos. Cada
dependência obrigatória nova aumenta superfície de instalação, risco de supply
chain e a chance de o modo offline quebrar. A política declarada do pacote é
"zero deps": a única devDependency atual é `playwright-core`
(`package.json:24`), usada só para testes/captura de navegador. O planejamento
precisa de capacidades pesadas — comparação perceptual (SSIM), conector LLM,
a11y de mercado — e a pergunta é como entregá-las sem desfazer essa promessa.

## Decisão

1. **Nenhuma dependência npm obrigatória nova.** O contrato de instalação do
   kit continua: `node install.mjs` funciona sem rede e sem resolução de
   pacotes.
2. **O que é algoritmo é implementado no repositório**: SSIM por janela 8×8
   vendorizado em código local (todo 10), sobre a lib de diff que já existe
   (extraída de `skills/design/scripts/smoke.mjs:307`).
3. **O que é rede usa o runtime**: o conector LLM fala HTTP com `fetch` nativo
   (todo 48) — sem SDK de provedor.
4. **O que é mercado é opcional e explícito**: axe-core/pa11y só como devDep
   atrás de flag (`--with-axe`, todo 26); sem flag o relatório roda sem eles e
   declara a lacuna.
5. **Bundle de terceiro só vendorizado e documentado** (ex.: o espelho de
   `skills/design/assets/vendor/html-to-image.js` no MIRROR do plugin, `plugin/core.mjs:50`),
   rastreável no inventário da auditoria.
6. **Exceção só por ADR substituto**, com: justificativa, garantia offline
   preservada e teste de contrato que prove o comportamento sem a dependência.

## Consequências

- Instalação e CI continuam sem cache de pacotes nem rede obrigatória; a
  garantia offline do conector (todo 52) é testável.
- Custo interno aceito: manutenção das implementações locais (ex.: ~100 linhas
  de SSIM) e responsabilidade nossa por correção de bug de terceiro vendorizado.
- O CI hoje não provisiona navegador (GAP-A5) e o `playwright-core` isolado já
  exige binário de navegador do sistema — limitação conhecida tratada pelo
  todo 15, sem nova dependência obrigatória.
- **Desvio conhecido em curso**: o launcher do impeccable busca um binário
  externo no primeiro uso (`skills/impeccable/scripts/impeccable:2`), fora do
  repo; é bundle de terceiro a documentar/espelhar, não dependência npm —
  monitorado como pendência de dívida (auditoria, seção "o que precisa de
  refatoração").

## Reversibilidade

- **Reversível por ADR substituto dedicado** (caso um provedor de diff ou de
  a11y de mercado passe a ser obrigatório): o ADR precisa registrar o que muda
  no contrato de instalação offline e quem absorve o custo de manutenção.
- **As implementações locais não são beco sem saída**: SSIM e diff são libs
  pequenas com contrato próprio; trocar por biblioteca equivalente é refatoração
  contida nos arquivos de *skills/design/scripts/lib/*, sem mudança de schema.
- **Nenhum artefato gerado depende do pacote escolhido** — os contratos da §5 do
  documento de arquitetura são JSON com `schemaVersion`, independentes de
  implementação.

# ADR-0006 — Regra única entre skills (fonte única de critérios)

- **Status:** Aceito
- **Data:** 2026-11-04
- **Fecha:** GAP-F5 (contradições cruzadas entre `skills/design`, `skills/taste`,
  `skills/emil-design-eng`, `skills/impeccable`)
- **Supervisão:** cada contradição tem UMA regra vencedora e um escopo declarado;
  nenhuma regra foi apagada sem substituição equivalente.

Contexto: a auditoria (todo 1) confirmou que as skills de craft se contradizem
(dials, Tailwind arbitrário, motion, loop de QA, duplicação de bans, caminho
morto, resposta engessada, allowlists transitórias). Este ADR registra a
resolução de cada contradição e o arquivo que passa a ser dono da regra.
`skills/design/assets/craft.md` é a fonte única de critérios para product UI;
`skills/taste/SKILL.md` continua sendo a fonte para landing/portfolio e dona da
lista de bans; `skills/emil-design-eng/SKILL.md` é a referência de motion CSS;
`skills/impeccable/SKILL.md` é a referência de verificação limitada.

---

### (a) Dials: `7/4/4` (product) vs `8/6/4` (landing)

- **Contradição:** `skills/design/assets/craft.md:23` declara baseline de dials
  `7 / 4 / 4` para product UI enquanto `skills/taste/SKILL.md:47`-`:49` declara
  `8 / 6 / 4` como baseline universal (`skills/taste/SKILL.md:51`).
- **Vencedora:** craft.md vence para product UI (canvas screens): baseline
  `7 / 4 / 4`. taste vence para landing/portfolio/marketing: baseline
  `8 / 6 / 4`.
- **Escopo:** o baseline é por tipo de tela; cada escopo tem exatamente UMA
  fonte de verdade — product UI: `skills/design/assets/craft.md:23`;
  landing/portfolio: `skills/taste/SKILL.md:47`-`:49`. Os dials continuam de
  1–10 com os mesmos eixos (VARIANCE/MOTION/DENSITY); só o baseline muda.
- **Aplicação:** tabela de escopo em `skills/design/assets/craft.md:21`-`:24`
  (com ponteiro para taste §1) e nota de escopo em `skills/taste/SKILL.md:53`
  (com ponteiro para craft.md §2).

### (b) Tailwind arbitrário: banido com exceções declaradas

- **Contradição:** `skills/design/SKILL.md:320` bane valores arbitrários
  (`text-[13px]`) e o `validate.mjs` falha a varredura, enquanto
  `skills/taste/SKILL.md:185` e `:937` mandam usar `leading-[1.1]` (sintaxe
  arbitrária) como regra obrigatória.
- **Vencedora:** a regra do `skills/design/SKILL.md:320` vence — valores
  arbitrários de Tailwind são BANIDOS.
- **Escopo:** o ban é absoluto em telas de canvas (a varredura do
  `validate.mjs` falha sem exceção — `skills/design/SKILL.md:320`-`:322`). Em
  código frontend real o ban também vale por padrão; a ÚNICA válvula é a
  lista explícita de exceções em `skills/design/assets/craft.md:51`-`:64`
  (derivada das regras obrigatórias do próprio taste: `leading-[1.1]`,
  métricas de eyebrow, medida/viewport, micro-transforms, hairline inset),
  ativa apenas quando o framework do consumidor é Tailwind. Fora da lista, a
  declaração explícita no design read vem antes do uso; fora de Tailwind,
  `var(--…)` ou CSS custom.
- **Aplicação:** política + lista de exceções em
  `skills/design/assets/craft.md:51`-`:64`; ponteiro em
  `skills/design/SKILL.md:321`-`:322`; `skills/taste/SKILL.md:185` reconhece
  `leading-[1.1]`/`leading-[1]` como exceções declaradas e remete à lista.

### (c) Motion: CSS-first; GSAP/Motion só quando já presentes

- **Contradição:** `skills/emil-design-eng/SKILL.md:267` determina CSS-first
  (transições sobre keyframes) enquanto `skills/taste/SKILL.md` §5.A-§5.C
  instrui implementar com GSAP/Motion/Three.js.
- **Vencedora:** CSS-first vence — a referência é
  `skills/emil-design-eng/SKILL.md:267` (transições CSS, `@starting-style`,
  scroll-driven animations).
- **Escopo:** GSAP/Motion/Three.js são permitidos APENAS quando a biblioteca
  já está presente no projeto; nunca adicionar biblioteca de motion só para
  seguir os esqueletos do taste §5.A-§5.C. As regras de motivação, duração,
  easing e `prefers-reduced-motion` continuam valendo (craft.md §4, taste
  §5.D/§6.A-§6.B).
- **Aplicação:** declaração CSS-first em `skills/design/assets/craft.md:94`-`:98`
  e escopo das bibliotecas em `skills/taste/SKILL.md:358`.

### (d) Loop de QA: até limpar, teto de 4 rodadas, saída por pendências

- **Contradição:** `skills/design/SKILL.md:397`-`:399` manda rodar até limpar
  (sem teto) enquanto `skills/impeccable/SKILL.md:15` limitava o ciclo a uma
  rodada + confirmação ("at most one more round").
- **Vencedora:** a regra do `skills/design/SKILL.md:397` vence — o loop roda
  ATÉ LIMPAR — com o teto de rodadas do impeccable elevado a 4 e a saída por
  lista de pendências.
- **Escopo:** o ciclo inteiro (screenshots, defeitos, micro-edições,
  rebuilds) é limitado a 4 rodadas; na 4ª rodada para-se e entrega-se com a
  lista explícita de pendências — nunca apresentar tela com issues como
  limpa. Vale para canvas (`skills/design/SKILL.md:397`-`:400`), craft
  (`skills/design/assets/craft.md:117`-`:124`) e os comandos do impeccable
  (`skills/impeccable/SKILL.md:15`).
- **Aplicação:** os três arquivos citados acima agora descrevem o mesmo loop.

### (e) Bans: taste é a referência; craft.md deixa de duplicar verbatim

- **Contradição:** `skills/design/assets/craft.md` §3 repetia literalmente a
  lista de bans estéticos do taste (gradientes AI, cards idênticos, em-dash,
  serifs proibidas, paleta beige+brass, etc.) — derivação garantida.
- **Vencedora:** `skills/taste/SKILL.md` é a referência única dos bans
  estéticos (§0.D, §4.1, §4.2, §4.7, §9.A-§9.G e o checklist final).
- **Escopo:** craft.md mantém apenas o contrato de canvas varrido pela máquina
  (cores literais, URLs remotas, classes de paleta, valores arbitrários), a
  política de utilities/componentes e as sobrescritas do canvas, e aponta para
  taste para a lista completa de bans; em conflito aparente, o ban do taste
  vence e o canvas apenas estreita. A única regra que existia só no craft
  (lorem ipsum) foi movida para o dono: `skills/taste/SKILL.md:623`.
- **Aplicação:** `skills/design/assets/craft.md:33`-`:49` (ponteiro + contrato
  de máquina) e `skills/taste/SKILL.md:623` (ban de lorem ipsum no dono).

### (f) Caminho morto do Block Library

- **Contradição:** `skills/taste/SKILL.md` §12.A apontava para
  `skills/taste-skill/blocks/`, diretório inexistente no repositório.
- **Vencedora:** os blocos vivem dentro da própria skill: `skills/taste/blocks/`
  (criado com o primeiro bloco; o schema da seção continua valendo).
- **Escopo:** nenhum caminho fora da pasta da skill. O status "blocos chegam
  iterativamente" permanece; só a localização mudou.
- **Aplicação:** `skills/taste/SKILL.md:848`-`:851` (grep de `skills/taste-skill`
  no SKILL.md = 0 ocorrências).

### (g) Resposta engessada do emil

- **Contradição:** `skills/emil-design-eng/SKILL.md` §Initial Response mandava
  responder apenas com uma frase fixa ("I'm ready…") e aguardar pergunta —
  em conflito com workflows que agem imediatamente.
- **Vencedora:** agir imediatamente: a skill atende o pedido no mesmo turno,
  sem resposta engessada.
- **Escopo:** vale para qualquer invocação da skill; a filosofia de craft que
  vem depois da seção permanece intacta.
- **Aplicação:** `skills/emil-design-eng/SKILL.md:8`-`:12` (mandato removido,
  regra equivalente posta no lugar).

### (h) classes.allow / actions.allowLegacy: migração encerrada

- **Contradição:** `skills/design/SKILL.md` declarava as allowlists como
  transitórias "que esvaziam quando a migração do corpus cliente fechar",
  sem data nem status real — enquanto o código as mantinha permanentes
  (mecanismo coberto por fixtures).
- **Vencedora:** migração ENCERRADA em 2026-11-04 — as listas já estão vazias
  no config publicado (`skills/design/assets/validate.config.json:9`,
  `:12`, `:33`) e o corpus não precisa de entradas.
- **Escopo:** o mecanismo permanece como escape hatch com justificativa
  obrigatória (`{ name, justification }`; item sem justificativa falha sozinho
  — `m-allowlist-nojust` / `action-allowlist-nojust`); toda entrada nova é
  excepcional e deve declarar na justificativa quando pode ser removida. O
  detector `on*` + `data-action` (`action-both`) é PERMANENTE. Vale para
  `classes.allow` (`skills/design/SKILL.md:419`-`:424`) e
  `actions.allowLegacy`/`handlers.allowLegacy`
  (`skills/design/SKILL.md:543`-`:550`).
- **Aplicação:** os dois trechos de política do design SKILL.md citados acima.

---

## Notas

- **Colisão de nomes (sem conflito de regra):**
  `skills/impeccable/reference/craft.md:1` é um alias depreciado de roteamento
  do impeccable ("craft" → new-work), não tem relação com
  `skills/design/assets/craft.md`, que é a fonte única de critérios de product
  UI. Nada foi renomeado; a fronteira fica declarada aqui.
- **Status real das allowlists (verificado no código):** o mecanismo está
  implementado e coberto por fixtures
  (`skills/design/scripts/rules/action-contract.mjs:63`-`:78`; fixtures
  `ok/m-allowlist`, `ok/action-allowlist`, `bad/m-allowlist-nojust`,
  `bad/action-allowlist-nojust`, `legacy-project`) e o config publicado traz as
  três listas vazias — por isso a migração é declarada encerrada e não com
  data de expiração.

## Verificação

```sh
node docs/adr/ADR-0006.check.mjs                       # estrutura + citações → exit 0
grep -n 'skills/taste-skill' skills/taste/SKILL.md     # → 0 ocorrências
node skills/design/scripts/validate.mjs --config skills/design/assets/validate.config.json skills/design/assets/example
npm run ci                                             # → exit 0
```

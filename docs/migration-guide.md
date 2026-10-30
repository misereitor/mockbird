# Guia de migração do cliente — update path + migração do corpus (§15)

Guia para projetos cliente EXISTENTES que já têm um corpus de telas em
`design/` e vão (1) atualizar o toolchain instalado e (2) migrar o corpus para
o contrato de ações/registry. Duas metades independentes: a Seção 1 é o
caminho de atualização; a Seção 2 é a migração do corpus.

> **Blocos CLIENT-RUN.** Todos os comandos da Seção 2 rodam NO SEU workspace,
> com o seu corpus. O repositório da skill não executa nada da migração.
>
> **Baseline client-run.** Os números de corpus citados abaixo (204 handlers,
> 37 atributos `.m-*`, 11 usos de `so-mobile`, linhas do `relatorios/`) são a
> medição do corpus de referência em 2026-10-29 — o SEU ponto de partida. Eles
> vivem só neste guia: nunca foram acceptance/gate do repositório da skill e
> não devem virar um. Meça o seu corpus com `--metrics` antes de começar.

---

## 1. Caminho de atualização do toolchain

### 1.1 Pré-checks

Rode os três blocos a seguir ANTES de qualquer coisa. Critério de passagem:
saída do `git status --porcelain` vazia, `node --version` ≥ v18, backup criado.

bash:

```bash
PROJ=/caminho/para/o-projeto        # workspace do cliente
cd "$PROJ"

# 1) git status limpo (trabalho sujo = commite/estacione antes)
git status --porcelain
# saída esperada: vazia

# 2) Node >= 18
node --version
# saída esperada: v18.0.0 ou superior

# 3) backup do design/ inteiro
cp -a design "design-backup-$(date +%Y%m%d-%H%M%S)"
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"   # workspace do cliente
Set-Location $PROJ

# 1) git status limpo (trabalho sujo = commite/estacione antes)
git status --porcelain
# saída esperada: vazia

# 2) Node >= 18
node --version
# saída esperada: v18.0.0 ou superior

# 3) backup do design/ inteiro
Copy-Item -Recurse design ("design-backup-" + (Get-Date -Format yyyyMMdd-HHmmss))
```

### 1.2 Executar `setup-design.mjs --update` — A PARTIR DO PACOTE DA SKILL

> **Fixação (pin):** o `--update` precisa rodar **a partir do pacote da skill**
> (a pasta que contém `skills/design/`). O `design/scripts/setup-design.mjs`
> instalado dentro do projeto **não consegue se auto-atualizar**: o
> `copy-list.json` resolve cada `from` contra a *skill root* (a pasta que
> guarda o `SKILL.md`), e esse arquivo não embarca no payload instalado em
> `design/` — sem ele o script cairia na lista interna mínima. Referência:
> issues.md, entrada "[follow-up todo 25]" do notepad `melhorias-sistema`.

bash:

```bash
SKILL=/caminho/para/o-pacote-mockbird   # pasta que contém skills/design
PROJ=/caminho/para/o-projeto

node "$SKILL/skills/design/scripts/setup-design.mjs" --target "$PROJ/design" --update
```

PowerShell:

```pwsh
$SKILL = "C:\caminho\para\o-pacote-mockbird"   # pasta que contém skills\design
$PROJ = "C:\caminho\para\o-projeto"

node "$SKILL\skills\design\scripts\setup-design.mjs" --target "$PROJ\design" --update
```

Flags relevantes (política completa em `setup-design.mjs --help`):

- `--update` — recopia o toolchain; mescla chaves NOVAS do
  `validate.config.json` embarcado no seu config (seus valores vencem, suas
  chaves nunca são removidas).
- `--force` — também substitui arquivos patchados divergentes (o conteúdo
  anterior fica em `<nome>.bak`).
- `--with-smoke` — escreve `design/package.json` (a exceção zero-dep:
  `playwright-core` pinada como devDependency) para habilitar o smoke.

### 1.3 Checklist de verificação (pós-update)

Critério de passagem dos 4 itens: marcador presente, nenhum `.new` inesperado,
config sem remoções, qa respondendo. Blocos distintos por shell.

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# 1) marcador de config na PRIMEIRA linha da saída do validador
node design/validate.mjs design/atendimento > /tmp/validate-out.txt
echo "exit=$?"
head -n 1 /tmp/validate-out.txt
# esperado: config: validate.config.json#<sha256-curto>

# 2) cópias patchadas preservadas (arquivos .new)
find design -name '*.new' -print
# esperado: vazio, ou apenas arquivos que você reconhece como seus patches

# 3) config do usuário preservado (nenhuma remoção de chave)
git diff -- design/validate.config.json
# esperado: só ADIÇÕES de chaves novas (ou diff vazio)

# 4) o toolchain instalado responde
node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento
# esperado: marcador + resultado do validate/sync para o canvas alvo
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# 1) marcador de config na PRIMEIRA linha da saída do validador
node design/validate.mjs design/atendimento > $env:TEMP\validate-out.txt
echo "exit=$LASTEXITCODE"
Get-Content $env:TEMP\validate-out.txt -TotalCount 1
# esperado: config: validate.config.json#<sha256-curto>

# 2) cópias patchadas preservadas (arquivos .new)
Get-ChildItem -Recurse -Filter *.new design | ForEach-Object FullName
# esperado: vazio, ou apenas arquivos que você reconhece como seus patches

# 3) config do usuário preservado (nenhuma remoção de chave)
git diff -- design/validate.config.json
# esperado: só ADIÇÕES de chaves novas (ou diff vazio)

# 4) o toolchain instalado responde
node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento
# esperado: marcador + resultado do validate/sync para o canvas alvo
```

### 1.4 Cenário de cópia patchada — o que esperar

O `--update` é "nunca brick". O contrato, item a item:

**Substituídos (recopiados do pacote da skill):** os arquivos do
`copy-list.json` que formam o toolchain — `validate.mjs`, `mock.js`,
`mock.css`, `viewer.html`, `serve.mjs`, `docs.html`,
`vendor/html-to-image.js`, `components/`, `tokens.contract.md` e tudo em
`scripts/` (`sync-components.mjs`, `codegen.mjs`, `marker-parser.mjs`,
`gen-tokens.mjs`, `export-tokens.mjs`, `export-spec.mjs`, `qa.mjs`,
`smoke.mjs`, `setup-design.mjs`, `lib/`, `rules/`). Cada substituição aparece
na saída do comando. Dois casos:

- script config-driven (carrega o marcador `/* mockbird:config-driven:v2 */`):
  substituição segura em todo run — a configuração vive no
  `validate.config.json`, não no script;
- script legado pré-config (sem o marcador): substituído pela cópia
  config-driven — **essa substituição é a correção** (era ela que perdia a
  configuração no flip-flop) e é listada no stdout.

**Nunca tocados:** telas (`canvas.json` + `*.html`), `data/`, `actions/`,
`spec/`, `snapshots/` e qualquer arquivo fora do `copy-list.json`.

**Proteção `<nome>.new` (cenário de cópia patchada):** um arquivo que você
patchou e que diverge TANTO da cópia antiga (hash registrado em
`design/.mockbird-manifest.json`) quanto da nova **fica como está** — a versão
nova é gravada ao lado como `<nome>.new` e um aviso é impresso
(`! <arquivo> (kept user-patched copy; new version at <arquivo>.new)`). Sem
proveniência (projeto legado sem manifesto), arquivo divergente é presumido
patchado — conservador de propósito. Para adotar a versão nova, confira o
diff, substitua você mesmo e remova o `.new`. `--force` faz a substituição por
você, preservando os bytes anteriores em `<nome>.bak`.

**Config do usuário preservado:** o `validate.config.json` existente nunca é
sobrescrito. O `--update` apenas ADICIONA chaves novas que faltam (valores
seus vencem; chaves suas nunca somem). JSON corrompido = exit 3 citando o
arquivo, com `<arquivo>.bak` preservando os seus bytes.

### 1.5 Falta de `validate.config.json` em projetos semeados pelo plugin (FINDING-1)

Contexto: três montagens divergentes do toolchain semeiam `design/` sem o
`validate.config.json` — o MIRROR do `plugin/core.mjs`, o
`scripts/viewer-accept.mjs:37` e o `mountDesign()` do `security-suite.mjs`.
Entrada de guia (transcrita de `.omo/evidence/task-28-melhorias-sistema.md`
§5b):

### Falta de `validate.config.json` em projetos semeados pelo plugin (FINDING-1)

Sintoma: `node design/validate.mjs` termina no aviso guiado
`validate.config.json not found … run setup-design.mjs to seed it` (exit 3),
mesmo com o toolchain completo em `design/`.

Correção: rode `node design/scripts/setup-design.mjs --target design` (ou
`--update` em projeto legado) — é o único caminho que semeia o
`validate.config.json` em FORMA DE PROJETO.

NUNCA copie `skills/design/assets/validate.config.json` literalmente para
`design/`: o `toolchainScripts` do seed usa caminhos `../scripts/…` que
resolvem para FORA de `design/` e a verificação de integridade do toolchain
reprova todo run com exit 2 (`… not found`). A forma de projeto é:

    "toolchainScripts": ["validate.mjs", "scripts/sync-components.mjs",
      "scripts/marker-parser.mjs", "scripts/gen-tokens.mjs",
      "scripts/export-tokens.mjs", "mock.js"]

(paths relativos ao diretório do próprio `validate.config.json`; cada entrada
deve existir em `design/` e conter o marcador `/* mockbird:config-driven:v2 */`.)

---

## 2. Migração do corpus — passos CLIENT-RUN (rodam no SEU workspace)

Ordem de dependências (corpus §15.1): WP2 → WP3 → WP5; WP4 corre parcialmente
em paralelo. Regra de ouro operacional (§15): cada tarefa fecha com `qa.mjs`
verde + smoke verde + commit — nada avança com o pipeline vermelho.

### 2.1 Baseline de métricas: `metrics.json` antes/depois + diff

Nada de contagem à mão — só o `metrics.json` gerado pelo validador. Gere e
guine a baseline ANTES de qualquer migração; regenere ao fim de cada WP e
confira o diff (a contagem só pode cair).

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# baseline ANTES (gera design/metrics.json a partir dos canvas.json do corpus)
node design/validate.mjs design --metrics
cp design/metrics.json design/metrics.before.json

# ... roda um WP de migração ...

# DEPOIS: diff do baseline congelado vs. censo atual (falha = regressão)
node design/validate.mjs design
# diff explícito do que mudou:
node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync("design/metrics.before.json","utf8"));const b=JSON.parse(f.readFileSync("design/metrics.json","utf8"));console.log("before totals:",JSON.stringify(a.totals));console.log("after  totals:",JSON.stringify(b.totals))'

# ao FECHAR a migração: re-congelar (único caminho de escrita do baseline;
# o diff do metrics.json precisa entrar no commit)
node design/validate.mjs design --update-metrics
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# baseline ANTES (gera design/metrics.json a partir dos canvas.json do corpus)
node design/validate.mjs design --metrics
Copy-Item design\metrics.json design\metrics.before.json

# ... roda um WP de migração ...

# DEPOIS: diff do baseline congelado vs. censo atual (falha = regressão)
node design/validate.mjs design
# diff explícito do que mudou:
node -e 'const f=require("fs");const a=JSON.parse(f.readFileSync("design/metrics.before.json","utf8"));const b=JSON.parse(f.readFileSync("design/metrics.json","utf8"));console.log("before totals:",JSON.stringify(a.totals));console.log("after  totals:",JSON.stringify(b.totals))'

# ao FECHAR a migração: re-congelar (único caminho de escrita do baseline;
# o diff do metrics.json precisa entrar no commit)
node design/validate.mjs design --update-metrics
```

**Baseline client-run (corpus de referência, medição 2026-10-29)** —
`atendimento/` sem o artefato temporário `__tmp-plus2.html`:

| evento | contagem |
|---|---|
| `onclick` | 181 |
| `oninput` | 14 |
| `onchange` | 4 |
| `onkeydown` | 2 |
| `ondragover` | 1 |
| `ondragleave` | 1 |
| `ondrop` | 1 |
| **total** | **204** |

Corpus completo de referência: 714 handlers em 61 telas (204 deles no
`atendimento/`). Escopo declarado: atributos `on*` em HTML — `addEventListener`
não conta. Regra de monotonicidade (§13.2 A.2b): nenhum commit da migração
aumenta a contagem; verificável pelo diff do `metrics.json`.

### 2.2 WP2.0 — Smoke de caracterização (3 fluxos de `01-base`)

ANTES de qualquer migração de DOM, rode o smoke e versione a baseline de
comportamento. Os 3 fluxos de `01-base` são completados pelos hashes de estado
— `#demo`, `#erro-envio` e o terceiro fluxo declarado na tela (o relatório de
origem traz "+1" sem nomear o hash; use o estado declarado restante do
`canvas.json`/hash shortcuts de `01-base`). Proibido validar mobile sem
emulação de `devices`.

bash:

```bash
SKILL=/caminho/para/o-pacote-mockbird
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# habilita smoke (playwright-core pinada — exceção zero-dep) e instala
node "$SKILL/skills/design/scripts/setup-design.mjs" --target "$PROJ/design" --update --with-smoke
npm --prefix design install

# smoke de caracterização (fase 0)
node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento

# baseline versionada ANTES da migração
git add design/snapshots
git commit -m "chore(design): baseline de smoke (caracterização pré-migração)"
```

PowerShell:

```pwsh
$SKILL = "C:\caminho\para\o-pacote-mockbird"
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# habilita smoke (playwright-core pinada — exceção zero-dep) e instala
node "$SKILL\skills\design\scripts\setup-design.mjs" --target "$PROJ\design" --update --with-smoke
npm --prefix design install

# smoke de caracterização (fase 0)
node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento

# baseline versionada ANTES da migração
git add design/snapshots
git commit -m "chore(design): baseline de smoke (caracterização pré-migração)"
```

Verificação: smoke verde nos 3 fluxos; falha reporta tela+fluxo com exit ≠ 0;
viewport aplicado == viewport solicitado (o smoke imprime o viewport com
`--print-viewport`).

### 2.3 WP2.1 — Contrato de ações: `tela.acao` + allowlists transitórias

O contrato completo (nomenclatura, tabela de unificação `data-toast`/
`data-close`/`data-go`/`data-overlay`, semântica de carga) é a seção "Ações e
acessibilidade" do `skills/design/SKILL.md` do pacote da skill. Resumo
operacional para a migração:

1. Cada tela ganha um módulo `design/actions/<telaId>.js` que registra
   `Mock.registerActions('<telaId>', { acao(event, el) { … } })`. O primeiro
   argumento é o literal = file stem (`05-visualizador.html` → `05-visualizador`).
2. Atributo de ação: `data-action="<telaId>.<acao>"`. Nunca misture `on*` com
   `data-action` no mesmo elemento (regra `action-both` reprova).
3. Nenhuma linha de JS com mais de ~80 caracteres dentro de atributo HTML
   (regra `action-js-line`).
4. Conteúdo que ganha `data-action` depois do boot chama
   `Mock.loadActions('<telaId>')` explicitamente.

Exemplo de módulo (`design/actions/05-visualizador.js`):

```js
Mock.registerActions('05-visualizador', {
  alternarTema(event, el) {
    event.preventDefault()
    document.body.classList.toggle('tema-escuro')
  },
  exportar(event, el) {
    Mock.toast('Exportação simulada')
  },
})
```

**Allowlists transitórias** em `design/validate.config.json` — existem para o
corpus legado e **esvaziam quando a migração fecha** (o detector `action-both`
é permanente e sobrevive a elas):

- nomes planos (sem o ponto) entram em `actions.allowLegacy`, itens
  `{ "name": …, "justification": … }` — item sem justificativa não vazia reprova
  (`action-allowlist-nojust`);
- `on*` residuais entram em `handlers.allowLegacy`, itens
  `{ "selector": "tela#elemento", "event": …, "justification": … }` — um item
  por elemento+evento, justificado um a um.

```json
{
  "actions": {
    "namespacePattern": "^[a-z0-9_-]+\\.[a-z0-9_-]+$",
    "allowLegacy": [
      { "name": "salvar", "justification": "nome plano transitório do corpus legado — esvaziar quando a migração fechar" }
    ]
  },
  "handlers": {
    "allowLegacy": [
      { "selector": "17-agendar#btn-confirmar", "event": "onclick", "justification": "handler transitório — migrar para 17-agendar.confirmar no WP2.3" }
    ]
  }
}
```

Verificação: `node design/scripts/qa.mjs --config design/validate.config.json
--target design/atendimento` verde; zero elementos combinando `on*` +
`data-action`; contrato sem `onclick` sancionado.

### 2.4 WP2.2 — Roteador + piloto (as duas telas menores)

Piloto do relatório de referência: os roteadores locais de `perfis-contato`
(51 usos de handler) e `relatorios` (14 usos) migrados para `tela.acao` —
17 nomes planos renomeados para o padrão `tela.acao` (baseline client-run).
Por tela: criar o módulo, converter os atributos, rodar qa + smoke, commitar.

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# exemplo: piloto em relatorios (troque o canvas pelo seu)
node design/validate.mjs design/relatorios --metrics
node design/scripts/qa.mjs --config design/validate.config.json --target design/relatorios
node design/scripts/smoke.mjs --config design/validate.config.json --design design/relatorios
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# exemplo: piloto em relatorios (troque o canvas pelo seu)
node design/validate.mjs design/relatorios --metrics
node design/scripts/qa.mjs --config design/validate.config.json --target design/relatorios
node design/scripts/smoke.mjs --config design/validate.config.json --design design/relatorios
```

Verificação: `perfis-contato`/`relatorios` com 0 handlers inline; allowlist só
com os nomes ainda não migrados; `metrics-regression` verde.

### 2.5 WP2.3 — Migração do `atendimento` (204 → 0 handlers)

Ordem: telas menores primeiro (`12-menu`, `17-agendar`, `05-visualizador`, …),
`01-base` por último (maior); os modais 15–18 ganham módulos de ação
próprios. Por tela: criar `actions/<tela>.js`, converter os atributos,
`qa.mjs` verde, smoke verde, commit. A quebra por evento da baseline está na
§2.1 (onclick 181, oninput 14, onchange 4, onkeydown 2, ondragover 1,
ondragleave 1, ondrop 1) — acompanhe o decrescimento pelo diff do
`metrics.json`, evento a evento.

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# loop de uma tela (ex.: 12-menu) — repita por tela, commitando por tela
node design/validate.mjs design/atendimento --metrics
node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento
node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento
git add design/atendimento design/actions design/metrics.json design/validate.config.json
git commit -m "migra(atendimento/12-menu): handlers inline -> data-action tela.acao"
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# loop de uma tela (ex.: 12-menu) — repita por tela, commitando por tela
node design/validate.mjs design/atendimento --metrics
node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento
node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento
git add design/atendimento design/actions design/metrics.json design/validate.config.json
git commit -m "migra(atendimento/12-menu): handlers inline -> data-action tela.acao"
```

Done do WP: `metrics.json` com `atendimento/` = **0** handlers, allowlist
declarada item a item em `validate.config.json` (§13.2 A.2c).

### 2.6 WP3 — Registry: catálogo, modais 15–18 (`.m-*`), `so-mobile`

- **3.1 Catálogo** (descoberta "≥2 de 3" é heurística de descoberta, NÃO
  gate): `modal, drawer, field, bubble, menu-row, media-card, toast, pill,
  avatar, banner, tabs, chip` + variante `device`. Gates de aceite (§13.2
  critério 4): `sync-components . --check` → "up to date"; cada entrada com
  variants+slots em `components.json` e ≥2 consumidores reais; variante
  `device` com mudança de schema documentada.
- **3.2 Modais 15–18 — dedup `.m-*`:** 37 atributos `class` `.m-*` → 0
  (baseline client-run: 7 no modal 15, 17 no 16, 8 no 17, 5 no 18), zero CSS
  `.m-*` local duplicado (classes `m-head/m-input/m-btn/m-error` etc. viram
  instâncias do registry).
- **3.3 `so-mobile` → `device="mobile"`:** 11 ocorrências em `atendimento`
  (baseline client-run) migradas para a variante `device` do registry ou
  justificadas uma a uma.

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# gate do registry (deve responder "up to date")
node design/scripts/sync-components.mjs design/atendimento --check

# census m-classes antes/depois (campo m-classes do metrics.json)
node design/validate.mjs design --metrics
grep -c 'so-mobile' design/atendimento/*.html   # baseline: 11 antes; 0 (ou justificado) depois
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# gate do registry (deve responder "up to date")
node design/scripts/sync-components.mjs design/atendimento --check

# census m-classes antes/depois (campo m-classes do metrics.json)
node design/validate.mjs design --metrics
Select-String -Path design\atendimento\*.html -Pattern 'so-mobile' | Measure-Object | Select-Object Count
# baseline: 11 antes; 0 (ou justificado) depois
```

Verificação: `sync-components . --check` verde; `m-classes` dos modais 15–18
zerado no `metrics.json`; 11 usos de `so-mobile` migrados ou justificados;
copy-paste `button`/`card` eliminado.

### 2.7 WP4 — P2s: export-spec, smoke completo, a11y, dados, tokens

- **4.1 Export de spec:** `export-spec` por tela emita estados, fluxos,
  textos e regras (`spec/<telaId>.md` + `.json`). Done do relatório:
  `export-spec` sobre `16-templates` emite os 4 estados de validação
  conhecidos.
- **4.2 Smoke completo (fase 1):** viewports 390×844 e 375×667 via `devices`;
  asserções por tela — sem scroll horizontal
  (`document.scrollWidth <= window.innerWidth`), zero `console.error`, fluxo
  principal dentro de timeout declarado; screenshots com baseline em
  `design/snapshots/` e threshold declarado (o default do config é 0.02).
- **4.3 Acessibilidade:** foco preso/restaurado em overlay, `aria-live` em
  toasts, teclado em menus — regras `a11y-no-autofocus`/`a11y-toast-no-live`
  no validador. Done: fluxo principal navegável por teclado.
- **4.4 Dados mock** em `design/data/` por canvas (datasets compartilhados
  fora dos módulos, bind via `{"$ref": "file.json#key"}` no `data.json`).
- **4.5 Contrato de tokens:** regenerar/conferir de `tokens.json`
  (easing/densidade/breakpoints/motion/camadas); mapear breakpoints 900/640 →
  `sm:`/`md:` do Tailwind como entrada do export de spec.

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# 4.1 export de spec por tela (gera spec/<telaId>.md + .json)
node design/scripts/export-spec.mjs --design design

# 4.2 smoke completo (fase 1) — os viewports vêm do smoke config
node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento

# 4.3/4.4/4.5 — validador cobre a11y, data-ref e contract-doc-sync
node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento

# 4.5 tokens: regenera tokens.json + tokens.w3c.json e a tabela de contrato
node design/scripts/gen-tokens.mjs
node design/scripts/gen-tokens.mjs --contract
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# 4.1 export de spec por tela (gera spec/<telaId>.md + .json)
node design/scripts/export-spec.mjs --design design

# 4.2 smoke completo (fase 1) — os viewports vêm do smoke config
node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento

# 4.3/4.4/4.5 — validador cobre a11y, data-ref e contract-doc-sync
node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento

# 4.5 tokens: regenera tokens.json + tokens.w3c.json e a tabela de contrato
node design/scripts/gen-tokens.mjs
node design/scripts/gen-tokens.mjs --contract
```

### 2.8 WP5 — Codegen `data-*`↔props + paridade D8

- **5.1** o mapa `data-*`↔props é gerado de `components.json` + `realComponent`
  dentro do pipeline `sync-components` (codegen é importado em runtime — rode o
  sync, não o codegen isolado). Done: `button` e `modal` compilando sem edição
  manual contra o design system real.
- **5.2** o checklist de paridade (D8) — as 6 linhas: estados, tokens,
  breakpoints, copy, a11y, interação — é emitido pelo export de spec. A linha
  6 (e2e no frontend real) é fase posterior.

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

node design/scripts/sync-components.mjs design/atendimento --check
node design/scripts/export-spec.mjs --design design   # emite o checklist D8 em spec/
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

node design/scripts/sync-components.mjs design/atendimento --check
node design/scripts/export-spec.mjs --design design   # emite o checklist D8 em spec/
```

Verificação: `button` e `modal` compilam sem edição manual; checklist D8 com
as 6 linhas emitido.

### 2.9 Reparo de encoding (`relatorios/`) — regra de ouro §14.4

> **Regra de ouro (corpus §14.4, §13.2 item novo 3):** nunca acusar corrupção
> de encoding — nem de estado de arquivo — sem verificar por codepoint/byte. O
> console embaralha UTF-8 na exibição; três revisões quase cometeram o mesmo
> engano, e duas "evidências" eram artefatos de medição. **Reparo por codepoint
> verificado — nunca por palpite de regex.**

Baseline client-run (corpus de referência): `relatorios/01-relatorios.html`
com mojibake double-encoded (UTF-8 válido, ZERO `U+FFFD`) — o relatório citou
as linhas 1135, 1138, 1268, 1397–1399 e 1429 (7 linhas; ex. `RESOLUÃ‡ÃƒO`,
`AÃ‡ÃƒO`, `Ãšltimos`), e a varredura completa encontrou o padrão pervadendo o
arquivo (o reparo do corpus de referência fechou em 180 runs). Não confie em
número de linha: varra por codepoint, repare por run, idempotente. Workarounds
de encoding em `01-base.html` também contam (baseline: 67 ocorrências —
23 `&atilde;`, 14 `&ccedil;`, 18 `\u00e3`, 10 `\u00e7`, 2 `&eacute;`), com meta
de zerar.

O script abaixo é o par verificação/reparo. **PowerShell-safe por construção:**
todo I/O e toda escrita passam pelo Node (UTF-8 sem BOM, byte-exato) — o shell
só invoca o Node; nenhum redirect de redirecionamento do PowerShell toca o
arquivo. Salve como `tools/mojibake-audit.mjs` no SEU workspace:

```js
#!/usr/bin/env node
// tools/mojibake-audit.mjs — auditoria e reparo de mojibake double-encoded.
// Regra de ouro (corpus §14.4): NUNCA acusar corrupção de encoding sem
// verificar por codepoint. --scan imprime codepoints; --repair só reescreve
// runs cuja decodificação UTF-8 é COMPROVADA (round-trip exato, sem U+FFFD);
// idempotente — uma segunda execução não encontra nada.
import { readFileSync, writeFileSync } from 'node:fs'

const [, , mode, file] = process.argv
if (!['--scan', '--repair'].includes(mode) || !file) {
  console.error('uso: node tools/mojibake-audit.mjs --scan|--repair <arquivo>')
  process.exit(2)
}

// bytes 0x80–0x9F do CP1252 que o console exibe como caracteres altos
const CP1252 = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C],
  [0x017E, 0x9E], [0x0178, 0x9F],
])
const toByte = (c) => {
  const p = c.codePointAt(0)
  return (p >= 0x80 && p <= 0xFF) ? p : CP1252.get(p)
}
// um run = pares (U+00C2..U+00DF + byte de cauda 0x80..0xBF reconstruível)
const isLead = (c) => { const p = c.codePointAt(0); return p >= 0xC2 && p <= 0xDF }
const isTrail = (c) => { const b = toByte(c); return b !== undefined && b >= 0x80 && b <= 0xBF }
const hex = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')

const src = readFileSync(file, 'utf8')
const eol = src.includes('\r\n') ? '\r\n' : '\n'
const lines = src.split(/\r?\n/)
let runs = 0
let fixed = 0
const out = lines.map((ln, i) => {
  const cs = [...ln]
  let res = ''
  for (let j = 0; j < cs.length;) {
    if (isLead(cs[j]) && cs[j + 1] !== undefined && isTrail(cs[j + 1])) {
      const run = []
      let k = j
      while (k + 1 < cs.length && isLead(cs[k]) && isTrail(cs[k + 1])) {
        run.push(cs[k], cs[k + 1])
        k += 2
      }
      runs += 1
      const bytes = Buffer.from(run.map(toByte))
      let decoded = null
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch { /* decodificação não comprovada: run não é mojibake */ }
      const verified = decoded !== null &&
        !decoded.includes('\uFFFD') &&
        Buffer.from(decoded, 'utf8').equals(bytes)
      console.log((verified ? 'FIX ' : 'KEEP') + ' line ' + (i + 1) + ': ' +
        run.map(hex).join(' ') +
        (verified ? ' -> ' + [...decoded].map(hex).join(' ') : ' (não comprovado — não toca)'))
      if (verified) {
        fixed += 1
        res += decoded
      } else {
        res += run.join('')
      }
      j = k
    } else {
      res += cs[j]
      j += 1
    }
  }
  return res
})
if (mode === '--repair' && fixed > 0) writeFileSync(file, out.join(eol), 'utf8')
console.log('runs candidatos: ' + runs + ' | reparados: ' + (mode === '--repair' ? fixed : 0) + ' (modo ' + mode + ')')
```

Roteiro (dois passos — verificar SEMPRE antes de reparar):

bash:

```bash
PROJ=/caminho/para/o-projeto
cd "$PROJ"

# 1) VERIFICAR por codepoint (não pela exibição do console — §14.4)
node tools/mojibake-audit.mjs --scan design/relatorios/01-relatorios.html
# esperado: linhas FIX candidatas com pares U+00C3/U+00C2 + U+0080..U+00FF

# 2) REPARAR (idempotente; só runs comprovados são reescritos)
node tools/mojibake-audit.mjs --repair design/relatorios/01-relatorios.html

# 3) re-verificar: 0 runs candidatos + regra de encoding verde
node tools/mojibake-audit.mjs --scan design/relatorios/01-relatorios.html
node design/scripts/qa.mjs --config design/validate.config.json --target design/relatorios
```

PowerShell:

```pwsh
$PROJ = "C:\caminho\para\o-projeto"
Set-Location $PROJ

# 1) VERIFICAR por codepoint (não pela exibição do console — §14.4)
node tools\mojibake-audit.mjs --scan design\relatorios\01-relatorios.html
# esperado: linhas FIX candidatas com pares U+00C3/U+00C2 + U+0080..U+00FF

# 2) REPARAR (idempotente; só runs comprovados são reescritos)
node tools\mojibake-audit.mjs --repair design\relatorios\01-relatorios.html

# 3) re-verificar: 0 runs candidatos + regra de encoding verde
node tools\mojibake-audit.mjs --scan design\relatorios\01-relatorios.html
node design\scripts\qa.mjs --config design\validate.config.json --target design\relatorios
```

### 2.10 Definições de pronto (corpus §13.2 — A.1 e A.2)

- **A.1 (governança, R1–R4) via `qa.mjs`:** o entrypoint oficial do pipeline é
  `node design/scripts/qa.mjs` — ele exige o marcador de config, roda validate
  + sync `--check` e embute os probes R1–R4 (config dirige o comportamento;
  script pré-config restaurado reprova com exit 2; 10 execuções estáveis;
  marcador visível). Verde no fim de cada WP.
- **A.2 (métricas por evento):** done = contagem `on*` = **0** nas telas dos
  canvases, com as allowlists `actions.allowLegacy`/`handlers.allowLegacy`
  **vazias** no fim (todo item residual justificado e removido antes do
  fechamento). Monotonicidade por diff do `metrics.json`; baseline re-congelada
  com `--update-metrics` no commit final da migração.
- Fechamento completo do ciclo: a tabela de 8 condições do corpus §15.7
  ("definição de tudo resolvido"), cada linha com seu verificador.

---

## 3. Mapa de cobertura — WP (§15) → seção → comando → verificação

| WP (corpus §15) | Seção do guia | Comando (client-run) | Verificação |
|---|---|---|---|
| 2.0 Smoke de caracterização | §2.2 | `node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento` | 3 fluxos de `01-base` verdes (`#demo`, `#erro-envio`, +1 declarado); baseline versionada antes de migrar |
| 2.1 Contrato de ações | §2.3 | `node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento` | qa verde; 0 elementos `on*`+`data-action` (action-both); allowlist justificada |
| 2.2 Roteador + piloto | §2.4 | `node design/validate.mjs design/relatorios --metrics` + qa + smoke | perfis/relatorios com 0 handlers inline; allowlist só com não migrados |
| 2.3 Migração atendimento (204→0) | §2.5 | `node design/validate.mjs design/atendimento --metrics` + qa + smoke por tela | `metrics.json`: `atendimento/` = 0 handlers, allowlist item a item |
| 3.1 Catálogo registry | §2.6 | `node design/scripts/sync-components.mjs design/atendimento --check` | "up to date"; variants+slots por entrada; ≥2 consumidores |
| 3.2 Modais 15–18 (`.m-*` 37→0) | §2.6 | sync `--check` + campo `m-classes` do `metrics.json` | 0 atributos `m-*` nos modais 15–18; 0 CSS `.m-*` local |
| 3.3 `so-mobile` (11 usos) | §2.6 | `grep -c 'so-mobile' design/atendimento/*.html` (ou `Select-String`) | 11 usos migrados para `device="mobile"` ou justificados |
| 4.1 Export de spec | §2.7 | `node design/scripts/export-spec.mjs --design design` | `spec/<telaId>.md`+`.json` por tela; estados declarados emitidos |
| 4.2 Smoke completo | §2.7 | `node design/scripts/smoke.mjs --config design/validate.config.json --design design/atendimento` | viewports 390×844/375×667 via devices; sem scroll horizontal; 0 `console.error`; snapshots versionados |
| 4.3 Acessibilidade | §2.7 | `node design/scripts/qa.mjs --config design/validate.config.json --target design/atendimento` | a11y-no-autofocus/a11y-toast-no-live verdes; fluxo por teclado |
| 4.4 Dados mock | §2.7 | `node design/scripts/qa.mjs … --target design/atendimento` (regra data-ref) | `data/` por canvas; `$ref` resolvido sem circularidade |
| 4.5 Contrato de tokens | §2.7 | `node design/scripts/gen-tokens.mjs` + `--contract` | contract-doc-sync verde; breakpoints 900/640 → `sm:`/`md:` |
| 5.1 Codegen `data-*`↔props | §2.8 | `node design/scripts/sync-components.mjs design/atendimento --check` | `button` e `modal` compilando sem edição manual |
| 5.2 Paridade D8 | §2.8 | `node design/scripts/export-spec.mjs --design design` | checklist D8 com as 6 linhas emitido |
| §15.6.4 Métricas (governança) | §2.1 | `node design/validate.mjs design --metrics` / `--update-metrics` | diff antes/depois; monotonicidade; baseline re-congelada no commit |
| §15.6.5 Encoding (governança) | §2.9 | `node tools/mojibake-audit.mjs --scan\|--repair <arquivo>` | 0 runs double-encoded; regra de encoding verde; §14.4 |

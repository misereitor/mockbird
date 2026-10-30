# fixtures/smoke — hard cases sintéticos (caracterização)

Espelhos SINTÉTICOS dos casos duros do corpus do cliente. Os números do corpus
(2.024 chars, 17 nomes, 11 ocorrências, 3 routers, `<script>` em overlay) são
apenas a FORMA do input de caracterização — nunca critério de aceitação.
Aceitação = o smoke (`smoke.mjs`) carrega tudo com exit 0 e congela o baseline
de pixels.

Canvas `hardcases/` (5 telas):

| tela | caso duro | forma espelhada |
|---|---|---|
| `01-inline-handler.html` | handler inline gigante | `onclick` de EXATAMENTE 2.024 chars (inofensivo, nunca roda no load) |
| `02-legacy-script-overlay.html` | overlay com `<script>` legado | bloco `<script>` dentro do overlay, MORTO e documentado: `type="text/x-legacy"` não é JavaScript, o navegador nunca executa |
| `03-local-routers.html` | routers locais | 3 scripts de roteamento locais (`router-1..3.js`) na mesma tela; declaram tabelas, sem efeito no load |
| `04-flat-action-names.html` | nomes planos de ação | 17 `data-action` sem namespace (sem ponto) |
| `05-so-mobile.html` | classes `so-mobile` | 11 ocorrências da classe `so-mobile` |

Uso (carrega as 5 telas + congela snapshots em `snapshots/`):

```
node skills/design/scripts/smoke.mjs --config skills/design/assets/validate.config.json --design skills/design/scripts/fixtures/smoke
```

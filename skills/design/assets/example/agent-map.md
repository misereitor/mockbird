# Agent map — skills/design/assets/example

> GERADO por `skills/design/scripts/agent-map.mjs` — não editar à mão; regenere com `/design-map`.
> schemaVersion 1 · gitSHA e4e237052883bfdbcfbfe5b9d5020d569c44be4b · contentHash b6ab9fc717ec76eaf3e8e238c7f5746428d02e0977cc590e2305469cb91bde88 · timestamp 2026-11-04T19:39:36+00:00

## (i) Inventário por tela

### dashboard/01-overview.html — `overview` (canvas dashboard)
- estados declarados: `default` (dashboard/01-overview.html:31), `vazio` (dashboard/01-overview.html:32), `critico` (dashboard/01-overview.html:33)
- componentes: `menu-row` size=md tone=default state=default (dashboard/01-overview.html:41); `menu-row` size=md tone=danger state=default (dashboard/01-overview.html:46)
- ícones (svg): nenhum
- elementos data-*: nenhum

### login/01-login.html — `login` (canvas login)
- estados declarados: `default` (login/01-login.html:21)
- componentes: `card` size=md tone=elevated state=default (login/01-login.html:25); `field` size=md tone=default state=default (login/01-login.html:29); `field` size=md tone=default state=default (login/01-login.html:35); `button` size=md tone=primary state=default (login/01-login.html:41); `button` size=md tone=ghost state=default (login/01-login.html:42)
- ícones (svg): nenhum
- elementos data-*: nenhum

### login/02-cadastro.html — `cadastro` (canvas login)
- estados declarados: `default` (login/02-cadastro.html:21)
- componentes: `card` size=md tone=elevated state=default (login/02-cadastro.html:25); `button` size=md tone=primary state=default (login/02-cadastro.html:33); `button` size=md tone=ghost state=default (login/02-cadastro.html:34)
- ícones (svg): nenhum
- elementos data-*: nenhum

### login/03-modal.html — `excluir` (canvas login)
- estados declarados: `default` (login/03-modal.html:12)
- componentes: `modal` size=md tone=danger state=default (login/03-modal.html:24)
- ícones (svg): nenhum
- elementos data-*: nenhum

## (ii) Verbos do runtime (derivado de mock.js; verificado por --check-verbs)

| verbo | executa | fonte |
| --- | --- | --- |
| `data-go` | `window.Mock.go(target.getAttribute('data-go'))` | skills/design/assets/mock.js:829 |
| `data-overlay` | `window.Mock.overlay(target.getAttribute('data-overlay'))` | skills/design/assets/mock.js:833 |
| `data-toast` | `window.Mock.toast(target.getAttribute('data-toast'))` | skills/design/assets/mock.js:827 |
| `data-close` | `window.Mock.close()` | skills/design/assets/mock.js:828 |
| `data-action` | `runAction(target.getAttribute('data-action'), event, target)` | skills/design/assets/mock.js:837 |
| `Mock.state/flash` | `Mock.state.get/set/clear · Mock.toast(message, ms = 2200)` | skills/design/assets/mock.js:476 |
| `actions/<stem>.js` | `Mock.loadActions(id) → new URL('actions/' + id + '.js', MOCK_BASE)` | skills/design/assets/mock.js:410 |

## (iii) Índice de contratos

- tokens: tokens.json:1 — temas [dark, light], grupos [borderRadius, breakpoints, color, density, dimension, font, fontSize, layers, motion, radius, shadow, space, typography], 112 tokens
- convenções de ícones: skills/taste/SKILL.md:140 §3.C + slots de ícone em skills/design/scripts/marker-parser.mjs:188 (menu-row), skills/design/scripts/marker-parser.mjs:214 (toast), skills/design/scripts/marker-parser.mjs:253 (banner)
- breakpoints: skills/design/assets/validate.config.json:27 — mobileMax 640, tabletMax 900 (default do pack (alvo sem validate.config.json))
- partials: `avatar` (components/avatar.html), `banner` (components/banner.html), `bubble` (components/bubble.html), `button` (components/button.html), `card` (components/card.html), `chip` (components/chip.html), `drawer` (components/drawer.html), `field` (components/field.html), `media-card` (components/media-card.html), `menu-row` (components/menu-row.html), `modal` (components/modal.html), `pill` (components/pill.html), `tabs` (components/tabs.html), `toast` (components/toast.html)

## (iv) Contratos mortos

SEM CONTRATOS MORTOS — 4/4 verificações limpas.

### data-action sem actions/<stem>.js

- nenhum

### links para telas inexistentes

- nenhum

### parciais órfãos

- nenhum

### ícones divergentes entre telas

- nenhum

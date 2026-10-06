---
name: design
description: Design screen mockups, UI prototypes, wireframes and landing pages as real HTML screens in design/<canvas>/, following the project design system, validated with design/validate.mjs and shown side by side in the local design/viewer.html canvas. Use when the user asks for screens, telas, mockups, layouts, wireframes, landing pages, prototypes or visual variations, or invokes /design.
---

# Design canvas

You design screens as real HTML files inside the project and show them in the
local design viewer. The user sees every screen side by side, switches device
size and light/dark theme, exports PNG and comments on a screen; comments come
back to you as chat messages with an exact prefix.

## Files (the contract)

```
design/
  design-system.css      design tokens for [data-theme="light"] and [data-theme="dark"]
  design-system.md       brand decisions in words (short)
  validate.mjs           the validator (copied once per project — see Setup)
  serve.mjs              tiny static server for the viewer (copied once per project)
  viewer.html            the viewer (copied once per project)
  mock.js                mock runtime for interactive screens (copied once per project)
  vendor/html-to-image.js  PNG export library (copied once per project)
  index.json             {"canvases": ["login", ...]} so the viewer can list them
  <canvas>/              one folder per canvas, kebab-case (login, dashboard)
    canvas.json
    data.json            optional fictitious data; optional "scenarios" object
                         with named top-level overrides (empty, critical…)
    01-<screen>.html     one complete HTML document per screen
    assets/              optional local images/scripts
```

`canvas.json` (screens appear in this order):

```json
{
  "title": "Login do app",
  "screens": [
    { "id": "login", "name": "Login", "file": "01-login.html", "device": "mobile" },
    { "id": "cadastro", "name": "Cadastro", "file": "02-cadastro.html", "device": "mobile" }
  ]
}
```

- `device`: `mobile` = 390×844, `tablet` = 834×1112, `desktop` = 1440×900;
  optional `width`/`height` (integers 100–10000) override it.
- `id` unique and non-empty; `name` non-empty; `title` optional.
- `file` is relative to the canvas folder: never `..`, leading `/`, `\` or a
  scheme (`http:`, `file:` …).

## One-time setup per project

If `design/` does not exist yet, create it and copy from this skill's folder
(the folder containing this SKILL.md):

- `scripts/validate.mjs` → `design/validate.mjs`
- `assets/viewer.html` → `design/viewer.html`
- `assets/serve.mjs` → `design/serve.mjs`
- `assets/mock.js` → `design/mock.js`
- `assets/docs.html` → `design/docs.html` (usage guide, linked from the viewer's 📘 Docs button)
- `assets/vendor/html-to-image.js` → `design/vendor/html-to-image.js`

Create `design/index.json` (`{"canvases": []}`) and add every new canvas name
to it as you create canvases. A complete, valid example lives in this skill's
`assets/example/` — a working stock-app system across two canvases:
`login/` (login, sign-up) and `dashboard/` (interactive overview), where
login and sign-up navigate across canvases into the overview, which reads
its fictitious items, supports named scenarios, and logs out back to the
login canvas. Read it before starting a new design system or canvas and
adapt it.

## Workflow

1. **Design system first.** Read `design/design-system.css` and
   `design/design-system.md`. If they do not exist, ask the user for the brand
   (primary color, typeface feel, tone; offer a neutral palette as one option),
   then create both. Later canvases reuse them. Change the tokens only after
   asking.
2. **Ask only what is missing.** If the request is vague (which screens, which
   platform, what data), ask once; if it is clear, start.
3. **Build the canvas.** Read `assets/craft.md` from this skill's folder first
   (it fuses the sibling craft skills — taste, emil-design-eng, impeccable —
   into rules for canvas screens) and apply it to every screen. Then create
   `canvas.json` and the screens. Rules for every screen:
   - Link the tokens: `<link rel="stylesheet" href="../design-system.css">` and
     use only `var(--…)` tokens for color, type, spacing and radius — never a
     hard-coded color.
   - Work in both themes through the tokens; the theme arrives as
     `data-theme` on `<html>` (`light` by default — include the attribute).
   - No CDN or remote URL of any kind (the canvas is offline and sandboxed):
     inline SVG icons, system fonts or font files under `design/`, local images.
   - Real copy in the user's language (Brazilian Portuguese by default) and
     plausible sample data — no lorem ipsum.
   - Cover empty, loading and error states when they matter, as extra screens.
   - Accessible basics: labels on inputs, visible focus, sufficient contrast,
     tap targets ≥ 44px on mobile.
   - The layout must hold at the screen's device width.
   - **Make it a system preview, not a poster.** When the request implies a
     working product, wire the screens with the mock runtime
     (`<script src="../mock.js"></script>`, copied by Setup): forms validate
     and submit, buttons give feedback, screens navigate with
     `Mock.go('03-dashboard.html')`, fictitious data lives in the canvas's
     `data.json` (`await Mock.data('items')`), flow state (logged-in user,
     items created along the way) lives in `Mock.state` (session, namespaced
     per canvas), and simulated actions confirm with `Mock.toast('…')`.
     Every screen must still render as a static composition if JS fails.
     The viewer shows a ↺ início button on cards that navigated and
     "⟲ Reset fluxo" to start the whole flow over. Cover the states that
     matter as named `scenarios` in `data.json` (top-level overrides, e.g.
     `"vazio": {"items": []}`) — the viewer gains a selector for them, the
     choice survives navigation, and each scenario must compose well
     (empty list, all items below minimum, API failure). A system may span
     canvases (one per flow): navigate across with
     `Mock.go('../<canvas>/<screen>.html')` — flow state is shared
     project-wide, so the login canvas sets the user and the dashboard
     canvas reads it. The viewer's canvas selector jumps between canvases
     (each canvas keeps its own scenario, theme and device).
4. **Validate and fix.** Run from the project root:
   `node design/validate.mjs design/<canvas>`. Fix every issue it lists and run
   again until only the summary line remains. Never present a canvas that has
   issues.
5. **Show it.** Start the viewer server in the background
   (`node design/serve.mjs`, default port 8765; if the port is busy a server is
   probably already running — reuse it) and give the user the link:
   `http://localhost:8765/viewer.html?canvas=<canvas>`. Mention that 🎯
   Elemento lets them click any element to comment on it specifically.
   Then summarize in one or two sentences what you created.
6. **Comments.** A message starting with
   `[Design: design/<canvas> › <name> (<file>)]` is a request about that exact
   screen: edit only that file. A message whose bracket ends with
   `› <selector> "<snippet>"` (the viewer's 🎯 Elemento mode, which pins
   element comments on the screen) targets one element inside it: locate the
   element by the selector first, then by the snippet text, and change only
   that element (and the tokens only if the user agrees). Validate again
   after any edit.
7. **Variations.** "2 options" means separate screens in the same canvas
   (`Login A`, `Login B`), not separate canvases.

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
  tokens.json            the single source of truth for every design token
                         (both themes); the only place brand values live
  design-system.css      GENERATED from tokens.json: design tokens for
                         [data-theme="light"] and [data-theme="dark"] (never edit)
  utilities.css          GENERATED from tokens.json: the closed utilities
                         vocabulary (never edit)
  design-system.md       brand decisions in words (short)
  validate.mjs           the validator (copied once per project — see Setup)
  serve.mjs              tiny static server for the viewer (copied once per project)
  viewer.html            the viewer (copied once per project)
  mock.js                mock runtime for interactive screens (copied once per project)
  mock.css              static styles for the mock runtime classes (copied once
                         per project) — toast/overlay/enter-transition states;
                         screens link it as `../mock.css`; mock.js only toggles
                         these classes and never injects CSS
  scripts/               copied once per project (see Setup)
    gen-tokens.mjs       regenerates design-system.css + utilities.css from
                         tokens.json
    sync-components.mjs  rematerializes every component marker region from its
                         partial (copied once per project)
    marker-parser.mjs    the shared marker grammar parser sync imports at
                         runtime (copied once per project)
  components/            component registry + partials seed (copied once per
                         project): components.json + one partial per component
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
- `group` (optional): label that clusters the screens into titled blocks in
  the viewer strip — complex projects stay readable (e.g. `"group": "Checkout"`).
- `transition` (optional): `fade`, `slide-left` or `none` (default). It is the
  screen's enter animation after `Mock.go` — see Workflow step 3 for the
  same-canvas/cross-canvas rule.
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
- `assets/mock.css` → `design/mock.css` (styles for the mock runtime classes;
  screens link `../mock.css`)
- `assets/docs.html` → `design/docs.html` (usage guide, linked from the viewer's 📘 Docs button)
- `assets/vendor/html-to-image.js` → `design/vendor/html-to-image.js`
- `scripts/gen-tokens.mjs` → `design/scripts/gen-tokens.mjs`
- `assets/components/` → `design/components/` (registry + partials seed)
- `scripts/sync-components.mjs` → `design/scripts/sync-components.mjs`
- `scripts/marker-parser.mjs` → `design/scripts/marker-parser.mjs` (the shared
  parser module sync imports, required at runtime)
- `scripts/export-tokens.mjs` → `design/scripts/export-tokens.mjs` (the W3C/DTCG
  interchange export: tokens.json → tokens.w3c.json; derived artifact, never
  edited by hand)
- `assets/validate.config.json` → `design/validate.config.json` (the validator's external config — its `toolchainScripts` must match the layout above when copied: `validate.mjs`, `scripts/sync-components.mjs`, `scripts/marker-parser.mjs`, `scripts/gen-tokens.mjs`, `scripts/export-tokens.mjs`, `mock.js`)

Rule for this copy list: only files that already exist enter it ("só entra no
copy list arquivo que já existe"). Files still to come join only at their
Contracts wave: `export-tokens.mjs` joined at Contracts wave 6 (todo 30) and is
listed above — the rule is satisfied (the file exists since todo 26).
(`mock.css` joined at wave 3 and is listed above.)

Whenever `tokens.json` changes, regenerate the two generated files from the
project root:

```
node design/scripts/gen-tokens.mjs
```

Create `design/index.json` (`{"canvases": []}`) and add every new canvas name
to it as you create canvases. A complete, valid example lives in this skill's
`assets/example/` — a working stock-app system across two canvases:
`login/` (login, sign-up, and a delete-account confirm modal opened as an
overlay from a plain link) and `dashboard/` (interactive overview with a long
item list, a same-canvas "Atualizar lista" refresh that demos the `fade`
transition and scroll restore), where login and sign-up navigate across
canvases into the overview, which reads its fictitious items, supports named
scenarios, and logs out back to the login canvas. Read it before starting a new design system or canvas and
adapt it. The seed `example/components/` is a byte-identical copy of
`assets/components/` ("example/components/ é cópia byte-idêntica de
assets/components/ (fonte única)"): edit partials only in `assets/components/`,
never in the example copy.

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
    - Styling policy: the utilities vocabulary is the vocabulary. Anything
      token-backed (colors, type, spacing, radius) goes through the generated
      utilities: link `<link rel="stylesheet" href="../design-system.css">` and
      `<link rel="stylesheet" href="../utilities.css">`, then use classes like
      `bg-accent`, `p-2`, `text-heading`, `rounded-md`. Interactive screens
      also link `<link rel="stylesheet" href="../mock.css">` (the mock runtime
      classes: toast, overlay, enter transitions). Semantic classes carry
      structure and layout only. `var(--…)` stays allowed where no utility fits,
      and an inline `<style>` block is allowed but must hold ZERO literal
      colors. The ban sweep scans literal colors in `<style>`, `style=""` and
      the VALUE positions of SVG `fill=`/`stroke=`; it also bans `http(s)://`
      anywhere in screens, Tailwind palette classes like `bg-zinc-900`, and
      arbitrary values like `text-[13px]`.
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
    - **Components are instances of partials, never loose component markup**
      ("instância usa partial, nunca markup solto de componente"). Wrap every
      instance in the marker pair
      `<!-- component:id size=md tone=primary state=default -->…<!-- /component:id -->`
      with the THREE required args `size=`, `tone=`, `state=` (values must be
      in the registry enums of `design/components/components.json`), and fill
      its slots as paired markers `<!-- slot:name -->…<!-- /slot:name -->`.
      Precedence: marker args are the source of truth (marker-args-win). The
      sync re-emits `data-size`/`data-tone`/`data-state` and the variant
      classes from the marker on every run; slot contents and user extra
      `data-*` attributes on the root survive.
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
      (each canvas keeps its own scenario, theme and device). Modals and
      confirm dialogs are full canvas screens too (one source of truth): the
      trigger is a plain screen link, `<a href="03-modal.html">`, which the
      mock runtime intercepts into `Mock.overlay('03-modal.html')` — without
      JS the untouched href navigates to the modal screen itself (the JS-off
      fallback). Persistent navigation (sidebar, top menu, tabs) must switch
      screens for real: put `data-go="02-cadastro.html"` on each item (keep a
      real `href="02-cadastro.html"` on the same link as the JS-off fallback —
      the runtime routes `data-go` to `Mock.go`, preserving `?scenario=` and
      the enter transition). Plain links stay reserved for overlay triggers
      (modals/details — a plain screen link always opens an overlay); repeat
      the same navigation block on every screen of the canvas and mark the
      active item. Screens may declare `"transition": "fade"|"slide-left"|"none"`
      in `canvas.json`: `Mock.go` hands an enter class to the destination
      (`mock-enter-fade`/`mock-enter-slide-left`, self-removed within 300 ms).
      The handoff reads the CURRENT canvas's `canvas.json` matched by the
      destination filename, so it works for same-canvas hops (a self-nav like
      `Mock.go('01-overview.html')` is the refresh pattern) — a cross-canvas
      `Mock.go('../<canvas>/<screen>.html')` is a plain navigation without
      enter class. Scroll position is preserved per screen
      (`scroll.<canvas>.<file>` in sessionStorage, restored when the screen
      returns and surviving ⟲ Reset fluxo, which clears only `mock.*`).
4. **Validate and fix.** MANDATORY sync first: after editing any partial in
   `design/components/` (or any marker's args), run
   `node design/scripts/sync-components.mjs` from the project root before
   presenting anything; it rematerializes every instance from its partial
   (marker-args-win). `--check` is the dry-run form: it prints a
   `file:line` diff per divergent region and exits 1 on divergence (0 clean),
   never writing. Then run from the project root:
   `node design/validate.mjs design/<canvas>`. Fix every issue it lists and run
   again until only the summary line remains. Never present a canvas that has
   issues. The validator's argument is a design-root (project mode) or a single
   canvas folder (canvas mode); with no argument it defaults to `./design`.
   Structural checks cover only the screens listed in `canvas.json`; project
   mode additionally checks tokens/generated-CSS staleness, components and
   comments. Component rules are scanned on every non-exempt `.html`,
   independent of `canvas.json`, with the codes `component-unknown`,
   `component-variant`, `component-marker`, `component-divergence` and
   `slot-marker`. `--allow-stale` skips ONLY the staleness check;
   `--mark-stale` is the validator's only write (it marks comment pins whose
   anchor is gone); `--example-inventory` is the example contract check (exact
   file list of `inventory.json` + `"_demo": true` on every pin; no
   `inventory.json` = skip, exit 0).
4b. **Impeccable audit.** After validating, run the sibling `impeccable`
   skill's technical audit on the canvas (installed layout, win32):
   `<skill-impeccable>/scripts/impeccable.cmd audit design/<canvas>` - the
   path is resolved from the installed skill dir (`scripts/impeccable` on
   other platforms). If the engine is absent or the run fails, follow the
   `impeccable` skill's `reference/degraded/` guidance and note the
   degradation in the delivery output - the workflow never stalls or throws
   on the engine, and the validated canvas is delivered the same.
5. **Show it.** Start the viewer server in the background
   (`node design/serve.mjs --open=<canvas>`, default port 8765 — `--open[=canvas]`
   opens the default browser straight at that canvas, `--no-open` suppresses
   it, `BROWSER` env picks a specific browser; without flags the browser opens
   only from an interactive terminal; if the port is busy a server is
   probably already running — reuse it) and give the user the link:
   `http://localhost:8765/viewer.html?canvas=<canvas>`. Point out the tools
   for complex projects: `group` blocks in `canvas.json`, ▦ Grid (wrap
   view), the search box (`/` focuses it), 📱 Frame (device frames) and
   screen-vs-screen in `Compare` (A/B accepts "Screens in this canvas").
   The viewer UI is English by default and follows the browser language
   (`?lang=pt` / `?lang=en` forces it; the 🌐 button switches).
   Mention that 🎯
   Element lets them click any element to comment on it specifically.
   Snapshots are review material: `Save snapshot` freezes a canvas state
   (`src/` + flat `render/`) for later review, `Compare` shows any two
   states side by side or as onion skin, and `Revert to this snapshot`
   restores a snapshot.
   Then summarize in one or two sentences what you created.
6. **Comments.** The `[Design: …]` chat message format below is
UNCHANGED — persistent pins are an extra channel, never a grammar change.
A message starting with
`[Design: design/<canvas> › <name> (<file>)]` is a request about that exact
screen: edit only that file. A message whose bracket ends with
`› <selector> "<snippet>"` (the viewer's 🎯 Element mode) targets one
element inside it: locate the element by the selector first, then by the
snippet text, and change only that element (and the tokens only if the
user agrees). Element comments are dual-channel 🎯: besides the chat
message the viewer persists a numbered pin in `design/comments.json`
(schema `{id, canvas, file, selector?, snippet?, rect?, status, replies,
createdAt, _demo?}`, `status` `open`|`resolved`|`stale`, written only by
the server) — the pin is the persistent record (pending panel, toolbar
count); the chat message is the channel that instructs you. `stale` has
exactly two writers: `validate.mjs --mark-stale` (step 4) and the revert
API. Never edit `comments.json` by hand. Validate again after any edit.
   A message
   `[Design-Reset: design/<canvas> — snapshot "<label>" restaurado]` is a
   state confirmation only — the agent does NOT edit anything: acknowledge
   and continue. (The bracket is the whole message — em-dash between canvas
   and snapshot, no `› <arquivo>` part.) It means the snapshot was already
   restored (the viewer's "Reverter para este snapshot" button) and the
   regen pipeline (gen → sync → validate) already ran. You may proactively
   offer to revert to a saved snapshot when one exists, but only revert on
   explicit user request.
7. **Variations.** "2 options" means separate screens in the same canvas
   (`Login A`, `Login B`), not separate canvases.
8. **Handoff.** "Extract section as production component": when the user wants
   a screen section handed to production, select the section (ideally a
   component region - the `<!-- component:id -->..<!-- /component:id -->`
   marker pair) and extract it into `design/handoff/` (installed layout) as
   EXACTLY three files named after the section: `<nome>.jsx`, `<nome>.html`
   and `tokens-used.json` - nothing else ever: `design/handoff/` holds exactly
   the three files of the current extraction (drop a previous extraction's
   output first). The variants note is
   a header comment INSIDE each generated file, NEVER a separate file:
   the first line of the `.jsx` (`// ..`) and of
   the `.html` (`<!-- .. -->`), and - where JSON cannot hold comments - the
   top-level `"variants"` string of `tokens-used.json`. The note records the
   instance's `size=/tone=/state=` args and the registry enums.
   `<nome>.html` is the extracted markup (sync markers stripped, root `data-*`
   kept); `<nome>.jsx` is the same markup as a production JSX component
   (`className`, no markers). `tokens-used.json` is
   `{"variants": <note>, "tokens": [<token path>, ..]}` - exactly the tokens
   the extracted markup references: every class resolves through the generated
   utilities to a `var(--.)` and each var maps to its token path in
   `tokens.json` (a composite token - `typography.*`, `shadow.*` - counts once
   at its own path); the list equals the tokens of the classes in the
   generated files, no more and no less.
   `handoff/` is not a canvas: it gets NO structural checks, but the BANS
   still apply - the bans walker covers `handoff/` and includes `.jsx`, so a
   literal color in generated JSX is flagged `hard-coded-color` like anywhere
   else; extract with utilities/`var(--.)` only, never literal colors.
   Impeccable hook: if the `impeccable` engine is available (the `impeccable`
   skill's launcher - `scripts/impeccable.cmd` on win32, `scripts/impeccable`
   elsewhere - resolves an engine binary), run `impeccable extract` on the
   output. ALWAYS when the engine is absent or the run fails - never blocking
   or throwing - follow `skills/impeccable/reference/degraded/asset-producer.md`
   (production cleanup by hand: preserve the reference, no redesign) and note
   the degradation in the output - the generated files' header notes
   (`tokens-used.json` as its top-level `"degraded"` string) and the delivery
   message. Fallback for a section WITHOUT a component (plain markup, no
   marker pair): plain markup + token list, the SAME three-file form
   (`<nome>.jsx`, `<nome>.html`, `tokens-used.json`); the variants note then
   records "no component registry entry" instead of variant enums.

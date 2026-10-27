# Mockbird

[![CI](https://github.com/misereitor/mockbird/actions/workflows/ci.yml/badge.svg)](https://github.com/misereitor/mockbird/actions/workflows/ci.yml)

> Language: **English** · [Português (BR)](README.pt-BR.md)

Four skills that, together, stop the agent from shipping generic layouts and
start shipping professional-grade interfaces — including a **screen canvas**
so you can see HTML mockups side by side in your browser.

Mockups are real, interactive HTML: logins navigate, forms validate, lists
react. Every project gets its own design system, and everything is validated
before you see it.

| Skill | What it does |
|---|---|
| `design` | Screen canvas that works as a **functional preview of the system**: real HTML mockups in `design/<canvas>/`, per-project design system, fictional data in `data.json` + `mock.js` runtime (login navigates, forms work, lists react), validator, and local viewer (zoom, light/dark theme, device size, **data scenarios** with a picker, **flow mode** full screen with history ◀ ▶ ⟲, **flow recording** to .webm, PNG export, comments per screen **and per element** — 🎯 mode turns numbered pins with the CSS selector of the commented spot; ⟲ Reset flow restarts the scenario). Systems with multiple flows live in **multiple canvases** with navigation between them and shared state (canvas A's login logs the user into canvas B) — the viewer has a canvas picker. Includes the **craft layer** that fuses the three skills below into every screen it builds. |
| `taste` | Anti-slop: reads the brief, sets the direction (variance/motion/density dials), bans AI clichés (purple gradients, three identical cards, em-dashes, beige+brass palettes…) and maps brief → real design system. |
| `emil-design-eng` | Emil Kowalski's polish and animation philosophy (creator of Sonner/Vaul, ex-Vercel/Linear): when NOT to animate, easing curves, durations, the invisible details that make UI "feel right". |
| `impeccable` | 24 design commands (`/impeccable audit`, `critique`, `polish`, `harden`, `typeset`…) with its own binary engine. Credits: Paul Bakaus — https://impeccable.style |

`design` is the entry point: when you ask for screens/mockups it already
applies the rules of the other three (via `assets/craft.md`). The three also
work standalone on real frontend code.

## Requirements

- **Node.js 18+** (the validator, the `design` skill's viewer and all tooling
  run on stock Node 18 — no other dependencies, everything is offline,
  no CDN).
- An agent with **Agent Skills** support (`SKILL.md` with frontmatter):
  ZCode, OpenCode, Claude Code, Codex, Cursor, Gemini CLI and friends.

## Installation

> **Using OpenCode v2?** The recommended path is the **auto-update plugin**
> ([see below](#opencode-v2-plugin-auto-update)) — it keeps skills and
> projects updated on its own. `install.mjs` remains the path for other
> agents and for static installs.

From this package's folder. The two install flags are `--target <agent>`
(known destination) and `--dir <folder>` (any folder, per-project install):

```bash
node install.mjs --target opencode   # OpenCode (global: ~/.config/opencode/skills + commands/)
node install.mjs --target zcode      # ZCode (~/.agents/skills)
node install.mjs --target claude     # Claude Code (~/.claude/skills)
node install.mjs --target codex      # Codex CLI (~/.codex/skills)
node install.mjs --target cursor     # Cursor (~/.cursor/skills)
node install.mjs --target gemini     # Gemini CLI (~/.gemini/skills)
node install.mjs --target agents     # open standard (~/.agents/skills)
node install.mjs --dir .claude/skills  # or any folder (per-project install)
node install.mjs --list              # see all destinations
```

OpenCode destinations also receive the **slash commands** (`/design`,
`/taste`, `/emil-design-eng`, `/impeccable`) in their `commands/` folder.
Without them, invoke the skills by mentioning them (`@design`) or just ask —
skills are not slash commands in OpenCode v2; the agent loads the matching
skill itself.

Recommendation: install **all four together** (the default behavior). The
`design` craft layer references its siblings by relative path (`../taste`,
`../emil-design-eng`, `../impeccable`), so they need to live side by side.

Then **restart your agent's session** so the skills load.

## OpenCode v2 plugin (auto-update)

The `plugin/` directory makes Mockbird behave as an **OpenCode v2 plugin**
that updates itself. `setup()` runs every time OpenCode opens a project and
does four things:

1. **Auto-update** — `git pull --ff-only` on this repo (10-minute throttle
   between pulls; offline or no remote keeps the local version, no errors).
2. **Skills without copies** — the four skills are registered straight from
   `skills/` via `ctx.skill.transform`. Single source of truth: no more
   keeping copies in `~/.agents/skills`, `~/.claude/skills` or
   `~/.config/opencode/skills`.
3. **Runtime mirror** — the runtime files (`viewer.html`, `mock.js`,
   `mock.css`, `docs.html`, `serve.mjs`, `validate.mjs`, `vendor/`,
   `scripts/`) are mirrored into the current project's `design/` folder.
   A file whose content diverges gets a `<file>.bak` backup of the local
   version before being updated. `components/` is *seed* only: filled in
   when missing, never overwritten (registries grow per project).
4. **Slash commands** — `/design`, `/taste`, `/emil-design-eng`,
   `/impeccable` (one per skill, from `commands/*.md`) plus `/design-sync`,
   which forces `git pull`, reloads the skills and re-mirrors the project's
   `design/` on demand.

Install (once per machine) — **clone the repo** (a ZIP download has no `.git`,
so auto-update would be disabled):

```bash
git clone https://github.com/misereitor/mockbird.git
cd mockbird/plugin && npm install   # @opencode/plugin dependency (v2 API)
```

And register the path in your global config (`~/.config/opencode/opencode.json`):

```jsonc
{
  "plugins": ["/path/to/mockbird/plugin"]   // Windows: "C:/path/to/mockbird/plugin"
}
```

From then on the update flow is just: **commit + push here** → the next time
OpenCode opens in any project, `git pull` brings everything in and the
project's `design/` is mirrored automatically.

Notes:

- Projects without a `design/` folder are never touched (the plugin never
  creates `design/` — the skill does, on first use).
- `node plugin/smoke.mjs <project>` tests the mirroring by hand, without
  opening OpenCode.
- Diagnostics: every `setup()` writes what it did to
  `%TEMP%\mockbird-plugin.log` (plugin `console.log` output does not show up
  in OpenCode's log).
- `install.mjs` still applies to Claude Code, Codex, Cursor, Gemini and
  per-project installs.

## First use

1. Ask for the screens ("landing page for app X", "login and signup screen"…)
   or type `/design`. On first use in a project, the skill creates the
   `design/` folder (it asks for the brand), copies validator + viewer there
   and validates everything before giving you the link.
2. Open the viewer link (something like
   `http://localhost:8765/viewer.html?canvas=login`): screens side by side,
   light/dark theme, device size, data scenarios, zoom, PNG export and a
   "Comment this screen" button — the comment comes back to the agent in the
   exact format `[Design: design/<canvas> › <screen> (<file>)] <request>` and
   it adjusts just that screen. Scenario, theme and device are remembered per
   canvas. Full usage docs live in `docs.html` (📘 Docs button in the viewer's
   toolbar).
    **Complex projects**: label screens with `"group"` in `canvas.json` to get
    titled blocks, toggle **▦ Grid** for a wrapping overview, type `/` to
    search screens, **📱 Frame** puts device frames around mobile/tablet
    screens, screens lazy-load as you scroll, and `Compare` accepts any two
    screens side by side (not just snapshots).
    **Language**: the viewer and its docs are English by default and follow
    the browser language (Portuguese included) — `?lang=pt` / `?lang=en` force
    it and the 🌐 button switches on the spot.
3. The `impeccable` skill **downloads a third-party binary** — its engine,
   from the [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
   releases — on first run (once, needs network). The launcher validates it
   (probe + version-pinned cache), you can preinstall your own via the
   `IMPECCABLE_BIN` env var, and if the download fails the skill continues
   without the engine via fallback.

The commands that live in the project's `design/` are `node design/validate.mjs`,
`node design/serve.mjs [port] [--share] [--open[=canvas]] [--no-open]`,
`node design/scripts/gen-tokens.mjs`, `node design/scripts/sync-components.mjs`
and `node design/scripts/export-tokens.mjs` (installed). The server opens your
default browser at the viewer (`--open=<canvas>` lands straight on a canvas,
`--no-open` suppresses it, the `BROWSER` env var picks a specific browser).

## Troubleshooting

- **OpenCode didn't detect the skills**: some versions read `skill/`
  (singular) and others `skills/` (plural). Install to the open standard —
  `node install.mjs --target agents` — which OpenCode also reads, or use
  `node install.mjs --dir <folder>` pointing at your version's directory.
- **Port 8765 in use**: `node design/serve.mjs 8766` and adjust the link.
- **Skills not showing up**: confirm your agent supports `SKILL.md` and that
  the chosen folder is the one it reads (`node install.mjs --list` shows the
  paths).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the invariants, test commands and PR checklist. A few pointers:

- Keep the four skills installable side by side — `design`'s craft layer
  references `../taste`, `../emil-design-eng` and `../impeccable`.
- The validator, viewer and mock runtime ship inside every project's
  `design/` folder; changes to them are mirrored by the plugin (and by the
  copy list in `SKILL.md`), so update both sides together.
- `node plugin/smoke.mjs <project>` mirrors a project by hand; run the
  validator against the example canvas in `skills/design/assets/example/`
  after touching `validate.mjs`.
- By contributing you agree that your contributions are licensed under the
  MIT License of this repository.

## Changelog

- **Read-only mode explains itself (v1.0.14)**: under `--share` the right
  button used to do *nothing* (the element menu silently refused to open) —
  now it answers with "Read-only mode (--share): comments are unavailable —
  run without --share to comment". Declared degradation, never silence. The
  share-mode behavior is now covered by the acceptance suite (12/12).
- **Version on screen (v1.0.13)**: the viewer now shows a small version tag
  bottom-right, and CI fails if it ever drifts from `package.json` — every
  report can say exactly which version is running (no more stale-tab
  ambiguity).
- **Resolved comments stay visible (v1.0.12)**: comments can no longer
  "disappear" — resolved ones were dropping out of the pending panel entirely
  (which then reads "nothing pending") while sitting greyed on screen. The
  panel now keeps a **Resolved (N)** section with one-click **Reopen**, and
  every resolve/reopen announces itself in a toast ("listed under Pending ›
  Resolved"). Locked by the acceptance suite (10/10).
- **The viewer updates itself + real-browser acceptance (v1.0.11)**: the
  viewer now watches its **own** file and reloads the tab automatically when
  it changes — fixes reach your screen without pressing F5 (this is why
  recent changes kept "not working": the tab was running old JS). New
  `npm run test:ui` acceptance suite (Edge/Chrome + `playwright-core`) runs
  the core workflow in a real browser — select, comment, right-click menu
  (list and flow mode), box selection, self-reload — 9/9 green.
- **Mouse contract, finally (v1.0.10)**: left selects (click or drag a
  selection box), the middle button pans, and the **right button opens the
  element menu** (💬/📋/🧩) — always. The right button had been turned into a
  pan gesture (and a post-gesture guard was swallowing the menu): both are
  gone; the right button is never a gesture now.
- **Rescue: per-file history + right button back (v1.0.9)**: while the server
  runs, every change to any `design/` file is recorded as a revision
  (`design/.history/`, newest 20 per file) and the new 🕘 **History** panel
  restores **exactly one file, one version** — nothing else in the system is
  touched (screens are independent; shared files restore whole; the view
  refreshes by itself; each restore is recorded as a new revision). Also:
  the right mouse button pans again (it was accidentally dropped in the
  interaction rework) and right-click still opens the element menu — without
  popping one after a pan drag.
- **Stuck click fix + quiet versioning (v1.0.8)**: releasing the mouse inside
  a screen iframe (or switching windows mid-drag) could lose the `pointerup`
  and leave the canvas "stuck" following the mouse — canvas gestures now tear
  down on `pointerup`/`pointercancel`/blur, are forwarded from inside screen
  iframes, and each new gesture heals any leftover one. Versioning goes
  quiet too: the 1.0.x era bumps the patch digit (older releases were
  renumbered to match — `v1.0.1`…`v1.0.7`).
- **Send comments straight to the agent (v1.0.7)**: commenting in the viewer
  now delivers the `[Design: …]` message directly into your OpenCode session
  — no more copy/paste. The overlay reports exactly what happened ("Sent to
  the agent — session: X"); when the agent is unreachable it honestly falls
  back to the clipboard copy. New `POST /api/agent-send` route (same
  localhost+token contract, 403 under `--share`) talks to the local OpenCode
  service and picks the project's newest session (creating one when needed).
- **Box selection + tool-like canvas (v1.0.6)**: drag on the empty canvas to
  box-select every screen the rectangle touches (Shift+click adds to the
  selection; clicking empty space clears; the PNG button exports the whole
  selection). The mouse behaves like in design tools: the middle button pans
  anywhere (over screens and inside flow mode), left-drag on a screen pans
  too, and drag-to-comment moved fully into 🎯 Element mode. Reloads keep
  you in place: the flow-mode ⟳ reloads the current screen (⟲ Reset flow
  restarts from the beginning), the list reload keeps zoom/pan, and F5
  returns to the same flow screen and history.
- **Live screen refresh (v1.0.5)**: the viewer now watches every screen HTML,
  `data.json` and the shared runtime (`mock.js`/`mock.css`,
  `design-system.css`, `utilities.css`) — a changed file refreshes only what
  changed (a single edited screen re-points its own iframe; the flow-mode
  frame refreshes too), so edits made by the agent appear without touching
  anything. `serve.mjs` now sends `Last-Modified` for cheap change detection,
  with a GET-hash fallback for older servers.
- **Sidebar navigation fix (v1.0.4)**: a screen link carrying `data-go` — the
  sidebar/menu pattern, with a real `href` kept as the JS-off fallback — used
  to open an overlay *and* navigate; now `data-go` routes cleanly to `Mock.go`
  (preserving `?scenario=` and the enter transition). The design skill now
  mandates the pattern for persistent navigation (sidebar/menu items switch
  screens for real; plain links stay the overlay/modal trigger) and
  `npm run test:mock` locks the navigation/overlay contracts.
- **Slash commands + OpenCode discovery fix (v1.0.3)**: `/design`, `/taste`,
  `/emil-design-eng` and `/impeccable` now exist as real slash commands —
  registered by the plugin from `commands/*.md` (one per skill) and installed
  by `install.mjs` into the OpenCode `commands/` folder. Skills alone are not
  slash commands in OpenCode v2 (`@design` mentions and auto-loading keep
  working). Also fixed the OpenCode global install path:
  `~/.config/opencode/skills` (plural — V2 never discovered the old singular
  `skill/` folder).
- **Viewer/docs i18n (v1.0.2)**: the viewer UI and `docs.html` speak English
  by default and follow the browser language (PT-BR included) — `?lang=pt` /
  `?lang=en` force it, the 🌐 button switches and keeps your place. Every
  string lives in one `I18N` dictionary (EN + PT, kept in sync by an
  automated check) and `docs.html` carries both languages side by side.
  `mock.js` error toasts follow the viewer language too.
- **Viewer for complex projects (v1.0.1)**: `"group"` blocks in `canvas.json`,
  ▦ Grade (wrapping overview), screen search (`/`), 📱 Moldura (device
  frames), lazy-loaded screens and screen-vs-screen in `Comparar` (A/B now
  accepts live screens, not just snapshots). `serve.mjs` opens the default
  browser at the viewer (`--open[=canvas]`, `--no-open`, `BROWSER` env) and
  the viewer hides actions the browser cannot do (`data-require` — declared
  degradation). Plus: unit tests in the CI, `CONTRIBUTING.md`, issue/PR
  templates and tag-driven releases (`v*` tag → GitHub release).
- **CI + plain-JS core (v1.0.0)**: GitHub Actions runs the smoke test, the
  installer, the validator and the security suite on Linux/Windows ×
  Node 18/20/22/24. The plugin's logic moved to `plugin/core.mjs` (plain JS),
  so `node plugin/smoke.mjs` now runs on stock Node 18. First tagged
  release: `v1.0.0`.
- **No console windows on Windows**: the auto-update `git` calls now spawn
  hidden (`windowsHide` / `CREATE_NO_WINDOW`) — opening a project no longer
  flashes a CMD window; everything else already ran in-process.
- **OpenCode v2 plugin (`plugin/`)**: Mockbird now runs as a self-updating
  OpenCode plugin — `git pull` at startup (10-minute throttle), skills
  registered straight from the repo (no copies) and automatic mirroring of
  each project's `design/` (changed files get a `<file>.bak`; `components/`
  is only filled in when missing). `/design-sync` command forces a sync.
  Migration path: register the cloned repo's `plugin/` folder in
  `~/.config/opencode/opencode.json` (`plugins`).
- **Default bind `127.0.0.1` + served root `./design`** (behavior changes):
  `node design/serve.mjs` only serves the local machine — the write API
  (`/api/*`) is never exposed to the network — and serves `./design` relative
  to the cwd (the same root the gen/sync/validate pipeline uses), never the
  script's own folder.
- **`--share` — migration path for phone/LAN testing**:
  `node design/serve.mjs 8766 --share` binds `0.0.0.0` so you can open
  `http://<machine-ip>:8766/viewer.html?canvas=…` on your phone. It is
  **read-only with declared degradation**: every `/api/*` route answers
  **403** (reads included — nothing leaks) and the viewer hides write actions
  **and** the `/api`-fed features (pins, pending comments panel,
  reply/resolve) with the banner "read-only mode — comments and snapshots
  unavailable".
- **Degradation contract (future)**: snapshot/comparison UIs arriving later
  must also stay hidden under `--share` — just mark them with
  `data-share-hide` in the HTML and the viewer's `syncShareDegradation()`
  hides them.
- **Snapshots, comparison and revert (w5)**: the viewer's **Snapshots** panel
  saves a canvas state (`src/` + flat `render/`), compares two states in
  **Side by side** and **Onion skin** modes and restores with the
  **"Revert to this snapshot"** button (with confirmation) — direct API use:
  `POST /api/revert {"canvas": "<canvas>", "label": "<label>"}` (400 =
  invalid manifest, nothing restored; 500 = pipeline failed, rollback).

## Credits and licenses

- `design` — Agent Skills port of the portable "design canvas" spec
  (originally for the Kio harness, `@kio/skill-design`), with the viewer
  written for this package. PNG export via
  [html-to-image](https://github.com/bubkoo/html-to-image) (MIT, vendored in
  `design/assets/vendor/`).
- `impeccable` — Paul Bakaus, Apache-2.0, https://impeccable.style
  ([pbakaus/impeccable](https://github.com/pbakaus/impeccable))
- `emil-design-eng` — Emil Kowalski, MIT
  ([emilkowalski/skills](https://github.com/emilkowalski/skills))
- `taste` — Leonxlnx, MIT
  ([Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill))
- Everything else in this repository: MIT (see [LICENSE](LICENSE)).

Each skill ships its own license file (`skills/<name>/LICENSE`), copied on
every install together with the skill.

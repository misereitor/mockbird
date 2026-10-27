# Contributing to Mockbird

Issues and pull requests are welcome. This file exists so you don't have to
guess the project's invariants — the CI enforces most of them.

## Development setup

- **Node.js 18+** — everything runs on stock Node, zero runtime dependencies.
- `cd plugin && npm install` only if you touch the plugin (its only dependency
  is `@opencode/plugin`).

```bash
npm run ci        # unit tests + mock contracts + smoke + validator + security + i18n
npm test          # plugin/core.test.mjs
npm run test:mock # mock.js navigation/overlay contracts (scripts/mock-check.mjs)
npm run test:ui   # real-browser acceptance (needs `npm i playwright-core`; Edge/Chrome)
npm run smoke     # plugin smoke (frontmatter, loadSkills, syncProject)
npm run validate  # validator against the example canvas
npm run security  # serve.mjs security suite (7 checks)
npm run check:i18n  # viewer dictionary + bilingual docs in sync
```

The CI runs exactly these on Linux/Windows × Node 18/20/22/24.

## Invariants (please keep these true)

1. **Mirror lists stay in sync.** The plugin's `MIRROR`/`SEED` lists
   (`plugin/core.mjs`) and the copy list in `skills/design/SKILL.md` must
   contain the same runtime files. If you add a runtime file to one side, add
   it to the other.
2. **The four skills install side by side.** `design`'s craft layer reads
   `../taste`, `../emil-design-eng` and `../impeccable` by relative path.
3. **`serve.mjs` security contract.** The write API (`/api/*`) is localhost +
   per-run token only; under `--share` every `/api/*` answers 403 and the
   viewer hides write/API-fed UI (`data-share-hide`). New UI fed by `/api`
   must carry `data-share-hide`. The security suite must stay green (7/7).
4. **Degradation over breakage.** Browser capability gaps hide the action
   (`data-require` + `CAPABILITIES` in the viewer), they never throw in the
   user's face. Same philosophy as `--share`.
5. **Node 18 compatibility.** No `import.meta.dirname`, no `toSorted`/
   `Object.groupBy`/other post-18 APIs in shipped scripts (browser code in
   the viewer may be modern; Node code may not).
6. **LF line endings** for text files (`.gitattributes` enforces it — don't
   fight it).
7. **License hygiene.** Each third-party skill ships its own
   `skills/<name>/LICENSE`; never remove or edit those. Original code is MIT.
8. **i18n.** Every user-visible string in
   `skills/design/assets/viewer.html` goes through the `I18N` dictionary
   (`t(key)` / `data-i18n*`), with EN and PT values kept in lockstep, and
   `docs.html` keeps its `data-lang="en"`/`data-lang="pt"` blocks in lockstep
   (same ids, working anchors). Never hardcode a UI literal in a single
   language — `npm run check:i18n` enforces all of this.
9. **One slash command per skill.** `commands/<skill>.md` must exist for
   every skill in `skills/<skill>/`, with a description and a template that
   forwards `$ARGUMENTS` and names its skill. Skills are not slash commands
   in OpenCode v2 — these files (plus the plugin's `ctx.command.transform`)
   are what makes `/design` work. `npm test` enforces the pairing.

## Testing changes

- Touching `validate.mjs`? Run the validator against
  `skills/design/assets/example/` and add a fixture under
  `skills/design/scripts/fixtures/` for the rule you changed.
- Touching `serve.mjs`? Extend the security suite with a check for the new
  behavior — especially anything under `/api/*`.
- Touching `plugin/core.mjs`? Add a unit test in `plugin/core.test.mjs`.
- Touching the viewer? It is plain HTML/JS with no build step — keep it that
  way (zero dependencies, no CDN).

## Versioning

Keep it quiet. The project is in its **1.0.x** era: bump the **patch** digit
(`1.0.7` → `1.0.8`) for fixes and incremental improvements — including small
features. Bump the minor digit only when the project genuinely steps up.
No marketing-style version inflation; the owner will call it out.

## Pull requests

- Keep PRs focused; describe *what* changed and *why*.
- Update the docs when behavior changes: `README.md`, `README.pt-BR.md`
  (keep both in sync) and `skills/design/SKILL.md` when the workflow changes.
- Add a `## Changelog` entry in the READMEs.

By contributing you agree that your contributions are licensed under the MIT
License of this repository.

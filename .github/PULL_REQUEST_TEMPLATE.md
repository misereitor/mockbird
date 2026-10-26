## What changed

<!-- Describe the change and the motivation. -->

## Checklist

- [ ] `npm run ci` passes locally
- [ ] Mirror lists kept in sync (`plugin/core.mjs` ↔ `skills/design/SKILL.md` copy list)
- [ ] `serve.mjs` security contract respected (`/api/*` localhost+token; `--share` read-only with `data-share-hide`)
- [ ] Node 18 compatible (no post-18 APIs in shipped Node scripts)
- [ ] Docs updated: `README.md` + `README.pt-BR.md` (in sync) and `skills/design/SKILL.md` if the workflow changed
- [ ] `## Changelog` entry added

/* mockbird:config-driven:v2 */
/**
 * spec-undeclared (todo 18, GAP-8) — every screen must DECLARE at least one
 * screen state (plan: "Regra: toda tela declara >=1 state"). States are
 * declared via `<!-- state:nome -->` markers or in-page hash shortcuts
 * `href="#nome"` (the `#estado` mechanism); CSS pseudo-classes are never
 * declarations ("state = estados declarados, nao hover/active CSS").
 *
 * Detection is the export-spec.mjs single implementation, imported here
 * (`detectScreenStates`) - ONE state-detection implementation, no duplicated
 * heuristics. export-spec.mjs is import-safe (its CLI entry point is
 * main-guarded). The state contract is therefore identical at export time
 * and at validate time; the fixture pair ok/spec-declared (green) x
 * bad/spec-undeclared (spec-undeclared, exit 1) covers both surfaces.
 *
 * One line per offending screen, citing the screen path + screen name,
 * emitted EXACTLY once per screen in any capture (see reportOnce below):
 *   spec-undeclared  the screen declares zero states
 *   spec-state       an invalid state marker name (kebab-case only) - the
 *                    same contract export-spec.mjs enforces on its run
 * Screens whose file is missing/unreadable are skipped (validate.mjs owns
 * input reporting). Unparseable canvas.json manifests are skipped exactly
 * like rules/canvas-meta.mjs (invalid-json is validate.mjs's job). Rules are
 * standalone (loadRules() imports every *.mjs in rules/ as a rule, so no
 * shared helper FILE can live here - the shared state detection lives in
 * export-spec.mjs and is imported by this rule).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectScreenStates } from '../export-spec.mjs'

export const id = 'spec-undeclared'

export function run(ctx) {
  for (const { dir, manifest } of discoverManifests(ctx)) {
    const screens = Array.isArray(manifest.screens) ? manifest.screens : []
    for (const screen of screens) {
      if (!isPlainObject(screen)) continue
      const file = typeof screen.file === 'string' && screen.file.length > 0 ? screen.file : null
      if (file === null) continue
      const abs = join(dir, file)
      let html = null
      try {
        html = readFileSync(abs, 'utf8')
      } catch {
        continue // missing/unreadable screen file = validate.mjs's input reporting
      }
      const name =
        typeof screen.name === 'string' && screen.name.length > 0
          ? screen.name
          : typeof screen.id === 'string' && screen.id.length > 0
            ? screen.id
            : file
      const label = `${ctx.relLabel(ctx.rootDir, abs)}: screen "${name}"`
      const { states, invalid } = detectScreenStates(html)
      for (const bad of invalid) {
        reportOnce(ctx, 'spec-state', `${label}: invalid state marker name ${JSON.stringify(bad)} (expected kebab-case, e.g. <!-- state:vazio -->)`)
      }
      if (states.length === 0) {
        reportOnce(ctx, 'spec-undeclared', `${label}: declares no screen state - declare at least one via <!-- state:nome --> or a hash shortcut href="#nome"`)
      }
    }
  }
}

/**
 * reportOnce - emit each screen's report EXACTLY ONCE in any capture.
 *
 * validate.mjs's runRules ruleFail contract routes every rule problem twice:
 * `problems.push(line)` (the pinned stdout "Fix these issues:" block) AND
 * `console.error(line)` (the stderr echo). In a merged `2>&1` capture every
 * rules/ module's line therefore appears twice (verified: bad/data-ref-missing
 * and bad/m-unknown double the same way) - it is NOT a per-rule double visit:
 * this run() visits each screen once and calls fail once. The plan requires
 * the spec-undeclared line EXACTLY once per screen in any capture, while
 * validate.mjs stays untouched and other rules' output stays byte-identical.
 * So this wrapper suppresses ONLY this rule's stderr echo around the ctx.fail
 * call: the line still lands in the stdout block via problems.push.
 */
function reportOnce(ctx, code, message) {
  const echo = console.error
  console.error = () => {}
  try {
    ctx.fail(code, message)
  } finally {
    console.error = echo
  }
}

/** Every canvas.json under the validated root (exemptDirs skipped - the
 * snapshots/ copies of manifests are inert). Same discovery contract as
 * rules/canvas-meta.mjs: rules are standalone modules (loadRules() imports
 * every *.mjs in rules/ as a rule, so no shared helper can live there). */
function discoverManifests(ctx) {
  const out = []
  const exempt = new Set(
    Array.isArray(ctx.config?.exemptDirs) ? ctx.config.exemptDirs.filter((d) => typeof d === 'string') : [],
  )
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {}
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isDirectory() && !exempt.has(entry.name)) walk(join(dir, entry.name))
    }
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'canvas.json'), 'utf8'))
    } catch {}
    if (isPlainObject(manifest)) out.push({ dir, manifest })
  }
  walk(ctx.rootDir)
  return out
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

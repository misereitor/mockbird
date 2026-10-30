/* mockbird:config-driven:v2 */
/**
 * a11y (todo 9, GAP-9) — template-level accessibility contract for the
 * overlay/toast component families. Registered with validate.mjs's loadRules()
 * via { id, run } (todo 2 contract — ZERO loader edits). Two checks, both over
 * the component TEMPLATES in <root>/components/*.html (the exact surface the
 * runtime consumes; screens are covered behaviorally by scripts/mock-check.mjs):
 *
 *   a11y-no-autofocus  an overlay/dialog template must declare [data-autofocus]
 *                      — the initial focus target Mock.overlay looks for when
 *                      it opens the screen (fallback there: first heading).
 *   a11y-toast-no-live a toast template must reference a live region
 *                      (`data-live` or `aria-live`) — the announcement hook
 *                      behind Mock.toast's #mock-live region. role="status" is
 *                      NOT accepted: the contract pins the two literal hooks.
 *
 * Kind detection is deterministic (no config): a template is an OVERLAY when
 * its file/registry id matches /modal|overlay|dialog|drawer/ OR its HTML
 * declares role="dialog"/role="alertdialog"/aria-modal; a template is a TOAST
 * when its file/registry id matches /toast/ OR its HTML carries the runtime
 * toast class "mock-toast". Anything else (button/card/…) is out of scope.
 *
 * Absence policy mirrors the component checks in validate.mjs: no components/
 * directory = skipped entirely. components/components.json is optional and
 * only supplies the registry id used in the messages and detection; an
 * unparseable registry falls back to the file stem (validate.mjs already
 * reports invalid-json itself). Output is deterministic (sorted walk, no
 * timestamps) — qa.mjs's 10-run stability (R3) must stay byte-identical.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const id = 'a11y'

const OVERLAY_NAME = /modal|overlay|dialog|drawer/i
const TOAST_NAME = /toast/i
const DIALOG_RE = /\brole\s*=\s*["'](?:alert)?dialog["']|\baria-modal\b/i
const TOAST_MARK = /\bmock-toast\b/i
const AUTOFOCUS_RE = /\bdata-autofocus\b/
const LIVE_RE = /\bdata-live\b|\baria-live\b/

export function run(ctx) {
  const dir = join(ctx.rootDir, 'components')
  let st = null
  try {
    st = statSync(dir)
  } catch {
    return // absence policy: no components/ dir = no component templates to check
  }
  if (!st.isDirectory()) return
  const registry = readRegistry(dir)
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const name of files) {
    const full = join(dir, name)
    let html = ''
    try {
      html = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const stem = name.replace(/\.html?$/i, '')
    const idByName = registry[name] ?? stem
    const label = ctx.relLabel(ctx.rootDir, full)
    const isOverlay = OVERLAY_NAME.test(stem) || OVERLAY_NAME.test(idByName) || DIALOG_RE.test(html)
    const isToast = TOAST_NAME.test(stem) || TOAST_NAME.test(idByName) || TOAST_MARK.test(html)
    if (isOverlay && !AUTOFOCUS_RE.test(html)) {
      ctx.fail(
        'a11y-no-autofocus',
        `${label}: overlay component "${idByName}" template must declare [data-autofocus] (initial focus target when Mock.overlay opens the screen)`,
      )
    }
    if (isToast && !LIVE_RE.test(html)) {
      ctx.fail(
        'a11y-toast-no-live',
        `${label}: toast component "${idByName}" template must reference a live region (data-live or aria-live) (announcement hook for Mock.toast / #mock-live)`,
      )
    }
  }
}

/** file -> registry id from components/components.json (optional). An
 * unparseable or wrong-shaped registry degrades to file-stem detection. */
function readRegistry(dir) {
  const byFile = {}
  let raw = null
  try {
    raw = readFileSync(join(dir, 'components.json'), 'utf8')
  } catch {
    return byFile // absence policy: no registry = stem-based names only
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return byFile
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return byFile
  for (const entry of Object.values(parsed)) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.file !== 'string') continue
    byFile[entry.file] = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : entry.file.replace(/\.html?$/i, '')
  }
  return byFile
}

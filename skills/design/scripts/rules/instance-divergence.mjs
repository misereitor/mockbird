/* mockbird:config-driven:v2 */
/**
 * instance-divergence (todo 15, GAP-5) — the zero-unknown `.m-*` gate
 * (§13.2 criterion 4, §3.1 drift). Registered with validate.mjs's loadRules()
 * via { id, run } (append-only extension point — ZERO loader edits).
 * Config-driven (classes.allow from validate.config.json — never hardcoded).
 * Per non-exempt HTML file under the validated root (exemptDirs and
 * exemptFiles skipped; the root's components/ tree is the registry-template
 * universe, not instance markup, and is excluded from the scan):
 *
 *   m-unknown            a `.m-*` class token used in instance markup that
 *                        exists in NO registry template (components/) fails —
 *                        every `.m-*` class of a screen/instance must come
 *                        from the registry templates (0 divergent .m-*; the
 *                        corpus's local .m-head/.m-input/.m-btn copies are
 *                        exactly what this rule makes impossible). The
 *                        message cites the class and the file.
 *   m-allowlist-nojust   every classes.allow item must carry a non-empty
 *                        { name, justification } — an allowlist item without
 *                        justification fails (the transient escape hatch must
 *                        justify itself; mirror of action-contract (c)).
 *
 * Allowlist semantics mirror action-contract (b)/(c) exactly: (nojust) runs
 * FIRST and rescue is presence-based — an item with a matching name rescues
 * the class from m-unknown regardless of its justification, so the two failure
 * modes never stack. Absence policy mirrors the component checks in
 * validate.mjs: no components/ directory = skipped entirely (there is no
 * registry-template universe to diverge from). components/components.json is
 * optional: the universe is the classes of the registry templates it names,
 * falling back to every components/*.html when the registry is absent or
 * unparseable (validate.mjs/sync-components.mjs already report that damage).
 *
 * The rule is standalone (loadRules() imports EVERY *.mjs in rules/ as a rule,
 * so no shared helper can live here) and its output is fully deterministic
 * (sorted walk, source order, no timestamps) — qa.mjs R3 10x stability.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const id = 'instance-divergence'

// Start tags only — comments/script/style consumed wholesale (same
// alternation contract as rules/metrics.mjs and validate.mjs's TAG_SCAN_RE).
const TAG_RE = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[a-zA-Z][^>]*>/g
const NON_TAG_RE = /^(?:<!--|<script|<style)/i
const M_CLASS_RE = /^m-/

export function run(ctx) {
  const cfg = ctx.config?.classes
  if (!isPlainObject(cfg)) {
    return ctx.fail('invalid-shape', 'validate.config.json: "classes" must be an object with "allow": a list of { name, justification } items')
  }
  const allowlist = cfg.allow === undefined ? [] : cfg.allow
  if (!Array.isArray(allowlist)) {
    return ctx.fail('invalid-shape', 'validate.config.json: "classes.allow" must be a list of { name, justification } items')
  }
  // (m-allowlist-nojust) runs FIRST so a broken allowlist can never silently
  // rescue a class. Presence-based: an item with a matching name rescues the
  // class in m-unknown regardless of its justification (action-contract (c)).
  const allowed = new Set()
  allowlist.forEach((item, index) => {
    const where = `validate.config.json: classes.allow[${index}]`
    if (!isPlainObject(item) || typeof item.name !== 'string' || item.name.length === 0) {
      return ctx.fail('invalid-shape', `${where}: item must be { name, justification } with a non-empty "name"`)
    }
    allowed.add(item.name)
    if (typeof item.justification !== 'string' || item.justification.trim().length === 0) {
      ctx.fail(
        'm-allowlist-nojust',
        `${where} (name "${item.name}"): allowlist item without justification (§3.1 — every divergent class must justify itself)`,
      )
    }
  })
  const universe = templateClasses(ctx)
  if (universe === null) return // absence policy: no components/ = nothing to diverge from
  for (const full of walkHtml(ctx)) {
    checkFile(ctx, full, universe, allowed)
  }
}

function checkFile(ctx, full, universe, allowed) {
  const label = ctx.relLabel(ctx.rootDir, full)
  let html = null
  try {
    html = readFileSync(full, 'utf8')
  } catch {
    return // unreadable file: validate.mjs already reports it
  }
  for (const { token, index } of classTokens(html)) {
    if (universe.has(token) || allowed.has(token)) continue
    ctx.fail(
      'm-unknown',
      `${label}:${lineOf(html, index)}: class "${token}" is not in the registry templates (components/) — ` +
        'add it to a template or justify it in classes.allow (zero .m-* divergence, §13.2 criterion 4)',
    )
  }
}

/** The `.m-*` class universe = class tokens of the registry templates under
 *  <root>/components/. components.json names the templates; absent or
 *  unparseable registry = every components/*.html (validate.mjs already
 *  reports the registry damage). No components/ dir = null (absence policy). */
function templateClasses(ctx) {
  const dir = join(ctx.rootDir, 'components')
  let st = null
  try {
    st = statSync(dir)
  } catch {
    return null
  }
  if (!st.isDirectory()) return null
  const out = new Set()
  for (const full of registryTemplates(dir)) {
    let text = null
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue // missing template: sync-components.mjs reports it
    }
    for (const token of classTokens(text)) out.add(token.token)
  }
  return out
}

/** Template files named by components/components.json (the registry
 *  templates); every components/*.html when the registry is absent or not a
 *  plain object. Sorted, deterministic. */
function registryTemplates(dir) {
  let registry = null
  try {
    registry = JSON.parse(readFileSync(join(dir, 'components.json'), 'utf8'))
  } catch {
    registry = null
  }
  if (isPlainObject(registry)) {
    const out = []
    for (const entry of Object.values(registry)) {
      if (!isPlainObject(entry) || typeof entry.template !== 'string' || entry.template.length === 0) continue
      out.push(join(dir, entry.template))
    }
    if (out.length > 0) return out
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => join(dir, name))
}

/** `.m-*` class tokens per start tag, source order (comments/script/style
 *  consumed by TAG_RE). Attribute names are lowercased (className included);
 *  values kept raw and split on whitespace. */
function classTokens(html) {
  const out = []
  for (const m of html.matchAll(TAG_RE)) {
    if (NON_TAG_RE.test(m[0])) continue
    for (const attr of parseAttrs(m[0])) {
      if (attr.name !== 'class' && attr.name !== 'classname') continue
      for (const token of attr.value.split(/\s+/)) {
        if (token !== '' && M_CLASS_RE.test(token)) out.push({ token, index: m.index })
      }
    }
  }
  return out
}

/** Attribute name/value pairs of one start tag (quoted or unquoted values,
 *  names lowercased, values RAW — deterministic). The tag name itself is
 *  skipped. Same contract as rules/action-contract.mjs. */
function parseAttrs(tag) {
  const out = []
  const body = tag.replace(/^<[a-zA-Z][a-zA-Z0-9-]*/, '')
  for (const m of body.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' })
  }
  return out
}

/** Every non-exempt .html under the validated root except the root's own
 *  components/ tree (the registry templates are the universe, not instances).
 *  Sorted, deterministic — same discovery contract as rules/action-contract.mjs. */
function walkHtml(ctx) {
  const out = []
  const exemptDirs = new Set(
    Array.isArray(ctx.config?.exemptDirs) ? ctx.config.exemptDirs.filter((d) => typeof d === 'string') : [],
  )
  const exemptFiles = new Set(
    Array.isArray(ctx.config?.exemptFiles) ? ctx.config.exemptFiles.filter((f) => typeof f === 'string') : [],
  )
  const walk = (dir, atRoot) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (atRoot && entry.name === 'components') continue // template universe, not instances
        if (!exemptDirs.has(entry.name)) walk(join(dir, entry.name), false)
        continue
      }
      if (!entry.isFile() || !/\.html$/i.test(entry.name)) continue
      if (exemptFiles.has(entry.name)) continue
      out.push(join(dir, entry.name))
    }
  }
  walk(ctx.rootDir, true)
  return out
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

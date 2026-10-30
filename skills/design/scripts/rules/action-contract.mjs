/* mockbird:config-driven:v2 */
/**
 * action-contract (todo 7, GAP-4) — the data-action contract detector
 * (§13.2 R3/R4, §14.3.1). Registered with validate.mjs's loadRules() via
 * { id, run } (append-only extension point — ZERO loader edits). Config-driven
 * (actions.namespacePattern / actions.allowLegacy from validate.config.json —
 * never hardcoded). Per HTML file under the validated root (exemptDirs and
 * exemptFiles skipped; comments, <script> and <style> bodies are consumed
 * wholesale — the same start-tag contract as rules/metrics.mjs — so JS strings
 * can never masquerade as markup):
 *   (a) action-both  an element carrying BOTH an on* attribute and data-action
 *                    fails — the PERMANENT detector (R3 §13.2). The mock.js
 *                    onclick guard is transitional and would silently win over
 *                    the action, so the mix is never allowed (todo 7 retains
 *                    the guard; this rule is what keeps it honest).
 *   (b) action-flat  a data-action value outside actions.namespacePattern AND
 *                    outside actions.allowLegacy fails (§14.3.1: flat names
 *                    are transitional and allowlist-only; the allowlist is
 *                    emptied when the client corpus migration closes).
 *   (c) action-allowlist-nojust  every actions.allowLegacy item must carry a
 *                    non-empty { name, justification } — an allowlist item
 *                    without justification fails.
 *   (d) action-js-line  in a file that carries data-action, any JS line inside
 *                    an on* attribute longer than 80 characters fails (§13.2
 *                    criterion 3 — big embedded handler detector).
 *
 * Scope note on (d), recorded in the task evidence: the detector applies to
 * FILES THAT CARRY data-action (the migration surface). The repo's example
 * corpus still holds two transitional inline handlers (81 and 90 chars) that
 * the frozen metrics baseline (todo 3) pins and no todo migrates; an unscoped
 * (d) would fail every validate run and break the "npm run ci green"
 * acceptance of this and every later todo. Files that have not adopted
 * data-action are covered by the metrics-regression baseline instead.
 *
 * The rule is standalone (loadRules() imports EVERY *.mjs in rules/ as a rule,
 * so no shared helper can live here) and its output is fully deterministic
 * (sorted walk, source order, no timestamps) — qa.mjs R3 10x stability.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const id = 'action-contract'

const JS_LINE_MAX = 80
const CITE_MAX = 80
// Start tags only — comments/script/style consumed wholesale (same
// alternation contract as rules/metrics.mjs and validate.mjs's TAG_SCAN_RE).
const TAG_RE = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[a-zA-Z][^>]*>/g
const NON_TAG_RE = /^(?:<!--|<script|<style)/i
const ON_ATTR_RE = /^on[a-z]+$/

export function run(ctx) {
  const cfg = ctx.config?.actions
  if (!isPlainObject(cfg) || typeof cfg.namespacePattern !== 'string' || cfg.namespacePattern.length === 0) {
    return ctx.fail('action-contract', 'validate.config.json: "actions.namespacePattern" must be a non-empty string')
  }
  let pattern = null
  try {
    pattern = new RegExp(cfg.namespacePattern)
  } catch (error) {
    return ctx.fail('action-contract', `validate.config.json: "actions.namespacePattern" is not a valid regular expression (${String(error?.message ?? error)})`)
  }
  const allowlist = cfg.allowLegacy === undefined ? [] : cfg.allowLegacy
  if (!Array.isArray(allowlist)) {
    return ctx.fail('action-contract', 'validate.config.json: "actions.allowLegacy" must be a list of { name, justification } items')
  }
  // (c) runs FIRST so a broken allowlist can never silently rescue a name.
  // Presence-based: an item with a matching name rescues the name in (b)
  // regardless of its justification — the two failure modes never stack.
  const allowed = new Set()
  allowlist.forEach((item, index) => {
    const where = `validate.config.json: actions.allowLegacy[${index}]`
    if (!isPlainObject(item) || typeof item.name !== 'string' || item.name.length === 0) {
      return ctx.fail('action-contract', `${where}: item must be { name, justification } with a non-empty "name"`)
    }
    allowed.add(item.name)
    if (typeof item.justification !== 'string' || item.justification.trim().length === 0) {
      ctx.fail('action-contract', `${where} (name "${item.name}"): allowlist item without justification (§14.3.1 — every legacy name must justify itself)`)
    }
  })
  for (const full of walkHtml(ctx)) {
    checkFile(ctx, full, pattern, allowed)
  }
}

function checkFile(ctx, full, pattern, allowed) {
  const label = ctx.relLabel(ctx.rootDir, full)
  let html = null
  try {
    html = readFileSync(full, 'utf8')
  } catch {
    return // unreadable file: validate.mjs already reports it
  }
  const tags = []
  for (const m of html.matchAll(TAG_RE)) {
    if (NON_TAG_RE.test(m[0])) continue
    tags.push({ text: m[0], index: m.index, attrs: parseAttrs(m[0]) })
  }
  const usesAction = tags.some((tag) => tag.attrs.some((attr) => attr.name === 'data-action'))
  for (const tag of tags) {
    const where = `${label}:${lineOf(html, tag.index)}`
    const cite = tag.text.replace(/\s+/g, ' ').trim().slice(0, CITE_MAX)
    const onAttrs = tag.attrs.filter((attr) => ON_ATTR_RE.test(attr.name))
    const action = tag.attrs.find((attr) => attr.name === 'data-action')

    // (a) permanent detector: on* and data-action on the same element.
    if (action !== undefined && onAttrs.length > 0) {
      ctx.fail(
        'action-contract',
        `${where}: element ${cite} mixes ${onAttrs.map((attr) => attr.name).join(', ')} with data-action — ` +
          'the transitional onclick guard would silently win (R3 §13.2); move the handler into the action module',
      )
    }

    // (b) naming: "<namespace>.<action>" per actions.namespacePattern, flat
    // names only through actions.allowLegacy (§14.3.1).
    if (action !== undefined && !pattern.test(action.value) && !allowed.has(action.value)) {
      ctx.fail(
        'action-contract',
        `${where}: data-action ${JSON.stringify(action.value)} on ${cite} must match actions.namespacePattern ` +
          'or be listed in actions.allowLegacy (§14.3.1 — flat names are transitional)',
      )
    }

    // (d) big embedded handler detector — files that carry data-action must
    // not keep giant JS lines inside inline handler attributes.
    if (usesAction) {
      for (const attr of onAttrs) {
        for (const line of attr.value.split('\n')) {
          const length = line.trim().length
          if (length > JS_LINE_MAX) {
            ctx.fail(
              'action-contract',
              `${where}: ${attr.name} holds a JS line of ${length} chars (> ${JS_LINE_MAX}) on ${cite} — ` +
                '§13.2 criterion 3: move the handler into the action module',
            )
          }
        }
      }
    }
  }
}

/** Attribute name/value pairs of one start tag (quoted or unquoted values,
 *  names lowercased, values RAW — the checks are name/length based and must
 *  stay deterministic). The tag name itself is skipped. */
function parseAttrs(tag) {
  const out = []
  const body = tag.replace(/^<[a-zA-Z][a-zA-Z0-9-]*/, '')
  for (const m of body.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' })
  }
  return out
}

/** Every non-exempt .html under the validated root (sorted, deterministic).
 *  Same discovery contract as rules/metrics.mjs: rules are standalone modules. */
function walkHtml(ctx) {
  const out = []
  const exemptDirs = new Set(
    Array.isArray(ctx.config?.exemptDirs) ? ctx.config.exemptDirs.filter((d) => typeof d === 'string') : [],
  )
  const exemptFiles = new Set(
    Array.isArray(ctx.config?.exemptFiles) ? ctx.config.exemptFiles.filter((f) => typeof f === 'string') : [],
  )
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!exemptDirs.has(entry.name)) walk(join(dir, entry.name))
        continue
      }
      if (!entry.isFile() || !/\.html$/i.test(entry.name)) continue
      if (exemptFiles.has(entry.name)) continue
      out.push(join(dir, entry.name))
    }
  }
  walk(ctx.rootDir)
  return out
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

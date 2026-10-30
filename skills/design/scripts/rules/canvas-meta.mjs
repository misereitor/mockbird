/* mockbird:config-driven:v2 */
/**
 * canvas-meta (todo 3, GAP-3) — device × width coherence for every screen of
 * every canvas.json under the validated root. Breakpoints come from
 * validate.config.json (`canvasMeta.breakpoints` = { mobileMax, tabletMax },
 * aligned with todo 19) — NEVER hardcoded:
 *   device "mobile"  -> width <= mobileMax
 *   device "tablet"  -> mobileMax < width < tabletMax
 *   device "desktop" -> width >= tabletMax
 * Rules:
 *   - width/height are BOTH required when "device" is declared (a missing
 *     dimension fails: there is nothing to coerce against the breakpoints);
 *   - non-numeric width/height and unknown device names fail deterministically
 *     (one line each, never a crash).
 * Screens without "device" are out of scope (nothing to coerce). Unparseable
 * canvas.json files are skipped — validate.mjs already reports invalid-json.
 * Every failure line cites the screen + device + width (acceptance (d)).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const id = 'canvas-meta'

const DEVICES = new Set(['mobile', 'tablet', 'desktop'])

export function run(ctx) {
  const cfg = ctx.config?.canvasMeta
  const bp = isPlainObject(cfg) ? cfg.breakpoints : undefined
  if (!isPlainObject(bp) || !Number.isFinite(bp.mobileMax) || !Number.isFinite(bp.tabletMax) || !(bp.mobileMax < bp.tabletMax)) {
    return ctx.fail(
      'invalid-shape',
      'validate.config.json: "canvasMeta.breakpoints" must be { "mobileMax": <number>, "tabletMax": <number> } with mobileMax < tabletMax',
    )
  }
  for (const { dir, manifest } of discoverManifests(ctx)) {
    const label = ctx.relLabel(ctx.rootDir, join(dir, 'canvas.json'))
    const screens = Array.isArray(manifest.screens) ? manifest.screens : []
    for (const [index, screen] of screens.entries()) {
      checkScreen(ctx, label, screen, index, bp)
    }
  }
}

function checkScreen(ctx, label, screen, index, bp) {
  if (!isPlainObject(screen)) return // shape is validate.mjs's job
  if (screen.device === undefined) return // no device = nothing to coerce
  const id = typeof screen.id === 'string' && screen.id.length > 0 ? screen.id : `#${index + 1}`
  const where = `${label}: screen "${id}"`
  const device = screen.device
  if (typeof device !== 'string' || !DEVICES.has(device)) {
    return ctx.fail('canvas-meta', `${where}: device ${JSON.stringify(device)} is not mobile|tablet|desktop`)
  }
  const missing = ['width', 'height'].filter((key) => screen[key] === undefined)
  if (missing.length > 0) {
    return ctx.fail('canvas-meta', `${where}: device "${device}" declared but ${missing.join('/')} missing (width and height are both required)`)
  }
  const { width, height } = screen
  for (const [key, value] of [['width', width], ['height', height]]) {
    if (!Number.isFinite(value)) {
      return ctx.fail('canvas-meta', `${where}: ${key} must be a number (got ${JSON.stringify(value)})`)
    }
  }
  const detail = `canvasMeta.breakpoints (mobileMax=${bp.mobileMax}, tabletMax=${bp.tabletMax})`
  if (device === 'mobile' && width > bp.mobileMax) {
    ctx.fail('canvas-meta', `${where}: device "mobile" requires width <= ${bp.mobileMax} per ${detail} but got width ${width} (height ${height})`)
  } else if (device === 'tablet' && !(width > bp.mobileMax && width < bp.tabletMax)) {
    ctx.fail('canvas-meta', `${where}: device "tablet" requires ${bp.mobileMax} < width < ${bp.tabletMax} per ${detail} but got width ${width} (height ${height})`)
  } else if (device === 'desktop' && width < bp.tabletMax) {
    ctx.fail('canvas-meta', `${where}: device "desktop" requires width >= ${bp.tabletMax} per ${detail} but got width ${width} (height ${height})`)
  }
}

/** Every canvas.json under the validated root (exemptDirs skipped — the
 * snapshots/ copies of manifests are inert). Same discovery contract as
 * rules/metrics.mjs: rules are standalone modules (loadRules() imports every
 * *.mjs in rules/ as a rule, so no shared helper can live there). */
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

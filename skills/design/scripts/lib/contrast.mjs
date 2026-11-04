/**
 * contrast.mjs — WCAG 2.x contrast math shared by the design tooling.
 *
 * The core trio (parseColorLiteral, relativeLuminance, contrastRatio) is a
 * LIFT-AND-SHIFT extracted verbatim from validate.mjs:326-421 (plan todo 11:
 * "contraste WCAG (reaproveitar validate.mjs:326-421)"). validate.mjs keeps its
 * own copy untouched (task 11 may not modify product files outside its own);
 * this module is the single source the Visual Critic imports — a later refactor
 * can point validate.mjs here without behavior change (the math is identical).
 *
 * The additions below (marked ADDITION) are NOT in validate.mjs: alpha-aware
 * parsing and compositing, needed because the critic measures COMPUTED styles
 * (rgba backgrounds stacked over ancestors) instead of token literals.
 *
 * Exports:
 *   parseColorLiteral(value)        -> [r, g, b] | null   (verbatim)
 *   relativeLuminance([r, g, b])    -> number             (verbatim)
 *   contrastRatio(a, b)             -> number >= 1        (verbatim)
 *   parseColorWithAlpha(value)      -> [r, g, b, a] | null        (ADDITION)
 *   compositeOver(fg, bg)           -> [r, g, b]                  (ADDITION)
 *   effectiveBackground(stack)      -> [r, g, b]                  (ADDITION)
 *   contrastForText(fg, bgStack)    -> number                    (ADDITION)
 *
 * Zero external imports (node-free pure functions).
 */

/** Verbatim from validate.mjs:333-350. */
export function parseColorLiteral(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
    return parts.slice(0, 3)
  }
  return null
}

/** Verbatim from validate.mjs:364-370. */
export function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Verbatim from validate.mjs:372-376. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ---------------------------------------------------------------------------
// ADDITION — alpha-aware helpers for computed-style measurement (todo 11).
// ---------------------------------------------------------------------------

/** #hex(3/4/6/8), rgb()/rgba() -> [r, g, b, a] with a defaulting to 1. */
export function parseColorWithAlpha(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null
    const a = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1
    return [parts[0], parts[1], parts[2], a]
  }
  return null
}

/** Source-over composite of an rgba foreground over an opaque rgb background. */
export function compositeOver(fg, bg) {
  const [fr, fg_, fb, fa] = fg
  const [br, bg_, bb] = bg
  const a = Math.min(1, Math.max(0, fa))
  return [fr * a + br * (1 - a), fg_ * a + bg_ * (1 - a), fb * a + bb * (1 - a)]
}

/**
 * Resolve a stack of rgba layers (top first) over an opaque base color to the
 * single visible rgb triple. Alpha-0 layers are skipped; layers below the
 * first fully opaque layer no longer contribute.
 */
export function effectiveBackground(stack, base = [255, 255, 255]) {
  // Stack is top-first: fold it bottom-up so the topmost layer composites last.
  let out = base
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const layer = stack[i]
    if (!layer) continue
    out = compositeOver([layer[0], layer[1], layer[2], layer[3]], out)
  }
  return out
}

/**
 * Contrast ratio between an rgba text color and a stack of rgba background
 * layers (top first). Returns the WCAG 2.x ratio using the verbatim math above.
 */
export function contrastForText(fg, bgStack) {
  const bg = effectiveBackground(bgStack)
  const composed = compositeOver(fg, bg)
  return contrastRatio(composed, bg)
}

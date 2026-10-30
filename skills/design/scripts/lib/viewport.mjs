/**
 * viewport.mjs — the SINGLE viewport truth (todo 16, GAP-6): a pure lib that
 * derives a screen's viewport from its canvas.json entry. The smoke (todo 17)
 * emulates devices with these dimensions and must NEVER hardcode viewports.
 *
 * deriveViewport(canvasMeta, breakpoints) -> { width, height }
 *   canvasMeta   a screen entry of `<canvas>/canvas.json` (`device`/`width`/
 *                `height` — the literals frozen by todo 3, e.g. 390x844
 *                mobile / 768x1024 tablet);
 *   breakpoints  `validate.config.json` `canvasMeta.breakpoints`
 *                ({ mobileMax, tabletMax }) — config-driven, NEVER hardcoded.
 *
 * The canvas-meta rule (rules/canvas-meta.mjs, todo 3) already fails an
 * incoherent canvas.json BEFORE any smoke run ("derivation never receives
 * incoherent data"); this lib re-asserts the same device x width coherence
 * (mobile: width <= mobileMax; tablet: mobileMax < width < tabletMax;
 * desktop: width >= tabletMax) so it stays safe to consume standalone.
 *
 * Pure module: no fs, no side effects, no config discovery. Invalid input
 * throws a single guided Error line citing the screen (misleading-success
 * rule: never return a made-up viewport).
 */

/** deriveViewport — see the module docblock for the contract. */
export function deriveViewport(canvasMeta, breakpoints) {
  const where = describeScreen(canvasMeta)
  if (!isPlainObject(canvasMeta)) {
    throw new Error(`${where}: screen entry must be an object from a canvas.json "screens" list`)
  }
  if (!isPlainObject(breakpoints) || !Number.isFinite(breakpoints.mobileMax) || !Number.isFinite(breakpoints.tabletMax) || !(breakpoints.mobileMax < breakpoints.tabletMax)) {
    throw new Error(`${where}: breakpoints must be { "mobileMax": <number>, "tabletMax": <number> } with mobileMax < tabletMax (validate.config.json "canvasMeta.breakpoints")`)
  }
  const missing = ['width', 'height'].filter((key) => canvasMeta[key] === undefined)
  if (missing.length > 0) {
    throw new Error(`${where}: cannot derive the viewport — ${missing.join('/')} missing in the canvas.json entry (width and height are both required)`)
  }
  const { width, height } = canvasMeta
  for (const [key, value] of [['width', width], ['height', height]]) {
    if (!Number.isFinite(value)) {
      throw new Error(`${where}: cannot derive the viewport — ${key} must be a number (got ${JSON.stringify(value)})`)
    }
  }
  const device = canvasMeta.device
  if (device !== undefined) {
    const detail = `canvasMeta.breakpoints (mobileMax=${breakpoints.mobileMax}, tabletMax=${breakpoints.tabletMax})`
    if (device === 'mobile' && width > breakpoints.mobileMax) {
      throw new Error(`${where}: device "mobile" requires width <= ${breakpoints.mobileMax} per ${detail} but got width ${width} (height ${height})`)
    } else if (device === 'tablet' && !(width > breakpoints.mobileMax && width < breakpoints.tabletMax)) {
      throw new Error(`${where}: device "tablet" requires ${breakpoints.mobileMax} < width < ${breakpoints.tabletMax} per ${detail} but got width ${width} (height ${height})`)
    } else if (device === 'desktop' && width < breakpoints.tabletMax) {
      throw new Error(`${where}: device "desktop" requires width >= ${breakpoints.tabletMax} per ${detail} but got width ${width} (height ${height})`)
    } else if (device !== 'mobile' && device !== 'tablet' && device !== 'desktop') {
      throw new Error(`${where}: device ${JSON.stringify(device)} is not mobile|tablet|desktop`)
    }
  }
  return { width, height }
}

function describeScreen(canvasMeta) {
  const id = isPlainObject(canvasMeta) && typeof canvasMeta.id === 'string' && canvasMeta.id.length > 0 ? canvasMeta.id : null
  const file = isPlainObject(canvasMeta) && typeof canvasMeta.file === 'string' ? canvasMeta.file : null
  return `screen "${id ?? file ?? '?'}"`
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

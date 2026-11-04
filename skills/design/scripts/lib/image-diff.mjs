/**
 * image-diff.mjs — the shared visual diff library (plan todo 10, GAP-A1):
 * PNG decoding + pixel diff extracted from smoke.mjs (the smoke consumes this
 * module now) plus a combined {pixelRatio, ssim} diff with per-platform
 * thresholds. The decoder and pixelDiff are a LIFT-AND-SHIFT — the math is
 * byte-identical to the smoke's original hand-rolled implementation (only a
 * truncation guard was added so corrupt PNG bytes fail loudly instead of
 * diffing as silent garbage).
 *
 * Exports:
 *   decodePng(buffer) -> { width, height, channels, pixels }
 *       8-bit RGB/RGBA non-interlaced PNG (chromium screenshots) — anything
 *       else throws one guided Error line ('not a PNG' / 'png nao suportado').
 *   pixelDiff(base, current) -> { differing, ratio } | { sizeMismatch: [bw, bh, cw, ch] }
 *       per-pixel RGBA diff (missing alpha counts as 255).
 *   diffRatio(base, current) -> number in [0, 1]
 *       differing-pixel ratio; dims must match (throws on sizeMismatch).
 *   combinedDiff(base, current) -> { pixelRatio, ssim, differing } | { sizeMismatch }
 *       pixel ratio + structural similarity (lib/ssim.mjs) in one pass.
 *   loadThresholds(path?) -> thresholds
 *       thresholds loaded from design/visual-thresholds.json (DEFAULT_       THRESHOLDS_PATH, cwd-relative) keyed by platform (linux/darwin/win32);
 *       a missing file falls back to DEFAULT_THRESHOLDS (documented below), a
 *       malformed one throws a guided Error. The file EXTENDS the snapshots/       threshold.json format ({ maxDiffPixelRatio }) — that key stays valid at
 *       the root and is never replaced.
 *   thresholdsForPlatform(thresholds?, platform?) -> { maxDiffPixelRatio, minSsim }
 *       per-platform limits; an unknown runtime platform falls back to linux
 *       (the reference platform of this repo — the CI runner).
 *   withinThresholds(diff, limits) -> { pass, pixelRatioOk, ssimOk }
 *       gate semantics (todo 12): pass = pixelRatio <= maxDiffPixelRatio AND
 *       ssim >= minSsim — the ONLY diff-based blocking rule.
 *
 * Defaults (identical in DEFAULT_THRESHOLDS and design/visual-thresholds.json):
 *   linux   maxDiffPixelRatio 0.02, minSsim 0.98 — reference platform, aligned
 *           with the shipped validate.config.json smoke.snapshotThreshold 0.02;
 *   darwin  maxDiffPixelRatio 0.03, minSsim 0.97 — looser: macOS font hinting
 *           and antialiasing shift glyph rasterization vs linux;
 *   win32   maxDiffPixelRatio 0.05, minSsim 0.95 — looser: ClearType/gamma
 *           make windows screenshots the least stable of the three.
 *
 * Zero npm deps: node: builtins plus the sibling ./ssim.mjs (no external
 * imports — package.json keeps its single playwright-core devDependency).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { ssim } from './ssim.mjs'

// ---------- PNG decode + pixel diff (chromium screenshots: 8-bit RGB/RGBA) ----------

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let color = 0
  let interlace = 0
  const idat = []
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      color = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + length
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
    throw new Error(`png nao suportado (depth ${depth}, color ${color}, interlace ${interlace})`)
  }
  const channels = color === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  // truncation guard: a zlib-complete but short pixel stream (or a lying
  // IHDR height) must fail loudly — never diff as silent zero-filled rows.
  const expected = height * (stride + 1)
  if (raw.length < expected) {
    throw new Error(`png truncado (IDAT ${raw.length} bytes, esperado ${expected})`)
  }
  const pixels = Buffer.alloc(height * stride)
  let prev = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = y * (stride + 1) + 1
    const out = y * stride
    for (let x = 0; x < stride; x += 1) {
      const cur = raw[line + x]
      const a = x >= channels ? pixels[out + x - channels] : 0
      const b = y > 0 ? pixels[prev + x] : 0
      const c = y > 0 && x >= channels ? pixels[prev + x - channels] : 0
      let value
      if (filter === 0) value = cur
      else if (filter === 1) value = cur + a
      else if (filter === 2) value = cur + b
      else if (filter === 3) value = cur + ((a + b) >> 1)
      else if (filter === 4) value = cur + paeth(a, b, c)
      else throw new Error(`png filter ${filter} invalido (linha ${y})`)
      pixels[out + x] = value & 255
    }
    prev = out
  }
  return { width, height, channels, pixels }
}

/** Per-pixel diff: {sizeMismatch} when dims differ, else {differing, ratio}. */
export function pixelDiff(base, current) {
  if (base.width !== current.width || base.height !== current.height) {
    return { sizeMismatch: [base.width, base.height, current.width, current.height] }
  }
  const total = base.width * base.height
  let differing = 0
  for (let i = 0; i < total; i += 1) {
    const bo = i * base.channels
    const co = i * current.channels
    const ba = base.channels === 4 ? base.pixels[bo + 3] : 255
    const ca = current.channels === 4 ? current.pixels[co + 3] : 255
    if (
      base.pixels[bo] !== current.pixels[co] ||
      base.pixels[bo + 1] !== current.pixels[co + 1] ||
      base.pixels[bo + 2] !== current.pixels[co + 2] ||
      ba !== ca
    ) {
      differing += 1
    }
  }
  return { differing, ratio: total === 0 ? 0 : differing / total }
}

/** diffRatio — differing-pixel ratio in [0, 1]; dims must match. */
export function diffRatio(base, current) {
  const outcome = pixelDiff(base, current)
  if (outcome.sizeMismatch) {
    const [bw, bh, cw, ch] = outcome.sizeMismatch
    throw new Error(`diffRatio: size mismatch (base ${bw}x${bh} vs current ${cw}x${ch})`)
  }
  return outcome.ratio
}

/** combinedDiff — {pixelRatio, ssim, differing}; {sizeMismatch} when dims differ. */
export function combinedDiff(base, current) {
  const outcome = pixelDiff(base, current)
  if (outcome.sizeMismatch) return { sizeMismatch: outcome.sizeMismatch }
  return { pixelRatio: outcome.ratio, ssim: ssim(base, current), differing: outcome.differing }
}

// ---------- per-platform thresholds (design/visual-thresholds.json) ----------

export const DEFAULT_THRESHOLDS_PATH = 'design/visual-thresholds.json'

export const DEFAULT_THRESHOLDS = {
  maxDiffPixelRatio: 0.02,
  platforms: {
    linux: { maxDiffPixelRatio: 0.02, minSsim: 0.98 },
    darwin: { maxDiffPixelRatio: 0.03, minSsim: 0.97 },
    win32: { maxDiffPixelRatio: 0.05, minSsim: 0.95 },
  },
}

/** loadThresholds — see the module docblock for the contract. */
export function loadThresholds(path = DEFAULT_THRESHOLDS_PATH) {
  const full = resolve(path)
  if (!existsSync(full)) return DEFAULT_THRESHOLDS
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(full, 'utf8'))
  } catch (error) {
    throw new Error(`${path}: cannot read visual-thresholds.json (or invalid JSON) — ${String(error?.message ?? error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}: visual-thresholds.json must have a JSON object at its root`)
  }
  const merged = {
    maxDiffPixelRatio: numberIn01(parsed.maxDiffPixelRatio, DEFAULT_THRESHOLDS.maxDiffPixelRatio, `${path}: "maxDiffPixelRatio"`),
    platforms: { ...DEFAULT_THRESHOLDS.platforms },
  }
  const platforms = parsed.platforms
  if (platforms !== undefined) {
    if (platforms === null || typeof platforms !== 'object' || Array.isArray(platforms)) {
      throw new Error(`${path}: "platforms" must be a JSON object keyed by platform (linux/darwin/win32)`)
    }
    for (const key of Object.keys(platforms)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_THRESHOLDS.platforms, key)) {
        throw new Error(`${path}: unknown platform ${JSON.stringify(key)} (linux/darwin/win32)`)
      }
      const entry = platforms[key]
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`${path}: "platforms.${key}" must be a JSON object { "maxDiffPixelRatio", "minSsim" }`)
      }
      const base = merged.platforms[key]
      merged.platforms[key] = {
        maxDiffPixelRatio: numberIn01(entry.maxDiffPixelRatio, base.maxDiffPixelRatio, `${path}: "platforms.${key}.maxDiffPixelRatio"`),
        minSsim: numberIn01(entry.minSsim, base.minSsim, `${path}: "platforms.${key}.minSsim"`),
      }
    }
  }
  return merged
}

/** thresholdsForPlatform — per-platform limits; unknown platform -> linux. */
export function thresholdsForPlatform(thresholds = DEFAULT_THRESHOLDS, platform = process.platform) {
  return thresholds.platforms[platform] ?? thresholds.platforms.linux
}

/** withinThresholds — pass = pixelRatio <= maxDiffPixelRatio AND ssim >= minSsim. */
export function withinThresholds(diff, limits) {
  const pixelRatioOk = typeof diff.pixelRatio === 'number' && diff.pixelRatio <= limits.maxDiffPixelRatio
  const ssimOk = typeof diff.ssim === 'number' && diff.ssim >= limits.minSsim
  return { pass: pixelRatioOk && ssimOk, pixelRatioOk, ssimOk }
}

function numberIn01(value, fallback, where) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${where} must be a number in [0, 1]`)
  }
  return value
}

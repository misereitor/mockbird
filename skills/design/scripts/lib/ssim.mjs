/**
 * ssim.mjs — vendored SSIM (structural similarity) for decoded PNG images
 * (plan todo 10, GAP-A1): hand-rolled and zero-dependency so the visual diff
 * gate never needs an npm SSIM package (package.json keeps its single
 * playwright-core devDependency).
 *
 * ssim(a, b) -> number in [0, 1]
 *   a, b  decoded images as produced by lib/image-diff.mjs decodePng:
 *         { width, height, channels, pixels } — 8-bit RGB/RGBA (chromium
 *         screenshots). Alpha is ignored; the comparison runs on luma.
 *
 * Method (documented simplification of Wang et al. 2004):
 *   1. luma per pixel (Rec.601: 0.299R + 0.587G + 0.114B);
 *   2. per-pixel SSIM map from local mean/variance/covariance over a 3x3
 *      gaussian window ([1 2 1; 2 4 2; 1 2 1]/16 — the cheap approximation of
 *      the paper's 11x11 gaussian), edge pixels sampled with clamping;
 *   3. the map is pooled per 8x8 window (the SSIM window of this
 *      implementation — non-overlapping blocks, edge partials included) and
 *      the score is the mean of the window means.
 *
 * Constants C1 = (0.01*255)^2, C2 = (0.03*255)^2 (L = 255, 8-bit). Identical
 * images score EXACTLY 1 (both sides take the same float path); the result is
 * clamped to [0, 1] because a strongly anti-correlated pair can dip below 0.
 *
 * Pure module: no fs, no imports, no side effects. A size mismatch throws one
 * guided Error line (misleading-success rule: never score two geometries).
 */

// 3x3 gaussian approximation, row-major, weights sum to 1.
const WEIGHTS = [1 / 16, 2 / 16, 1 / 16, 2 / 16, 4 / 16, 2 / 16, 1 / 16, 2 / 16, 1 / 16]
const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2
const WINDOW = 8

/** ssim — see the module docblock for the contract. */
export function ssim(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`ssim: size mismatch (base ${a.width}x${a.height} vs current ${b.width}x${b.height})`)
  }
  const { width, height } = a
  const la = luma(a)
  const lb = luma(b)
  let windows = 0
  let total = 0
  for (let wy = 0; wy < height; wy += WINDOW) {
    for (let wx = 0; wx < width; wx += WINDOW) {
      const yEnd = Math.min(wy + WINDOW, height)
      const xEnd = Math.min(wx + WINDOW, width)
      let sum = 0
      let count = 0
      for (let y = wy; y < yEnd; y += 1) {
        for (let x = wx; x < xEnd; x += 1) {
          sum += pixelSsim(la, lb, width, height, x, y)
          count += 1
        }
      }
      total += sum / count
      windows += 1
    }
  }
  return Math.min(1, Math.max(0, windows === 0 ? 1 : total / windows))
}

/** SSIM of one pixel over its gaussian-weighted 3x3 neighborhood (clamped). */
function pixelSsim(la, lb, width, height, x, y) {
  let ma = 0
  let mb = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const w = WEIGHTS[(dy + 1) * 3 + (dx + 1)]
      const i = index(width, height, x + dx, y + dy)
      ma += w * la[i]
      mb += w * lb[i]
    }
  }
  let va = 0
  let vb = 0
  let cov = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const w = WEIGHTS[(dy + 1) * 3 + (dx + 1)]
      const i = index(width, height, x + dx, y + dy)
      const da = la[i] - ma
      const db = lb[i] - mb
      va += w * da * da
      vb += w * db * db
      cov += w * da * db
    }
  }
  return ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))
}

function luma(image) {
  const out = new Float64Array(image.width * image.height)
  for (let i = 0; i < out.length; i += 1) {
    const o = i * image.channels
    out[i] = 0.299 * image.pixels[o] + 0.587 * image.pixels[o + 1] + 0.114 * image.pixels[o + 2]
  }
  return out
}

function index(width, height, x, y) {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y
  return cy * width + cx
}

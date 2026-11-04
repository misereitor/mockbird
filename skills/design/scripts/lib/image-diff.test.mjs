/**
 * Unit tests for the shared visual diff library (plan todo 10, GAP-A1):
 * lib/image-diff.mjs (PNG decoder + pixel diff + combined diff + thresholds)
 * and lib/ssim.mjs (vendored SSIM).
 *
 * Contract under test:
 *   - identical images      -> pixelRatio 0 and ssim EXACTLY 1.0;
 *   - one pixel changed     -> pixelRatio > 0 and ssim > 0.98;
 *   - totally different     -> ssim < 0.5;
 *   - malformed PNG bytes   -> one guided Error (never silent garbage);
 *   - design/visual-thresholds.json -> {maxDiffPixelRatio, minSsim} keyed by
 *     platform (linux/darwin/win32) and gate semantics of withinThresholds.
 *
 * Mutation-sensitive on purpose: an inverted channel comparison in pixelDiff
 * breaks the "pixelRatio 0" assert and an ssim() that always returns 1.0
 * breaks the "ssim < 0.5" assert — the suite detects, not just runs.
 *
 * Run: node --test skills/design/scripts/lib/image-diff.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import {
  combinedDiff,
  decodePng,
  diffRatio,
  loadThresholds,
  pixelDiff,
  DEFAULT_THRESHOLDS,
  thresholdsForPlatform,
  withinThresholds,
} from './image-diff.mjs'
import { ssim } from './ssim.mjs'

const SNAPSHOT = fileURLToPath(new URL('../../assets/example/snapshots/dashboard-01-overview-768x1024.png', import.meta.url))
const THRESHOLDS_FILE = fileURLToPath(new URL('../../../../design/visual-thresholds.json', import.meta.url))

// ---------- tiny RGB PNG encoder (filter 0 rows) for constructed fixtures ----------

function encodePng(width, height, pixels) {
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function gradient(width, height) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3
      pixels[o] = (x * 4) % 256
      pixels[o + 1] = (y * 4) % 256
      pixels[o + 2] = ((x + y) * 2) % 256
    }
  }
  return pixels
}

// ---------- tests ----------

test('identical images -> pixelRatio 0 and ssim exactly 1.0', () => {
  const png = encodePng(64, 64, gradient(64, 64))
  const base = decodePng(png)
  const current = decodePng(png)
  const diff = combinedDiff(base, current)
  assert.equal(diff.pixelRatio, 0)
  assert.equal(diff.ssim, 1)
  assert.equal(diffRatio(base, current), 0)
  assert.equal(ssim(base, current), 1)
})

test('one pixel changed -> pixelRatio > 0 and ssim > 0.98', () => {
  const width = 64
  const base = decodePng(encodePng(width, width, gradient(width, width)))
  const tweaked = gradient(width, width)
  const o = (10 * width + 10) * 3
  tweaked[o] = 0
  tweaked[o + 1] = 0
  tweaked[o + 2] = 0
  const current = decodePng(encodePng(width, width, tweaked))
  const diff = combinedDiff(base, current)
  assert.ok(diff.pixelRatio > 0)
  assert.equal(diff.pixelRatio, 1 / (width * width))
  assert.ok(diff.ssim > 0.98, `ssim ${diff.ssim} must stay above 0.98 for a single pixel change`)
})

test('totally different images -> ssim < 0.5 and pixelRatio 1', () => {
  const black = decodePng(encodePng(64, 64, Buffer.alloc(64 * 64 * 3, 0)))
  const white = decodePng(encodePng(64, 64, Buffer.alloc(64 * 64 * 3, 255)))
  const diff = combinedDiff(black, white)
  assert.ok(diff.ssim < 0.5, `ssim ${diff.ssim} must drop below 0.5 for opposite images`)
  assert.equal(diff.pixelRatio, 1)
})

test('real chromium snapshot decodes and self-diffs to zero', () => {
  const img = decodePng(readFileSync(SNAPSHOT))
  assert.ok(img.width > 0 && img.height > 0)
  assert.equal(diffRatio(img, img), 0)
  assert.equal(ssim(img, img), 1)
})

test('malformed PNG bytes fail loudly (guided Error, no silent garbage)', () => {
  assert.throws(() => decodePng(Buffer.from('definitely not a png')), /not a PNG/)
  const png = encodePng(32, 32, gradient(32, 32))
  const truncated = png.subarray(0, Math.floor(png.length * 0.6))
  assert.throws(() => decodePng(truncated), /png|unexpected end/i)
  // zlib-complete stream with a lying IHDR height -> the truncation guard
  const lying = Buffer.from(png)
  lying.writeUInt32BE(64, 20) // IHDR height offset: 8 (sig) + 8 (len+type) + 4 (width)
  assert.throws(() => decodePng(lying), /png truncado/)
})

test('diff combines size mismatch and thresholds load per platform', () => {
  const a = decodePng(encodePng(8, 8, gradient(8, 8)))
  const b = decodePng(encodePng(4, 4, gradient(4, 4)))
  assert.deepEqual(combinedDiff(a, b).sizeMismatch, [8, 8, 4, 4])

  const thresholds = loadThresholds(THRESHOLDS_FILE)
  for (const platform of ['linux', 'darwin', 'win32']) {
    const limits = thresholdsForPlatform(thresholds, platform)
    assert.ok(Number.isFinite(limits.maxDiffPixelRatio) && limits.maxDiffPixelRatio >= 0 && limits.maxDiffPixelRatio <= 1)
    assert.ok(Number.isFinite(limits.minSsim) && limits.minSsim >= 0 && limits.minSsim <= 1)
  }
  const linux = thresholdsForPlatform(thresholds, 'linux')
  assert.equal(withinThresholds({ pixelRatio: 0, ssim: 1 }, linux).pass, true)
  assert.equal(withinThresholds({ pixelRatio: 1, ssim: 0 }, linux).pass, false)
  assert.equal(withinThresholds({ pixelRatio: 0, ssim: 0 }, linux).pass, false)

  const dir = mkdtempSync(join(tmpdir(), 'image-diff-test-'))
  try {
    writeFileSync(join(dir, 'bad.json'), '{')
    assert.throws(() => loadThresholds(join(dir, 'bad.json')), /visual-thresholds\.json/)
    assert.deepEqual(loadThresholds(join(dir, 'missing.json')), DEFAULT_THRESHOLDS)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

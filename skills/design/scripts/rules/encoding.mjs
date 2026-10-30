/* mockbird:config-driven:v2 */
/**
 * encoding check v2 (todo 2, GAP-2) — mojibake/corruption detector over TEXT
 * files only. Registered with validate.mjs's loadRules() via { id, run }.
 *
 * Fails on, per scanned file:
 *   encoding-fffd   U+FFFD anywhere (literal char, bytes EF BF BD, or the
 *                   replacement produced by an ill-formed UTF-8 byte sequence
 *                   — the message always cites the ACTUAL raw bytes found)
 *   encoding-double double-encoding signature: U+00C3 (Ã) or U+00C2 (Â)
 *                   immediately followed by a non-ASCII codepoint (U+0080+;
 *                   the CP1252 followers of 0x80–0x9F reach U+0100+ — e.g.
 *                   "Ã‡" = U+00C3 U+2021, the mojibake of "Ç")
 *                   ("Ã©" = U+00C3 U+00A9 is the mojibake of "é" = U+00E9)
 *   encoding-c1     lone C1 control: codepoint U+0080–U+009F NOT consumed by a
 *                   pair above. Range note (deliberate): the literal reading
 *                   "lone C1 U+0080–U+00FF" would flag every valid "é/ç/ã"
 *                   (U+00E9/U+00E7/U+00E3 live in U+00A0–U+00FF), contradicting
 *                   the ok/encoding-clean contract — so lone C1 is the C1
 *                   control block U+0080–U+009F only. U+00A0–U+00FF standing
 *                   alone is valid Latin-1 Supplement text and passes.
 *
 * Scanning whitelist (never a byte-scan of binaries): ONLY the extensions in
 * `encoding.textExtensions` of validate.config.json are read. PNG/binary files
 * decoded as UTF-8 yield thousands of replacement chars (false positive), so
 * they are never opened at all (ok/encoding-png-allow pins this).
 *
 * Allowlist: `encoding.allowlist` = [{ path, reason }] of intentional quotes
 * (e.g. docs that MENTION U+FFFD). `path` matches the file's path RELATIVE TO
 * THE VALIDATED ROOT (`ctx.rootDir`), `/`-separated, exactly (the fixture is
 * validated as its own root, so its entry is the bare file name).
 *
 * Scope: config.exemptDirs are skipped (same exemption policy as every other
 * validator check — .history/vendor/snapshots/scripts); exemptFiles are NOT
 * skipped (encoding must still cover mock.js/viewer/docs, §13.2 critério 6).
 *
 * Error messages cite the verified codepoint + byte/char offset + line — the
 * §14.4 golden rule: never accuse corruption without codepoint/byte proof.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

export const id = 'encoding'

const FFFD = 0xfffd
const PAIR_LEADS = new Set([0xc2, 0xc3]) // Â U+00C2 / Ã U+00C3
const PAIR_HI = 0x10ffff // pair follower range U+0080+ (CP1252 followers reach U+0100+ — `Ã‡` U+00C3 U+2021; todo 2 gap closed by the todo 28 PAIR_HI extension)
const C1_HI = 0x9f // lone C1 range U+0080–U+009F (see docblock)
const MAX_FINDINGS = 10 // per file; the rest collapse into one summary line

export function run(ctx) {
  const cfg = ctx.config?.encoding
  if (!isPlainObject(cfg) || !Array.isArray(cfg.textExtensions) || cfg.textExtensions.some((e) => typeof e !== 'string')) {
    return ctx.fail('invalid-shape', 'validate.config.json: "encoding.textExtensions" must be a list of strings')
  }
  const allowlist = parseAllowlist(ctx)
  if (allowlist === null) return
  const exts = new Set(cfg.textExtensions.map((e) => e.replace(/^\./, '').toLowerCase()))
  const exemptDirs = new Set(
    Array.isArray(ctx.config?.exemptDirs) ? ctx.config.exemptDirs.filter((d) => typeof d === 'string') : [],
  )
  const files = []
  walk(ctx.rootDir, ctx.rootDir, exts, exemptDirs, allowlist, files)
  for (const full of files) scanFile(ctx, full)
}

/** encoding.allowlist = [{ path, reason }]; malformed entries = invalid-shape. */
function parseAllowlist(ctx) {
  const raw = ctx.config?.encoding?.allowlist
  if (raw === undefined) return new Set()
  if (!Array.isArray(raw)) {
    ctx.fail('invalid-shape', 'validate.config.json: "encoding.allowlist" must be a list of { path, reason }')
    return null
  }
  const out = new Set()
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || entry.path.length === 0 || typeof entry.reason !== 'string') {
      ctx.fail('invalid-shape', `validate.config.json: encoding.allowlist[${index}] must be { path, reason } with non-empty strings`)
      return null
    }
    out.add(entry.path.replaceAll('\\', '/').replace(/^\.\//, ''))
  }
  return out
}

function walk(rootDir, dir, exts, exemptDirs, allowlist, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (exemptDirs.has(entry.name)) continue
      walk(rootDir, join(dir, entry.name), exts, exemptDirs, allowlist, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!exts.has(extname(entry.name).replace(/^\./, '').toLowerCase())) continue
    const rel = dir === rootDir ? entry.name : `${dir.slice(rootDir.length).replace(/^[\\/]/, '')}/${entry.name}`
    if (allowlist.has(rel.replaceAll('\\', '/'))) continue
    out.push(join(dir, entry.name))
  }
}

function scanFile(ctx, full) {
  let buf = null
  try {
    buf = readFileSync(full)
  } catch {
    return // unreadable text file: same absence policy as the other checks
  }
  const chars = decodeUtf8(buf)
  const label = ctx.relLabel(ctx.rootDir, full)
  let findings = 0
  let suppressed = 0
  const report = (code, message) => {
    if (findings < MAX_FINDINGS) {
      findings += 1
      ctx.fail(code, message)
    } else {
      suppressed += 1
    }
  }
  // running line index (was lineOf(chars, i) per character → O(n²) rescan;
  // todo 32): `line` = 1 + count of \n in chars[0..lineUpTo), advanced
  // monotonically to each loop index — same value as lineOf(chars, i) for
  // every call site, O(n) total regardless of the pair skip.
  let line = 1
  let lineUpTo = 0
  for (let i = 0; i < chars.length; i += 1) {
    while (lineUpTo < i) {
      if (chars[lineUpTo].cp === 0x0a) line += 1
      lineUpTo += 1
    }
    const here = chars[i]
    const where = `${label}:${line}`
    if (here.cp === FFFD) {
      const detail = here.bad === undefined
        ? 'U+FFFD (replacement char, literal bytes EF BF BD)'
        : `U+FFFD (replacement for invalid UTF-8 bytes ${here.bad})`
      report('encoding-fffd', `${where}: ${detail} at byte ${here.byte} (char ${i})`)
      continue
    }
    const next = chars[i + 1]
    if (PAIR_LEADS.has(here.cp) && next !== undefined && next.cp >= 0x80 && next.cp <= PAIR_HI) {
      report(
        'encoding-double',
        `${where}: double-encoding signature ${fmt(here.cp)} ${fmt(next.cp)} ("${here.chr}${next.chr}") at byte ${here.byte} (char ${i})`,
      )
      i += 1
      continue
    }
    if (here.cp >= 0x80 && here.cp <= C1_HI) {
      report('encoding-c1', `${where}: lone C1 control ${fmt(here.cp)} at byte ${here.byte} (char ${i})`)
    }
  }
  if (suppressed > 0) {
    ctx.fail('encoding', `${label}: ${suppressed} more encoding finding(s) suppressed (first ${MAX_FINDINGS} shown)`)
  }
}

/**
 * Byte-accurate UTF-8 decoder (no dependencies): each entry is
 * { cp, byte, chr, bad } — `byte` is the exact offset in the raw file, `chr`
 * the char, `bad` the hex of the consumed raw bytes when the sequence was
 * ill-formed (then cp is U+FFFD, WHATWG-style, deterministic: one replacement
 * per ill-formed sequence). This is the §14.4 byte/codepoint verification the
 * error messages cite.
 */
function decodeUtf8(buf) {
  const out = []
  let i = 0
  while (i < buf.length) {
    const b0 = buf[i]
    if (b0 < 0x80) {
      out.push({ cp: b0, byte: i, chr: String.fromCodePoint(b0), bad: undefined })
      i += 1
      continue
    }
    let len = 0
    let cp = 0
    let min = 0
    if (b0 >= 0xc2 && b0 <= 0xdf) { len = 2; cp = b0 & 0x1f; min = 0x80 }
    else if (b0 >= 0xe0 && b0 <= 0xef) { len = 3; cp = b0 & 0x0f; min = 0x800 }
    else if (b0 >= 0xf0 && b0 <= 0xf4) { len = 4; cp = b0 & 0x07; min = 0x10000 }
    else {
      out.push({ cp: FFFD, byte: i, chr: '\uFFFD', bad: hex(buf, i, 1) })
      i += 1
      continue
    }
    let ok = true
    for (let k = 1; k < len; k += 1) {
      const bk = buf[i + k]
      if (bk === undefined || (bk & 0xc0) !== 0x80) {
        ok = false
        break
      }
      cp = (cp << 6) | (bk & 0x3f)
    }
    if (ok && cp >= min && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
      out.push({ cp, byte: i, chr: String.fromCodePoint(cp), bad: undefined })
      i += len
      continue
    }
    const span = ok ? len : 1 // well-formed shape but invalid value: consume it whole
    out.push({ cp: FFFD, byte: i, chr: '\uFFFD', bad: hex(buf, i, span) })
    i += span
  }
  return out
}

function hex(buf, start, span) {
  return [...buf.slice(start, start + span)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

function fmt(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

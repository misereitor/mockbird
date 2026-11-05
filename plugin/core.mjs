/**
 * opencode-mockbird core — plain JavaScript (Node 18+, no type stripping).
 *
 * Shared by the plugin entry (`index.ts`, loaded by OpenCode's TS runtime)
 * and the smoke test (`smoke.mjs`, which must run on stock Node 18).
 *
 * Sync policy:
 *   - MIRROR: the pack's runtime (viewer, mock, serve, validate, scripts…)
 *     is always mirrored — the repo is the truth; `.bak` keeps the local
 *     version around.
 *   - SEED: `components/` is only filled in when missing — the registry can
 *     grow per project and must never be overwritten.
 *   - Stamp: every sync writes `design/.mockbird-version` (pack semver +
 *     SHA-256 of the mirrored MIRROR set + date). Diverging local content and
 *     any previous-stamp mismatch (drift) are recorded in the stamp itself.
 *   - Integrity: every sync verifies the mirrored set against the previous
 *     stamp (per-file checksums + composite hash) — see `verifyStamp`.
 *   - Update policy (ADR-0008): the pack only moves to an approved pinned
 *     semver tag (`mockbird.autoUpdate`); without it every update is refused
 *     with zero git calls.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACK_ROOT = resolve(HERE, "..")
const SKILLS_DIR = join(PACK_ROOT, "skills")
const DESIGN_ASSETS = join(SKILLS_DIR, "design", "assets")
const DESIGN_SCRIPTS = join(SKILLS_DIR, "design", "scripts")
/** Diagnostics: plugin console.log output is swallowed by OpenCode's log. */
export const LOG_FILE = join(tmpdir(), "mockbird-plugin.log")

/** Minimum interval between two pack update runs (ms). */
export const PULL_INTERVAL_MS = 10 * 60 * 1000

/**
 * Config key gating every pack update (ADR-0008): the `autoUpdate` option of
 * the `mockbird` plugin (`ctx.options`), named `mockbird.autoUpdate` in the
 * config docs. Its value must be the pinned semver tag the checkout moves to.
 */
export const AUTO_UPDATE_KEY = "mockbird.autoUpdate"

/** Pinned tag accepted as `mockbird.autoUpdate` (e.g. "v1.1.0" or "1.1.0"). */
const SEMVER_TAG = /^v?\d+\.\d+\.\d+$/

/**
 * Spawn options for external processes. `windowsHide: true` (CREATE_NO_WINDOW)
 * runs them fully hidden on Windows — without it, every `git` call flashes a
 * console window when the host app has no terminal attached. Ignored elsewhere.
 */
const HIDDEN = { windowsHide: true }

/** Always mirrored into the project's design/ (.bak when content diverges). */
export const MIRROR = [
  ["viewer.html", join(DESIGN_ASSETS, "viewer.html")],
  ["mock.js", join(DESIGN_ASSETS, "mock.js")],
  ["mock.css", join(DESIGN_ASSETS, "mock.css")],
  ["docs.html", join(DESIGN_ASSETS, "docs.html")],
  ["serve.mjs", join(DESIGN_ASSETS, "serve.mjs")],
  ["validate.mjs", join(DESIGN_SCRIPTS, "validate.mjs")],
  ["vendor/html-to-image.js", join(DESIGN_ASSETS, "vendor", "html-to-image.js")],
  ["scripts/gen-tokens.mjs", join(DESIGN_SCRIPTS, "gen-tokens.mjs")],
  ["scripts/sync-components.mjs", join(DESIGN_SCRIPTS, "sync-components.mjs")],
  ["scripts/marker-parser.mjs", join(DESIGN_SCRIPTS, "marker-parser.mjs")],
  ["scripts/export-tokens.mjs", join(DESIGN_SCRIPTS, "export-tokens.mjs")],
]

/** Seed: only added when missing — never overwrites what a project evolved. */
export const SEED = [
  ["components/button.html", join(DESIGN_ASSETS, "components", "button.html")],
  ["components/card.html", join(DESIGN_ASSETS, "components", "card.html")],
  ["components/modal.html", join(DESIGN_ASSETS, "components", "modal.html")],
  ["components/drawer.html", join(DESIGN_ASSETS, "components", "drawer.html")],
  ["components/field.html", join(DESIGN_ASSETS, "components", "field.html")],
  ["components/bubble.html", join(DESIGN_ASSETS, "components", "bubble.html")],
  ["components/menu-row.html", join(DESIGN_ASSETS, "components", "menu-row.html")],
  ["components/media-card.html", join(DESIGN_ASSETS, "components", "media-card.html")],
  ["components/toast.html", join(DESIGN_ASSETS, "components", "toast.html")],
  ["components/pill.html", join(DESIGN_ASSETS, "components", "pill.html")],
  ["components/avatar.html", join(DESIGN_ASSETS, "components", "avatar.html")],
  ["components/banner.html", join(DESIGN_ASSETS, "components", "banner.html")],
  ["components/tabs.html", join(DESIGN_ASSETS, "components", "tabs.html")],
  ["components/chip.html", join(DESIGN_ASSETS, "components", "chip.html")],
  ["components/components.json", join(DESIGN_ASSETS, "components", "components.json")],
]

/** Minimal YAML frontmatter (`key: value`, with indented continuations). */
export function frontmatter(text) {
  const out = {}
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return out
  let key = ""
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s+/.test(line) && key) {
      out[key] += " " + line.trim()
      continue
    }
    const pair = /^([\w-]+):\s*(.*)$/.exec(line)
    if (pair) {
      key = pair[1]
      out[key] = pair[2].trim()
    }
  }
  return out
}

/** Reads the skills from the repo - always from disk, right after the pull. */
export function loadSkills() {
  if (!existsSync(SKILLS_DIR)) return []
  const out = []
  for (const dir of readdirSync(SKILLS_DIR)) {
    const file = join(SKILLS_DIR, dir, "SKILL.md")
    if (!existsSync(file)) continue
    const content = readFileSync(file, "utf8")
    const meta = frontmatter(content)
    out.push({
      id: meta.name || dir,
      name: meta.name || dir,
      description: meta.description || "",
      path: file,
      content,
    })
  }
  return out
}

/**
 * Slash commands (commands/*.md) - one per skill. Skills are NOT slash
 * commands in OpenCode v2: the plugin registers these via
 * `ctx.command.transform` and install.mjs copies them into a `commands/`
 * directory. The Markdown body is the prompt template (`$ARGUMENTS`).
 */
export function loadCommands() {
  const dir = join(PACK_ROOT, "commands")
  if (!existsSync(dir)) return []
  const out = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue
    const content = readFileSync(join(dir, file), "utf8")
    const meta = frontmatter(content)
    const template = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim()
    out.push({
      name: file.replace(/\.md$/, ""),
      description: meta.description || "",
      template,
      path: join(dir, file),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Runs `git <args>` inside the pack checkout and returns trimmed stdout.
 * Injected in tests to record the git calls (acceptance: zero git calls while
 * `mockbird.autoUpdate` is off).
 */
const runGit = (args, timeout = 10_000) =>
  execFileSync("git", ["-C", PACK_ROOT, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...HIDDEN,
    timeout,
  }).trim()

export function hasRemote(exec = runGit) {
  try {
    return exec(["remote"]).length > 0
  } catch {
    return false
  }
}

/**
 * Opt-in, pinned pack update (ADR-0008). `mockbird.autoUpdate` must carry a
 * pinned semver tag (`vX.Y.Z`/`X.Y.Z`): absent/false → refused with ZERO git
 * calls; malformed values are refused the same way. When pinned, the update
 * fetches tags and checks out exactly the pin — never a floating pull.
 * Non-fatal: offline or conflicts keep the local version.
 */
export function pullPack(autoUpdate, exec = runGit) {
  const pin = typeof autoUpdate === "string" ? autoUpdate.trim() : ""
  const set = autoUpdate !== undefined && autoUpdate !== null && autoUpdate !== false && autoUpdate !== ""
  if (!set || !SEMVER_TAG.test(pin)) {
    const got = set ? JSON.stringify(autoUpdate) : "not set"
    return { ok: false, applied: null, message: `update refused: ${AUTO_UPDATE_KEY}=${got} — updates only move to a pinned semver tag (vX.Y.Z); see docs/adr/ADR-0008-atualizacao-plugin.md` }
  }
  if (!hasRemote(exec)) return { ok: false, applied: null, message: "update: no remote configured — using the local version" }
  try {
    exec(["fetch", "--tags", "--quiet"], 60_000)
    exec(["checkout", "--quiet", pin], 60_000)
    return { ok: true, applied: pin, message: `update: pack pinned at ${pin}` }
  } catch (error) {
    const reason = (error.stderr || error.message || "unknown error").trim().split("\n")[0]
    return { ok: false, applied: null, message: `update failed (keeping the local version): ${reason}` }
  }
}

/** design/.mockbird-version — which kit version + mirrored content stamped this design/. */
const STAMP_FILE = ".mockbird-version"

/**
 * Composite SHA-256 over [dest, path] entries: for each, in order, feeds
 * `dest\n<sha256 of content>\n` into the hash. Absent files are skipped and
 * listed in `missing` — a set that cannot reproduce the recorded hash (or a
 * divergent recorded hash) is the drift signal stored in the next stamp.
 */
function hashFileSet(entries) {
  const files = {}
  const missing = []
  const composite = createHash("sha256")
  for (const [dest, path] of entries) {
    if (!existsSync(path)) {
      missing.push(dest)
      continue
    }
    const hex = createHash("sha256").update(readFileSync(path)).digest("hex")
    files[dest] = hex
    composite.update(`${dest}\n${hex}\n`)
  }
  return { files, missing, mirrorHash: composite.digest("hex") }
}

const mirroredEntries = (designDir) => MIRROR.map(([dest]) => [dest, join(designDir, dest)])

/** Previous stamp, or null when absent/malformed (a malformed stamp is replaced). */
function readStamp(designDir) {
  const path = join(designDir, STAMP_FILE)
  if (!existsSync(path)) return null
  try {
    const stamp = JSON.parse(readFileSync(path, "utf8"))
    return stamp && typeof stamp.mirrorHash === "string" ? stamp : null
  } catch {
    return null
  }
}

/** Best-effort warning line in the plugin log — silence is not a pass. */
function logWarning(message) {
  const line = `[mockbird] ${new Date().toISOString()} WARNING ${message}`
  try {
    appendFileSync(LOG_FILE, line + "\n")
  } catch { /* diagnostics are best-effort */ }
}

/**
 * Integrity check of `design/.mockbird-version` for the inspector (todo 21):
 * per-file SHA-256 of the mirrored set vs the recorded `files` checksums,
 * plus the composite `mirrorHash` vs the record. Names tampered files (checksum
 * mismatch) and deletions; `recordMismatch` flags an edited/stale record. A
 * project without a stamp verifies vacuously (`version: null`).
 */
export function verifyStamp(designDir) {
  const previous = readStamp(designDir)
  const result = { version: previous?.version ?? null, ok: true, tampered: [], missing: [], recordMismatch: false }
  if (!previous) return result
  result.recordMismatch = hashFileSet(mirroredEntries(designDir)).mirrorHash !== previous.mirrorHash
  for (const [dest, recorded] of Object.entries(previous.files ?? {})) {
    const file = join(designDir, dest)
    if (!existsSync(file)) {
      result.missing.push(dest)
      continue
    }
    const hex = createHash("sha256").update(readFileSync(file)).digest("hex")
    if (hex !== recorded) result.tampered.push(dest)
  }
  result.ok = result.tampered.length === 0 && result.missing.length === 0 && !result.recordMismatch
  return result
}

/** Compares the previous stamp against the mirrored set and the current kit. */
function stampDrift(designDir, previous) {
  const mirrored = hashFileSet(mirroredEntries(designDir))
  const kit = hashFileSet(MIRROR)
  const mirrorMismatch = mirrored.mirrorHash !== previous.mirrorHash
  const kitDrift = kit.mirrorHash !== previous.mirrorHash
  if (!mirrorMismatch && !kitDrift) return null
  return {
    previousVersion: previous.version,
    previousMirrorHash: previous.mirrorHash,
    missing: mirrored.missing,
    mirrorMismatch,
    kitDrift,
  }
}

/** Mirrors the runtime into the project's design/. Null when the project has none. */
export function syncProject(projectDir) {
  const designDir = join(projectDir, "design")
  if (!existsSync(designDir)) return null
  const summary = { updated: [], added: [], warnings: [] }
  // Verify the previous stamp BEFORE the mirror loop restores anything, so
  // hand edits, tampering and deletions are still visible in the records.
  const previous = readStamp(designDir)
  const drift = previous ? stampDrift(designDir, previous) : null
  const integrity = verifyStamp(designDir)
  for (const [dest, src] of MIRROR) {
    if (!existsSync(src)) continue
    const target = join(designDir, dest)
    const source = readFileSync(src)
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, source)
      summary.added.push(dest)
      continue
    }
    const current = readFileSync(target)
    if (current.equals(source)) continue
    writeFileSync(`${target}.bak`, current)
    writeFileSync(target, source)
    summary.updated.push(dest)
  }
  for (const [dest, src] of SEED) {
    const target = join(designDir, dest)
    if (existsSync(target) || !existsSync(src)) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(src, target)
    summary.added.push(dest)
  }
  // Divergence and integrity warnings: each .bak (above) and each checksum
  // mismatch gets a LOG_FILE line — silence is never a pass (todo 34).
  if (integrity.recordMismatch) summary.warnings.push(`integrity: ${STAMP_FILE} checksum does not match the mirrored set (edited or stale record)`)
  for (const dest of integrity.tampered) summary.warnings.push(`integrity: design/${dest} does not match the checksum recorded in ${STAMP_FILE}`)
  for (const dest of integrity.missing) summary.warnings.push(`integrity: design/${dest} was deleted since the last stamp — restored from the pack`)
  for (const dest of summary.updated) summary.warnings.push(`divergence: design/${dest} updated to the pack version — local content kept as ${dest}.bak`)
  for (const warning of summary.warnings) logWarning(warning)
  // Version stamp: which kit version + mirrored content created this design/.
  // Divergences (each file also got its .bak), drift and the verification
  // result are recorded here — the inspector (todo 21) reads `status`.
  const stamped = hashFileSet(mirroredEntries(designDir))
  const version = JSON.parse(readFileSync(join(PACK_ROOT, "package.json"), "utf8")).version
  const stamp = {
    version,
    mirrorHash: stamped.mirrorHash,
    date: new Date().toISOString(),
    files: stamped.files,
    status: summary.warnings.length > 0 ? "warning" : "ok",
    integrity: { ok: integrity.ok, tampered: integrity.tampered, missing: integrity.missing, recordMismatch: integrity.recordMismatch },
  }
  if (summary.updated.length > 0) stamp.divergent = [...summary.updated]
  if (drift) stamp.drift = drift
  writeFileSync(join(designDir, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`)
  return summary
}

export function describe(summary) {
  if (!summary) return "design/: no design/ folder in this project — nothing to sync"
  const updated = summary.updated.join(", ") || "none"
  const added = summary.added.join(", ") || "none"
  const base = `design/: updated = ${updated}; added = ${added}`
  return summary.warnings?.length ? `${base}; WARNING: ${summary.warnings.join(" | ")}` : base
}

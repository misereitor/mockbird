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
 */
import { execFileSync } from "node:child_process"
import {
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

/** Minimum interval between two `git pull` runs (ms). */
export const PULL_INTERVAL_MS = 10 * 60 * 1000

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

export function hasRemote() {
  try {
    return execFileSync("git", ["-C", PACK_ROOT, "remote"], { encoding: "utf8", ...HIDDEN, timeout: 10_000 }).trim().length > 0
  } catch {
    return false
  }
}

/** Non-fatal `git pull --ff-only`: offline or conflicts keep the local version. */
export function pullPack() {
  if (!hasRemote()) return "git pull: no remote configured — using the local version"
  try {
    execFileSync("git", ["-C", PACK_ROOT, "pull", "--ff-only", "--no-edit", "--quiet"], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
      ...HIDDEN,
    })
    return "git pull: pack updated"
  } catch (error) {
    const reason = (error.stderr || error.message || "unknown error").trim().split("\n")[0]
    return `git pull failed (keeping the local version): ${reason}`
  }
}

/** Mirrors the runtime into the project's design/. Null when the project has none. */
export function syncProject(projectDir) {
  const designDir = join(projectDir, "design")
  if (!existsSync(designDir)) return null
  const summary = { updated: [], added: [] }
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
  return summary
}

export function describe(summary) {
  if (!summary) return "design/: no design/ folder in this project — nothing to sync"
  const updated = summary.updated.join(", ") || "none"
  const added = summary.added.join(", ") || "none"
  return `design/: updated = ${updated}; added = ${added}`
}

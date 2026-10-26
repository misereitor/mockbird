/**
 * opencode-mockbird — OpenCode v2 plugin for Mockbird.
 *
 * On `setup()` (runs every time OpenCode opens a project) it:
 *
 *   1. updates this checkout with `git pull --ff-only` (throttled);
 *   2. registers the skills straight from the repo via `ctx.skill.transform`
 *      — single source of truth, no copies in ~/.config/opencode/skill,
 *      ~/.agents/skills etc.;
 *   3. mirrors the runtime files into the current project's `design/` folder
 *      (files whose content diverges get a `<file>.bak` backup of the local
 *      version before being updated);
 *   4. registers the `/design-sync` command for on-demand update + sync.
 *
 * Sync policy:
 *   - MIRROR: the pack's runtime (viewer, mock, serve, validate, scripts…)
 *     is always mirrored — the repo is the truth; `.bak` keeps the local
 *     version around.
 *   - SEED: `components/` is only filled in when missing — the registry can
 *     grow per project and must never be overwritten.
 */
import { Plugin, Skill } from "@opencode/plugin"
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK_ROOT = resolve(HERE, "..")
const SKILLS_DIR = join(PACK_ROOT, "skills")
const DESIGN_ASSETS = join(SKILLS_DIR, "design", "assets")
const DESIGN_SCRIPTS = join(SKILLS_DIR, "design", "scripts")
/** Diagnostics: plugin console.log output is swallowed by OpenCode's log. */
const LOG_FILE = join(tmpdir(), "mockbird-plugin.log")

/** Minimum interval between two `git pull` runs (ms). */
const PULL_INTERVAL_MS = 10 * 60 * 1000

/** Always mirrored into the project's design/ (.bak when content diverges). */
const MIRROR: ReadonlyArray<readonly [dest: string, src: string]> = [
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
const SEED: ReadonlyArray<readonly [dest: string, src: string]> = [
  ["components/button.html", join(DESIGN_ASSETS, "components", "button.html")],
  ["components/card.html", join(DESIGN_ASSETS, "components", "card.html")],
  ["components/components.json", join(DESIGN_ASSETS, "components", "components.json")],
]

interface PackSkill {
  id: string
  name: string
  description: string
  path: string
  content: string
}

interface SyncSummary {
  updated: string[]
  added: string[]
}

/** Minimal YAML frontmatter (`key: value`, with indented continuations). */
export function frontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
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

/** Reads the skills from the repo — always from disk, right after the pull. */
export function loadSkills(): PackSkill[] {
  if (!existsSync(SKILLS_DIR)) return []
  const out: PackSkill[] = []
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

function hasRemote(): boolean {
  try {
    return execFileSync("git", ["-C", PACK_ROOT, "remote"], { encoding: "utf8", timeout: 10_000 }).trim().length > 0
  } catch {
    return false
  }
}

/** Non-fatal `git pull --ff-only`: offline or conflicts keep the local version. */
function pullPack(): string {
  if (!hasRemote()) return "git pull: no remote configured — using the local version"
  try {
    execFileSync("git", ["-C", PACK_ROOT, "pull", "--ff-only", "--no-edit", "--quiet"], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return "git pull: pack updated"
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    const reason = (err.stderr || err.message || "unknown error").trim().split("\n")[0]
    return `git pull failed (keeping the local version): ${reason}`
  }
}

/** Mirrors the runtime into the project's design/. Null when the project has none. */
export function syncProject(projectDir: string): SyncSummary | null {
  const designDir = join(projectDir, "design")
  if (!existsSync(designDir)) return null
  const summary: SyncSummary = { updated: [], added: [] }
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

function describe(summary: SyncSummary | null): string {
  if (!summary) return "design/: no design/ folder in this project — nothing to sync"
  const updated = summary.updated.join(", ") || "none"
  const added = summary.added.join(", ") || "none"
  return `design/: updated = ${updated}; added = ${added}`
}

export default Plugin.define({
  id: "mockbird",
  async setup(ctx) {
    const log = (message: string) => {
      const line = `[mockbird] ${new Date().toISOString()} ${message}`
      console.log(line)
      try {
        appendFileSync(LOG_FILE, line + "\n")
      } catch { /* diagnostics are best-effort */ }
    }
    const guard = async (phase: string, run: () => Promise<void> | void) => {
      try {
        await run()
      } catch (error) {
        log(`ERROR in ${phase}: ${(error as Error)?.message ?? error}`)
      }
    }
    const interval = Number(ctx.options?.updateIntervalMs ?? PULL_INTERVAL_MS)
    const projectDir = ctx.location.project?.directory ?? ctx.location.directory
    log(`setup: projectDir=${projectDir} location=${ctx.location.directory}`)

    // 1. auto-update (throttled so every project start stays light)
    await guard("auto-update", async () => {
      const lastPull = Number((await ctx.storage.get("lastPull")) ?? 0)
      if (!Number.isFinite(interval) || Date.now() - lastPull >= interval) {
        await ctx.storage.set("lastPull", Date.now())
        log(pullPack())
      }
    })

    // 2. skills: single source of truth = the repo (read after the pull). The
    //    callback is synchronous and reads `source.skills`; `reload()` replays
    //    the transforms.
    const source = { skills: loadSkills() }
    await guard("skill.transform", async () => {
      await ctx.skill.transform((editor) => {
        for (const skill of source.skills) {
          if (editor.get(skill.id)) editor.remove(skill.id)
          editor.add({
            id: Skill.ID.make(skill.id),
            name: Skill.Name.make(skill.name),
            description: skill.description,
            path: Skill.Info.fields.path.make(skill.path),
            content: skill.content,
          })
        }
      })
      log(`skills registered from repo: ${source.skills.map((s) => s.id).join(", ")}`)
    })

    // 3. mirror the runtime into the current project's design/
    await guard("sync", async () => {
      log(describe(syncProject(projectDir)))
    })

    // 4. /design-sync: forced update + re-sync on demand
    await guard("command.transform", async () => {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "design-sync",
          description: "Update Mockbird (git pull), reload the skills and mirror this project's design/ folder",
          execute: async ({ sessionID }) => {
            const lines = [pullPack()]
            source.skills = loadSkills()
            await ctx.skill.reload()
            lines.push(describe(syncProject(projectDir)))
            await ctx.session.synthetic({ sessionID, text: `[mockbird] ${lines.join(" | ")}` })
          },
        })
      })
    })
  },
})

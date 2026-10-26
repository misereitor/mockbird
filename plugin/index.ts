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
 * All the logic lives in `core.mjs` (plain JS, Node 18+, shared with the
 * smoke test); this file is only the typed OpenCode adapter.
 */
import { Plugin, Skill } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import {
  describe,
  loadSkills,
  LOG_FILE,
  PULL_INTERVAL_MS,
  pullPack,
  syncProject,
} from "./core.mjs"

export {
  frontmatter,
  hasRemote,
  loadSkills,
  pullPack,
  syncProject,
} from "./core.mjs"

interface PackSkill {
  id: string
  name: string
  description: string
  path: string
  content: string
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
    const source: { skills: PackSkill[] } = { skills: loadSkills() }
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

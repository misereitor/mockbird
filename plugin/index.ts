/**
 * opencode-design-pack — plugin OpenCode v2 do pacote Design Pack.
 *
 * No `setup()` (que roda toda vez que o OpenCode abre um projeto) ele:
 *
 *   1. atualiza o checkout do pack com `git pull --ff-only` (com throttle);
 *   2. registra as skills direto do repo via `ctx.skill.transform` — fonte
 *      única, sem cópias em ~/.config/opencode/skill, ~/.agents/skills etc.;
 *   3. espelha os arquivos de runtime no `design/` do projeto atual
 *      (arquivos com conteúdo divergente ganham `<arquivo>.bak` com a versão
 *      anterior antes de serem atualizados);
 *   4. registra o comando `/design-sync` para forçar update + sync sob demanda.
 *
 * Política de sincronização:
 *   - MIRROR: runtime do pack (viewer, mock, serve, validate, scripts…)
 *     sempre espelhado — o pack é a verdade; `.bak` preserva a versão local.
 *   - SEED: `components/` só é preenchido quando falta — o registry pode
 *     crescer por projeto e nunca deve ser sobrescrito.
 */
import { Plugin, Skill } from "@opencode/plugin"
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK_ROOT = resolve(HERE, "..")
const SKILLS_DIR = join(PACK_ROOT, "skills")
const DESIGN_ASSETS = join(SKILLS_DIR, "design", "assets")
const DESIGN_SCRIPTS = join(SKILLS_DIR, "design", "scripts")

/** Intervalo mínimo entre dois `git pull` (ms). */
const PULL_INTERVAL_MS = 10 * 60 * 1000

/** Espelhados sempre no design/ do projeto (com .bak quando divergir). */
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

/** Seed: só entra quando falta — nunca sobrescreve o que o projeto evoluiu. */
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

/** Frontmatter YAML mínimo (`key: value`, com continuação indentada). */
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

/** Lê as skills do repo — sempre do disco, depois do pull. */
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

/** `git pull --ff-only` não fatal: offline ou conflito segue com a versão local. */
function pullPack(): string {
  if (!hasRemote()) return "git pull: sem remoto configurado — usando a versão local"
  try {
    execFileSync("git", ["-C", PACK_ROOT, "pull", "--ff-only", "--no-edit", "--quiet"], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return "git pull: pack atualizado"
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    const reason = (err.stderr || err.message || "erro desconhecido").trim().split("\n")[0]
    return `git pull falhou (seguindo com a versão local): ${reason}`
  }
}

/** Espelha o runtime no design/ do projeto. Retorna null se o projeto não usa design/. */
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
  if (!summary) return "design/: pasta inexistente neste projeto — nada a sincronizar"
  const updated = summary.updated.join(", ") || "nenhum"
  const added = summary.added.join(", ") || "nenhum"
  return `design/: atualizados = ${updated}; novos = ${added}`
}

export default Plugin.define({
  id: "design-pack",
  async setup(ctx) {
    const log = (message: string) => console.log(`[design-pack] ${message}`)
    const interval = Number(ctx.options?.updateIntervalMs ?? PULL_INTERVAL_MS)
    const projectDir = ctx.location.project?.directory ?? ctx.location.directory

    // 1. auto-update (com throttle para não pesar no startup de cada projeto)
    const lastPull = Number((await ctx.storage.get("lastPull")) ?? 0)
    if (!Number.isFinite(interval) || Date.now() - lastPull >= interval) {
      await ctx.storage.set("lastPull", Date.now())
      log(pullPack())
    }

    // 2. skills: fonte única = repo (lido após o pull). O callback é síncrono
    //    e relê `source.skills`; `reload()` reexecuta os transforms.
    const source = { skills: loadSkills() }
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
    log(`skills registradas do repo: ${source.skills.map((s) => s.id).join(", ")}`)

    // 3. espelho do runtime no design/ do projeto atual
    log(describe(syncProject(projectDir)))

    // 4. /design-sync: update forçado + re-sync sob demanda
    await ctx.command.transform((editor) => {
      editor.add({
        name: "design-sync",
        description: "Atualiza o Design Pack (git pull), recarrega as skills e espelha o design/ deste projeto",
        execute: async ({ sessionID }) => {
          const lines = [pullPack()]
          source.skills = loadSkills()
          await ctx.skill.reload()
          lines.push(describe(syncProject(projectDir)))
          await ctx.session.synthetic({ sessionID, text: `[design-pack] ${lines.join(" | ")}` })
        },
      })
    })
  },
})

#!/usr/bin/env node
/**
 * Mockbird installer - installs the 4 skills (design, taste,
 * emil-design-eng, impeccable) into the skills directory of your coding agent.
 *
 * Zero dependencies. Requires Node 18+.
 *
 * Usage:
 *   node install.mjs --target <name>     install into that agent's skills dir
 *   node install.mjs --dir <path>        install into any folder (relative to cwd)
 *   node install.mjs --list              show the known targets
 *   node install.mjs --only design,taste install a subset (default: all four)
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALL_SKILLS = ['design', 'taste', 'emil-design-eng', 'impeccable']
const CRAFT_ONLY = ['taste', 'emil-design-eng', 'impeccable'] // craft.md references these

const TARGETS = {
  zcode: { dir: join(homedir(), '.agents', 'skills'), note: 'ZCode (open standard ~/.agents/skills)' },
  agents: { dir: join(homedir(), '.agents', 'skills'), note: 'Agent Skills open standard (read by OpenCode, ZCode and others)' },
  opencode: { dir: join(homedir(), '.config', 'opencode', 'skills'), note: 'OpenCode global (skills/ plural + slash commands in commands/)' },
  claude: { dir: join(homedir(), '.claude', 'skills'), note: 'Claude Code global' },
  codex: { dir: join(homedir(), '.codex', 'skills'), note: 'Codex CLI' },
  cursor: { dir: join(homedir(), '.cursor', 'skills'), note: 'Cursor' },
  gemini: { dir: join(homedir(), '.gemini', 'skills'), note: 'Gemini CLI' },
}

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const args = { only: ALL_SKILLS }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target' || arg === '-t') args.target = argv[++i]
    else if (arg === '--dir' || arg === '-d') args.dir = argv[++i]
    else if (arg === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg === '--list') args.list = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else {
      console.error(`unknown argument: ${arg} (see --help)`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help || (!args.target && !args.dir && !args.list)) {
  console.log(`Mockbird - installs the skills design, taste, emil-design-eng and impeccable.

Usage:
  node install.mjs --target <name>    install into that agent's skills directory
  node install.mjs --dir <path>       install into any folder (e.g. a project's .claude/skills)
  node install.mjs --only design,taste  install a subset
  node install.mjs --list             list the known targets

OpenCode destinations also get the slash commands (/design, /taste,
/emil-design-eng, /impeccable) in their commands/ directory.

Targets (--target):`)
  for (const [name, target] of Object.entries(TARGETS)) {
    console.log(`  ${name.padEnd(10)} ${target.dir}  (${target.note})`)
  }
  process.exit(args.help ? 0 : 1)
}

if (args.list) {
  for (const [name, target] of Object.entries(TARGETS)) {
    console.log(`${name.padEnd(10)} ${target.dir}  # ${target.note}`)
  }
  process.exit(0)
}

const unknown = args.only.filter((s) => !ALL_SKILLS.includes(s))
if (args.only.length === 0 || unknown.length > 0) {
  console.error(`invalid --only: ${unknown.join(', ') || '(empty)'} - options: ${ALL_SKILLS.join(', ')}`)
  process.exit(2)
}

let destDir
if (args.dir) {
  destDir = resolve(args.dir)
} else {
  const target = TARGETS[args.target]
  if (!target) {
    console.error(`unknown --target "${args.target}" - options: ${Object.keys(TARGETS).join(', ')} (or use --dir)`)
    process.exit(2)
  }
  destDir = target.dir
}

const packDir = dirname(fileURLToPath(import.meta.url))
const missing = args.only.filter((name) => !existsSync(join(packDir, 'skills', name, 'SKILL.md')))
if (missing.length > 0) {
  console.error(`incomplete package, missing: ${missing.join(', ')} (skills/<name>/SKILL.md)`)
  process.exit(2)
}

/* ----------------------------------------------------------------- install */

console.log(`Installing ${args.only.join(', ')}`)
console.log(`  from  ${packDir}`)
console.log(`  into  ${destDir}`)
console.log('')

mkdirSync(destDir, { recursive: true })
for (const name of args.only) {
  const dest = join(destDir, name)
  if (existsSync(dest)) {
    console.log(`  ~ ${name} (replacing the previous version)`)
    rmSync(dest, { recursive: true, force: true })
  } else {
    console.log(`  + ${name}`)
  }
  cpSync(join(packDir, 'skills', name), dest, { recursive: true })
}

/* ------------------------------------------------------- slash commands */

/* OpenCode v2: skills are NOT slash commands — /design & co. live in a
 * commands/ directory (~/.config/opencode/commands globally,
 * .opencode/commands per project). Only OpenCode-shaped destinations get
 * them; other agents are left alone with a note. */
function commandsDestFor(dir) {
  const norm = dir.replace(/\\/g, '/')
  if (/\/\.opencode\/[^/]+$/.test(norm)) return join(dir, '..', 'commands')
  if (/\/\.config\/opencode\/[^/]+$/.test(norm)) return join(homedir(), '.config', 'opencode', 'commands')
  if ((args.target === 'agents' || args.target === 'zcode') && existsSync(join(homedir(), '.config', 'opencode'))) {
    return join(homedir(), '.config', 'opencode', 'commands')
  }
  return null
}

const commandsSrc = join(packDir, 'commands')
const commandsDest = commandsDestFor(destDir)
if (commandsDest && existsSync(commandsSrc)) {
  console.log('')
  console.log(`Slash commands into ${commandsDest}`)
  mkdirSync(commandsDest, { recursive: true })
  for (const file of readdirSync(commandsSrc)) {
    if (!file.endsWith('.md')) continue
    copyFileSync(join(commandsSrc, file), join(commandsDest, file))
    console.log(`  + /${file.replace(/\.md$/, '')}`)
  }
} else {
  console.log('')
  console.log('  (slash commands skipped — OpenCode only: use --target opencode or --dir <project>/.opencode/skills)')
}

/* -------------------------------------------------------------- verify */

let failures = 0
console.log('')
for (const name of args.only) {
  const dir = join(destDir, name)
  const skillMd = join(dir, 'SKILL.md')
  try {
    const raw = readFileSync(skillMd, 'utf8')
    const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? ''
    const skillName = /^name:\s*(\S+)/m.exec(frontmatter)?.[1]
    const hasDescription = /^description:\s*\S/m.test(frontmatter)
    const files = countFiles(dir)
    if (!skillName || !hasDescription) throw new Error('frontmatter missing name/description')
    console.log(`  ok  ${name.padEnd(16)} ${String(files).padStart(3)} files  (skill "${skillName}")`)
  } catch (error) {
    failures++
    console.error(`  ERROR ${name}: ${error.message}`)
  }
}
if (failures > 0) process.exit(1)

const craftPresent = args.only.includes('design')
const craftMissing = CRAFT_ONLY.filter((name) => !args.only.includes(name))
if (craftPresent && craftMissing.length > 0) {
  console.log(`
WARNING: the design skill loads assets/craft.md, which references the sibling
skills (${craftMissing.join(', ')}) by relative path ../<name>. Install them
together (run again without --only) for the full craft layer.`)
}

function countFiles(dir) {
  let count = 0
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry)
      if (statSync(full).isDirectory()) walk(full)
      else count++
    }
  }
  walk(dir)
  return count
}

console.log(`
Done. Next steps:

1. Restart your agent's session so the skills show up.
2. The design skill runs the validator and the viewer with Node 18+:
   node design/validate.mjs, node design/serve.mjs [port] [--share] [--open[=canvas]] [--no-open]
   (127.0.0.1 bind by default; the served root is ./design relative to the
   cwd; --share = read-only LAN mode with declared degradation; the server
   opens your default browser at the viewer — --open=<canvas> lands straight
   on a canvas, --no-open suppresses it, the BROWSER env var picks a browser),
   node design/scripts/gen-tokens.mjs (regenerates the token CSS),
   node design/scripts/sync-components.mjs (rematerializes components) and
   node design/scripts/export-tokens.mjs (exports tokens.w3c.json).
   validate.mjs and sync-components.mjs read design/validate.config.json
   (shipped by the skill's one-time copy list); without it they exit 3 and
   point at setup-design.mjs.
3. The impeccable skill downloads its engine binary on first run
   (once, needs network; if it fails it falls back to no engine).
4. Invoke it: type /design, /taste, /emil-design-eng or /impeccable (OpenCode
   slash commands), mention a skill as @design in your prompt, or just ask —
   the agent loads the matching skill itself.

To reinstall or install elsewhere, the two flags are:
node install.mjs --target <agent> (known target) or
node install.mjs --dir <folder> (any folder).
`)

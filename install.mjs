#!/usr/bin/env node
/**
 * Design Pack installer — installs the 4 skills (design, taste,
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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

const ALL_SKILLS = ['design', 'taste', 'emil-design-eng', 'impeccable']
const CRAFT_ONLY = ['taste', 'emil-design-eng', 'impeccable'] // craft.md references these

const TARGETS = {
  zcode: { dir: join(homedir(), '.agents', 'skills'), note: 'ZCode (padrao aberto ~/.agents/skills)' },
  agents: { dir: join(homedir(), '.agents', 'skills'), note: 'padrao aberto Agent Skills (OpenCode, ZCode e outros leem daqui)' },
  opencode: { dir: join(homedir(), '.config', 'opencode', 'skill'), note: 'OpenCode global (se nao detectar, use --dir ~/.agents/skills)' },
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
      console.error(`argumento desconhecido: ${arg} (use --help)`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help || (!args.target && !args.dir && !args.list)) {
  console.log(`Design Pack — instala as skills design, taste, emil-design-eng e impeccable.

Uso:
  node install.mjs --target <nome>    instala no diretorio de skills do agente
  node install.mjs --dir <caminho>    instala em qualquer pasta (ex.: .claude/skills do projeto)
  node install.mjs --only design,taste  instala um subconjunto
  node install.mjs --list             lista os destinos conhecidos

Destinos (--target):`)
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
  console.error(`--only invalido: ${unknown.join(', ') || '(vazio)'} — opções: ${ALL_SKILLS.join(', ')}`)
  process.exit(2)
}

let destDir
if (args.dir) {
  destDir = resolve(args.dir)
} else {
  const target = TARGETS[args.target]
  if (!target) {
    console.error(`--target "${args.target}" desconhecido — opções: ${Object.keys(TARGETS).join(', ')} (ou use --dir)`)
    process.exit(2)
  }
  destDir = target.dir
}

const packDir = import.meta.dirname
const missing = args.only.filter((name) => !existsSync(join(packDir, 'skills', name, 'SKILL.md')))
if (missing.length > 0) {
  console.error(`pacote incompleto, faltam: ${missing.join(', ')} (skills/<nome>/SKILL.md)`)
  process.exit(2)
}

/* ----------------------------------------------------------------- install */

console.log(`Instalando ${args.only.join(', ')}`)
console.log(`  de  ${packDir}`)
console.log(`  em  ${destDir}`)
console.log('')

mkdirSync(destDir, { recursive: true })
for (const name of args.only) {
  const dest = join(destDir, name)
  if (existsSync(dest)) {
    console.log(`  ~ ${name} (substituindo a versao anterior)`)
    rmSync(dest, { recursive: true, force: true })
  } else {
    console.log(`  + ${name}`)
  }
  cpSync(join(packDir, 'skills', name), dest, { recursive: true })
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
    if (!skillName || !hasDescription) throw new Error('frontmatter sem name/description')
    console.log(`  ok  ${name.padEnd(16)} ${String(files).padStart(3)} arquivos  (skill "${skillName}")`)
  } catch (error) {
    failures++
    console.error(`  ERRO ${name}: ${error.message}`)
  }
}
if (failures > 0) process.exit(1)

const craftPresent = args.only.includes('design')
const craftMissing = CRAFT_ONLY.filter((name) => !args.only.includes(name))
if (craftPresent && craftMissing.length > 0) {
  console.log(`
AVISO: a skill design carrega assets/craft.md, que referencia as skills
irmas (${craftMissing.join(', ')}) pelo caminho relativo ../<nome>. Instale-as
juntas (rode de novo sem --only) para a camada de craft completa.`)
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
Pronto. Proximos passos:

1. Reinicie a sessao do seu agente para que as skills aparecam.
2. A skill design roda o validador e o visualizador com Node 18+:
   node design/validate.mjs, node design/serve.mjs [porta] [--share]
   (bind 127.0.0.1 por padrao; a raiz servida e ./design relativa ao cwd;
   --share = LAN somente-leitura com degradacao declarada),
   node design/scripts/gen-tokens.mjs (regenera o CSS dos tokens),
   node design/scripts/sync-components.mjs (rematerializa componentes) e
   node design/scripts/export-tokens.mjs (exporta tokens.w3c.json) (instalado).
3. A skill impeccable baixa seu engine binario na primeira execucao
   (uma vez so, precisa de rede; se falhar, ela tem fallback sem engine).
4. Teste: peca "uma landing page para o app X" ou digite /design, /taste,
   /impeccable conforme o agente.

Para reinstalar ou instalar em outro lugar, as duas flags sao:
node install.mjs --target <agente> (destino conhecido) ou
node install.mjs --dir <pasta> (qualquer pasta).
`)

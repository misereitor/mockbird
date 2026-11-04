#!/usr/bin/env node
/**
 * docs/arquitetura-evolutiva.check.mjs — verificador embutido do documento de
 * arquitetura evolutiva (todo 2 do plano mockbird-evolution).
 *
 * Verifica, sem dependências externas (só node: builtins):
 *   1. docs/arquitetura-evolutiva.md tem exatamente os 10 cabeçalhos
 *      `## 1.` … `## 10.` (um de cada);
 *   2. os 4 ADRs iniciais existem em docs/adr/ e cada um contém as seções
 *      Status, Contexto, Decisão, Consequências e Reversibilidade
 *      (>= 4 cabeçalhos `## `);
 *   3. toda seção de contrato da §5 (report, brief, decisions, approvals,
 *      DesignAgent) cita schema com campo `schemaVersion`;
 *   4. §8 declara que "score é instrumento de rastreio" (exigência do todo 12);
 *   5. toda citação `caminho/arquivo.ext:linha` do documento e dos ADRs aponta
 *      para arquivo existente e linha dentro do arquivo (tokens de caminho em
 *      `código` = afirmação de existência; artefatos futuros vão em itálico);
 *   6. o gitSHA embutido no cabeçalho bate com docs/auditoria.json#gitSHA e o
 *      commit existe no git (drift de HEAD é listado; --strict-drift falha).
 *
 * Uso:
 *   node docs/arquitetura-evolutiva.check.mjs
 *   node docs/arquitetura-evolutiva.check.mjs --doc <copia.md> [--adr-dir <dir>]
 *   node docs/arquitetura-evolutiva.check.mjs --strict-drift
 *
 * Exit 0 = tudo verificado (lista as 10 seções + 4 ADRs no stdout).
 * Exit 1 = alguma verificação falhou (cada FALHA nomeia o item ausente).
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const DOC_DEFAULT = join(HERE, "arquitetura-evolutiva.md")
const ADR_DIR_DEFAULT = join(HERE, "adr")
const AUDIT_JSON = join(HERE, "auditoria.json")

const ADR_NAMES = [
  "ADR-0001-nucleo-deterministico-papeis-llm.md",
  "ADR-0002-camadas-core-skills-adapters.md",
  "ADR-0003-avaliadores-nunca-editam-codigo.md",
  "ADR-0004-politica-de-dependencias-zero-obrigatorias.md",
]
const ADR_SECTIONS = ["Status", "Contexto", "Decisão", "Consequências", "Reversibilidade"]
const CONTRACTS = [
  ["report", /report/i],
  ["brief", /brief/i],
  ["decisions", /decision/i],
  ["approvals", /approv/i],
  ["DesignAgent", /designagent/i],
]

// ---------- args ----------
const argv = process.argv.slice(2)
let docPath = DOC_DEFAULT
let adrDir = ADR_DIR_DEFAULT
let strictDrift = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--doc") docPath = resolve(argv[++i] ?? "")
  else if (a === "--adr-dir") adrDir = resolve(argv[++i] ?? "")
  else if (a === "--strict-drift") strictDrift = true
  else if (a === "--help" || a === "-h") {
    console.log("uso: node docs/arquitetura-evolutiva.check.mjs [--doc <arquivo>] [--adr-dir <dir>] [--strict-drift]")
    process.exit(0)
  } else {
    console.error(`FALHA: argumento desconhecido: ${a} (use --help)`)
    process.exit(1)
  }
}

const failures = []
const fail = (msg) => failures.push(msg)
const rel = (p) => (p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p)

// ---------- helpers ----------
function countLines(text) {
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  return lines.length
}

function sectionBody(text, fromNum, toNum) {
  const re = new RegExp(`^##\\s+${fromNum}\\.[^\\n]*$`, "m")
  const startMatch = re.exec(text)
  if (!startMatch) return null
  const rest = text.slice(startMatch.index + startMatch[0].length)
  const endRe = new RegExp(`^##\\s+${toNum}\\.`, "m")
  const endMatch = endRe.exec(rest)
  return endMatch ? rest.slice(0, endMatch.index) : rest
}

// ---------- 1. documento e seções ----------
if (!existsSync(docPath) || !statSync(docPath).isFile()) {
  console.error(`FALHA: documento não encontrado: ${docPath}`)
  process.exit(1)
}
const doc = readFileSync(docPath, "utf8")
console.log(`documento: ${rel(docPath)}`)

const headerRe = /^##\s+(\d+)\.\s+(\S[^\n]*)$/gm
const sections = []
for (const m of doc.matchAll(headerRe)) sections.push({ num: Number(m[1]), title: m[0].replace(/^##\s+/, "") })
const numericHeaders = (doc.match(/^##\s+\d/gm) || []).length
console.log(`SEÇÕES (esperado 10):`)
for (let n = 1; n <= 10; n++) {
  const found = sections.filter((s) => s.num === n)
  if (found.length === 1) console.log(`  ✓ ${found[0].title}`)
  else if (found.length === 0) {
    console.log(`  ✗ ## ${n}. — AUSENTE`)
    fail(`seção ausente: '## ${n}.' em ${rel(docPath)}`)
  } else {
    fail(`seção duplicada: '## ${n}.' aparece ${found.length}x em ${rel(docPath)}`)
  }
}
if (numericHeaders !== 10) fail(`esperado exatamente 10 cabeçalhos '## <n>.', encontrados ${numericHeaders} em ${rel(docPath)}`)

// ---------- 2. ADRs ----------
console.log(`ADRs (esperado 4 em ${rel(adrDir)}/):`)
const adrTexts = []
for (const name of ADR_NAMES) {
  const p = join(adrDir, name)
  if (!existsSync(p) || !statSync(p).isFile()) {
    console.log(`  ✗ ${name} — AUSENTE`)
    fail(`ADR ausente: ${rel(p)}`)
    continue
  }
  const text = readFileSync(p, "utf8")
  adrTexts.push([p, text])
  const nHeaders = (text.match(/^##\s+/gm) || []).length
  const missing = ADR_SECTIONS.filter((s) => !new RegExp(`^##\\s+${s}\\b`, "im").test(text))
  if (missing.length) {
    console.log(`  ✗ ${name} — seções ausentes: ${missing.join(", ")}`)
    fail(`ADR ${rel(p)} sem as seções: ${missing.join(", ")}`)
  } else if (nHeaders < 4) {
    console.log(`  ✗ ${name} — apenas ${nHeaders} cabeçalhos '## '`)
    fail(`ADR ${rel(p)} com menos de 4 seções '## '`)
  } else {
    console.log(`  ✓ ${name} (${nHeaders} seções; ${ADR_SECTIONS.join(", ")})`)
  }
}

// ---------- 3. contratos da §5 ----------
console.log(`CONTRATOS (§5 — cada seção cita schema com schemaVersion):`)
const sec5 = sectionBody(doc, 5, 6)
if (sec5 === null) {
  fail(`seção '## 5.' não encontrada — contratos inverificáveis`)
} else {
  const subs = []
  const lines = sec5.split("\n")
  let current = null
  for (const line of lines) {
    const h = /^###\s+([^\n]+)$/.exec(line)
    if (h) {
      current = { title: h[1], bodyLines: [] }
      subs.push(current)
    } else if (current) current.bodyLines.push(line)
  }
  for (const [name, re] of CONTRACTS) {
    const sub = subs.find((s) => re.test(s.title))
    const body = sub ? sub.bodyLines.join("\n") : ""
    if (!sub) {
      console.log(`  ✗ ${name} — subseção de contrato ausente em §5`)
      fail(`contrato '${name}' sem subseção em §5 de ${rel(docPath)}`)
    } else if (!body.includes("schemaVersion")) {
      console.log(`  ✗ ${name} — subseção sem campo schemaVersion`)
      fail(`contrato '${name}' sem campo schemaVersion em §5`)
    } else {
      console.log(`  ✓ ${name} (${sub.title.trim()})`)
    }
  }
}

// ---------- 4. regra do score (§8, exigência do todo 12) ----------
const sec8 = sectionBody(doc, 8, 9)
if (sec8 === null || !/score é instrumento de rastreio/i.test(sec8)) {
  console.log(`  ✗ §8 não declara 'score é instrumento de rastreio'`)
  fail(`§8 de ${rel(docPath)} deve declarar que score é instrumento de rastreio (todo 12)`)
} else {
  console.log(`REGRA §8: ✓ 'score é instrumento de rastreio' declarado`)
}

// ---------- 5. citações ----------
const PATH_TOKEN = /^([A-Za-z0-9_.][A-Za-z0-9_./-]*\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?(?:#([A-Za-z0-9_.-]+))?$/
let tokens = 0, withLine = 0, pointers = 0
for (const [label, text] of [[rel(docPath), doc], ...adrTexts.map(([p, t]) => [rel(p), t])]) {
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1]
    const match = PATH_TOKEN.exec(token)
    if (!match) continue
    const [, relPath, startStr, endStr] = match
    if (isAbsolute(relPath) || relPath.split("/").includes("..")) continue
    tokens++
    const full = join(ROOT, relPath)
    if (!existsSync(full) || !statSync(full).isFile()) {
      console.log(`  ✗ citação '${token}' em ${label} — arquivo não existe`)
      fail(`citação quebrada em ${label}: '${token}' não existe no repositório (caminhos futuros vão em itálico)`)
      continue
    }
    if (startStr) {
      withLine++
      const max = countLines(readFileSync(full, "utf8"))
      const start = Number(startStr)
      const end = endStr ? Number(endStr) : start
      if (start < 1 || start > end || end > max) {
        console.log(`  ✗ citação '${token}' em ${label} — linha fora do arquivo (tem ${max})`)
        fail(`citação quebrada em ${label}: '${token}' fora do arquivo ${relPath} (${max} linhas)`)
      }
    } else if (match[4]) {
      pointers++
    }
  }
}
console.log(`CITAÇÕES: ${tokens} tokens de caminho conferidos (${withLine} com linha, ${pointers} ponteiros) — arquivos e linhas reais`)

// ---------- 6. gitSHA auditado + drift ----------
if (!existsSync(AUDIT_JSON)) {
  fail(`auditoria ausente: ${rel(AUDIT_JSON)}`)
} else {
  let audit
  try {
    audit = JSON.parse(readFileSync(AUDIT_JSON, "utf8"))
  } catch {
    fail(`docs/auditoria.json não parseia como JSON válido`)
  }
  if (audit) {
    const audited = String(audit.gitSHA ?? "")
    const shaLines = doc.split("\n").filter((l) => l.includes("gitSHA"))
    const shas = shaLines.flatMap((l) => l.match(/\b[0-9a-f]{40}\b/g) ?? [])
    if (shas.length === 0) {
      fail(`cabeçalho de ${rel(docPath)} não embute o gitSHA auditado (linha com 'gitSHA' + SHA de 40 hex)`)
    } else if (shas.some((s) => s !== audited)) {
      fail(`gitSHA do documento (${shas.join(", ")}) difere de docs/auditoria.json#gitSHA (${audited})`)
    } else {
      console.log(`GITSHA: ${audited} == docs/auditoria.json#gitSHA ✓`)
    }
    try {
      execFileSync("git", ["cat-file", "-e", `${audited}^{commit}`], { cwd: ROOT, stdio: "pipe" })
    } catch {
      fail(`gitSHA auditado ${audited} não existe mais no git (re-audite: todo 1)`)
    }
    try {
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
      const behind = execFileSync("git", ["rev-list", "--count", `${audited}..HEAD`], { cwd: ROOT, encoding: "utf8" }).trim()
      const drift = `HEAD=${head.slice(0, 7)} base=${audited.slice(0, 7)} commitsDesdeABase=${behind}`
      if (strictDrift && Number(behind) > 0) {
        console.log(`DRIFT: ${drift}`)
        fail(`drift estrito: HEAD avançou ${behind} commit(s) desde o gitSHA auditado — documento reflete a base, não HEAD`)
      } else {
        console.log(`DRIFT (informativo; --strict-drift para falhar): ${drift}`)
      }
    } catch {
      console.log(`DRIFT: não calculável (git indisponível neste diretório)`)
    }
  }
}

// ---------- resultado ----------
if (failures.length) {
  for (const f of failures) console.error(`FALHA: ${f}`)
  console.error(`RESULTADO: ${failures.length} falha(s)`)
  process.exit(1)
}
console.log("OK — 10 seções, 4 ADRs, contratos §5, regra §8, citações e gitSHA verificados.")

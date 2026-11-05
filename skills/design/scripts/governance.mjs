/* mockbird:config-driven:v2 */
/**
 * governance.mjs (todo 24, GAP-C2) — lint de design system + relatório de
 * saúde. Report-only: NUNCA reescreve CSS do alvo (o gate de verdade é o
 * visual-gate.mjs, todo 12). Saída: <target>/.visual/health.json
 * ({schemaVersion, gitSHA, score, violations por regra, orphanTokens,
 * paletteDrift}).
 *
 * Regras (violações nomeadas por regra + arquivo):
 *   token-unused       (erro)  token declarado em tokens.json cujo nome de
 *                      variável nunca aparece na superfície do alvo
 *                      (nem var(--x) nem definição --x:) — "declarado e não
 *                      usado" no sentido literal: nunca entrou no sistema.
 *                      A sublista de tokens nunca REFERENCIADOS via var()
 *                      (órfãos no sentido estrito) é dado de saúde em
 *                      orphanTokens, sem derrubar o exit — o example do pack
 *                      declara grupos de contrato (motion/density/breakpoints/
 *                      layers, token-groups.mjs) consumidos pela ferramenta,
 *                      não por var() em tela.
 *   color-off-palette  (erro)  literal de cor em posição de valor (bloco
 *                      <style>, .css, style="", fill=/stroke= SVG) cujo RGB
 *                      base não está em nenhum valor de cor de tokens.json
 *                      (alpha pode variar: rgba da cor do token é a mesma
 *                      paleta). Detalhe em paletteDrift.
 *   spacing-off-scale  (erro)  valor absoluto em padding/margin/gap (e variantes
 *                      por lado/eixo) fora da escala declarada em tokens.json (todo px declarado em
 *                      qualquer grupo + 0). rem/em/pt em espaçamento também
 *                      são arbitrários.
 *   css-duplicate      (aviso) bloco de regra (selector + declarações) idêntico
 *                      em ≥2 arquivos — CSS redundante entre telas. Só
 *                      reportar: mover CSS é decisão de refatoração.
 *   component-reinvented (aviso) integração com o discovery (todo 23):
 *                      endpoint preparado — importa ./component-discovery.mjs
 *                      quando existir e expuser auditReinvented(targetDir),
 *                      senão lê <target>/components/discovery-log.json
 *                      (recomendações "create"), senão SKIP sem crash
 *                      (status "skipped: discovery ausente").
 *
 * Severidade × exit: erros derrubam o exit (1 = há erros de drift); avisos
 * entram no relatório e no score sem derrubar. Motivo: o contrato do plano
 * exige example → exit 0; os três drifts do GAP-C2 (tokens não usados, cores
 * fora da paleta, espaçamentos arbitrários) são os erros, enquanto duplicação
 * de CSS e componente reinventado exigem refatoração humana ("só reportar").
 *
 * Score: 100 - 10*erros - 2*avisos, clampado em [0,100].
 *
 * Exit codes (padrão validate.mjs): 0 = sem erros; 1 = erros de regra;
 * 2 = uso/dano de ferramenta (argumento, tokens.json sem cor); 3 = tokens.json
 * ausente/ilegível (erro guiado, nunca fallback silencioso).
 *
 * Stale state: health.json anterior com gitSHA diferente do HEAD é detectado e
 * regenerado; o campo staleRefresh.previousGitSHA registra a detecção.
 *
 * Determinismo: arquivos varridos em ordem estável, sem timestamp; o mesmo
 * alvo no mesmo commit produz os mesmos bytes.
 *
 * Node 18+, stdlib only (ADR-0004).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = 'governance.mjs --target <design-root> [--help]'

function die(message) {
  console.error(`governance: ${message}`)
  process.exit(2)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(path) {
  return String(path).split('\\').join('/')
}

function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function gitShaOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
let targetArg = './design'
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(USAGE)
    process.exit(0)
  } else if (token === '--target') {
    if (i + 1 >= argv.length) die(`--target requer um caminho — ${USAGE}`)
    targetArg = argv[i + 1]
    i += 1
  } else {
    die(`argumento desconhecido "${token}" — ${USAGE}`)
  }
}

const targetDir = resolve(targetArg)
const targetSt = (() => {
  try {
    return statSync(targetDir)
  } catch {
    return null
  }
})()
if (!targetSt?.isDirectory()) die(`target não encontrado ou não é diretório: ${targetArg}`)

// ---------------------------------------------------------------------------
// tokens.json → tokens (dotted + nomes de variável + valores), paleta RGB e
// escala de espaçamento declarada. Derivação de nome idêntica à de
// gen-tokens.mjs (kebab por segmento; composites typography achatam em
// <name>-<kebab(sub)>; shadow emite o nome base).
// ---------------------------------------------------------------------------
function loadTokensFile(dir) {
  const path = join(dir, 'tokens.json')
  let raw = null
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    console.error(`governance: tokens.json não encontrado em ${normalize(targetArg)} — a paleta vive em tokens.json (crie com skills/design/scripts/gen-tokens.mjs)`)
    process.exit(3)
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error(`governance: tokens.json ilegível (JSON inválido: ${String(error?.message ?? error)}) — corrija o arquivo ou regenere com skills/design/scripts/gen-tokens.mjs`)
    process.exit(3)
  }
  if (!isPlainObject(parsed)) die('tokens.json: raiz deve ser objeto com seções de tema')
  return parsed
}

function isNamespaceFolder(entry) {
  if (!isPlainObject(entry)) return false
  if (Object.prototype.hasOwnProperty.call(entry, '$value')) return false
  const children = Object.entries(entry).filter(([key]) => !key.startsWith('$'))
  return (
    children.length > 0 &&
    children.every(([, child]) => isPlainObject(child) && !Object.prototype.hasOwnProperty.call(child, '$value'))
  )
}

/** Um token por caminho dotted (temas repetidos a mesma estrutura contam uma vez). */
function collectTokens(root) {
  const byDotted = new Map()
  const walkTheme = (theme) => {
    const walk = (node, pathParts) => {
      for (const [key, entry] of Object.entries(node)) {
        if (key.startsWith('$')) continue
        const parts = [...pathParts, kebab(key)]
        const dotted = parts.join('.')
        const cssName = `--${parts.join('-')}`
        if (!isPlainObject(entry)) continue
        if (Object.prototype.hasOwnProperty.call(entry, '$value')) {
          const type = entry.$type ?? node.$type ?? null
          const value = entry.$value
          const record = { dotted, varNames: [], values: [] }
          if (isPlainObject(value) && type !== 'shadow') {
            for (const [sub, subValue] of Object.entries(value)) {
              if (sub.startsWith('$')) continue
              record.varNames.push(`${cssName}-${kebab(sub)}`)
              if (typeof subValue === 'string' || typeof subValue === 'number') record.values.push(String(subValue))
            }
          } else if (Array.isArray(value)) {
            record.varNames.push(cssName)
            for (const item of value) if (isPlainObject(item) && typeof item.color === 'string') record.values.push(item.color)
          } else {
            record.varNames.push(cssName)
            if (isPlainObject(value) && typeof value.color === 'string') record.values.push(value.color)
            else if (typeof value === 'string' || typeof value === 'number') record.values.push(String(value))
          }
          if (!byDotted.has(dotted)) {
            byDotted.set(dotted, record)
          } else {
            const known = byDotted.get(dotted)
            for (const name of record.varNames) if (!known.varNames.includes(name)) known.varNames.push(name)
            for (const value of record.values) if (!known.values.includes(value)) known.values.push(value)
          }
        } else if (typeof entry.$type === 'string' || isNamespaceFolder(entry)) {
          walk(entry, parts)
        }
      }
    }
    for (const [groupName, group] of Object.entries(theme)) {
      if (groupName.startsWith('$')) continue
      if (!isPlainObject(group)) continue
      walk(group, [kebab(groupName)])
    }
  }
  for (const [name, section] of Object.entries(root)) {
    if (name.startsWith('$')) continue
    if (isPlainObject(section)) walkTheme(section)
  }
  return [...byDotted.values()].sort((a, b) => (a.dotted < b.dotted ? -1 : a.dotted > b.dotted ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Cores: parser de literais (hex 3/4/6/8, rgb()/rgba(), nomes básicos) → RGB.
// Alpha nunca participa da comparação: rgba da cor do token é a mesma paleta.
// ---------------------------------------------------------------------------
const NAMED_COLORS = {
  aqua: '#00ffff', black: '#000000', blue: '#0000ff', fuchsia: '#ff00ff',
  gray: '#808080', green: '#008000', lime: '#00ff00', maroon: '#800000',
  navy: '#000080', olive: '#808000', orange: '#ffa500', purple: '#800080',
  red: '#ff0000', silver: '#c0c0c0', teal: '#008080', white: '#ffffff',
  yellow: '#ffff00',
}

function parseColor(text) {
  const value = String(text).trim().toLowerCase()
  if (value === 'transparent' || value === 'currentcolor' || value === 'inherit') return null
  const named = NAMED_COLORS[value]
  const hexMatch = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(named ?? value)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
  }
  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(value)
  if (rgbMatch) return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) }
  return null
}

function rgbKey(color) {
  return `${color.r},${color.g},${color.b}`
}

const HEX_LITERAL = /#[0-9a-f]{3,8}\b/gi
const RGB_LITERAL = /rgba?\([^)]*\)/gi

/** Literais de cor dentro de um valor de declaração (strings citadas removidas). */
function colorLiteralsIn(value) {
  const source = String(value).replace(/"[^"]*"|'[^']*'/g, ' ')
  const out = []
  for (const m of source.matchAll(HEX_LITERAL)) out.push(m[0])
  for (const m of source.matchAll(RGB_LITERAL)) out.push(m[0])
  for (const word of source.split(/[\s,/()]+/)) {
    if (word && Object.prototype.hasOwnProperty.call(NAMED_COLORS, word.toLowerCase())) out.push(word.toLowerCase())
  }
  return out
}

// ---------------------------------------------------------------------------
// Superfície CSS: regiões de valor por arquivo (.css, blocos <style>, style="",
// fill=/stroke= SVG) e blocos de regra (selector + declarações) para duplicação.
// ---------------------------------------------------------------------------
const WALK_EXT = /\.(?:css|html|svg)$/i
const SKIP_DIRS = new Set(['.visual', 'snapshots', 'node_modules'])
const EXEMPT_FILES = new Set(['mock.css']) // literal do backdrop — na lista de isenções do validate.mjs

function walkSurface(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkSurface(path, out)
    } else if (entry.isFile() && WALK_EXT.test(entry.name) && !EXEMPT_FILES.has(entry.name)) {
      out.push(path)
    }
  }
  return out
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** Declarações `property: value` de uma lista de declarações sem chaves. */
function declarationsOf(body) {
  const out = []
  for (const part of stripCssComments(body).split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (property && value) out.push({ property, value })
  }
  return out
}

/** Corpos de bloco mais internos (`{ ... }`) — só declarações, sem seletores. */
function blockBodies(content) {
  const out = []
  for (const m of stripCssComments(content).matchAll(/\{([^{}]*)\}/g)) out.push(m[1])
  return out
}

function styleRegions(content, ext) {
  const regions = [] // { where, decls }
  if (ext === '.css') {
    regions.push({ where: 'o arquivo CSS', decls: blockBodies(content).flatMap(declarationsOf) })
    return regions
  }
  for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    regions.push({ where: 'um bloco <style>', decls: blockBodies(m[1]).flatMap(declarationsOf) })
  }
  for (const m of content.matchAll(/(?<![A-Za-z0-9_-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    regions.push({ where: 'um atributo style', decls: declarationsOf(m[1] ?? m[2] ?? '') })
  }
  for (const m of content.matchAll(/(?<![A-Za-z0-9_-])(?:fill|stroke)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    regions.push({ where: 'um atributo SVG fill/stroke', decls: [{ property: 'fill', value: m[1] ?? m[2] ?? '' }] })
  }
  return regions
}

/** Blocos de regra selector{declarações} (mais internos; @media só envolve). */
function ruleBlocksOf(content) {
  const blocks = []
  for (const m of stripCssComments(content).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const body = m[2].trim().replace(/\s+/g, ' ').replace(/;\s*$/g, '')
    if (!selector || !body || selector.startsWith('@')) continue
    blocks.push({ selector, body })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------
const SPACING_PROPS = /^(padding|margin)(-(?:top|right|bottom|left))?$|^(gap|row-gap|column-gap)$/
const ABSOLUTE_UNIT = /^-?(\d+(?:\.\d+)?)(px|rem|em|pt|cm|mm|in|pc)$/

function ruleColorOffPalette(files, palette) {
  const violations = []
  const drift = new Map() // rgbKey → { color, files:Set }
  for (const { rel, content, ext } of files) {
    for (const { where, decls } of styleRegions(content, ext)) {
      for (const { value } of decls) {
        for (const literal of colorLiteralsIn(value)) {
          const parsed = parseColor(literal)
          if (!parsed) continue
          if (palette.has(rgbKey(parsed))) continue
          violations.push({ rule: 'color-off-palette', severity: 'error', file: rel, message: `cor literal "${literal}" em ${where} fora da paleta de tokens.json` })
          const key = rgbKey(parsed)
          if (!drift.has(key)) drift.set(key, { color: literal, files: new Set() })
          drift.get(key).files.add(rel)
        }
      }
    }
  }
  const paletteDrift = [...drift.values()]
    .map((entry) => ({ color: entry.color, files: [...entry.files].sort() }))
    .sort((a, b) => (a.color < b.color ? -1 : 1))
  return { violations, paletteDrift }
}

function ruleSpacingScale(files, scale) {
  const violations = []
  for (const { rel, content, ext } of files) {
    for (const { where, decls } of styleRegions(content, ext)) {
      for (const { property, value } of decls) {
        if (!SPACING_PROPS.test(property)) continue
        for (const token of String(value).replace(/"[^"]*"|'[^']*'/g, ' ').split(/[\s,]+/)) {
          if (!token || token === '0' || token.startsWith('var(') || token.startsWith('calc(')) continue
          if (token.endsWith('%') || token.endsWith('vw') || token.endsWith('vh') || token === 'auto') continue
          const match = ABSOLUTE_UNIT.exec(token)
          if (!match) continue
          const px = match[2] === 'px' ? Number(match[1]) : null
          if (px !== null && (px === 0 || scale.has(px))) continue
          violations.push({ rule: 'spacing-off-scale', severity: 'error', file: rel, message: `espaçamento arbitrário "${token}" em ${property} (${where}) fora da escala declarada` })
        }
      }
    }
  }
  return violations
}

function ruleTokenUnused(tokens, surface) {
  const violations = []
  const orphanTokens = []
  for (const token of tokens) {
    const present = token.varNames.some((name) => surface.includes(name))
    const referenced = token.varNames.some((name) => surface.includes(`var(${name}`))
    if (!referenced) orphanTokens.push({ token: token.dotted, varNames: token.varNames })
    if (!present) {
      violations.push({ rule: 'token-unused', severity: 'error', file: 'tokens.json', message: `token "${token.dotted}" declarado e não usado (nenhuma ocorrência de ${token.varNames.join('/')} na superfície)` })
    }
  }
  return { violations, orphanTokens }
}

function ruleCssDuplicate(files) {
  const seen = new Map() // key → { selector, body, files:Set }
  for (const { rel, content, ext } of files) {
    // Regras de CSS só vivem em arquivos .css e blocos <style>; markup e
    // <script> nunca são parseados como CSS.
    const sources = ext === '.css'
      ? [content]
      : [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
    for (const source of sources) {
      for (const { selector, body } of ruleBlocksOf(source)) {
        const key = `${selector}|${body}`
        if (!seen.has(key)) seen.set(key, { selector, body, files: new Set() })
        seen.get(key).files.add(rel)
      }
    }
  }
  const violations = []
  for (const { selector, files: where } of seen.values()) {
    if (where.size < 2) continue
    const list = [...where].sort()
    violations.push({ rule: 'css-duplicate', severity: 'warning', file: list[0], message: `bloco "${selector}" duplicado entre ${list.join(', ')}` })
  }
  return violations.sort((a, b) => (a.message < b.message ? -1 : 1))
}

/**
 * Endpoint preparado do discovery (todo 23): ./component-discovery.mjs pode
 * exportar auditReinvented(targetDir) -> [{file, component, message}]. Sem o
 * módulo, lê <target>/components/discovery-log.json (recomendações "create").
 * Sem nenhum dos dois: skip explícito, nunca crash.
 */
async function ruleComponentReinvented(target, targetLabel) {
  const modulePath = join(HERE, 'component-discovery.mjs')
  if (existsSync(modulePath)) {
    try {
      const mod = await import(pathToFileURL(modulePath).href)
      if (typeof mod.auditReinvented === 'function') {
        const findings = await mod.auditReinvented(target)
        const violations = []
        for (const finding of Array.isArray(findings) ? findings : []) {
          if (!isPlainObject(finding)) continue
          violations.push({
            rule: 'component-reinvented',
            severity: 'warning',
            file: typeof finding.file === 'string' ? finding.file : targetLabel,
            message: typeof finding.message === 'string' ? finding.message : `componente reinventado: ${String(finding.component ?? '?')}`,
          })
        }
        return { status: 'ok', violations, source: 'component-discovery.mjs' }
      }
    } catch (error) {
      console.error(`governance: component-discovery.mjs import falhou (${String(error?.message ?? error)}) — regra tolerada, sem crash`)
      return { status: 'skipped: discovery com erro', violations: [], source: null }
    }
  }
  const logPath = join(target, 'components', 'discovery-log.json')
  if (existsSync(logPath)) {
    try {
      const log = JSON.parse(readFileSync(logPath, 'utf8'))
      const entries = Array.isArray(log?.entries) ? log.entries : []
      const violations = []
      for (const entry of entries) {
        if (!isPlainObject(entry)) continue
        if (String(entry.recommendation ?? '') !== 'create') continue
        violations.push({
          rule: 'component-reinvented',
          severity: 'warning',
          file: typeof entry.file === 'string' ? entry.file : 'components/discovery-log.json',
          message: `componente reinventado: ${String(entry.component ?? '?')} — ${String(entry.justification ?? 'discovery recomendou reuso')}`,
        })
      }
      return { status: 'ok', violations, source: 'components/discovery-log.json' }
    } catch (error) {
      console.error(`governance: components/discovery-log.json ilegível (${String(error?.message ?? error)}) — regra tolerada, sem crash`)
      return { status: 'skipped: discovery-log ilegível', violations: [], source: null }
    }
  }
  return { status: 'skipped: discovery ausente', violations: [], source: null }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
const tokensRoot = loadTokensFile(targetDir)
const tokens = collectTokens(tokensRoot)

const palette = new Set()
const scale = new Set([0])
for (const token of tokens) {
  for (const value of token.values) {
    const parsed = parseColor(value)
    if (parsed) palette.add(rgbKey(parsed))
    const px = /^\d+(?:\.\d+)?px$/.exec(String(value).trim())
    if (px) scale.add(Number.parseFloat(value))
  }
}
if (palette.size === 0) die('tokens.json: nenhum valor de cor encontrado — fonte de paleta vazia (shape inesperado)')

const filePaths = walkSurface(targetDir)
const files = filePaths.map((path) => {
  const raw = readFileSync(path, 'utf8')
  // Comentários (CSS e HTML) nunca contam como uso nem como valor: um
  // comentário citando o nome do token não o torna "usado".
  const content = stripCssComments(raw).replace(/<!--[\s\S]*?-->/g, ' ')
  return {
    rel: normalize(path.slice(targetDir.length + 1)),
    content,
    ext: path.slice(path.lastIndexOf('.')).toLowerCase(),
  }
})
const surface = files.map((file) => file.content).join('\n')

const colorResult = ruleColorOffPalette(files, palette)
const spacingViolations = ruleSpacingScale(files, scale)
const tokenResult = ruleTokenUnused(tokens, surface)
const duplicateViolations = ruleCssDuplicate(files)
const reinvented = await ruleComponentReinvented(targetDir, normalize(targetArg))

const violations = [
  ...tokenResult.violations,
  ...colorResult.violations,
  ...spacingViolations,
  ...duplicateViolations,
  ...reinvented.violations,
].sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

const errors = violations.filter((v) => v.severity === 'error').length
const warnings = violations.length - errors
const score = Math.max(0, Math.min(100, 100 - 10 * errors - 2 * warnings))

const byRule = {}
for (const violation of violations) {
  if (!byRule[violation.rule]) byRule[violation.rule] = []
  byRule[violation.rule].push({ file: violation.file, message: violation.message, severity: violation.severity })
}

const rules = {
  'token-unused': { severity: 'error', status: tokenResult.violations.length > 0 ? 'violations' : 'ok' },
  'color-off-palette': { severity: 'error', status: colorResult.violations.length > 0 ? 'violations' : 'ok' },
  'spacing-off-scale': { severity: 'error', status: spacingViolations.length > 0 ? 'violations' : 'ok' },
  'css-duplicate': { severity: 'warning', status: duplicateViolations.length > 0 ? 'violations' : 'ok' },
  'component-reinvented': { severity: 'warning', status: reinvented.status },
}

const gitSHA = gitShaOf(targetDir)
const payload = {
  schemaVersion: 1,
  tool: 'governance.mjs',
  target: normalize(targetArg),
  gitSHA,
  score,
  violations: {
    total: violations.length,
    errors,
    warnings,
    byRule,
  },
  orphanTokens: tokenResult.orphanTokens,
  paletteDrift: colorResult.paletteDrift,
  rules,
}

// Stale state: relatório anterior de outro gitSHA é detectado e regenerado.
const outDir = join(targetDir, '.visual')
const outPath = join(outDir, 'health.json')
let previous = null
try {
  previous = JSON.parse(readFileSync(outPath, 'utf8'))
} catch {}
const previousSHA = isPlainObject(previous) && typeof previous.gitSHA === 'string' ? previous.gitSHA : null
if (previousSHA && previousSHA !== gitSHA) {
  payload.staleRefresh = { previousGitSHA: previousSHA }
  console.error(`governance: health.json anterior defasado (gitSHA ${previousSHA} ≠ ${gitSHA}) — regenerado`)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n')

console.log(`governance: ${normalize(targetArg)} — score ${score}/100 (${errors} erro(s), ${warnings} aviso(s))`)
if (violations.length > 0) {
  console.log('Fix these issues:')
  for (const violation of violations) {
    console.log(`${violation.rule}  ${violation.file}: ${violation.message}`)
  }
}
if (payload.orphanTokens.length > 0) {
  console.log(`tokens órfãos (sem var()): ${payload.orphanTokens.length} — ${payload.orphanTokens.map((t) => t.token).join(', ')}`)
}
if (payload.paletteDrift.length > 0) {
  console.log(`deriva de paleta: ${payload.paletteDrift.map((d) => d.color).join(', ')}`)
}
console.log(`health: ${normalize(join(targetArg, '.visual', 'health.json'))}`)

process.exit(errors > 0 ? 1 : 0)

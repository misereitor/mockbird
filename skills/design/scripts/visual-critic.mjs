#!/usr/bin/env node
/* mockbird:config-driven:v2 */
/**
 * visual-critic.mjs — Visual Critic determinístico (plano todo 11, GAP-A2).
 *
 * CONTRATO DURO: o critic SÓ diagnostica. Ele nunca escreve, corrige ou gera
 * código/arquivos de produto — a única escrita declarada é o próprio relatório
 * JSON no sink de saída (<target>/.visual/critic/ por padrão, --out muda).
 * Critic.test.mjs prova não-escrita por snapshot de hash do workspace antes e
 * depois da execução (mais um probe de sensibilidade com cópia corrompida).
 *
 * Passe determinístico OBRIGATÓRIO (8 detectores -> os 8 critérios reconciliados
 * de skills/design/assets/craft.md pós-todo 4):
 *
 *   contrast      acessibilidade  contraste WCAG medido em computed styles
 *                                  (MATEMÁTICA reutilizada de validate.mjs:326-
 *                                  421 via lib/contrast.mjs — extração verbatim,
 *                                  validate.mjs intocado). Texto normal < 4.5
 *                                  (AA) => blocker; < 7 (AAA) => minor. Texto
 *                                  grande (>=24px ou >=18.66px bold): < 3 =>
 *                                  blocker; < 4.5 => minor.
 *   text-clip     tipografia      texto cortado: overflow hidden/clip e
 *                                  scroll > client no eixo. Sem reticências =>
 *                                  blocker (conteúdo perdido); com ellipsis =>
 *                                  minor (advisory).
 *   overflow      responsividade  largura da página > viewport (scrollWidth >
 *                                  innerWidth) => major.
 *   alignment     composicao      bordas quase alinhadas entre irmãos de caixa
 *                                  (delta em (0.5, 8] px) => major.
 *   grid          espacamento     padding/margin/gap positivo fora da grade de
 *                                  4 px => minor.
 *   token-drift   consistencia    cor/background-color computados fora do
 *                                  contrato de tokens.json (RGB; alfa ignorado)
 *                                  => major. Sem tokens.json => detector skip
 *                                  (política de ausência, registrado no relatório).
 *   states        microinteracao  estados ausentes da matriz (default, modal,
 *                                  dropdown, form-invalid, loading, empty,
 *                                  error, success — mesma matriz do visual-
 *                                  capture). Barra esperada vem do vocabulário
 *                                  da tela (default sempre; form -> form-
 *                                  invalid; dialog/overlay -> modal; menu ->
 *                                  dropdown; coleção -> loading+empty).
 *                                  Cobertura declarada: marcadores
 *                                  <!-- state:X -->, chaves "scenarios" de
 *                                  data.json e screens[].states do canvas.json
 *                                  (soma, nunca silencia a barra; aliases
 *                                  pt-BR/en aceitos). Ausente => major.
 *   touch-target  acessibilidade  alvo interativo < 24 px (WCAG 2.5.8) =>
 *                                  blocker; 24-44 px => minor (2.5.5 AAA).
 *                                  Exceção inline (links dentro de texto).
 *
 * Passe de vision-LLM OPT-IN (só com --vision --budget-tokens N; proibido sem
 * as DUAS flags): adapter DesignAgent (seam do todo 32 — docs/arquitetura-
 * evolutiva.md §5.5) com stub determinístico offline incluso
 * (agent-adapters/stub-deterministic.mjs). O passe só EMITE issues — nunca
 * escreve arquivos — e o critic rejeita adapter que estoure o teto declarado.
 *
 * CONFINAMENTO da renderização: Playwright (playwright-core) servindo o target
 * por HTTP local efêmero; <script> removidos na transformação em memória (a
 * tela original NUNCA é alterada), CSP `script-src 'none'` em toda resposta e
 * toda sub-rede fora de 127.0.0.1 bloqueada. Nada do que a tela declara executa.
 *
 * Relatório (skills/design/assets/critic-report.schema.json):
 *   {schemaVersion, screen, viewport, state, score, issues:[{severity, category,
 *     element, problem, suggestion, evidence}], deterministic:{...},
 *     vision:{model, run, optIn}, gitSHA, screenHash, platform, timestamp}
 *   (gitSHA/screenHash/timestamp: regra anti-fake §5.6). Issues em ordem
 *   determinística (severity, category, element, problem). O score (0-100,
 *   100 - 25*blockers - 10*majors - 3*minors, piso 0) é instrumento de rastreio
 *   e NUNCA gateia — a semântica de gate é do todo 12; aqui --gate só decide o
 *   exit code pela presença de blockers (0=report-only, 1=com blockers).
 *
 * Usage: node skills/design/scripts/visual-critic.mjs [target] [--target <dir>]
 *          [--out <dir>] [--gate] [--vision --budget-tokens <N>] [--help]
 *   target = design-root ou canvas (com canvas.json); ./design por padrão.
 *   --out  sink dos relatórios (padrão: <target>/.visual/critic).
 *   Exit codes: 0 = relatório emitido (report-only), 1 = --gate com blockers,
 *               2 = erro de uso/entrada guiado (nomeia a tela; sem stack trace).
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { contrastForText, effectiveBackground, parseColorLiteral, parseColorWithAlpha } from './lib/contrast.mjs'
import { createDesignAgent, ADAPTER_ID } from './agent-adapters/stub-deterministic.mjs'

export const SCHEMA_VERSION = 1

/** Os 8 critérios reconciliados (ordem fixa = ordem de desempate). */
export const CATEGORIES = Object.freeze([
  'hierarquia',
  'composicao',
  'tipografia',
  'espacamento',
  'consistencia',
  'responsividade',
  'acessibilidade',
  'microinteracao',
])
/** Tríade fixa de severidade (ordem de desempate). */
export const SEVERITIES = Object.freeze(['blocker', 'major', 'minor'])

/** Matriz de estados canônica (idêntica à do visual-capture, todo 9). */
export const STATES = Object.freeze([
  'default',
  'modal',
  'dropdown',
  'form-invalid',
  'loading',
  'empty',
  'error',
  'success',
])

/** Estado canônico -> aliases aceitos em <!-- state:X --> e scenarios de data.json. */
const STATE_ALIASES = Object.freeze({
  default: ['default', 'padrao', 'base'],
  modal: ['modal', 'overlay', 'dialog', 'dialogo'],
  dropdown: ['dropdown', 'menu', 'select'],
  'form-invalid': ['form-invalid', 'invalid', 'invalido', 'form-erro', 'erro-formulario'],
  loading: ['loading', 'carregando', 'skeleton', 'carregando-dados'],
  empty: ['empty', 'vazio', 'sem-dados', 'lista-vazia', 'zero'],
  error: ['error', 'erro', 'critico', 'critical', 'falha', 'failure'],
  success: ['success', 'sucesso', 'ok', 'concluido', 'done'],
})

const ISSUES_SORTED_BY = Object.freeze(['severity', 'category', 'element', 'problem'])
const RENDERING = Object.freeze({ pageScripts: 'stripped', network: 'blocked' })

/** Teto de issues por detector por tela (saída determinística mesmo em DOM hostil). */
const CAPS = Object.freeze({
  contrast: 20,
  'text-clip': 10,
  overflow: 2,
  alignment: 5,
  grid: 10,
  'token-drift': 10,
  states: 8,
  'touch-target': 10,
})

const usage =
  'usage: node skills/design/scripts/visual-critic.mjs [target] [--target <dir>] [--out <dir>] ' +
  '[--gate] [--vision --budget-tokens <N>] [--help]'

const INTERACTIVE_SEL =
  'a[href], button, input:not([type=hidden]), select, textarea, summary, ' +
  '[role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=switch], ' +
  '[data-go], [data-action], [data-overlay], [data-close], [data-toast], [onclick]'
const BLOCKISH = new Set(['block', 'flex', 'grid', 'list-item', 'flow-root'])
const CLIP_OVERFLOW = new Set(['hidden', 'clip'])
const SKIP_DIRS = new Set(['node_modules', 'snapshots', 'vendor', '.visual', '.history'])
const MAX_ELEMENTS = 3000
const BOUND_TEXT = 80

// ---------------------------------------------------------------------------
// Erros guiados: uma linha nomeando a tela/entrada, exit 2, NUNCA stack trace.
// ---------------------------------------------------------------------------
class GuidedError extends Error {}

const die = (message) => {
  throw new GuidedError(message)
}

// ---------------------------------------------------------------------------
// Transformação em memória do HTML (o arquivo original NUNCA é tocado):
// injeta data-critic-line="<linha>" em toda start tag (mapeamento elemento ->
// linha de origem para as evidências) e REMOVE elementos <script> (nada do que
// a tela declara executa; CSP script-src 'none' é a segunda camada).
// ---------------------------------------------------------------------------
const RAWTEXT_KEEP = new Set(['style', 'textarea', 'title'])

function countNewlines(chunk) {
  let count = 0
  for (let i = 0; i < chunk.length; i += 1) if (chunk.charCodeAt(i) === 10) count += 1
  return count
}

function scanTagEnd(source, from) {
  let quote = null
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i
    }
  }
  return -1
}

function findRawtextEnd(source, from, tag) {
  const lower = source.toLowerCase()
  const needle = `</${tag}`
  let at = lower.indexOf(needle, from)
  while (at !== -1) {
    const after = at + needle.length
    const next = lower[after]
    if (next === undefined || next === '>' || next === '/' || next === ' ' || next === '\t' || next === '\n' || next === '\r') {
      const end = scanTagEnd(source, at)
      return end === -1 ? source.length : end + 1
    }
    at = lower.indexOf(needle, at + 1)
  }
  return source.length // rawtext sem fechamento: consome até o fim (como o browser)
}

export function transformHtml(source, label) {
  if (source.includes('\u0000')) die(`${label}: conteúdo não-texto (byte NUL) — tela rejeitada`)
  let out = ''
  let line = 1
  let i = 0
  const n = source.length
  while (i < n) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      const rest = source.slice(i)
      out += rest
      line += countNewlines(rest)
      break
    }
    const text = source.slice(i, lt)
    out += text
    line += countNewlines(text)
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      if (end === -1) die(`${label}: HTML malformado — comentário não termina (linha ${line})`)
      const chunk = source.slice(lt, end + 3)
      out += chunk
      line += countNewlines(chunk)
      i = end + 3
      continue
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = scanTagEnd(source, lt)
      if (end === -1) die(`${label}: HTML malformado — declaração não termina (linha ${line})`)
      const chunk = source.slice(lt, end + 1)
      out += chunk
      line += countNewlines(chunk)
      i = end + 1
      continue
    }
    if (source.startsWith('</', lt)) {
      const end = scanTagEnd(source, lt)
      if (end === -1) die(`${label}: HTML malformado — tag de fechamento não termina (linha ${line})`)
      const chunk = source.slice(lt, end + 1)
      out += chunk
      line += countNewlines(chunk)
      i = end + 1
      continue
    }
    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(source.slice(lt, Math.min(lt + 64, n)))
    if (!nameMatch) {
      out += '<'
      i = lt + 1
      continue
    }
    const tag = nameMatch[1].toLowerCase()
    const end = scanTagEnd(source, lt)
    if (end === -1) die(`${label}: HTML malformado — tag <${tag}> não termina (linha ${line})`)
    const rawTag = source.slice(lt, end + 1)
    if (tag === 'script') {
      // elemento inteiro removido (start + conteúdo + end) — payload nunca executa
      const after = findRawtextEnd(source, end + 1, tag)
      const dropped = source.slice(lt, after)
      line += countNewlines(dropped)
      i = after
      continue
    }
    const injected =
      rawTag.endsWith('/>')
        ? `${rawTag.slice(0, -2)} data-critic-line="${line}"/>`
        : `${rawTag.slice(0, -1)} data-critic-line="${line}">`
    if (RAWTEXT_KEEP.has(tag)) {
      const after = findRawtextEnd(source, end + 1, tag)
      const raw = source.slice(end + 1, after)
      out += injected + raw
      line += countNewlines(rawTag) + countNewlines(raw)
      i = after
      continue
    }
    out += injected
    line += countNewlines(rawTag)
    i = end + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// Descoberta de telas (espelho de discoverCanvases do validate.mjs): cada dir
// com canvas.json é um canvas e suas screens[] são as telas; fallback: *.html
// soltos na raiz do target. Entrada vazia/ausente => erro guiado explícito
// (NUNCA "0 problemas").
// ---------------------------------------------------------------------------
function readJsonQuiet(full, label) {
  let raw
  try {
    raw = readFileSync(full, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    die(`${label}: JSON inválido (${full})`)
  }
  return null
}

function walkCanvasDirs(dir, targetDir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (existsSync(join(full, 'canvas.json'))) out.push(full)
    else walkCanvasDirs(full, targetDir, out)
  }
}

const FALLBACK_VIEWPORT = { mobile: [390, 844], tablet: [768, 1024], desktop: [1440, 900] }

function viewportFor(entry) {
  const w = entry?.width
  const h = entry?.height
  if (Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1) return `${w}x${h}`
  const byDevice = FALLBACK_VIEWPORT[entry?.device]
  return byDevice ? `${byDevice[0]}x${byDevice[1]}` : '1440x900'
}

export function discoverScreens(targetDir) {
  const st = (() => {
    try {
      return statSync(targetDir)
    } catch {
      return null
    }
  })()
  if (!st || !st.isDirectory()) die(`visual-critic: target não encontrado ou não é diretório: ${targetDir}`)
  const canvasDirs = []
  if (existsSync(join(targetDir, 'canvas.json'))) canvasDirs.push(targetDir)
  walkCanvasDirs(targetDir, targetDir, canvasDirs)
  const screens = []
  if (canvasDirs.length === 0) {
    const loose = readdirSync(targetDir)
      .filter((name) => extname(name).toLowerCase() === '.html')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const name of loose) {
      screens.push({ file: name, abs: join(targetDir, name), viewport: '1440x900', states: null })
    }
  } else {
    for (const canvasDir of canvasDirs.sort()) {
      const canvasRel = canvasDir === targetDir ? '' : canvasDir.slice(targetDir.length + 1)
      const label = canvasRel || '.'
      const manifest = readJsonQuiet(join(canvasDir, 'canvas.json'), label)
      if (!manifest || !Array.isArray(manifest.screens)) die(`${label}: canvas.json sem "screens"`)
      for (const entry of manifest.screens) {
        if (!entry || typeof entry.file !== 'string') die(`${label}: entrada de screen sem "file"`)
        const abs = join(canvasDir, entry.file)
        if (!existsSync(abs)) die(`${label}: tela listada no canvas.json não existe: ${entry.file}`)
        screens.push({
          file: canvasRel ? `${canvasRel}${sep}${entry.file}` : entry.file,
          abs,
          viewport: viewportFor(entry),
          states: Array.isArray(entry.states) ? entry.states : null,
        })
      }
    }
  }
  if (screens.length === 0) die(`visual-critic: nenhuma tela encontrada em ${targetDir} — informe um canvas.json com screens ou telas .html`)
  return screens
}

// ---------------------------------------------------------------------------
// Tokens do contrato (detector token-drift): cores de todos os temas.
// Ausência de tokens.json => skip registrado (política de ausência).
// ---------------------------------------------------------------------------
export function loadTokenColors(targetDir) {
  const full = join(targetDir, 'tokens.json')
  if (!existsSync(full)) return null
  const tokens = readJsonQuiet(full, 'tokens.json')
  const colors = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const type = typeof node.$type === 'string' ? node.$type : null
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('$')) continue
      if (value && typeof value === 'object') {
        const leafType = typeof value.$type === 'string' ? value.$type : type
        if (typeof value.$value === 'string' && leafType === 'color') {
          const rgb = parseColorLiteral(value.$value)
          if (rgb) colors.add(`${rgb[0]},${rgb[1]},${rgb[2]}`)
        } else {
          walk(value)
        }
      }
    }
  }
  walk(tokens)
  return colors.size > 0 ? colors : null
}

// ---------------------------------------------------------------------------
// Análise estática: declarações de estado (marcadores <!-- state:X --> e
// chaves "scenarios" de data.json) com linhas de evidência.
// ---------------------------------------------------------------------------
function staticStateDeclarations(source, canvasDir) {
  const declared = new Map() // nome declarado -> linha de evidência
  const markerRe = /<!--\s*state:([A-Za-z][A-Za-z0-9_-]*)\s*-->/g
  let m
  while ((m = markerRe.exec(source)) !== null) {
    const name = m[1]
    if (!declared.has(name)) declared.set(name, 1 + countNewlines(source.slice(0, m.index)))
  }
  const dataPath = join(canvasDir, 'data.json')
  if (existsSync(dataPath)) {
    const raw = readFileSync(dataPath, 'utf8')
    const data = readJsonQuiet(dataPath, 'data.json')
    const scenarios = data?.scenarios
    if (scenarios && typeof scenarios === 'object' && !Array.isArray(scenarios)) {
      for (const key of Object.keys(scenarios)) {
        if (declared.has(key)) continue
        const at = raw.indexOf(`"${key}"`)
        declared.set(key, at === -1 ? 1 : 1 + countNewlines(raw.slice(0, at)))
      }
    }
  }
  return declared
}

function canonicalState(name) {
  const lower = String(name).toLowerCase()
  for (const [canonical, aliases] of Object.entries(STATE_ALIASES)) {
    if (aliases.includes(lower)) return canonical
  }
  return null
}

// ---------------------------------------------------------------------------
// Coleta em página (Playwright evaluate): medidas em computed styles. O DOM é
// não-confiável — tudo é truncado/limitado; semântica documentada no header.
// ---------------------------------------------------------------------------
async function collectPageData(page) {
  return page.evaluate(
    ({ interactiveSel, bound, maxElements }) => {
      const all = document.querySelectorAll('*')
      const indexByEl = new Map()
      all.forEach((el, idx) => indexByEl.set(el, idx))
      const skipTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'TEMPLATE', 'NOSCRIPT'])
      const elements = []
      for (const el of all) {
        if (skipTags.has(el.tagName)) continue
        const cs = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const visible =
          rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01
        let text = ''
        let hasText = false
        for (const node of el.childNodes) {
          if (node.nodeType === 3) {
            const t = node.textContent.trim()
            if (t) {
              hasText = true
              if (text.length < bound) text += (text ? ' ' : '') + t.slice(0, bound)
            }
          }
        }
        const bgStack = []
        let bgImage = false
        let node = el
        for (let depth = 0; depth < 12 && node && node.nodeType === 1; depth += 1) {
          const ncs = getComputedStyle(node)
          if (ncs.backgroundImage && ncs.backgroundImage !== 'none') bgImage = true
          const bg = ncs.backgroundColor
          if (bg && bg !== 'transparent') {
            bgStack.push(bg)
            const parts = /rgba?\(([^)]+)\)/.exec(bg)
            const nums = parts ? parts[1].split(/[\s,/]+/).filter(Boolean).map(Number) : []
            if (nums.length >= 4 && nums[3] >= 1) break
            if (nums.length === 3) break
          }
          node = node.parentElement
        }
        let inlineInText = false
        if (cs.display === 'inline' && el.parentElement) {
          for (const sib of el.parentElement.childNodes) {
            if (sib.nodeType === 3 && sib.textContent.trim()) {
              inlineInText = true
              break
            }
          }
        }
        elements.push({
          parentKey: el.parentElement ? (indexByEl.get(el.parentElement) ?? -1) : -1,
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: Array.from(el.classList).slice(0, 3),
          line: el.getAttribute('data-critic-line') || '',
          text: text.slice(0, bound),
          hasText,
          color: cs.color,
          bgColor: cs.backgroundColor,
          bgStack,
          bgImage,
          fontSize: parseFloat(cs.fontSize) || 0,
          fontWeight: Number(cs.fontWeight) || (/bold/i.test(cs.fontWeight) ? 700 : 400),
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          textOverflow: cs.textOverflow,
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          clipPath: cs.clipPath,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          display: cs.display,
          position: cs.position,
          padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
          margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft],
          gap: [cs.rowGap, cs.columnGap],
          interactive: el.matches(interactiveSel),
          inlineInText,
          tiny: rect.width <= 2 && rect.height <= 2,
          visible,
        })
        if (elements.length >= maxElements) break
      }
      return {
        meta: {
          scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        },
        flags: {
          hasFormControls: !!document.querySelector('input, textarea, select'),
          hasDialog: !!document.querySelector('[role=dialog],[role=alertdialog],[aria-modal],[data-overlay]'),
          hasDialogLink: !!document.querySelector('a[href*="modal"],a[href*="overlay"],a[href*="dialog"],a[href*="drawer"]'),
          hasMenu: !!document.querySelector('details > summary, [aria-haspopup], [data-menu], [data-dropdown]'),
          hasCollection: !!document.querySelector('table, [data-list], [data-feed], [role=list], [role=grid], [role=feed]'),
        },
        truncated: elements.length >= maxElements,
        elements,
      }
    },
    { interactiveSel: INTERACTIVE_SEL, bound: BOUND_TEXT, maxElements: MAX_ELEMENTS }
  )
}

// ---------------------------------------------------------------------------
// Detectores (lado Node: semântica + limiares + evidência arquivo:linha).
// ---------------------------------------------------------------------------
function descriptor(el) {
  let d = el.tag
  if (el.id) d += `#${el.id}`
  if (el.cls.length > 0) d += `.${el.cls.join('.')}`
  return d.slice(0, 80)
}

function px(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function offGrid(v) {
  return v !== null && v > 0.5 && Math.abs(v - Math.round(v / 4) * 4) > 0.5
}

function issue(severity, category, element, problem, suggestion, evidence) {
  return { severity, category, element, problem, suggestion, evidence }
}

function detectContrast(elements, screenRel) {
  const out = []
  for (const el of elements) {
    if (out.length >= CAPS.contrast) break
    if (!el.visible || !el.hasText || el.bgImage || el.tiny) continue
    const fg = parseColorWithAlpha(el.color)
    if (!fg) continue
    const bgStack = el.bgStack.map((c) => parseColorWithAlpha(c)).filter(Boolean)
    const ratio = contrastForText(fg, bgStack)
    const bg = effectiveBackground(bgStack)
    const bgLabel = `rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`
    const large = el.fontSize >= 24 || (el.fontSize >= 18.66 && el.fontWeight >= 700)
    const aa = large ? 3 : 4.5
    const aaa = large ? 4.5 : 7
    if (ratio >= aaa) continue
    const severity = ratio < aa ? 'blocker' : 'minor'
    const alvo = large ? 'texto grande' : 'texto normal'
    out.push(
      issue(
        severity,
        'acessibilidade',
        descriptor(el),
        `contraste ${ratio.toFixed(2)}:1 abaixo do mínimo WCAG (${alvo}: ${ratio < aa ? `AA ${aa}:1` : `AAA ${aaa}:1`}) — cor ${el.color} sobre ${bgLabel}`,
        ratio < aa
          ? 'escurecer/clarear o texto ou o fundo até atingir o mínimo AA (4.5:1 normal, 3:1 grande)'
          : 'elevar o contraste até 7:1 (4.5:1 grande) para atingir AAA',
        `${screenRel}:${el.line || '?'}: ratio ${ratio.toFixed(2)} < ${ratio < aa ? aa : aaa}`
      )
    )
  }
  return out
}

function detectTextClip(elements, screenRel) {
  const out = []
  for (const el of elements) {
    if (out.length >= CAPS['text-clip']) break
    if (!el.visible || !el.hasText || el.tiny || el.clipPath !== 'none') continue
    const clipX = CLIP_OVERFLOW.has(el.overflowX) && el.scrollW > el.clientW + 1
    const clipY = CLIP_OVERFLOW.has(el.overflowY) && el.scrollH > el.clientH + 1
    if (!clipX && !clipY) continue
    const ellipsis = el.textOverflow === 'ellipsis'
    const axis = clipX ? 'horizontal' : 'vertical'
    out.push(
      issue(
        ellipsis ? 'minor' : 'blocker',
        'tipografia',
        descriptor(el),
        `texto cortado ${ellipsis ? 'com reticências' : 'sem reticências'} no eixo ${axis} (scroll ${clipX ? el.scrollW : el.scrollH}px > área ${clipX ? el.clientW : el.clientH}px, overflow ${clipX ? el.overflowX : el.overflowY})`,
        ellipsis
          ? 'verificar se a truncagem perde significado; preferir quebra de linha ou conteúdo completo'
          : 'liberar espaço (largura/altura ou quebra de linha) para o texto caber — conteúdo está sendo perdido',
        `${screenRel}:${el.line || '?'}: ${clipX ? `scrollWidth ${el.scrollW} > clientWidth ${el.clientW}` : `scrollHeight ${el.scrollH} > clientHeight ${el.clientH}`}`
      )
    )
  }
  return out
}

function detectOverflow(meta, screenRel, viewport) {
  if (meta.scrollWidth <= meta.innerWidth + 1) return []
  return [
    issue(
      'major',
      'responsividade',
      'html',
      `overflow horizontal: página com ${meta.scrollWidth}px de largura em viewport de ${meta.innerWidth}px`,
      'conter a largura do conteúdo (max-width, quebra de palavra, remover elemento transbordante)',
      `${screenRel}:1: scrollWidth ${meta.scrollWidth} > innerWidth ${meta.innerWidth} (${viewport})`
    ),
  ]
}

function detectAlignment(elements, screenRel) {
  const groups = new Map()
  for (const el of elements) {
    if (!el.visible || !BLOCKISH.has(el.display)) continue
    if (el.position !== 'static' && el.position !== 'relative') continue
    if (el.rect.w <= 8) continue
    if (!groups.has(el.parentKey)) groups.set(el.parentKey, [])
    groups.get(el.parentKey).push(el)
  }
  const out = []
  const round = (v) => Math.round(v * 2) / 2
  for (const group of groups.values()) {
    if (out.length >= CAPS.alignment) break
    if (group.length < 2) continue
    for (const [get, kind] of [
      [(e) => e.rect.x, 'esquerda'],
      [(e) => e.rect.x + e.rect.w, 'direita'],
    ]) {
      const clusters = new Map()
      for (const el of group) {
        const edge = round(get(el))
        if (!clusters.has(edge)) clusters.set(edge, el)
      }
      const edges = [...clusters.keys()].sort((a, b) => a - b)
      for (let i = 0; i + 1 < edges.length; i += 1) {
        const gap = edges[i + 1] - edges[i]
        if (gap > 0.5 && gap <= 8) {
          const a = clusters.get(edges[i])
          const b = clusters.get(edges[i + 1])
          out.push(
            issue(
              'major',
              'composicao',
              descriptor(b),
              `borda ${kind} quase alinhada com ${descriptor(a)} (delta ${gap.toFixed(1)}px)`,
              `alinhar as bordas exatas (${kind} em ${edges[i]}px) ou separar de forma deliberada`,
              `${screenRel}:${b.line || '?'}: ${kind} ${edges[i + 1]}px vs ${edges[i]}px (delta ${gap.toFixed(1)}px)`
            )
          )
          if (out.length >= CAPS.alignment) break
        }
      }
    }
  }
  return out
}

function detectGrid(elements, screenRel) {
  const out = []
  for (const el of elements) {
    if (out.length >= CAPS.grid) break
    if (!el.visible) continue
    const names = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'row-gap', 'column-gap']
    const values = [...el.padding, ...el.margin, ...el.gap]
    for (let i = 0; i < values.length; i += 1) {
      if (out.length >= CAPS.grid) break
      const v = px(values[i])
      if (offGrid(v)) {
        out.push(
          issue(
            'minor',
            'espacamento',
            descriptor(el),
            `${names[i]} = ${v}px fora da grade de espaçamento de 4px`,
            'mover para o múltiplo de 4px mais próximo da escala de espaçamento',
            `${screenRel}:${el.line || '?'}: ${names[i]} ${v}px`
          )
        )
      }
    }
  }
  return out
}

function detectTokenDrift(elements, screenRel, tokenColors) {
  if (!tokenColors) return []
  const out = []
  const checked = (value) => {
    const rgba = parseColorWithAlpha(value)
    if (!rgba || rgba[3] <= 0) return true // invisível/ilegível: fora do escopo
    return tokenColors.has(`${Math.round(rgba[0])},${Math.round(rgba[1])},${Math.round(rgba[2])}`)
  }
  for (const el of elements) {
    if (out.length >= CAPS['token-drift']) break
    if (!el.visible) continue
    if (!checked(el.color)) {
      out.push(
        issue(
          'major',
          'consistencia',
          descriptor(el),
          `cor de texto ${el.color} fora do contrato de tokens.json`,
          'usar uma cor de tokens.json (utilitário ou var(--color-*)) em vez de valor literal',
          `${screenRel}:${el.line || '?'}: color ${el.color}`
        )
      )
    }
    if (out.length >= CAPS['token-drift']) break
    if (!checked(el.bgColor)) {
      out.push(
        issue(
          'major',
          'consistencia',
          descriptor(el),
          `cor de fundo ${el.bgColor} fora do contrato de tokens.json`,
          'usar uma cor de tokens.json (utilitário ou var(--color-*)) em vez de valor literal',
          `${screenRel}:${el.line || '?'}: background-color ${el.bgColor}`
        )
      )
    }
  }
  return out
}

function detectMissingStates({ declarations, manifestStates, flags, screenRel, dataLabel }) {
  // Esperado: a barra vem SEMPRE do vocabulário da tela (default sempre;
  // form -> form-invalid; dialog/overlay -> modal; menu -> dropdown; coleção ->
  // loading+empty). Cobertura declarada: marcadores <!-- state:X -->, chaves
  // "scenarios" de data.json e screens[].states do canvas.json (declaração
  // autoritativa do contrato de estados da tela — soma, nunca silencia a barra).
  const expected = ['default']
  if (flags.hasFormControls) expected.push('form-invalid')
  if (flags.hasDialog || flags.hasDialogLink) expected.push('modal')
  if (flags.hasMenu) expected.push('dropdown')
  if (flags.hasCollection) expected.push('loading', 'empty')
  const expectedSet = [...new Set(expected)]
  const declaredCanonical = new Set()
  for (const name of declarations.keys()) {
    const canonical = canonicalState(name)
    if (canonical) declaredCanonical.add(canonical)
  }
  for (const name of manifestStates ?? []) {
    const canonical = canonicalState(name) ?? (STATES.includes(name) ? name : null)
    if (canonical) declaredCanonical.add(canonical)
  }
  const firstMarkerLine = declarations.size > 0 ? Math.min(...declarations.values()) : 1
  const out = []
  for (const state of expectedSet) {
    if (out.length >= CAPS.states) break
    if (declaredCanonical.has(state)) continue
    out.push(
      issue(
        'major',
        'microinteracao',
        'html',
        `estado "${state}" ausente da matriz de estados (sem cobertura declarada)`,
        `declarar o estado (marcador <!-- state:${state} --> na tela ou chave "${state}" em ${dataLabel}) e dar superfície a ele`,
        `${screenRel}:${firstMarkerLine}: declarados [${[...declaredCanonical].sort().join(', ')}] — esperado incluir "${state}"`
      )
    )
  }
  return out
}

function detectTouchTargets(elements, screenRel) {
  const out = []
  for (const el of elements) {
    if (out.length >= CAPS['touch-target']) break
    if (!el.visible || !el.interactive || el.inlineInText) continue
    const min = Math.min(el.rect.w, el.rect.h)
    if (min >= 44) continue
    const severity = min < 24 ? 'blocker' : 'minor'
    out.push(
      issue(
        severity,
        'acessibilidade',
        descriptor(el),
        `alvo de toque ${Math.round(el.rect.w)}x${Math.round(el.rect.h)}px abaixo do mínimo (${min < 24 ? '24px WCAG 2.5.8' : '44px WCAG 2.5.5'})`,
        'ampliar a área clicável para pelo menos 44x44px (padding ou área de toque estendida)',
        `${screenRel}:${el.line || '?'}: bounding box ${Math.round(el.rect.w)}x${Math.round(el.rect.h)}px`
      )
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Ordenação determinística + score (rastreio; NUNCA gateia sozinho).
// ---------------------------------------------------------------------------
export function sortIssues(issues) {
  const sevRank = (s) => SEVERITIES.indexOf(s)
  const catRank = (c) => CATEGORIES.indexOf(c)
  return [...issues].sort((a, b) => {
    const s = sevRank(a.severity) - sevRank(b.severity)
    if (s !== 0) return s
    const c = catRank(a.category) - catRank(b.category)
    if (c !== 0) return c
    if (a.element !== b.element) return a.element < b.element ? -1 : 1
    if (a.problem !== b.problem) return a.problem < b.problem ? -1 : 1
    return 0
  })
}

export function scoreOf(issues) {
  let blocker = 0
  let major = 0
  let minor = 0
  for (const it of issues) {
    if (it.severity === 'blocker') blocker += 1
    else if (it.severity === 'major') major += 1
    else minor += 1
  }
  return Math.max(0, 100 - 25 * blocker - 10 * major - 3 * minor)
}

// ---------------------------------------------------------------------------
// Validador estrutural embutido (ajv-free) para critic-report.schema.json.
// Subconjunto de JSON Schema: $ref local, type, const, enum, required,
// properties, additionalProperties:false, items, minimum, maximum, minLength,
// minItems, pattern.
// ---------------------------------------------------------------------------
export function validateAgainstSchema(value, schema, root = schema, path = '$') {
  const errors = []
  const check = (v, s, p) => {
    if (!s || typeof s !== 'object') return
    if (typeof s.$ref === 'string') {
      const name = s.$ref.replace(/^#\/\$defs\//, '')
      check(v, root.$defs?.[name], p)
      return
    }
    if ('const' in s && v !== s.const) {
      errors.push(`${p}: esperado const ${JSON.stringify(s.const)}`)
      return
    }
    if (Array.isArray(s.enum) && !s.enum.includes(v)) {
      errors.push(`${p}: fora do enum ${JSON.stringify(s.enum)}`)
      return
    }
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : []
    const actual = Array.isArray(v)
      ? 'array'
      : v === null
        ? 'null'
        : typeof v === 'number'
          ? Number.isInteger(v)
            ? 'integer'
            : 'number'
          : typeof v
    if (types.length > 0 && !types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
      errors.push(`${p}: tipo ${actual}, esperado ${types.join('|')}`)
      return
    }
    if (typeof v === 'string') {
      if (typeof s.minLength === 'number' && v.length < s.minLength) errors.push(`${p}: string menor que minLength ${s.minLength}`)
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(v)) errors.push(`${p}: não casa o pattern ${s.pattern}`)
    }
    if (typeof v === 'number') {
      if (typeof s.minimum === 'number' && v < s.minimum) errors.push(`${p}: menor que minimum ${s.minimum}`)
      if (typeof s.maximum === 'number' && v > s.maximum) errors.push(`${p}: maior que maximum ${s.maximum}`)
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === 'number' && v.length < s.minItems) errors.push(`${p}: array menor que minItems ${s.minItems}`)
      if (s.items) v.forEach((item, i) => check(item, s.items, `${p}[${i}]`))
    }
    if (actual === 'object') {
      for (const key of s.required ?? []) {
        if (!(key in v)) errors.push(`${p}: falta a propriedade obrigatória "${key}"`)
      }
      if (s.properties) {
        for (const [key, sub] of Object.entries(s.properties)) {
          if (key in v) check(v[key], sub, `${p}.${key}`)
        }
      }
      if (s.additionalProperties === false && s.properties) {
        for (const key of Object.keys(v)) {
          if (!(key in s.properties)) errors.push(`${p}: propriedade não permitida "${key}"`)
        }
      }
    }
  }
  check(value, schema, path)
  return errors
}

// ---------------------------------------------------------------------------
// Servidor HTTP local efêmero (só leitura do target) + renderização confinada.
// ---------------------------------------------------------------------------
function startServer(targetDir) {
  const server = createServer((req, res) => {
    try {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '')
      const full = resolve(targetDir, rel)
      if (full !== targetDir && !full.startsWith(targetDir + sep)) {
        res.writeHead(403).end('fora do target')
        return
      }
      if (!existsSync(full) || !statSync(full).isFile()) {
        res.writeHead(404).end('nao encontrado')
        return
      }
      const isHtml = extname(full).toLowerCase() === '.html'
      const body = isHtml ? transformHtml(readFileSync(full, 'utf8'), rel) : readFileSync(full)
      res.writeHead(200, {
        'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/octet-stream',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      })
      res.end(body)
    } catch (err) {
      res.writeHead(500).end(err instanceof GuidedError ? err.message : 'erro interno')
    }
  })
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }))
  })
}

async function launchBrowser() {
  const require2 = createRequire(import.meta.url)
  let chromium
  try {
    ;({ chromium } = require2('playwright-core'))
  } catch {
    die('visual-critic: playwright-core indisponível — instale as dependências (npm ci) e provisione o navegador (npx playwright-core install chromium)')
  }
  try {
    return await chromium.launch()
  } catch (err) {
    die(`visual-critic: navegador indisponível (${String(err.message).split('\n')[0]}) — provisione com npx playwright-core install chromium`)
  }
}

// ---------------------------------------------------------------------------
// Orquestração de uma análise de tela: renderiza o quadro estático, roda os
// detectores e (opt-in) o passe de visão — só emite issues.
// ---------------------------------------------------------------------------
async function analyzeScreen({ browser, port, screen, tokenColors, vision, budgetTokens, adapter, schema }) {
  const source = readFileSync(screen.abs, 'utf8')
  const screenRel = screen.file.split(sep).join('/')
  const canvasDir = resolve(screen.abs, '..')
  const declarations = staticStateDeclarations(source, canvasDir)
  transformHtml(source, screenRel) // validação antecipada: erro guiado (exit 2) propaga antes da renderização
  const context = await browser.newContext({
    viewport: {
      width: Number(screen.viewport.split('x')[0]),
      height: Number(screen.viewport.split('x')[1]),
    },
  })
  await context.route('**/*', (route) => {
    const url = route.request().url()
    return url.startsWith(`http://127.0.0.1:${port}/`) ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  let collected
  let screenshotPng = null
  try {
    await page.goto(`http://127.0.0.1:${port}/${screenRel}`, { waitUntil: 'load', timeout: 15_000 })
    collected = await collectPageData(page)
    if (vision) screenshotPng = await page.screenshot({ fullPage: true })
  } finally {
    await context.close().catch(() => {})
  }
  const elements = collected.elements
  const issues = [
    ...detectContrast(elements, screenRel),
    ...detectTextClip(elements, screenRel),
    ...detectOverflow(collected.meta, screenRel, screen.viewport),
    ...detectAlignment(elements, screenRel),
    ...detectGrid(elements, screenRel),
    ...detectTokenDrift(elements, screenRel, tokenColors),
    ...detectMissingStates({
      declarations,
      manifestStates: screen.states,
      flags: collected.flags,
      screenRel,
      dataLabel: 'data.json',
    }),
    ...detectTouchTargets(elements, screenRel),
  ]
  const detectors = [
    { id: 'contrast', category: 'acessibilidade', status: 'ran' },
    { id: 'text-clip', category: 'tipografia', status: 'ran' },
    { id: 'overflow', category: 'responsividade', status: 'ran' },
    { id: 'alignment', category: 'composicao', status: 'ran' },
    { id: 'grid', category: 'espacamento', status: 'ran' },
    tokenColors
      ? { id: 'token-drift', category: 'consistencia', status: 'ran' }
      : { id: 'token-drift', category: 'consistencia', status: 'skipped', detail: 'tokens.json ausente ou sem cores de token no target' },
    { id: 'states', category: 'microinteracao', status: 'ran' },
    { id: 'touch-target', category: 'acessibilidade', status: 'ran' },
  ]
  const visionField = { model: null, run: false, optIn: false }
  if (vision) {
    const result = await adapter.analyze({ screen: screenRel, viewport: screen.viewport, state: 'default', html: source, screenshotPng, budgetTokens })
    if (typeof result.tokensUsed !== 'number' || result.tokensUsed > budgetTokens) {
      die(`visual-critic: adapter ${adapter.id} estourou o teto de orçamento (usou ${result.tokensUsed}, teto ${budgetTokens})`)
    }
    for (const it of result.issues ?? []) {
      const valid =
        it && SEVERITIES.includes(it.severity) && CATEGORIES.includes(it.category) &&
        typeof it.element === 'string' && typeof it.problem === 'string' &&
        typeof it.suggestion === 'string' && typeof it.evidence === 'string'
      if (!valid) die(`visual-critic: adapter ${adapter.id} emitiu issue fora do contrato`)
    }
    issues.push(...(result.issues ?? []))
    visionField.model = result.model
    visionField.run = true
    visionField.optIn = true
    visionField.adapter = adapter.id
    visionField.budgetTokens = budgetTokens
    visionField.tokensUsed = result.tokensUsed
  }
  const sorted = sortIssues(issues)
  const report = {
    schemaVersion: SCHEMA_VERSION,
    screen: screenRel,
    viewport: screen.viewport,
    state: 'default',
    score: scoreOf(sorted),
    issues: sorted,
    deterministic: {
      detectors,
      rendering: RENDERING,
      issuesSortedBy: [...ISSUES_SORTED_BY],
      rerunStable: true,
    },
    vision: visionField,
    gitSHA: gitShaOf(screen.abs),
    screenHash: createHash('sha256').update(source).digest('hex'),
    platform: process.platform,
    timestamp: new Date().toISOString(),
  }
  const errors = validateAgainstSchema(report, schema)
  if (errors.length > 0) die(`visual-critic: relatório inválido contra o schema (${errors[0]})`)
  return report
}

function gitShaOf(absPath) {
  try {
    return execSync('git rev-parse HEAD', { cwd: resolve(absPath, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// API programática (usada pelo CLI e por critic.test.mjs).
// ---------------------------------------------------------------------------
export async function runCritic({ target, outDir, gate = false, vision = false, budgetTokens = null, adapter = null }) {
  if (vision && (!Number.isInteger(budgetTokens) || budgetTokens < 1)) {
    die('visual-critic: --vision exige --budget-tokens <N> com N inteiro >= 1 (passes pagos nunca sem teto)')
  }
  const targetDir = resolve(target)
  const screens = discoverScreens(targetDir)
  const tokenColors = loadTokenColors(targetDir)
  const schemaPath = fileURLToPath(new URL('../assets/critic-report.schema.json', import.meta.url))
  let schema = null
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  } catch {
    die('visual-critic: critic-report.schema.json ausente ou inválido em skills/design/assets/')
  }
  const agent = adapter ?? (vision ? createDesignAgent() : null)
  const { server, port } = await startServer(targetDir)
  const browser = await launchBrowser()
  const reports = []
  try {
    for (const screen of screens) {
      reports.push(
        await analyzeScreen({ browser, port, screen, tokenColors, vision, budgetTokens, adapter: agent, schema })
      )
    }
  } finally {
    await browser.close().catch(() => {})
    await new Promise((ok) => server.close(ok))
  }
  const sink = outDir ? resolve(outDir) : join(targetDir, '.visual', 'critic')
  mkdirSync(sink, { recursive: true })
  const reportPaths = []
  for (const report of reports) {
    const slug = report.screen.replace(/\.html$/i, '').split('/').join('__')
    const full = join(sink, `${slug}.json`)
    writeFileSync(full, `${JSON.stringify(report, null, 2)}\n`)
    reportPaths.push(full)
  }
  let blocker = 0
  let major = 0
  let minor = 0
  for (const report of reports) {
    for (const it of report.issues) {
      if (it.severity === 'blocker') blocker += 1
      else if (it.severity === 'major') major += 1
      else minor += 1
    }
  }
  return { reports, reportPaths, sink, counts: { blocker, major, minor }, gate, gateBlocked: gate && blocker > 0 }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { target: null, outDir: null, gate: false, vision: false, budgetTokens: null }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    } else if (arg === '--target') {
      if (i + 1 >= argv.length) die(`--target requer um caminho — ${usage}`)
      opts.target = argv[i + 1]
      i += 1
    } else if (arg === '--out') {
      if (i + 1 >= argv.length) die(`--out requer um caminho — ${usage}`)
      opts.outDir = argv[i + 1]
      i += 1
    } else if (arg === '--gate') {
      opts.gate = true
    } else if (arg === '--vision') {
      opts.vision = true
    } else if (arg === '--budget-tokens') {
      if (i + 1 >= argv.length) die(`--budget-tokens requer um número inteiro — ${usage}`)
      const n = Number(argv[i + 1])
      if (!Number.isInteger(n)) die(`--budget-tokens requer um número inteiro — ${usage}`)
      opts.budgetTokens = n
      i += 1
    } else if (arg.startsWith('-')) {
      die(`flag desconhecida "${arg}" — ${usage}`)
    } else {
      positional.push(arg)
    }
  }
  if (positional.length > 1) die(`${usage} (recebeu ${positional.length} posicionais)`)
  if (opts.target && positional.length === 1) die(`informe o target uma única vez — ${usage}`)
  opts.target = opts.target ?? positional[0] ?? 'design'
  if (opts.vision && opts.budgetTokens === null) die(`--vision exige --budget-tokens <N> — passes pagos nunca sem teto — ${usage}`)
  if (!opts.vision && opts.budgetTokens !== null) die(`--budget-tokens só faz sentido com --vision — ${usage}`)
  return opts
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2))
    const result = await runCritic(opts)
    for (const report of result.reports) {
      for (const it of report.issues) {
        console.log(`critic: [${it.severity}|${it.category}] ${it.element} — ${it.problem} (${it.evidence})`)
      }
    }
    for (const p of result.reportPaths) console.log(`critic: relatorio -> ${p}`)
    const { blocker, major, minor } = result.counts
    console.log(
      `critic: ${result.reports.length} tela(s), ${blocker + major + minor} issues (${blocker} blockers, ${major} majors, ${minor} minors) — relatórios em ${result.sink}`
    )
    if (result.gateBlocked) {
      console.log(`critic: gate bloqueado por ${blocker} blocker(s)`)
      process.exit(1)
    }
    process.exit(0)
  } catch (err) {
    if (err instanceof GuidedError) {
      console.error(err.message)
      process.exit(2)
    }
    console.error(`visual-critic: erro interno: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) main()

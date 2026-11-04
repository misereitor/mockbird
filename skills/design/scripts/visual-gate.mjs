#!/usr/bin/env node
/**
 * visual-gate.mjs — o DONO da semântica de gate (plano todo 12, GAP-A3).
 *
 * BLOQUEIA APENAS por (exatamente duas regras):
 *   (a) diff determinístico acima do limiar da plataforma — pixelRatio/SSIM
 *       de skills/design/scripts/lib/image-diff.mjs (combinedDiff +
 *       loadThresholds + thresholdsForPlatform + withinThresholds) contra
 *       design/visual-thresholds.json;
 *   (b) contrato quebrado — skills/design/scripts/validate.mjs com exit ≠ 0.
 *
 * NUNCA bloqueia por score: score é instrumento de rastreio
 * (docs/arquitetura-evolutiva.md §8) e este gate não lê, nem interpreta, nem
 * referencia o histórico de score. Queda de score isolada nunca muda o exit
 * code daqui (provado em visual-score.test.mjs).
 *
 * Baseline home (congelada, padrão do --update-metrics de rules/metrics.mjs):
 *   <target>/.visual/baseline/<tela>/<viewport>__<estado>.png
 * Comparado contra a captura atual em <target>/.visual/ (só *.png; a subárvore
 * da baseline fica excluída do lado atual — "baseline" é nome reservado).
 * --update-baseline é o ÚNICO caminho de escrita da baseline: congela todas as
 * imagens atuais e sai 0 (primeira execução = freeze). Sem --update-baseline a
 * baseline nunca é tocada.
 *
 * Semântica de par: só o que existe nos DOIS lados é comparado. Imagem sem
 * par NÃO bloqueia (a regra "bloqueia APENAS" é literal) — é reportada como
 * aviso para congelar com --update-baseline. PNG ilegível ou com geometria
 * divergente num par é diff acima do limiar (não há como passar) e bloqueia.
 *
 * Limiar: loadThresholds(path) com caminho EXPLÍCITO (o default do módulo é
 * cwd-relative e não é usado aqui): --thresholds <arquivo>, senão
 * <target>/visual-thresholds.json, senão design/visual-thresholds.json da raiz
 * do design pack (este repositório); ausente => DEFAULT_THRESHOLDS documentado
 * em lib/image-diff.mjs. A plataforma é process.platform.
 *
 * Exit codes: 0 = pass (ou freeze), 1 = bloqueado (diff acima do limiar ou
 * contrato quebrado), 2 = erro de uso/entrada.
 *
 * Usage: node skills/design/scripts/visual-gate.mjs [--target <dir>]
 *   [--config <validate.config.json>] [--thresholds <arquivo>]
 *   [--baseline <dir>] [--current <dir>] [--update-baseline] [--help]
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { combinedDiff, decodePng, loadThresholds, thresholdsForPlatform, withinThresholds } from './lib/image-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VALIDATE = join(HERE, 'validate.mjs')
const DEFAULT_CONFIG = join(HERE, '..', 'assets', 'validate.config.json')
const PACK_THRESHOLDS = join(HERE, '..', '..', '..', 'design', 'visual-thresholds.json')

const usage =
  'usage: node skills/design/scripts/visual-gate.mjs [--target <dir>] [--config <path>] ' +
  '[--thresholds <path>] [--baseline <dir>] [--current <dir>] [--update-baseline] [--help]'

function die(message) {
  console.error(`visual-gate: ${message}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const opts = {
  target: './design',
  config: null,
  thresholds: null,
  baseline: null,
  current: null,
  updateBaseline: false,
}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(usage)
    process.exit(0)
  } else if (token === '--target' || token === '--config' || token === '--thresholds' || token === '--baseline' || token === '--current') {
    if (i + 1 >= argv.length) die(`${token} requer um caminho — ${usage}`)
    opts[token.slice(2)] = argv[i + 1]
    i += 1
  } else if (token === '--update-baseline') {
    opts.updateBaseline = true
  } else {
    die(`argumento desconhecido "${token}" — ${usage}`)
  }
}

const targetDir = resolve(opts.target)
const targetSt = (() => {
  try {
    return statSync(targetDir)
  } catch {
    return null
  }
})()
if (!targetSt?.isDirectory()) die(`target não encontrado ou não é diretório: ${opts.target}`)

const currentDir = resolve(opts.current ?? join(targetDir, '.visual'))
const baselineDir = resolve(opts.baseline ?? join(targetDir, '.visual', 'baseline'))

// ---------------------------------------------------------------------------
// Imagens: só *.png, chaves relativas com '/'. A subárvore da baseline fica
// excluída do lado atual quando aninhada.
// ---------------------------------------------------------------------------
function pngMap(root, excludeDir) {
  const out = new Map()
  if (!existsSync(root)) return out
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = join(dir, entry.name)
      if (excludeDir !== null && (full === excludeDir || full.startsWith(excludeDir + sep))) continue
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        out.set(relative(root, full).split('\\').join('/'), full)
      }
    }
  }
  walk(root)
  return out
}

const excludeFromCurrent = baselineDir.startsWith(currentDir + sep) ? baselineDir : null
const currentImages = pngMap(currentDir, excludeFromCurrent)

// ---------------------------------------------------------------------------
// --update-baseline: o ÚNICO caminho de escrita da baseline (freeze).
// ---------------------------------------------------------------------------
if (opts.updateBaseline) {
  for (const [key, full] of currentImages) {
    const dest = join(baselineDir, key)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(full, dest)
  }
  console.log(`visual-gate: baseline congelada — ${currentImages.size} imagem(ns) em ${relative(process.cwd(), baselineDir) || baselineDir}`)
  process.exit(0)
}

const baselineImages = pngMap(baselineDir, null)

// ---------------------------------------------------------------------------
// Limiar da plataforma (caminho explícito — nunca o default cwd-relative).
// ---------------------------------------------------------------------------
const thresholdsPath = opts.thresholds
  ? resolve(opts.thresholds)
  : existsSync(join(targetDir, 'visual-thresholds.json'))
    ? join(targetDir, 'visual-thresholds.json')
    : PACK_THRESHOLDS
const limits = thresholdsForPlatform(loadThresholds(thresholdsPath), process.platform)

// ---------------------------------------------------------------------------
// Regra (a): diff determinístico vs limiar da plataforma. APENAS pares.
// ---------------------------------------------------------------------------
let blocked = 0
let compared = 0
for (const key of [...baselineImages.keys()].sort()) {
  const currentFull = currentImages.get(key)
  if (currentFull === undefined) {
    console.log(`visual-gate: aviso — baseline sem captura atual: ${key}`)
    continue
  }
  compared += 1
  let outcome = null
  try {
    outcome = combinedDiff(decodePng(readFileSync(baselineImages.get(key))), decodePng(readFileSync(currentFull)))
  } catch (error) {
    blocked += 1
    console.error(`visual-gate: FALHOU ${key} — imagem ilegível (${String(error?.message ?? error)})`)
    continue
  }
  if (outcome.sizeMismatch) {
    const [bw, bh, cw, ch] = outcome.sizeMismatch
    blocked += 1
    console.error(`visual-gate: FALHOU ${key} — geometria divergente (baseline ${bw}x${bh} vs atual ${cw}x${ch})`)
    continue
  }
  const verdict = withinThresholds(outcome, limits)
  if (!verdict.pass) {
    blocked += 1
    console.error(
      `visual-gate: FALHOU ${key} — pixelRatio ${outcome.pixelRatio.toFixed(6)} (limiar ${limits.maxDiffPixelRatio})` +
        `${verdict.pixelRatioOk ? '' : ' [pixelRatio]'}, ssim ${outcome.ssim.toFixed(6)} (piso ${limits.minSsim})` +
        `${verdict.ssimOk ? '' : ' [ssim]'} (${process.platform})`
    )
  }
}
for (const key of [...currentImages.keys()].sort()) {
  if (!baselineImages.has(key)) {
    console.log(`visual-gate: aviso — imagem sem baseline: ${key} (congele com --update-baseline)`)
  }
}

// ---------------------------------------------------------------------------
// Regra (b): contrato (validate.mjs) — bloqueia com exit ≠ 0.
// ---------------------------------------------------------------------------
const configPath = opts.config ? resolve(opts.config) : DEFAULT_CONFIG
const contract = spawnSync(process.execPath, [VALIDATE, '--config', configPath, opts.target], {
  cwd: process.cwd(),
  encoding: 'utf8',
})
if (contract.error || contract.status !== 0) {
  blocked += 1
  const detail = contract.error ? String(contract.error.message) : `exit ${contract.status}`
  console.error(`visual-gate: FALHOU contrato — validate.mjs ${detail}`)
  const output = `${contract.stdout ?? ''}${contract.stderr ?? ''}`.trim()
  if (output) console.error(output)
} else {
  console.log('visual-gate: contrato ok (validate.mjs exit 0)')
}

console.log(
  `visual-gate: ${compared} par(es) comparado(s) — ${blocked} falha(s) (limiar ${process.platform}: maxDiffPixelRatio ${limits.maxDiffPixelRatio}, minSsim ${limits.minSsim})`
)
if (blocked > 0) {
  console.error('visual-gate: BLOQUEADO — diff acima do limiar da plataforma e/ou contrato quebrado (score nunca decide aqui)')
  process.exit(1)
}
console.log('visual-gate: pass')
process.exit(0)

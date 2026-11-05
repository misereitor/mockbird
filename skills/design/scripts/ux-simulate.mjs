#!/usr/bin/env node
/**
 * ux-simulate.mjs — UX/task simulation com relatório por tarefa (plan todo 20,
 * GAP-B4).
 *
 * Executa tarefas de usuário declaradas em <design-root>/tasks.json sobre o
 * runtime mock com CLIQUES REAIS via Playwright (proibido simular sem clicar
 * de verdade — plan: "cliques reais nos seletores declarados"). Cada passo
 * clica um seletor real da tela renderizada e observa o efeito verdadeiro do
 * vocabulário declarativo do mock.js (data-toast/data-close/data-go/
 * data-overlay + Mock.registerActions/loadActions, instrumentados em tempo de
 * execução) — nunca assume o efeito esperado.
 *
 * Input — <design-root>/tasks.json ("design/tasks.json" no contrato do plano;
 * o design root é o --target):
 *   {
 *     "schemaVersion": 1,
 *     "tasks": [
 *       {
 *         "id": "login",              // ^[a-z0-9][a-z0-9_-]*$ (nome do relatório)
 *         "title": "Login do usuário", // opcional
 *         "start": "login/01-login.html", // tela inicial (existe no design root)
 *         "steps": [
 *           {
 *             "id": "entrar",          // único dentro da tarefa
 *             "click": "<seletor css>", // obrigatório — clique REAL do Playwright
 *             "fill": [ { "selector": "<css>", "value": "..." } ], // opcional, digitação real
 *             "expect": {              // opcional (chaves fechadas)
 *               "url": "<substring>",  // location.href após o passo
 *               "toast": "<substring>", // toast registrado OU visível
 *               "overlay": true,       // camada .mock-overlay aberta/fechada
 *               "text": "<substring>", // texto visível do documento
 *               "state": "<nome>",     // estado do fluxo provado por este passo
 *               "confirmation": true   // passo de RETORNO: exige confirmação
 *             }
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Output — <design-root>/.visual/ux/<tarefa>.json:
 *   { schemaVersion, tool, target, task, title, start, gitSHA, generatedAt,
 *     steps: [{ id, index, click, executed, reason, action, ms, expect,
 *               observed, frictions }],
 *     stepsExecuted, stepsTotal,
 *     actions: { toast|go|overlay|close|action -> passos executados },
 *     states: { found: [], missing: [] },
 *     frictions: [{ code, label, step, detail }],
 *     timing: { totalMs, stepsMs: { <stepId>: ms } },
 *     concluded }
 *
 * Fricções (lista fechada do plano — "clique sem ação, retorno sem
 * confirmação, etapa sem feedback"):
 *   click-no-action        "botão sem ação"        clique real sem EFEITO algum
 *                                                 (botão morto) ou data-action
 *                                                 sem handler registrado;
 *   return-no-confirmation "retorno sem confirmação" passo com expect
 *                                                 .confirmation sem evidência
 *                                                 de confirmação (toast/estado/
 *                                                 texto) no retorno;
 *   step-no-feedback       "etapa sem feedback"    passo com efeito mas sem a
 *                                                 saída declarada em expect.
 *
 * Invariante dura (plan: PROIBIDO "concluir tarefa com passo não executado"):
 *   `concluded` só é true quando TODO passo foi executado — o relatório nunca
 *   conclui com passo não executado, e um passo não executado sempre sai
 *   exit != 0 (mesmo sem --gate).
 *
 * Serviço/execução (visual-capture/responsive-report precedents): o alvo é
 * servido de uma CÓPIA temporária via assets/serve.mjs (porta efêmera) e
 * instrumentado antes de qualquer script da página; o alvo nunca é tocado —
 * a única escrita declarada é o relatório. Raízes seed (o example) não
 * embarcam mock.js/mock.css: o runtime é caminhado para a cópia servida
 * (responsive-report.mjs precedent).
 *
 * Exit codes: 0 = relatório gravado (fricções são report-only), 1 = --gate com
 * fricções OU passo não executado (sempre), 2 = erro de uso/entrada guiado
 * (tasks.json ausente/malformado/schemaVersion, tarefa desconhecida, tela
 * inicial ausente, seletor malformado), 5 = playwright-core ausente.
 *
 * Usage:
 *   node skills/design/scripts/ux-simulate.mjs [--target <design-root>]
 *     [--task <tarefa>] [--gate] [--help]
 */
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- constants ----------

const OUT_DIR = '.visual'
const REPORT_DIR = 'ux'
const TASKS_NAME = 'tasks.json'
const SCHEMA_VERSION = 1
const LOAD_TIMEOUT_MS = 15_000
const CLICK_TIMEOUT_MS = 3_000
const NAV_TIMEOUT_MS = 5_000
const SETTLE_MS = 600
const TASK_ID_RE = /^[a-z0-9][a-z0-9_-]*$/

/** Fricções: code -> rótulo pt-BR do relatório (lista fechada do plano). */
const FRICTIONS = Object.freeze({
  'click-no-action': 'botão sem ação',
  'return-no-confirmation': 'retorno sem confirmação',
  'step-no-feedback': 'etapa sem feedback',
})

/** Ações do vocabulário contadas em `actions` (a ordem define `step.action`). */
const ACTION_KINDS = ['toast', 'go', 'overlay', 'close', 'action']

const usage =
  'usage: node skills/design/scripts/ux-simulate.mjs [--target <design-root>] [--task <tarefa>] [--gate] [--help]'

/** Guided failure inside resource-holding sections: thrown so the serve/
 *  browser cleanup in `finally` runs before the process exits. */
class GuidedError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

function die(message, code) {
  console.error(message)
  process.exit(code)
}

// ---------- args ----------

const argv = process.argv.slice(2)
let targetArg = 'design'
let taskArg = null
let gate = false
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--help' || token === '-h') {
    console.log(usage)
    process.exit(0)
  } else if (token === '--target' || token === '--task') {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      die(`${token} requires a value — ${usage}`, 2)
    }
    if (token === '--target') targetArg = value
    else taskArg = value
    i += 1
  } else if (token === '--gate') {
    gate = true
  } else {
    die(`unknown argument: ${token} — ${usage}`, 2)
  }
}

// ---------- playwright-core (dynamic require — visual-capture.mjs pattern) ----------

const requireFrom = createRequire(join(process.cwd(), 'noop.js'))
let chromium
try {
  ;({ chromium } = requireFrom('playwright-core'))
} catch {
  die('ux-simulate: playwright-core nao encontrado — rode "npm i playwright-core" nesta pasta e tente de novo.', 5)
}

// ---------- small helpers (responsive-report.mjs conventions) ----------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findSkillAsset(name) {
  for (const rel of [`../assets/${name}`, `../${name}`]) {
    const full = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(full)) return full
  }
  return null
}

const SERVE_SCRIPT = findSkillAsset('serve.mjs')
if (SERVE_SCRIPT === null) {
  die('ux-simulate: serve.mjs nao encontrado (checked ../assets/serve.mjs and ../serve.mjs)', 2)
}

function gitShaOf(designRoot) {
  try {
    return execFileSync('git', ['-C', designRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const settle = (page) =>
  page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready
    await new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise)))
  })

// ---------- tasks.json (schemaVersion 1 — entrada declarativa) ----------

const EXPECT_KEYS = new Set(['url', 'toast', 'overlay', 'text', 'state', 'confirmation'])

function taskProblem(message) {
  return new GuidedError(`ux-simulate: ${TASKS_NAME}: ${message}`, 2)
}

function validateStep(step, seenIds, where) {
  if (!isPlainObject(step)) throw taskProblem(`${where}: cada passo deve ser um objeto`)
  if (typeof step.id !== 'string' || step.id.trim() === '') {
    throw taskProblem(`${where}: passo sem "id" não-empty`)
  }
  if (seenIds.has(step.id)) throw taskProblem(`${where}: id de passo duplicado "${step.id}"`)
  seenIds.add(step.id)
  if (typeof step.click !== 'string' || step.click.trim() === '') {
    throw taskProblem(`${where} (passo "${step.id}"): "click" deve ser um seletor não-empty`)
  }
  if (step.fill !== undefined) {
    if (!Array.isArray(step.fill)) throw taskProblem(`${where} (passo "${step.id}"): "fill" deve ser uma lista de {selector, value}`)
    for (const fill of step.fill) {
      if (!isPlainObject(fill) || typeof fill.selector !== 'string' || fill.selector.trim() === '' || typeof fill.value !== 'string') {
        throw taskProblem(`${where} (passo "${step.id}"): item de "fill" deve ser {selector: string, value: string}`)
      }
    }
  }
  if (step.expect !== undefined) {
    if (!isPlainObject(step.expect)) throw taskProblem(`${where} (passo "${step.id}"): "expect" deve ser um objeto`)
    for (const key of Object.keys(step.expect)) {
      if (!EXPECT_KEYS.has(key)) {
        throw taskProblem(`${where} (passo "${step.id}"): chave de expect desconhecida "${key}" (esperado: ${[...EXPECT_KEYS].join(', ')})`)
      }
    }
    for (const key of ['url', 'toast', 'text', 'state']) {
      if (step.expect[key] !== undefined && typeof step.expect[key] !== 'string') {
        throw taskProblem(`${where} (passo "${step.id}"): expect.${key} deve ser string`)
      }
    }
    for (const key of ['overlay', 'confirmation']) {
      if (step.expect[key] !== undefined && typeof step.expect[key] !== 'boolean') {
        throw taskProblem(`${where} (passo "${step.id}"): expect.${key} deve ser booleano`)
      }
    }
  }
}

function loadTasks(designRoot) {
  const tasksPath = join(designRoot, TASKS_NAME)
  if (!existsSync(tasksPath)) {
    throw new GuidedError(
      `ux-simulate: ${TASKS_NAME} nao encontrado em ${targetArg} — declare as tarefas ` +
        `({"schemaVersion": 1, "tasks": [...]}) em design/${TASKS_NAME} antes de simular`,
      2,
    )
  }
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(tasksPath, 'utf8'))
  } catch (error) {
    throw taskProblem(`JSON invalido — ${String(error?.message ?? error).split('\n')[0]}`)
  }
  if (!isPlainObject(parsed)) throw taskProblem('a raiz deve ser um objeto {"schemaVersion", "tasks"}')
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw taskProblem(`schemaVersion ${JSON.stringify(parsed.schemaVersion ?? null)} nao suportado (esperado ${SCHEMA_VERSION})`)
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw taskProblem('"tasks" deve ser uma lista nao vazia de tarefas')
  }
  const tasks = []
  const seenTaskIds = new Set()
  for (const [index, task] of parsed.tasks.entries()) {
    const where = `tarefa #${index + 1}`
    if (!isPlainObject(task)) throw taskProblem(`${where}: deve ser um objeto`)
    if (typeof task.id !== 'string' || !TASK_ID_RE.test(task.id)) {
      throw taskProblem(`${where}: "id" deve casar ${TASK_ID_RE} (recebido ${JSON.stringify(task.id ?? null)})`)
    }
    if (seenTaskIds.has(task.id)) throw taskProblem(`id de tarefa duplicado "${task.id}"`)
    seenTaskIds.add(task.id)
    if (task.title !== undefined && typeof task.title !== 'string') {
      throw taskProblem(`${where} ("${task.id}"): "title" deve ser string`)
    }
    if (typeof task.start !== 'string' || task.start.trim() === '' || !/\.html?$/i.test(task.start)) {
      throw taskProblem(`${where} ("${task.id}"): "start" deve ser uma tela .html do design root`)
    }
    if (task.start.split(/[?#]/)[0].includes('..')) {
      throw taskProblem(`${where} ("${task.id}"): "start" nao pode escapar do design root`)
    }
    if (!Array.isArray(task.steps) || task.steps.length === 0) {
      throw taskProblem(`${where} ("${task.id}"): "steps" deve ser uma lista nao vazia`)
    }
    const seenStepIds = new Set()
    for (const step of task.steps) {
      validateStep(step, seenStepIds, `${where} ("${task.id}")`)
    }
    tasks.push(task)
  }
  return tasks
}

// ---------- in-page instrumentation (addInitScript — antes de qualquer tela) ----------

const INIT_SCRIPT = `(() => {
  const warnings = []
  let mutations = 0
  const isNoiseNode = (node) => !!node && (node.id === 'mock-toast' || node.id === 'mock-live')
  const noiseRecord = (record) => {
    const target = record.target
    const el = target && target.nodeType === 1 ? target : target && target.parentElement
    if (el && (el.id === 'mock-toast' || el.id === 'mock-live')) return true
    if (el && el.closest && el.closest('#mock-toast, #mock-live')) return true
    const added = Array.from(record.addedNodes || [])
    const removed = Array.from(record.removedNodes || [])
    if (added.length && added.every(isNoiseNode)) return true
    if (removed.length && removed.every(isNoiseNode)) return true
    return false
  }
  const installObserver = () => {
    if (!document.documentElement) return
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (!noiseRecord(record)) {
          mutations += 1
          return
        }
      }
    })
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver)
  else installObserver()

  const push = (event) => {
    try {
      console.debug('ux-sim-event:' + JSON.stringify(event))
    } catch { /* o evento segue visivel no coletor in-page */ }
  }
  const wrapState = (state) => ({
    get: state.get,
    set(key, value) {
      push({ call: 'state', op: 'set', key: String(key) })
      return state.set(key, value)
    },
    clear() {
      push({ call: 'state', op: 'clear' })
      return state.clear()
    },
  })
  const wrapped = new WeakSet()
  const wrapMock = (mock) => {
    if (!mock || typeof mock !== 'object' || wrapped.has(mock)) return mock
    wrapped.add(mock)
    const original = {
      toast: mock.toast,
      go: mock.go,
      overlay: mock.overlay,
      close: mock.close,
      registerActions: mock.registerActions,
      loadActions: mock.loadActions,
    }
    if (typeof original.toast === 'function') {
      mock.toast = (message, ms) => {
        push({ call: 'toast', message: String(message) })
        return original.toast.call(mock, message, ms)
      }
    }
    if (typeof original.go === 'function') {
      mock.go = (file) => {
        push({ call: 'go', file: String(file) })
        return original.go.call(mock, file)
      }
    }
    if (typeof original.overlay === 'function') {
      mock.overlay = (url, opts) => {
        push({ call: 'overlay', url: String(url) })
        return original.overlay.call(mock, url, opts)
      }
    }
    if (typeof original.close === 'function') {
      mock.close = () => {
        push({ call: 'close' })
        return original.close.call(mock)
      }
    }
    if (typeof original.registerActions === 'function') {
      mock.registerActions = (namespace, map) => {
        const wrappedMap = {}
        for (const [name, handler] of Object.entries(map ?? {})) {
          wrappedMap[name] =
            typeof handler === 'function'
              ? (event, el) => {
                  push({ call: 'action', name: String(namespace) + '.' + name })
                  return handler(event, el)
                }
              : handler
        }
        return original.registerActions.call(mock, namespace, wrappedMap)
      }
    }
    if (typeof original.loadActions === 'function') {
      mock.loadActions = (id) => {
        push({ call: 'loadActions', id: String(id) })
        return original.loadActions.call(mock, id)
      }
    }
    if (isPlainLike(mock.state)) mock.state = wrapState(mock.state)
    return mock
  }
  const isPlainLike = (value) => !!value && typeof value === 'object' && typeof value.set === 'function'

  let current
  Object.defineProperty(window, 'Mock', {
    configurable: true,
    get() {
      return current
    },
    set(value) {
      current = wrapMock(value)
    },
  })

  const originalWarn = console.warn
  console.warn = (...args) => {
    warnings.push(args.map((arg) => String(arg)).join(' '))
    originalWarn.apply(console, args)
  }

  window.__uxSim = {
    drainWarnings() {
      return warnings.splice(0)
    },
    resetMutations() {
      mutations = 0
    },
    mutations() {
      return mutations
    },
  }
})()`

const COLLECT_SCRIPT = `(() => {
  const toastEl = document.getElementById('mock-toast')
  const body = document.body
  return {
    toast: toastEl ? String(toastEl.textContent ?? '') : null,
    toastVisible: !!toastEl && toastEl.classList.contains('show'),
    overlay: document.querySelectorAll('.mock-overlay').length,
    text: body ? String(body.innerText ?? '') : '',
    mutations: window.__uxSim ? window.__uxSim.mutations() : 0,
  }
})()`

// ---------- step execution (clique real; efeito observado, nunca assumido) ----------

function parseEventLine(text) {
  const prefix = 'ux-sim-event:'
  if (!text.startsWith(prefix)) return null
  try {
    return JSON.parse(text.slice(prefix.length))
  } catch {
    return null
  }
}

function actionKindsOf(events) {
  const kinds = []
  for (const event of events) {
    const kind = event.call === 'state' || event.call === 'loadActions' ? null : event.call
    if (kind && ACTION_KINDS.includes(kind) && !kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}

function friction(code, detail) {
  return { code, label: FRICTIONS[code], detail }
}

async function collectObserved(page) {
  try {
    return await page.evaluate(COLLECT_SCRIPT)
  } catch {
    await page.waitForLoadState('load', { timeout: NAV_TIMEOUT_MS }).catch(() => {})
    return await page.evaluate(COLLECT_SCRIPT)
  }
}

async function runStep(page, step, index, consoleLog) {
  const expect = isPlainObject(step.expect) ? step.expect : null
  const record = {
    id: step.id,
    index,
    click: step.click,
    executed: false,
    reason: null,
    action: [],
    ms: 0,
    expect,
    observed: null,
    frictions: [],
  }

  // digitação real (fill) é entrada do passo: o mutação-sob-teste é o clique
  for (const fill of step.fill ?? []) {
    try {
      await page.fill(fill.selector, fill.value, { timeout: CLICK_TIMEOUT_MS })
    } catch (error) {
      const message = String(error?.message ?? error).split('\n')[0]
      if (/invalid selector|unknown engine|unexpected token|querySelectorAll/i.test(message)) {
        throw new GuidedError(`ux-simulate: passo "${step.id}": seletor de fill malformado ${JSON.stringify(fill.selector)} — ${message}`, 2)
      }
      record.reason = `fill ${JSON.stringify(fill.selector)} nao aplicou — ${message}`
      return record
    }
  }

  const marker = consoleLog.length
  await page.evaluate(() => window.__uxSim?.resetMutations()).catch(() => {})
  const urlBefore = page.url()
  const startedAt = Date.now()
  try {
    await page.click(step.click, { timeout: CLICK_TIMEOUT_MS })
  } catch (error) {
    record.ms = Date.now() - startedAt
    const message = String(error?.message ?? error).split('\n')[0]
    if (/invalid selector|unknown engine|unexpected token|querySelectorAll/i.test(message)) {
      throw new GuidedError(`ux-simulate: passo "${step.id}": seletor malformado ${JSON.stringify(step.click)} — ${message}`, 2)
    }
    record.reason = `elemento ${JSON.stringify(step.click)} nao encontrado ou nao clicavel — ${message}`
    return record
  }

  if (expect?.url) {
    await page.waitForURL((url) => url.href.includes(expect.url), { timeout: NAV_TIMEOUT_MS }).catch(() => {})
  }
  await page.waitForTimeout(SETTLE_MS)
  await page.waitForLoadState('load', { timeout: NAV_TIMEOUT_MS }).catch(() => {})
  await settle(page).catch(() => {})
  record.ms = Date.now() - startedAt

  const slice = consoleLog.slice(marker)
  const events = slice.map((entry) => parseEventLine(entry.text)).filter(Boolean)
  const warnings = slice.filter((entry) => entry.type === 'warning').map((entry) => entry.text)
  const observed = await collectObserved(page)
  const urlAfter = page.url()
  const actions = actionKindsOf(events)

  record.executed = true
  record.action = actions
  record.observed = {
    url: urlAfter,
    toast: observed.toastVisible ? observed.toast : events.filter((e) => e.call === 'toast').map((e) => e.message).join(' | ') || null,
    overlay: observed.overlay,
    text: expect?.text !== undefined ? observed.text.includes(expect.text) : null,
    mutations: observed.mutations,
    events: events.map((e) => (e.call === 'action' ? e.name : e.call === 'toast' ? `toast(${e.message})` : e.call === 'go' ? `go(${e.file})` : e.call === 'overlay' ? `overlay(${e.url})` : e.call)),
  }

  const urlChanged = urlAfter !== urlBefore
  const effect = actions.length > 0 || observed.mutations > 0 || urlChanged
  const handlerWarn = warnings.some((text) => /no handler registered/i.test(text))

  const missing = []
  if (expect?.url !== undefined && !urlAfter.includes(expect.url)) missing.push(`url ${JSON.stringify(expect.url)}`)
  const toastTexts = [
    observed.toastVisible ? observed.toast : '',
    ...events.filter((e) => e.call === 'toast').map((e) => e.message),
  ].filter(Boolean)
  if (expect?.toast !== undefined && !toastTexts.some((text) => text.includes(expect.toast))) {
    missing.push(`toast ${JSON.stringify(expect.toast)}`)
  }
  if (expect?.overlay === true && observed.overlay < 1) missing.push('overlay aberto')
  if (expect?.overlay === false && observed.overlay !== 0) missing.push('overlay fechado')
  if (expect?.text !== undefined && !observed.text.includes(expect.text)) missing.push(`texto ${JSON.stringify(expect.text)}`)

  const confirmationEvidence =
    toastTexts.length > 0 ||
    events.some((e) => e.call === 'state' && e.op === 'set') ||
    (expect?.text !== undefined && observed.text.includes(expect.text))

  if (handlerWarn || !effect) {
    record.frictions.push(
      friction(
        'click-no-action',
        `clique real em ${JSON.stringify(step.click)} nao produziu efeito (nenhuma acao mock.js, navegacao ou mudanca visivel)` +
          (handlerWarn ? ' — data-action sem handler registrado' : ''),
      ),
    )
  } else if (expect?.confirmation === true && !confirmationEvidence) {
    record.frictions.push(
      friction(
        'return-no-confirmation',
        `passo "${step.id}" retornou sem confirmacao (nenhum toast, estado ou texto de confirmacao no destino)`,
      ),
    )
  } else if (missing.length > 0) {
    record.frictions.push(
      friction('step-no-feedback', `passo "${step.id}" executou mas a saida esperada nao apareceu: ${missing.join(', ')}`),
    )
  }
  return record
}

// ---------- report ----------

function buildReport({ targetArg, task, stepRecords, totalMs, gitSHA }) {
  const stepsExecuted = stepRecords.filter((record) => record.executed).length
  const actions = {}
  for (const record of stepRecords) {
    if (!record.executed) continue
    for (const kind of record.action) actions[kind] = (actions[kind] ?? 0) + 1
  }
  const found = []
  const missing = []
  for (const record of stepRecords) {
    const state = record.expect?.state
    if (typeof state !== 'string') continue
    const clean = record.executed && record.frictions.length === 0
    if (clean) {
      if (!found.includes(state)) found.push(state)
    } else if (!missing.includes(state)) {
      missing.push(state)
    }
  }
  const frictions = stepRecords.flatMap((record) =>
    record.frictions.map((item) => ({ ...item, step: record.id })),
  )
  const stepsMs = {}
  for (const record of stepRecords) stepsMs[record.id] = record.ms

  const concluded = stepRecords.length > 0 && stepRecords.every((record) => record.executed)
  // Invariante dura (plan): PROIBIDO concluir tarefa com passo não executado.
  if (concluded && stepsExecuted !== stepRecords.length) {
    throw new GuidedError('ux-simulate: invariante violada — o relatorio nao pode concluir com passo nao executado', 1)
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'ux-simulate',
    target: targetArg,
    task: task.id,
    title: task.title ?? null,
    start: task.start,
    gitSHA,
    generatedAt: new Date().toISOString(),
    steps: stepRecords,
    stepsExecuted,
    stepsTotal: stepRecords.length,
    actions,
    states: { found, missing },
    frictions,
    timing: { totalMs, stepsMs },
    concluded,
  }
}

// ---------- main ----------

const targetRoot = resolve(targetArg)
const designRoot = targetRoot // ux-simulate roda em modo design-root (tasks.json na raiz)

let tasks
try {
  tasks = loadTasks(designRoot)
} catch (error) {
  die(error instanceof GuidedError ? error.message : `ux-simulate: falha inesperada — ${String(error?.message ?? error).split('\n')[0]}`, error instanceof GuidedError ? error.code : 2)
}

if (taskArg !== null) {
  const found = tasks.find((task) => task.id === taskArg)
  if (found === undefined) {
    die(`ux-simulate: tarefa "${taskArg}" nao existe em ${join(targetArg, TASKS_NAME)} (disponiveis: ${tasks.map((task) => task.id).join(', ')})`, 2)
  }
  tasks = [found]
}

for (const task of tasks) {
  if (!existsSync(join(designRoot, task.start))) {
    die(`ux-simulate: tarefa "${task.id}": tela inicial ${JSON.stringify(task.start)} nao existe em ${targetArg}`, 2)
  }
}

const gitSHA = gitShaOf(designRoot)
const workRoot = mkdtempSync(join(tmpdir(), 'ux-simulate-'))
const workDesign = join(workRoot, 'design')
cpSync(designRoot, workDesign, { recursive: true })
// The example root is a design-system seed, not a full design/ root: its
// screens link ../mock.js / ../mock.css. Layer the runtime into the served
// copy when the design root does not ship it (responsive-report.mjs precedent).
for (const runtime of ['mock.js', 'mock.css']) {
  const runtimeSource = findSkillAsset(runtime)
  if (!existsSync(join(workDesign, runtime)) && runtimeSource !== null) {
    copyFileSync(runtimeSource, join(workDesign, runtime))
  }
}

let server = null
let browser = null
let guided = null
const reports = []
try {
  server = spawn(process.execPath, [SERVE_SCRIPT, '0', '--no-open'], {
    cwd: workRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('serve.mjs nao subiu em 10s (porta efemera?)')), 10_000)
    server.stdout.on('data', (chunk) => {
      const match = /URL: (http:\/\/[\d.]+:\d+)/.exec(String(chunk))
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
      }
    })
    server.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`serve.mjs saiu antes de subuir (exit ${code})`))
    })
  })

  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] })

  for (const task of tasks) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(INIT_SCRIPT)
    const page = await context.newPage()
    const consoleLog = []
    page.on('console', (message) => {
      consoleLog.push({ type: message.type(), text: message.text() })
    })
    page.on('pageerror', (error) => {
      consoleLog.push({ type: 'pageerror', text: String(error?.message ?? error) })
    })

    const startedAt = Date.now()
    console.log(`ux-simulate: tarefa ${task.id} (${task.steps.length} passos) em ${targetArg}`)
    try {
      const response = await page.goto(`${base}/${task.start}`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
      if (!response || !response.ok()) {
        throw new GuidedError(
          `ux-simulate: tarefa ${task.id}: tela inicial ${task.start} falhou ao carregar (HTTP ${response ? response.status() : 'sem resposta'})`,
          2,
        )
      }
      await page.waitForLoadState('networkidle', { timeout: LOAD_TIMEOUT_MS }).catch(() => {})
      await settle(page)

      const stepRecords = []
      for (const [index, step] of task.steps.entries()) {
        const record = await runStep(page, step, index + 1, consoleLog)
        stepRecords.push(record)
        const actionLabel = record.executed ? (record.action.join(',') || 'sem acao mock.js') : `NAO EXECUTADO (${record.reason})`
        console.log(`  ${index + 1}/${task.steps.length} ${step.id} — ${actionLabel} (${record.ms}ms)`)
        for (const item of record.frictions) {
          console.log(`    [${item.label}] ${item.detail}`)
        }
      }

      const report = buildReport({
        targetArg,
        task,
        stepRecords,
        totalMs: Date.now() - startedAt,
        gitSHA,
      })
      const outRoot = join(designRoot, OUT_DIR, REPORT_DIR)
      mkdirSync(outRoot, { recursive: true })
      const outPath = join(outRoot, `${task.id}.json`)
      writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
      reports.push(report)

      const actionSummary = ACTION_KINDS.filter((kind) => report.actions[kind])
        .map((kind) => `${kind}=${report.actions[kind]}`)
        .join(' ')
      console.log(
        `ux-simulate: ${task.id} — ${report.stepsExecuted}/${report.stepsTotal} passos executados | ` +
          `acoes: ${actionSummary || 'nenhuma'} | estados: ${report.states.found.length} encontrados, ` +
          `${report.states.missing.length} faltantes | atritos: ${report.frictions.length} | ` +
          `${(report.timing.totalMs / 1000).toFixed(1)}s`,
      )
      console.log(`ux-simulate: relatorio ${join(targetArg, OUT_DIR, REPORT_DIR, `${task.id}.json`)}`)
    } finally {
      await context.close().catch(() => {})
    }
  }
} catch (error) {
  guided = error instanceof GuidedError
    ? error
    : new GuidedError(`ux-simulate: falha inesperada — ${String(error?.message ?? error).split('\n')[0]}`, 2)
} finally {
  if (browser !== null) await browser.close().catch(() => {})
  if (server !== null) server.kill()
  rmSync(workRoot, { recursive: true, force: true })
}
if (guided !== null) die(guided.message, guided.code)

const unexecuted = reports.flatMap((report) =>
  report.steps.filter((step) => !step.executed).map((step) => `${report.task}/${step.id}`),
)
const totalFrictions = reports.reduce((sum, report) => sum + report.frictions.length, 0)

if (unexecuted.length > 0) {
  // Plan: PROIBIDO concluir tarefa com passo não executado — sempre exit != 0.
  die(`ux-simulate: passo(s) nao executado(s): ${unexecuted.join(', ')} — tarefa nunca conclui com passo nao executado`, 1)
}
if (gate && totalFrictions > 0) {
  die(`ux-simulate: gate bloqueado por ${totalFrictions} atrito(s)`, 1)
}
process.exit(0)

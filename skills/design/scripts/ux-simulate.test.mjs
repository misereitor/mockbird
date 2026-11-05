/**
 * ux-simulate.test.mjs — Simulação de tarefas de usuário com relatório de
 * usabilidade por fluxo (plan todo 20, GAP-B4).
 *
 * Contrato sob teste (ux-simulate.mjs):
 *   - cliques REAIS via Playwright sobre o vocabulário declarativo do mock.js
 *     (data-toast/data-close/data-go/data-overlay/data-action +
 *     Mock.registerActions/loadActions) — nunca simulação: cada passo executado
 *     observa o efeito verdadeiro (eventos instrumentados em tempo de execução);
 *   - entrada design/tasks.json (schemaVersion) -> saida design/.visual/ux/
 *     <tarefa>.json com { steps executed, states found/missing, frictions, timing };
 *   - as 3 fricoes da lista fechada: click-no-action "botão sem ação",
 *     return-no-confirmation "retorno sem confirmação", step-no-feedback
 *     "etapa sem feedback";
 *   - invariante dura: NUNCA conclui tarefa com passo não executado (concluded
 *     so e true quando todo passo rodou; passo nao executado => exit != 0);
 *   - --gate bloqueia (exit != 0) com qualquer atrito; sem --gate atrito e
 *     report-only (exit 0);
 *   - entrada invalida (tasks.json ausente/schemaVersion/tarefa desconhecida/
 *     tela inicial ausente/seletor malformado) => erro guiado exit 2.
 *
 * Aceitação (acceptance): ux-ok executa >=1 passo por acao (os 5 verbos) com
 * exit 0; ux-dead emite "botão sem ação" e --gate sai exit != 0; ux-unexecuted
 * nunca conclui com passo nao executado.
 *
 * Run: node --test skills/design/scripts/ux-simulate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const UX = join(HERE, 'ux-simulate.mjs')
const FIX = join(HERE, 'fixtures')

const FIXTURES = ['ux-ok', 'ux-dead', 'ux-unexecuted', 'ux-frictions']
const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
// Reports land in <fixture>/.visual/ux/ — transient; never committed. Cleaned
// on exit so a green run leaves the worktree exactly as it found it.
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
  for (const fixture of FIXTURES) rmSync(join(FIX, fixture, '.visual'), { recursive: true, force: true })
})

function run(args) {
  return spawnSync(process.execPath, [UX, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
}
function target(fixture) {
  return join('skills', 'design', 'scripts', 'fixtures', fixture)
}
function report(fixture, task) {
  const path = join(FIX, fixture, '.visual', 'ux', `${task}.json`)
  assert.ok(existsSync(path), `relatório ausente: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

// ---------- caminho feliz: cliques reais exercitam o vocabulário do mock.js ----------

test('ux-ok: 5 verbos com clique real, tudo executado, sem atrito, exit 0', () => {
  const r = run(['--target', target('ux-ok')])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const rep = report('ux-ok', 'fluxo')
  assert.equal(rep.concluded, true)
  assert.equal(rep.stepsExecuted, rep.stepsTotal, 'todo passo deve executar')
  // >=1 passo executado por acao: os 5 verbos do vocabulário declarativo.
  for (const verb of ['toast', 'go', 'overlay', 'close', 'action']) {
    assert.ok((rep.actions[verb] ?? 0) >= 1, `verbo "${verb}" sem passo executado`)
  }
  assert.equal(rep.frictions.length, 0, `atritos inesperados: ${JSON.stringify(rep.frictions)}`)
  assert.deepEqual(rep.states.missing, [])
  assert.equal(rep.states.found.length, 5)
})

// ---------- fricção: botão sem ação (aceitação) ----------

test('ux-dead: "botão sem ação" é report-only sem gate e --gate bloqueia', () => {
  const plain = run(['--target', target('ux-dead')])
  assert.equal(plain.status, 0, 'sem --gate o atrito é report-only')
  assert.match(plain.stdout, /botão sem ação/)
  const rep = report('ux-dead', 'morto')
  assert.equal(rep.frictions[0].code, 'click-no-action')
  assert.equal(rep.frictions[0].label, 'botão sem ação')

  const gate = run(['--target', target('ux-dead'), '--gate'])
  assert.notEqual(gate.status, 0, '--gate deve bloquear com atrito')
  assert.match(gate.stdout, /botão sem ação|gate bloqueado/)
})

// ---------- invariante: nunca conclui com passo não executado (aceitação) ----------

test('ux-unexecuted: passo sem alvo nunca conclui — exit != 0, concluded false', () => {
  const r = run(['--target', target('ux-unexecuted')])
  assert.notEqual(r.status, 0, 'passo não executado deve sair exit != 0')
  const rep = report('ux-unexecuted', 'falta')
  assert.equal(rep.concluded, false, 'não pode concluir com passo não executado')
  assert.ok(rep.stepsExecuted < rep.stepsTotal)
  assert.equal(rep.steps[0].executed, false)
  assert.match(r.stderr, /nunca conclui com passo nao executado/)
})

// ---------- fricções restantes: retorno sem confirmação + etapa sem feedback ----------

test('ux-frictions: retorno sem confirmação e etapa sem feedback detectados', () => {
  const r = run(['--target', target('ux-frictions')])
  assert.equal(r.status, 0, 'sem --gate fricções são report-only')
  const retorno = report('ux-frictions', 'retorno')
  assert.equal(retorno.frictions[0].code, 'return-no-confirmation')
  assert.equal(retorno.frictions[0].label, 'retorno sem confirmação')
  const feedback = report('ux-frictions', 'feedback')
  assert.equal(feedback.frictions[0].code, 'step-no-feedback')
  assert.equal(feedback.frictions[0].label, 'etapa sem feedback')
})

// ---------- entrada inválida: erros guiados exit 2 (sem navegador) ----------

function seedTasks(dir, tasksJson) {
  writeFileSync(join(dir, 'tasks.json'), tasksJson)
}

test('entrada inválida: tasks.json ausente/malformado → exit 2 guiado', () => {
  // ausente
  let r = run(['--target', tmpRoot('ux-notasks-')])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /tasks\.json/)

  // schemaVersion não suportado
  const badVersion = tmpRoot('ux-badversion-')
  seedTasks(badVersion, JSON.stringify({ schemaVersion: 99, tasks: [{ id: 't', start: 'a.html', steps: [{ id: 's', click: '#x' }] }] }))
  r = run(['--target', badVersion])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /schemaVersion/)

  // tarefa desconhecida via --task
  const unknown = tmpRoot('ux-unknown-')
  seedTasks(unknown, JSON.stringify({ schemaVersion: 1, tasks: [{ id: 't', start: 'a.html', steps: [{ id: 's', click: '#x' }] }] }))
  r = run(['--target', unknown, '--task', 'nope'])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /nao existe/)

  // tela inicial ausente
  const noStart = tmpRoot('ux-nostart-')
  seedTasks(noStart, JSON.stringify({ schemaVersion: 1, tasks: [{ id: 't', start: 'nao-existe.html', steps: [{ id: 's', click: '#x' }] }] }))
  r = run(['--target', noStart])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /tela inicial/)
})

test('entrada inválida: expect desconhecida / passo sem click → exit 2 guiado', () => {
  // chave de expect desconhecida
  const badExpect = tmpRoot('ux-badexpect-')
  writeFileSync(join(badExpect, 'a.html'), '<!doctype html><html><body><button id="x">x</button></body></html>')
  seedTasks(badExpect, JSON.stringify({ schemaVersion: 1, tasks: [{ id: 't', start: 'a.html', steps: [{ id: 's', click: '#x', expect: { nope: 1 } }] }] }))
  let r = run(['--target', badExpect])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /expect/)

  // passo sem "click"
  const noClick = tmpRoot('ux-noclick-')
  seedTasks(noClick, JSON.stringify({ schemaVersion: 1, tasks: [{ id: 't', start: 'a.html', steps: [{ id: 's' }] }] }))
  r = run(['--target', noClick])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /click/)
})

test('seletor malformado: erro guiado exit 2 (não quebra)', () => {
  const dir = tmpRoot('ux-badselector-')
  writeFileSync(join(dir, 'a.html'), '<!doctype html><html><body><button id="x">x</button></body></html>')
  seedTasks(dir, JSON.stringify({ schemaVersion: 1, tasks: [{ id: 't', start: 'a.html', steps: [{ id: 's', click: '>>>' }] }] }))
  const r = run(['--target', dir])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr + r.stdout, /seletor malformado/)
})

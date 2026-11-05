/**
 * decisions.test.mjs — testes da memória de decisões (plano todo 18, GAP-B2).
 *
 * Contrato sob teste:
 *   - add → list: ciclo feliz grava DEC-001 com reason, exit 0;
 *   - add sem reason → rejeitado (exit != 0) nomeando o campo 'reason';
 *   - query por tela / DEC-id / texto encontra a decisão (exit 0) e
 *     consulta sem match → exit != 0 (nenhuma lista vazia "ok");
 *   - supersede: add --supersedes vira o registro antigo para status
 *     "superseded" e encadeia via campo supersedes; apagar é sempre
 *     rejeitado (subcomandos delete/remove);
 *   - impact DEC-001 lista >= 1 tela quando screens preenchido, e o
 *     caminho reverso (impact por tela) lista decisões e telas;
 *   - adversarial: JSON inválido → erro guiado exit 2 sem stack; texto
 *     não confiável (<script>) escapado na saída; impact sobre DEC
 *     inexistente → exit != 0 nunca lista vazia "ok"; stale_state (DEC
 *     supercedido ainda ativo / órfão) → detectado nomeando os campos.
 *
 * Run: node --test skills/design/scripts/decisions.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./decisions.mjs', import.meta.url))
const FIXTURE_OK = fileURLToPath(new URL('./fixtures/decisions-ok.json', import.meta.url))

const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

/** Fresh register path in a temp dir, optionally seeded from a JSON value. */
function freshStore(seed) {
  const dir = tmpRoot('dec-probe-')
  const file = join(dir, 'decisions.json')
  if (seed !== undefined) writeFileSync(file, typeof seed === 'string' ? seed : JSON.stringify(seed, null, 2), 'utf8')
  return file
}

/** Parses `- DEC-xxx [status] ...` lines from stdout. */
function decisionLines(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('- DEC-'))
    .map((line) => {
      const m = /^- (DEC-\d+) \[(\w+)\]/.exec(line)
      assert.ok(m, `linha de decisão fora do formato: ${line}`)
      return { id: m[1], status: m[2], line }
    })
}

function addArgs(file, fields) {
  const args = ['add', '--file', file]
  for (const [flag, value] of Object.entries(fields)) {
    if (value !== undefined) args.push(`--${flag}`, value)
  }
  return args
}

test('happy: add → list grava DEC-001 com reason, exit 0', () => {
  const file = freshStore()
  const add = run(addArgs(file, { category: 'layout', decision: 'Tabela central densa', reason: 'Varredura rápida é a tarefa diária', screens: 'dashboard.html,settings.html' }))
  assert.equal(add.status, 0, add.stdout + add.stderr)
  assert.match(add.stdout, /DEC-001/)

  const list = run(['list', '--file', file])
  assert.equal(list.status, 0, list.stdout + list.stderr)
  const rows = decisionLines(list.stdout)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'DEC-001')
  assert.equal(rows[0].status, 'active')
  assert.match(rows[0].line, /reason="Varredura rápida é a tarefa diária"/)
  assert.match(rows[0].line, /screens="dashboard\.html, settings\.html"/)

  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.schemaVersion, 1)
  assert.equal(saved.decisions[0].supersedes, null)
  assert.match(saved.decisions[0].createdAt, /^\d{4}-\d{2}-\d{2}$/)
})

test('outcome: grava resultado e exporta lição com outcome', () => {
  const file = freshStore()
  assert.equal(run(addArgs(file, { category: 'layout', decision: 'Login claro', reason: 'Teste de aprovação', screens: 'login/01-login.html' })).status, 0)
  const outcome = run(['outcome', 'DEC-001', '--file', file, '--value', 'funcionou', '--note', 'Aprovado e medido'])
  assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(saved.decisions[0].outcome, { result: 'funcionou', note: 'Aprovado e medido' })
  const lessons = join(tmpRoot('lessons-'), 'lessons.json')
  assert.equal(run(['export', '--file', file, '--out', lessons]).status, 0)
  assert.deepEqual(JSON.parse(readFileSync(lessons, 'utf8')).decisions[0].outcome, saved.decisions[0].outcome)
})

test('outcome inexistente e value inválido são rejeitados com código apropriado', () => {
  const file = freshStore()
  assert.equal(run(addArgs(file, { category: 'x', decision: 'y', reason: 'z' })).status, 0)
  assert.notEqual(run(['outcome', 'DEC-999', '--file', file, '--value', 'funcionou', '--note', 'x']).status, 0)
  assert.equal(run(['outcome', 'DEC-001', '--file', file, '--value', 'talvez', '--note', 'x']).status, 2)
})

test('export/import prefixa DEC-id e import duplicado avisa sem duplicar', () => {
  const source = freshStore()
  assert.equal(run(addArgs(source, { category: 'x', decision: 'y', reason: 'z' })).status, 0)
  const lessons = join(tmpRoot('lessons-'), 'lessons.json')
  assert.equal(run(['export', '--file', source, '--out', lessons]).status, 0)
  const target = freshStore()
  const imported = run(['import', '--file', target, '--source', lessons, '--origin', 'origem'])
  assert.equal(imported.status, 0, imported.stdout + imported.stderr)
  const duplicate = run(['import', '--file', target, '--source', lessons, '--origin', 'origem'])
  assert.equal(duplicate.status, 0)
  assert.match(duplicate.stderr, /duplicate/)
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).decisions.length, 1)
})

test('failure: add sem reason → exit != 0 nomeando o campo reason', () => {
  const file = freshStore()
  const r = run(addArgs(file, { category: 'layout', decision: 'Tabela densa' }))
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /reason/)
  assert.match(r.stdout, /missing required field "reason"/)
  assert.ok(!/\n\s+at /.test(r.stderr), `stack trace exposta:\n${r.stderr}`)
  // nada foi gravado
  assert.throws(() => readFileSync(file, 'utf8'))
})

test('query por tela, DEC-id e texto; termo sem match → exit != 0', () => {
  const file = freshStore()
  assert.equal(run(addArgs(file, { category: 'nav', decision: 'Menu lateral', reason: '6 seções não cabem em abas', screens: 'dashboard.html' })).status, 0)

  const byScreen = run(['query', 'dashboard.html', '--file', file])
  assert.equal(byScreen.status, 0, byScreen.stdout + byScreen.stderr)
  assert.equal(decisionLines(byScreen.stdout).length, 1)

  const byId = run(['query', 'DEC-001', '--file', file])
  assert.equal(byId.status, 0, byId.stdout + byId.stderr)
  assert.match(byId.stdout, /DEC-001/)

  const byText = run(['query', 'seções', '--file', file])
  assert.equal(byText.status, 0, byText.stdout + byText.stderr)
  assert.match(byText.stdout, /DEC-001/)

  const noMatch = run(['query', 'checkout', '--file', file])
  assert.equal(noMatch.status, 1, noMatch.stdout + noMatch.stderr)
  assert.match(noMatch.stdout, /0 decision\(s\) matched/)
})

test('supersede: add --supersedes marca o antigo como superseded; apagar é rejeitado', () => {
  const file = freshStore()
  assert.equal(run(addArgs(file, { category: 'nav', decision: 'Menu fixo', reason: 'Aba não cabe', screens: 'dashboard.html' })).status, 0)
  const sup = run(addArgs(file, { category: 'nav', decision: 'Menu retrátil', reason: 'Largura para telas densas', screens: 'dashboard.html', supersedes: 'DEC-001' }))
  assert.equal(sup.status, 0, sup.stdout + sup.stderr)
  assert.match(sup.stdout, /superseded DEC-001/)

  const list = run(['list', '--file', file])
  assert.equal(list.status, 0, list.stdout + list.stderr)
  const byId = Object.fromEntries(decisionLines(list.stdout).map((r) => [r.id, r]))
  assert.equal(byId['DEC-001'].status, 'superseded')
  assert.equal(byId['DEC-002'].status, 'active')
  assert.match(byId['DEC-002'].line, /supersedes="DEC-001"/)

  // superceder o mesmo alvo duas vezes → rejeitado (um sucessor por decisão)
  const again = run(addArgs(file, { category: 'nav', decision: 'Outra', reason: 'x', supersedes: 'DEC-001' }))
  assert.equal(again.status, 1, again.stdout + again.stderr)
  assert.match(again.stdout, /already superseded by "DEC-002"/)

  // apagar nunca passa — o caminho é superseder
  for (const del of [['delete', 'DEC-001'], ['remove', 'DEC-001']]) {
    const r = run(del)
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /never deleted/)
    assert.match(r.stderr, /supersede/)
  }
})

test('impact DEC-001 lista >= 1 tela; impact por tela lista decisões e telas', () => {
  const file = freshStore()
  assert.equal(run(addArgs(file, { category: 'nav', decision: 'Menu retrátil', reason: 'Largura', screens: 'dashboard.html,settings.html' })).status, 0)
  assert.equal(run(addArgs(file, { category: 'dados', decision: 'Filtro por status', reason: 'Varredura', screens: 'dashboard.html' })).status, 0)

  const byDec = run(['impact', 'DEC-001', '--file', file])
  assert.equal(byDec.status, 0, byDec.stdout + byDec.stderr)
  assert.match(byDec.stdout, /screens affected \(2\):/)
  assert.match(byDec.stdout, /- dashboard\.html/)
  assert.match(byDec.stdout, /- settings\.html/)
  assert.match(byDec.stdout, /decisions governing those screens \(2\):/)
  assert.match(byDec.stdout, /DEC-002/)

  const byScreen = run(['impact', 'settings.html', '--file', file])
  assert.equal(byScreen.status, 0, byScreen.stdout + byScreen.stderr)
  assert.match(byScreen.stdout, /decisions governing this screen \(1\):/)
  assert.match(byScreen.stdout, /DEC-001/)
  assert.match(byScreen.stdout, /screens affected by those decisions \(2\):/)
})

test('misleading success: impact/query sem resultado → exit != 0, nunca lista vazia "ok"', () => {
  const file = freshStore()
  assert.equal(run(addArgs(file, { category: 'nav', decision: 'Menu', reason: 'r', screens: 'dashboard.html' })).status, 0)

  const ghostDec = run(['impact', 'DEC-999', '--file', file])
  assert.equal(ghostDec.status, 1, ghostDec.stdout + ghostDec.stderr)
  assert.match(ghostDec.stdout, /DEC-999/)
  assert.match(ghostDec.stdout, /0 results/)

  const ghostScreen = run(['impact', 'checkout.html', '--file', file])
  assert.equal(ghostScreen.status, 1, ghostScreen.stdout + ghostScreen.stderr)
  assert.match(ghostScreen.stdout, /0 results/)
})

test('malformed: JSON inválido → erro guiado exit 2, sem stack trace', () => {
  const file = freshStore('{"schemaVersion": 1, "decisions": ')
  const r = run(['list', '--file', file])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /invalid JSON/)
  assert.ok(!/\n\s+at /.test(r.stderr), `stack trace exposta:\n${r.stderr}`)
})

test('untrusted text: <script> em decision/reason → escapado na saída', () => {
  const file = freshStore()
  const add = run(addArgs(file, {
    category: '<script>cat</script>',
    decision: '<script>alert(1)</script> tabela densa',
    reason: '"><img src=x onerror=1> varredura',
    screens: 'dashboard.html',
  }))
  assert.equal(add.status, 0, add.stdout + add.stderr)
  assert.ok(!add.stdout.includes('<script>'), `tag crua na saída:\n${add.stdout}`)

  const list = run(['list', '--file', file])
  assert.equal(list.status, 0, list.stdout + list.stderr)
  assert.ok(!list.stdout.includes('<script>'), `tag crua na saída:\n${list.stdout}`)
  assert.match(list.stdout, /&lt;script&gt;/)
})

test('stale_state: DEC supercedido ainda ativo / órfão → detectado nomeando os campos', () => {
  // supersedes aponta para DEC-001 mas DEC-001 continua active
  const stale = freshStore({
    schemaVersion: 1,
    decisions: [
      { id: 'DEC-001', category: 'nav', decision: 'A', reason: 'r', status: 'active', scope: 'global', screens: [], createdAt: '2026-11-01', supersedes: null },
      { id: 'DEC-002', category: 'nav', decision: 'B', reason: 'r', status: 'active', scope: 'global', screens: [], createdAt: '2026-11-02', supersedes: 'DEC-001' },
    ],
  })
  const r = run(['list', '--file', stale])
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /stale-state/)
  assert.match(r.stdout, /DEC-001/)
  assert.match(r.stdout, /superseded/)

  // status "superseded" sem sucessor (registro órfão)
  const orphan = freshStore({
    schemaVersion: 1,
    decisions: [
      { id: 'DEC-001', category: 'nav', decision: 'A', reason: 'r', status: 'superseded', scope: 'global', screens: [], createdAt: '2026-11-01', supersedes: null },
    ],
  })
  const r2 = run(['list', '--file', orphan])
  assert.equal(r2.status, 1, r2.stdout + r2.stderr)
  assert.match(r2.stdout, /stale-state/)
  assert.match(r2.stdout, /DEC-001/)
})

test('schemaVersion ausente ou divergente → rejeitado nomeando o campo', () => {
  const missing = freshStore({ decisions: [] })
  const rMissing = run(['list', '--file', missing])
  assert.equal(rMissing.status, 1)
  assert.match(rMissing.stdout, /schemaVersion/)

  const stale = freshStore({ schemaVersion: 99, decisions: [] })
  const rStale = run(['list', '--file', stale])
  assert.equal(rStale.status, 1)
  assert.match(rStale.stdout, /schemaVersion/)
})

test('fixture decisions-ok.json é um exemplo válido do formato (list exit 0)', () => {
  const r = run(['list', '--file', FIXTURE_OK])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const rows = decisionLines(r.stdout)
  assert.equal(rows.length, 3)
  // cadeia de supersessão do fixture consistente: DEC-002 supercede DEC-001
  const impact = run(['impact', 'DEC-001', '--file', FIXTURE_OK])
  assert.equal(impact.status, 0, impact.stdout + impact.stderr)
  assert.match(impact.stdout, /- dashboard\.html/)
})

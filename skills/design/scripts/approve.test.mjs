/**
 * approve.test.mjs — ciclo de aprovação por hash ligada a DEC-ids (plano todo
 * 27, GAP-D2).
 *
 * Contrato sob teste:
 *   - happy: set-status approved grava {screen, contentHash sha256, status,
 *     decIds, reviewedBy, at} e verify passa (exit 0);
 *   - regra central (stale_state): editar a tela (1 byte) → verify exit≠0 e o
 *     status approved|implemented cai para review no registro (auto-downgrade,
 *     contentHash preservado como proveniência); verify de NÃO passa num
 *     registro stale (misleading_success) até um novo set-status re-vincular;
 *   - hash scope = arquivo da tela: mudar data.json/tokens do canvas NÃO
 *     reabre a aprovação (limite declarado);
 *   - DEC-ids: com decisão ativa governando a tela, aprovar sem --dec → exit≠0
 *     nomeando o DEC; com --dec cobrindo todas as decisões → exit 0;
 *     --dec inexistente → exit≠0; status não-verde não exige --dec;
 *   - adversarial: approvals.json adulterado (JSON inválido, contentHash
 *     forjado, status desconhecido, registro vazio, tela apagada) → exit≠0
 *     guiado sem stack; aprovar sem hash (arquivo da tela ausente) → exit≠0.
 *
 * Run: node --test skills/design/scripts/approve.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./approve.mjs', import.meta.url))
const DECISIONS = fileURLToPath(new URL('./decisions.mjs', import.meta.url))

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

/** Target fixture: canvas login com 2 telas + data.json (fora do hash scope). */
function freshRig() {
  const dir = tmpRoot('approve-probe-')
  const target = join(dir, 'target')
  mkdirSync(join(target, 'login'), { recursive: true })
  writeFileSync(join(target, 'login', 'canvas.json'), JSON.stringify({
    title: 'Login',
    screens: [
      { id: 'login', name: 'Login', file: '01-login.html' },
      { id: 'cadastro', name: 'Cadastro', file: '02-cadastro.html' },
    ],
  }, null, 2))
  writeFileSync(join(target, 'login', '01-login.html'), '<h1>login</h1>\n')
  writeFileSync(join(target, 'login', '02-cadastro.html'), '<h1>cadastro</h1>\n')
  writeFileSync(join(target, 'login', 'data.json'), '{}\n')
  return {
    dir,
    target,
    approvals: join(dir, 'approvals.json'),
    decisions: join(dir, 'decisions.json'),
  }
}

function argsFor(rig, command, ...rest) {
  return [command, ...rest, '--target', rig.target, '--file', rig.approvals, '--decisions', rig.decisions]
}

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function readStore(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Registra uma decisão real via decisions.mjs (join com o registro de origem). */
function addDecision(rig, screens) {
  const run = spawnSync(process.execPath, [
    DECISIONS, 'add', '--file', rig.decisions,
    '--category', 'layout', '--decision', 'Tela reorganizada', '--reason', 'Fluxo de aprovação', '--screens', screens,
  ], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  return /added - (DEC-\d+)/.exec(run.stdout)[1]
}

test('happy: set-status approved grava hash do arquivo e verify passa', () => {
  const rig = freshRig()
  const set = run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa'))
  assert.equal(set.status, 0, set.stdout + set.stderr)
  assert.match(set.stdout, /login\/01-login\.html/)

  const store = readStore(rig.approvals)
  assert.equal(store.schemaVersion, 1)
  assert.equal(store.approvals.length, 1)
  const entry = store.approvals[0]
  assert.equal(entry.screen, 'login/01-login.html')
  assert.equal(entry.status, 'approved')
  assert.equal(entry.contentHash, sha(join(rig.target, 'login', '01-login.html')))
  assert.deepEqual(entry.decIds, [])
  assert.equal(entry.reviewedBy, 'qa')
  assert.ok(!Number.isNaN(Date.parse(entry.at)))

  const verify = run(argsFor(rig, 'verify'))
  assert.equal(verify.status, 0, verify.stdout + verify.stderr)
  assert.match(verify.stdout, /hash ok/)
})

test('regra central: 1 byte a mais → verify exit≠0 e status rebaixado para review (re-verify nunca passa stale)', () => {
  const rig = freshRig()
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa')).status, 0)
  const approvedHash = readStore(rig.approvals).approvals[0].contentHash

  writeFileSync(join(rig.target, 'login', '01-login.html'), '<h1>login</h1>\nX') // +1 byte
  const verify = run(argsFor(rig, 'verify'))
  assert.notEqual(verify.status, 0, verify.stdout + verify.stderr)
  assert.match(verify.stdout, /hash DIVERGE/)

  const entry = readStore(rig.approvals).approvals[0]
  assert.equal(entry.status, 'review', 'auto-downgrade gravado no registro')
  assert.equal(entry.contentHash, approvedHash, 'contentHash preservado como proveniência do que foi aprovado')

  // misleading_success: o registro continua stale — verify NUNCA passa aqui
  const again = run(argsFor(rig, 'verify'))
  assert.notEqual(again.status, 0, again.stdout + again.stderr)

  // ciclo fecha com um novo set-status (re-vincula o conteúdo atual)
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa')).status, 0)
  assert.equal(run(argsFor(rig, 'verify')).status, 0)
})

test('hash scope = arquivo da tela: mudar data.json do canvas NÃO reabre (limite declarado)', () => {
  const rig = freshRig()
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa')).status, 0)
  writeFileSync(join(rig.target, 'login', 'data.json'), '{"mudou": true}\n')
  writeFileSync(join(rig.target, 'login', 'canvas.json'), readFileSync(join(rig.target, 'login', 'canvas.json'), 'utf8'))
  const verify = run(argsFor(rig, 'verify'))
  assert.equal(verify.status, 0, verify.stdout + verify.stderr)
  assert.equal(readStore(rig.approvals).approvals[0].status, 'approved')
})

test('DEC-ids: decisão ativa governando a tela torna --dec obrigatório na aprovação', () => {
  const rig = freshRig()
  const dec = addDecision(rig, 'login')

  const semDec = run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa'))
  assert.notEqual(semDec.status, 0, semDec.stdout + semDec.stderr)
  assert.match(semDec.stdout, new RegExp(dec), 'a rejeição nomeia o DEC que governa a tela')
  assert.match(semDec.stdout, /--dec/)

  // status não-verde não exige DEC
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'review')).status, 0)

  const comDec = run(argsFor(rig, 'set-status', 'login', 'approved', '--dec', dec, '--reviewed-by', 'qa'))
  assert.equal(comDec.status, 0, comDec.stdout + comDec.stderr)
  assert.deepEqual(readStore(rig.approvals).approvals[0].decIds, [dec])
  assert.equal(run(argsFor(rig, 'verify')).status, 0)
})

test('DEC-ids: --dec inexistente ou cobertura incompleta das decisões → exit≠0', () => {
  const rig = freshRig()
  const dec = addDecision(rig, 'login')
  const dec2 = addDecision(rig, '01-login.html')

  const ghost = run(argsFor(rig, 'set-status', 'login', 'approved', '--dec', 'DEC-999', '--reviewed-by', 'qa'))
  assert.notEqual(ghost.status, 0, ghost.stdout + ghost.stderr)
  assert.match(ghost.stdout, /DEC-999/)

  const partial = run(argsFor(rig, 'set-status', 'login', 'approved', '--dec', dec, '--reviewed-by', 'qa'))
  assert.notEqual(partial.status, 0, partial.stdout + partial.stderr)
  assert.match(partial.stdout, new RegExp(dec2), 'toda decisão ativa que governa a tela precisa ser citada')

  const full = run(argsFor(rig, 'set-status', 'login', 'approved', '--dec', `${dec},${dec2}`, '--reviewed-by', 'qa'))
  assert.equal(full.status, 0, full.stdout + full.stderr)
  assert.equal(run(argsFor(rig, 'verify')).status, 0)
})

test('verify detecta aprovação que deixou de citar decisão ativa (stale_state do join DEC)', () => {
  const rig = freshRig()
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa')).status, 0)
  assert.equal(run(argsFor(rig, 'verify')).status, 0)

  const dec = addDecision(rig, 'login') // decisão nasce DEPOIS da aprovação
  const verify = run(argsFor(rig, 'verify'))
  assert.notEqual(verify.status, 0, verify.stdout + verify.stderr)
  assert.match(verify.stdout, new RegExp(dec))
  assert.equal(readStore(rig.approvals).approvals[0].status, 'approved', 'hash bate — só o join DEC está stale')
})

test('adversarial: approvals.json adulterado → verify exit≠0 guiado, sem stack', () => {
  const rig = freshRig()
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa')).status, 0)

  // 1. JSON inválido
  writeFileSync(rig.approvals, '{ "schemaVersion": 1, "approvals": [', 'utf8')
  const broken = run(argsFor(rig, 'verify'))
  assert.notEqual(broken.status, 0)
  assert.match(broken.stderr, /invalid JSON/)
  assert.doesNotMatch(broken.stderr, /at .*\.mjs:\d+/, 'erro guiado, nunca stack')

  // 2. contentHash forjado (não é sha256)
  writeFileSync(rig.approvals, JSON.stringify({
    schemaVersion: 1,
    approvals: [{ screen: 'login/01-login.html', contentHash: 'xyz', status: 'approved', decIds: [], reviewedBy: 'qa', at: '2026-01-01T00:00:00.000Z' }],
  }), 'utf8')
  const forged = run(argsFor(rig, 'verify'))
  assert.notEqual(forged.status, 0, forged.stdout + forged.stderr)
  assert.match(forged.stdout, /contentHash/)

  // 3. status fora do enum
  writeFileSync(rig.approvals, JSON.stringify({
    schemaVersion: 1,
    approvals: [{ screen: 'login/01-login.html', contentHash: sha(join(rig.target, 'login', '01-login.html')), status: 'super-approved', decIds: [], reviewedBy: 'qa', at: '2026-01-01T00:00:00.000Z' }],
  }), 'utf8')
  const enumTamper = run(argsFor(rig, 'verify'))
  assert.notEqual(enumTamper.status, 0, enumTamper.stdout + enumTamper.stderr)
  assert.match(enumTamper.stdout, /status/)

  // 4. registro vazio nunca é "ok"
  writeFileSync(rig.approvals, JSON.stringify({ schemaVersion: 1, approvals: [] }), 'utf8')
  const empty = run(argsFor(rig, 'verify'))
  assert.notEqual(empty.status, 0, empty.stdout + empty.stderr)

  // 5. tela apagada do canvas → registro stale
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'approved', '--reviewed-by', 'qa')).status, 0)
  rmSync(join(rig.target, 'login', '01-login.html'))
  const gone = run(argsFor(rig, 'verify'))
  assert.notEqual(gone.status, 0, gone.stdout + gone.stderr)
  assert.match(gone.stdout, /screen-missing/)
})

test('aprovar sem hash: tela desconhecida ou arquivo ausente → exit≠0', () => {
  const rig = freshRig()
  const ghost = run(argsFor(rig, 'set-status', 'nao-existe', 'approved'))
  assert.notEqual(ghost.status, 0, ghost.stdout + ghost.stderr)
  assert.match(ghost.stderr, /não encontrada/)

  rmSync(join(rig.target, 'login', '02-cadastro.html'))
  const noFile = run(argsFor(rig, 'set-status', 'cadastro', 'approved'))
  assert.notEqual(noFile.status, 0, noFile.stdout + noFile.stderr)
  assert.match(noFile.stderr, /aprovar sem hash/)

  assert.equal(existsSync(rig.approvals), false, 'nenhum registro gravado sem hash')
})

test('implemented segue as mesmas regras da aprovação (DEC + auto-downgrade)', () => {
  const rig = freshRig()
  const dec = addDecision(rig, 'login')
  assert.notEqual(run(argsFor(rig, 'set-status', 'login', 'implemented', '--reviewed-by', 'qa')).status, 0, 'sem --dec é rejeitado')
  assert.equal(run(argsFor(rig, 'set-status', 'login', 'implemented', '--dec', dec, '--reviewed-by', 'qa')).status, 0)
  writeFileSync(join(rig.target, 'login', '01-login.html'), '<h1>mudou</h1>\n')
  const verify = run(argsFor(rig, 'verify'))
  assert.notEqual(verify.status, 0, verify.stdout + verify.stderr)
  assert.equal(readStore(rig.approvals).approvals[0].status, 'review')
})

test('uso: status desconhecido, flag desconhecida ou tela ambígua → exit 2 guiado', () => {
  const rig = freshRig()
  const badStatus = run(argsFor(rig, 'set-status', 'login', 'super-approved'))
  assert.equal(badStatus.status, 2)
  assert.match(badStatus.stderr, /status:/)

  const badFlag = run(argsFor(rig, 'verify', '--nope', 'x'))
  assert.equal(badFlag.status, 2)
  assert.match(badFlag.stderr, /unknown flag/)

  const badCommand = run(['frobnicate'])
  assert.equal(badCommand.status, 2)
  assert.match(badCommand.stderr, /unknown command/)
})

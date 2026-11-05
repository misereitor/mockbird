/**
 * validate-brief.test.mjs — testes do validador de brief (plano todo 17, GAP-B1).
 *
 * Contrato sob teste:
 *   - fixtures/brief-ok.json -> exit 0, zero issues;
 *   - fixtures/brief-contradiction.json -> exit != 0 com >=1 issue
 *     category=contradiction citando os campos conflitantes (tone x
 *     visualDirection no minimo);
 *   - campo desconhecido -> aviso (severity=warning) nomeando o campo, nunca
 *     aceito em silêncio (exit != 0);
 *   - schemaVersion obrigatório: ausente ou divergente -> rejeitado nomeando o
 *     campo (stale_state);
 *   - adversarial: JSON inválido -> erro guiado exit 2 sem stack trace; texto
 *     não confiável (<script>) -> escapado na saída de issues, nunca cru;
 *     contradição disfarçada (mesma exigência em must e mustNot) -> acusada.
 *
 * Run: node --test skills/design/scripts/validate-brief.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./validate-brief.mjs', import.meta.url))
const FIXTURE_OK = fileURLToPath(new URL('./fixtures/brief-ok.json', import.meta.url))
const FIXTURE_CONTRADICTION = fileURLToPath(new URL('./fixtures/brief-contradiction.json', import.meta.url))

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

/** Writes an ad-hoc brief (or raw text) into a temp dir and runs the CLI. */
function runRaw(name, content) {
  const dir = tmpRoot('brief-probe-')
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  return run([file])
}

/** Parses `- category [severity] (fields): message` lines from stdout. */
function issueLines(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const m = /^- (\S+) \[(\S+)\] \(([^)]+)\): (.*)$/.exec(line)
      assert.ok(m, `linha de issue fora do formato: ${line}`)
      return { category: m[1], severity: m[2], fields: m[3], message: m[4] }
    })
}

test('happy: brief-ok valida limpo, exit 0', () => {
  const r = run([FIXTURE_OK])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(issueLines(r.stdout).length, 0)
  assert.match(r.stdout, /brief-check: OK/)
})

test('failure: brief-contradiction -> exit != 0, category=contradiction citando tone x visualDirection', () => {
  const r = run([FIXTURE_CONTRADICTION])
  assert.notEqual(r.status, 0)
  assert.equal(r.status, 1)
  const issues = issueLines(r.stdout)
  const contradictions = issues.filter((i) => i.category === 'contradiction')
  assert.ok(contradictions.length >= 1, r.stdout)
  const canonical = contradictions.find((i) => i.fields.includes('tone') && i.fields.includes('visualDirection'))
  assert.ok(canonical, `nenhuma issue cita tone x visualDirection:\n${r.stdout}`)
  assert.equal(canonical.severity, 'error')
  assert.match(canonical.message, /sóbrio e contido/)
  assert.match(canonical.message, /neon maximalista/)
})

test('campo desconhecido -> aviso naming o campo, nunca aceito em silêncio', () => {
  const brief = JSON.parse(JSON.stringify({ ...JSON.parse(readFixture(FIXTURE_OK)), moodBoard: 'x' }))
  const r = runRaw('brief.json', JSON.stringify(brief))
  assert.equal(r.status, 1)
  const issues = issueLines(r.stdout)
  const unknown = issues.find((i) => i.category === 'unknown-field')
  assert.ok(unknown, r.stdout)
  assert.equal(unknown.severity, 'warning')
  assert.equal(unknown.fields, 'moodBoard')
  assert.match(unknown.message, /moodBoard/)
})

test('schemaVersion obrigatório: ausente ou divergente -> rejeitado nomeando o campo', () => {
  const base = JSON.parse(readFixture(FIXTURE_OK))
  const missing = { ...base }
  delete missing.schemaVersion
  const rMissing = runRaw('brief.json', JSON.stringify(missing))
  assert.equal(rMissing.status, 1)
  const missingIssues = issueLines(rMissing.stdout).filter((i) => i.fields === 'schemaVersion')
  assert.equal(missingIssues.length, 1, rMissing.stdout)
  assert.match(missingIssues[0].message, /schemaVersion/)

  const stale = { ...base, schemaVersion: 99 }
  const rStale = runRaw('brief.json', JSON.stringify(stale))
  assert.equal(rStale.status, 1)
  const staleIssues = issueLines(rStale.stdout).filter((i) => i.fields === 'schemaVersion')
  assert.equal(staleIssues.length, 1, rStale.stdout)
  assert.match(staleIssues[0].message, /99/)
})

test('malformed: JSON inválido -> erro guiado exit 2, sem stack trace', () => {
  const r = runRaw('brief.json', '{"schemaVersion": 1, "tone": ')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /invalid JSON/)
  assert.ok(!/\n\s+at /.test(r.stderr), `stack trace exposta:\n${r.stderr}`)
})

test('untrusted text: <script> em chave e valor -> escapado na saída de issues', () => {
  const base = JSON.parse(readFixture(FIXTURE_OK))
  const brief = {
    ...base,
    tone: 'sóbrio',
    visualDirection: '<script>alert(1)</script> neon maximalista',
    '<script>key': 'x',
  }
  const r = runRaw('brief.json', JSON.stringify(brief))
  assert.equal(r.status, 1)
  assert.ok(!r.stdout.includes('<script>'), `tag crua na saída:\n${r.stdout}`)
  assert.match(r.stdout, /&lt;script&gt;/)
})

test('misleading success: contradição disfarçada (must x mustNot) -> acusada', () => {
  const base = JSON.parse(readFixture(FIXTURE_OK))
  const brief = {
    ...base,
    must: ['modo escuro disponível em todas as telas'],
    mustNot: ['modo escuro'],
  }
  const r = runRaw('brief.json', JSON.stringify(brief))
  assert.equal(r.status, 1)
  const issues = issueLines(r.stdout)
  const overlap = issues.find((i) => i.category === 'contradiction' && i.fields.includes('must'))
  assert.ok(overlap, r.stdout)
  assert.match(overlap.fields, /must\[\d+\] × mustNot\[\d+\]/)
})

function readFixture(path) {
  return readFileSync(path, 'utf8')
}

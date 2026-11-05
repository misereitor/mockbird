/**
 * governance.test.mjs — lint de design system + relatório de saúde (todo 24,
 * GAP-C2). Contrato sob teste:
 *   - fixture boa → exit 0 + health.json schema-válido (schemaVersion, gitSHA
 *     do HEAD, score, violations por regra, orphanTokens, paletteDrift);
 *   - acceptance: skills/design/assets/example → exit 0 (relatório é
 *     report-only; avisos de CSS duplicado não derrubam o exit);
 *   - fixture governance-bad (cor fora da paleta + token órfão + espaçamento
 *     fora da escala + CSS duplicado) → exit 1 nomeando regra+arquivo por
 *     violação (≥2 regras violadas);
 *   - misleading_success: o health.json da fixture ruim JAMAIS nasce sem as
 *     violações que a fixture tem (asserção morde se o relatório mentir);
 *   - tokens.json corrompido/ausente → erro guiado (exit 3, cita tokens.json e
 *     gen-tokens.mjs), nunca fallback silencioso;
 *   - stale state: health.json de gitSHA anterior é detectado (staleRefresh) e
 *     regenerado com o gitSHA atual;
 *   - regra component-reinvented tolera discovery.mjs ausente (status skipped,
 *     sem crash).
 *
 * Run: node --test skills/design/scripts/governance.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const GOV = join(HERE, 'governance.mjs')
const FIX_OK = 'skills/design/scripts/fixtures/governance-ok'
const FIX_BAD = 'skills/design/scripts/fixtures/governance-bad'
const EXAMPLE = 'skills/design/assets/example'

const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
  // artefatos transitórios: .visual das fixtures e health.json do example
  for (const target of [FIX_OK, FIX_BAD]) rmSync(join(ROOT, target, '.visual'), { recursive: true, force: true })
  rmSync(join(ROOT, EXAMPLE, '.visual', 'health.json'), { force: true })
})

function run(target) {
  return spawnSync(process.execPath, [GOV, '--target', target], { cwd: ROOT, encoding: 'utf8' })
}

function gitSHA() {
  return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function healthOf(target) {
  return JSON.parse(readFileSync(join(ROOT, target, '.visual', 'health.json'), 'utf8'))
}

function assertSchema(health, target) {
  assert.equal(health.schemaVersion, 1, 'schemaVersion')
  assert.equal(health.target, target, 'target')
  assert.equal(health.gitSHA, gitSHA(), 'gitSHA embutido = HEAD atual')
  assert.equal(typeof health.score, 'number', 'score numérico')
  assert.ok(Number.isInteger(health.violations.total), 'violations.total')
  assert.ok(Number.isInteger(health.violations.errors), 'violations.errors')
  assert.ok(Number.isInteger(health.violations.warnings), 'violations.warnings')
  assert.equal(typeof health.violations.byRule, 'object', 'violations por regra')
  assert.ok(Array.isArray(health.orphanTokens), 'tokens órfãos')
  assert.ok(Array.isArray(health.paletteDrift), 'deriva de paleta')
  for (const rule of ['token-unused', 'color-off-palette', 'spacing-off-scale', 'css-duplicate', 'component-reinvented']) {
    assert.ok(health.rules[rule], `regra ${rule} registrada`)
  }
}

test('fixture boa → exit 0 + health.json schema-válido', () => {
  const result = run(FIX_OK)
  assert.equal(result.status, 0, `esperava exit 0, veio ${result.status}: ${result.stderr}`)
  const health = healthOf(FIX_OK)
  assertSchema(health, FIX_OK)
  assert.equal(health.score, 100, 'fixture boa = score 100')
  assert.equal(health.violations.total, 0, 'fixture boa = zero violações')
  assert.deepEqual(health.violations.byRule, {})
  assert.deepEqual(health.orphanTokens, [], 'fixture boa referencia todos os tokens')
  assert.deepEqual(health.paletteDrift, [])
  // component-reinvented tolera discovery.mjs ausente: nunca crasha
  assert.equal(typeof health.rules['component-reinvented'].status, 'string')
  assert.match(health.rules['component-reinvented'].status, /^(skipped|ok)/)
})

test('acceptance: example → exit 0 + health.json schema-válido (report-only)', () => {
  const result = run(EXAMPLE)
  assert.equal(result.status, 0, `esperava exit 0, veio ${result.status}: ${result.stderr}`)
  const health = healthOf(EXAMPLE)
  assertSchema(health, EXAMPLE)
  assert.equal(health.violations.errors, 0, 'example sem erros de drift')
  // CSS duplicado entre telas é dado real, mas não derruba o exit
  assert.ok(health.violations.byRule['css-duplicate']?.length >= 1, 'aviso de CSS duplicado relatado')
})

test('fixture governance-bad → exit 1 nomeando regra+arquivo (≥2 regras)', () => {
  const result = run(FIX_BAD)
  assert.equal(result.status, 1, `esperava exit 1, veio ${result.status}: ${result.stderr}`)
  const out = result.stdout + result.stderr
  // as duas regras nomeadas do contrato + as demais do fixture
  assert.match(out, /token-unused/, 'regra token-unused nomeada')
  assert.match(out, /color-off-palette/, 'regra color-off-palette nomeada')
  assert.match(out, /spacing-off-scale/, 'regra spacing-off-scale nomeada')
  assert.match(out, /css-duplicate/, 'regra css-duplicate nomeada')
  assert.match(out, /tokens\.json/, 'arquivo tokens.json nomeado')
  assert.match(out, /tela-01\.html/, 'arquivo tela-01.html nomeado')
  assert.match(out, /#e91e63/, 'cor fora da paleta nomeada')
  const health = healthOf(FIX_BAD)
  assertSchema(health, FIX_BAD)
  assert.ok(Object.keys(health.violations.byRule).length >= 2, '≥2 regras violadas no relatório')
  for (const [rule, entries] of Object.entries(health.violations.byRule)) {
    for (const entry of entries) {
      assert.equal(typeof entry.file, 'string', `${rule}: violação com arquivo`)
      assert.ok(entry.file.length > 0, `${rule}: arquivo não vazio`)
      assert.equal(typeof entry.message, 'string', `${rule}: violação com mensagem`)
    }
  }
})

test('misleading_success: health.json da fixture ruim nunca nasce sem violações', () => {
  const result = run(FIX_BAD)
  assert.notEqual(result.status, 0, 'fixture ruim deve falhar')
  const health = healthOf(FIX_BAD)
  // a verdade da fixture: cor fora da paleta + token órfão. Se o relatório
  // disser "limpo", estas asserções mordem.
  assert.ok(health.violations.total > 0, 'relatório não pode nascer vazio')
  assert.ok(health.violations.byRule['color-off-palette']?.length >= 1, 'cor fora da paleta relatada')
  assert.ok(health.violations.byRule['token-unused']?.length >= 1, 'token órfão relatado')
  assert.ok(health.score < 100, 'score reflete as violações')
})

test('orphanTokens e paletteDrift carregam a verdade da fixture', () => {
  run(FIX_BAD)
  const health = healthOf(FIX_BAD)
  assert.ok(health.orphanTokens.some((t) => t.token === 'color.brand-neon'), 'brand-neon nos tokens órfãos')
  assert.ok(health.paletteDrift.some((d) => d.color.toLowerCase() === '#e91e63'), '#e91e63 na deriva de paleta')
})

test('tokens.json corrompido → erro guiado (exit 3), nunca fallback', () => {
  const dir = tmpRoot('gov-broken-')
  writeFileSync(join(dir, 'tokens.json'), '{ corrompido')
  const result = run(dir)
  assert.equal(result.status, 3, `esperava exit 3, veio ${result.status}`)
  assert.match(result.stderr, /tokens\.json/, 'erro cita tokens.json')
  assert.match(result.stderr, /gen-tokens/, 'erro traz o caminho de correção')
})

test('tokens.json ausente → erro guiado (exit 3)', () => {
  const dir = tmpRoot('gov-missing-')
  const result = run(dir)
  assert.equal(result.status, 3, `esperava exit 3, veio ${result.status}`)
  assert.match(result.stderr, /tokens\.json/, 'erro cita tokens.json')
  assert.match(result.stderr, /gen-tokens/, 'erro traz o caminho de correção')
})

test('stale state: health.json de gitSHA anterior é detectado e regenerado', () => {
  const visualDir = join(ROOT, FIX_OK, '.visual')
  mkdirSync(visualDir, { recursive: true })
  writeFileSync(join(visualDir, 'health.json'), JSON.stringify({ schemaVersion: 1, gitSHA: 'deadbeefcafebabe' }) + '\n')
  const result = run(FIX_OK)
  assert.equal(result.status, 0, `esperava exit 0, veio ${result.status}: ${result.stderr}`)
  assert.match(result.stderr, /defasado/, 'stale state anunciado')
  const health = healthOf(FIX_OK)
  assert.equal(health.staleRefresh?.previousGitSHA, 'deadbeefcafebabe', 'gitSHA defasado registrado')
  assert.equal(health.gitSHA, gitSHA(), 'regenerado com o gitSHA atual')
})

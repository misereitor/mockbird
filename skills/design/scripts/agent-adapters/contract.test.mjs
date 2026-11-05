/**
 * contract.test.mjs — testes do contrato DesignAgent model-agnostic (todo 32,
 * GAP-E2; skills/design/assets/design-agent.contract.md +
 * design-agent.schema.json; docs/arquitetura-evolutiva.md §5.5/§5.6).
 *
 * Contrato sob teste:
 *   - stub-deterministic cumpre generate/review/improve com IO schema-válido
 *     (validado contra design-agent.schema.json, campo a campo);
 *   - determinismo estrito (mesma entrada => mesma saída, hash estável) E
 *     sensibilidade a entrada (stub NÃO é "sortudo" — mudou a entrada, mudou a
 *     saída; adversarial misleading_success);
 *   - alias legado analyze() = review() com o envelope {schemaVersion, model,
 *     tokensUsed, issues} dos consumidores dos todos 11/14;
 *   - offline de verdade: zero sockets e zero fetch nas operações do stub e no
 *     critic --vision --adapter stub de ponta a ponta (sonda de rede no
 *     processo filho);
 *   - seleção sem provedor hardcoded: default = stub offline; adaptadores
 *     reais (openai-compatible, google-genai) opt-in e recusados sem chave de
 *     env (exit≠0 documentado, nomeando a variável);
 *   - texto externo (resposta de modelo) é NÃO confiável: payload fora do
 *     schema é recusado nomeando o campo inválido (malformed_input /
 *     untrusted_external_text), não-JSON e __proto__ caem, envelope é sempre do
 *     runtime, teto estourado é recusado;
 *   - schemaVersion verificado ANTES de interpretar (stale_state);
 *   - probe de sensibilidade: stub corrompido num espelho temporário faz ESTA
 *     suíte falhar (exit≠0) nomeando o campo inválido.
 *
 * Run: node --test skills/design/scripts/agent-adapters/contract.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import {
  AdapterConfigError,
  ContractViolationError,
  DESIGN_AGENT_SCHEMA_VERSION,
  validatePayload,
} from './validate.mjs'
import {
  ADAPTER_ID,
  ADAPTER_IDS,
  DeterministicStubAdapter,
  capabilities as STUB_CAPABILITIES,
  createDesignAgent,
} from './stub-deterministic.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..', '..')
const CRITIC = join(HERE, '..', 'visual-critic.mjs')
const ASSETS = join(HERE, '..', '..', 'assets')
const FIXTURE_OK = join(HERE, '..', 'fixtures', 'critic-ok')

const tmpRoots = []
function tmpRoot(prefix) {
  const dir = mkdtempSync(join(process.env.RUN_TMP ?? tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

/** Env sem nenhuma credencial/config de provedor (offline garantido).
 *  NODE_TEST_CONTEXT é removido: herdado do runner, ele faria um `node --test`
 *  filho (probe de sensibilidade) rodar 0 testes e sair 0. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const key of [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_BASE_URL',
    'GOOGLE_GENAI_MODEL',
    'DESIGN_AGENT_ADAPTER',
    'NODE_TEST_CONTEXT',
  ]) {
    delete env[key]
  }
  return env
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [options.script ?? CRITIC, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: options.env ?? cleanEnv(),
    timeout: 120_000,
  })
}

// ---------- PNGs determinísticos (16x16 RGB, filtro None; decodePng) ----------

function makePng(width, height, pixelAt) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // depth
  ihdr[9] = 2 // color type RGB
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filtro None
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y)
      const at = y * (stride + 1) + 1 + x * 3
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
    }
  }
  const idat = deflateSync(raw)
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    return Buffer.concat([head, data, Buffer.alloc(4)]) // CRC zerado: decodePng não valida CRC
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const UNIFORM_PNG = makePng(16, 16, () => [12, 34, 56]) // uniformidade 100% => issue
const CHECKER_PNG = makePng(16, 16, (x, y) => ((x + y) % 2 === 0 ? [12, 34, 56] : [200, 100, 50]))

// ---------- requests de amostra (contrato) ----------

const GENERATE_REQ = {
  schemaVersion: DESIGN_AGENT_SCHEMA_VERSION,
  operation: 'generate',
  brief: {
    goal: 'Painel de pedidos para operadores logísticos',
    audience: 'operadores logísticos',
    tone: 'sóbrio',
    must: ['lista de pedidos', 'detalhe do pedido'],
    mustNot: ['neon maximalista'],
  },
  screens: [
    { screen: '01-inicio', viewport: '1280x800', state: 'default' },
    { screen: '02-modal' },
  ],
  budgetTokens: 10_000,
}

const REVIEW_REQ = {
  schemaVersion: DESIGN_AGENT_SCHEMA_VERSION,
  operation: 'review',
  screen: '01-inicio',
  viewport: '1280x800',
  state: 'default',
  html: '<!doctype html><html><head><title>x</title></head><body><p>ok</p></body></html>',
  screenshotPng: UNIFORM_PNG.toString('base64'),
  budgetTokens: 10_000,
}

const ISSUE = {
  severity: 'minor',
  category: 'hierarquia',
  element: 'html',
  problem: 'tela quase uniforme',
  suggestion: 'aumentar o contraste entre regiões',
  evidence: 'vision:offline-stub: 01-inicio (16x16)',
}

const IMPROVE_REQ = {
  schemaVersion: DESIGN_AGENT_SCHEMA_VERSION,
  operation: 'improve',
  screen: '01-inicio',
  html: '<!doctype html><html><head><title>x</title></head><body><p>ok</p></body></html>',
  issues: [ISSUE],
  budgetTokens: 10_000,
}

// ---------- fetch falsos (resposta de modelo = texto NÃO confiável) ----------

function fakeChat(texts, usage = 123) {
  const calls = []
  const queue = Array.isArray(texts) ? [...texts] : [texts]
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const text = queue.length > 1 ? queue.shift() : queue[0]
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: text } }],
        usage: { total_tokens: usage },
      }),
    }
  }
  return { calls, fetchImpl }
}

function fakeGoogle(text, usage = 77) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { totalTokenCount: usage },
      }),
    }
  }
  return { calls, fetchImpl }
}

// ---------- descriptor + operações do stub ----------

test('stub: generate/review/improve devolvem IO schema-válido', async () => {
  const agent = new DeterministicStubAdapter()
  // descriptor {role, capabilities} cobre as três operações do contrato
  validatePayload({ role: agent.role, capabilities: [...agent.capabilities] }, 'descriptor')
  assert.deepEqual([...STUB_CAPABILITIES], ['generate', 'review', 'improve'])
  for (const method of ['generate', 'review', 'improve', 'analyze']) {
    assert.equal(typeof agent[method], 'function', `stub precisa implementar ${method}()`)
  }

  const gen = await agent.generate(GENERATE_REQ)
  validatePayload(gen, 'generate-response')
  assert.equal(gen.schemaVersion, 1)
  assert.equal(gen.operation, 'generate')
  assert.equal(gen.model, 'offline-stub')
  assert.ok(gen.tokensUsed <= GENERATE_REQ.budgetTokens)
  assert.deepEqual(gen.screens.map((s) => s.screen), ['01-inicio', '02-modal'])
  assert.ok(gen.screens.every((s) => s.html.includes('<!doctype html>')))

  const rev = await agent.review(REVIEW_REQ)
  validatePayload(rev, 'review-response')
  assert.equal(rev.operation, 'review')
  assert.equal(rev.adapter, ADAPTER_ID)
  assert.ok(Array.isArray(rev.issues))
  assert.ok(rev.tokensUsed <= REVIEW_REQ.budgetTokens)

  const imp = await agent.improve(IMPROVE_REQ)
  validatePayload(imp, 'improve-response')
  assert.equal(imp.operation, 'improve')
  assert.equal(imp.patch.screen, IMPROVE_REQ.screen)
  assert.ok(imp.patch.rationale.length > 0, 'patch sem why é rejeitado pelo schema; o stub sempre explica')
  assert.ok(imp.patch.html.includes('</body>'))
})

test('stub: determinismo estrito e sensibilidade a entrada (não é sorte)', async () => {
  const a = new DeterministicStubAdapter()
  const b = new DeterministicStubAdapter()
  assert.deepEqual(await a.generate(GENERATE_REQ), await b.generate(GENERATE_REQ))
  assert.deepEqual(await a.review(REVIEW_REQ), await b.review(REVIEW_REQ))
  assert.deepEqual(await a.improve(IMPROVE_REQ), await b.improve(IMPROVE_REQ))
  assert.deepEqual(await a.generate(GENERATE_REQ), await a.generate(GENERATE_REQ))

  const otherGoal = { ...GENERATE_REQ, brief: { ...GENERATE_REQ.brief, goal: 'Outro objetivo' } }
  assert.notDeepEqual(await a.generate(otherGoal), await a.generate(GENERATE_REQ))
  const otherPng = { ...REVIEW_REQ, screenshotPng: CHECKER_PNG.toString('base64') }
  assert.notDeepEqual(await a.review(otherPng), await a.review(REVIEW_REQ))
  const otherIssues = { ...IMPROVE_REQ, issues: [...IMPROVE_REQ.issues, { ...ISSUE, problem: 'outra falha' }] }
  assert.notDeepEqual(await a.improve(otherIssues), await a.improve(IMPROVE_REQ))
})

test('stub: sinal visual — tela uniforme vira issue, tela com hierarquia não gera issue', async () => {
  const agent = new DeterministicStubAdapter()
  const uniform = await agent.review(REVIEW_REQ)
  assert.equal(uniform.issues.length, 1)
  assert.equal(uniform.issues[0].severity, 'minor')
  assert.equal(uniform.issues[0].category, 'hierarquia')
  assert.match(uniform.issues[0].evidence, /^vision:offline-stub:/)
  const checker = await agent.review({ ...REVIEW_REQ, screenshotPng: CHECKER_PNG.toString('base64') })
  assert.equal(checker.issues.length, 0)
  const noPng = await agent.review({ ...REVIEW_REQ, screenshotPng: '' })
  assert.equal(noPng.issues.length, 0)
})

test('stub: analyze() é alias legado de review() com o envelope {schemaVersion, model, tokensUsed, issues}', async () => {
  const agent = new DeterministicStubAdapter()
  const legacy = await agent.analyze({
    screen: REVIEW_REQ.screen,
    viewport: REVIEW_REQ.viewport,
    state: REVIEW_REQ.state,
    html: REVIEW_REQ.html,
    screenshotPng: UNIFORM_PNG,
    budgetTokens: REVIEW_REQ.budgetTokens,
  })
  assert.deepEqual(Object.keys(legacy).sort(), ['issues', 'model', 'schemaVersion', 'tokensUsed'])
  const rev = await agent.review(REVIEW_REQ)
  assert.deepEqual(legacy, {
    schemaVersion: rev.schemaVersion,
    model: rev.model,
    tokensUsed: rev.tokensUsed,
    issues: rev.issues,
  })
})

test('stub: zero sockets e zero fetch nas operações do contrato', async () => {
  const calls = []
  const originals = {
    fetch: globalThis.fetch,
    socketConnect: net.Socket.prototype.connect,
    netConnect: net.connect,
    netCreate: net.createConnection,
    tlsConnect: tls.connect,
    httpRequest: http.request,
    httpsRequest: https.request,
  }
  const spy = (name) => {
    const fn = () => {
      calls.push(name)
      throw new Error(`rede bloqueada pelo teste: ${name}`)
    }
    return fn
  }
  globalThis.fetch = spy('fetch')
  net.Socket.prototype.connect = spy('socket.connect')
  net.connect = spy('net.connect')
  net.createConnection = spy('net.createConnection')
  tls.connect = spy('tls.connect')
  http.request = spy('http.request')
  https.request = spy('https.request')
  try {
    const agent = new DeterministicStubAdapter()
    await agent.generate(GENERATE_REQ)
    await agent.review(REVIEW_REQ)
    await agent.improve(IMPROVE_REQ)
    await agent.analyze({ ...REVIEW_REQ, screenshotPng: UNIFORM_PNG })
  } finally {
    globalThis.fetch = originals.fetch
    net.Socket.prototype.connect = originals.socketConnect
    net.connect = originals.netConnect
    net.createConnection = originals.netCreate
    tls.connect = originals.tlsConnect
    http.request = originals.httpRequest
    https.request = originals.httpsRequest
  }
  assert.deepEqual(calls, [], 'o stub é offline: nenhuma chamada de rede é permitida')
})

// ---------- seleção de adapter (sem provedor hardcoded) ----------

test('seleção: default é o stub offline; id desconhecido é recusado nomeando os ids válidos', () => {
  const agent = createDesignAgent({ env: {} })
  assert.equal(agent.id, ADAPTER_ID)
  assert.equal(agent.offline, true)
  assert.throws(
    () => createDesignAgent({ adapter: 'hal-9000', env: {} }),
    (err) => {
      assert.ok(err instanceof AdapterConfigError)
      assert.match(err.message, /hal-9000/)
      assert.match(err.message, /stub/)
      return true
    }
  )
  assert.ok(ADAPTER_IDS.includes('stub'))
  assert.ok(ADAPTER_IDS.includes('openai-compatible'))
  assert.ok(ADAPTER_IDS.includes('google-genai'))
})

test('seleção: env DESIGN_AGENT_ADAPTER seleciona adapter (opt-in, nunca default pago)', () => {
  const viaEnv = createDesignAgent({ env: { DESIGN_AGENT_ADAPTER: 'stub-deterministic' } })
  assert.equal(viaEnv.id, ADAPTER_ID)
  const paid = createDesignAgent({
    adapter: 'openai-compatible',
    env: { OPENAI_API_KEY: 'sk-teste' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  })
  assert.equal(paid.id, 'openai-compatible')
  assert.equal(paid.offline, false)
})

test('adapters: sem chave de env a criação falha nomeando a variável (exit≠0 documentado)', () => {
  assert.throws(
    () => createDesignAgent({ adapter: 'openai-compatible', env: {} }),
    (err) => {
      assert.ok(err instanceof AdapterConfigError)
      assert.match(err.message, /OPENAI_API_KEY/)
      return true
    }
  )
  assert.throws(
    () => createDesignAgent({ adapter: 'google-genai', env: {} }),
    (err) => {
      assert.ok(err instanceof AdapterConfigError)
      assert.match(err.message, /GOOGLE_API_KEY/)
      return true
    }
  )
})

test('adapters: chamada paga sem budgetTokens é recusada ANTES do fetch', async () => {
  const { calls, fetchImpl } = fakeChat('{}')
  const agent = createDesignAgent({ adapter: 'openai-compatible', env: { OPENAI_API_KEY: 'sk-teste' }, fetchImpl })
  await assert.rejects(
    () => agent.review({ schemaVersion: 1, operation: 'review', screen: 'x', html: '<p>x</p>' }),
    /budgetTokens/
  )
  await assert.rejects(
    () => agent.generate({ schemaVersion: 1, operation: 'generate', brief: { goal: 'g' }, screens: [{ screen: '01' }] }),
    /budgetTokens/
  )
  assert.equal(calls.length, 0, 'sem teto não há chamada — nem de teste')
})

// ---------- texto externo NÃO confiável ----------

test('adapters: texto externo não confiável — payload fora do schema é recusado nomeando o campo', async () => {
  const bad = JSON.stringify({
    issues: [{ severity: 'catastrófico', category: 'hierarquia', element: 'html', problem: 'p', suggestion: 's', evidence: 'e' }],
  })
  const { fetchImpl } = fakeChat(bad)
  const agent = createDesignAgent({ adapter: 'openai-compatible', env: { OPENAI_API_KEY: 'sk-teste' }, fetchImpl })
  await assert.rejects(
    () => agent.review(REVIEW_REQ),
    (err) => {
      assert.ok(err instanceof ContractViolationError)
      assert.match(err.message, /\$\.issues\[0\]\.severity/)
      return true
    }
  )
})

test('adapters: texto externo não confiável — não-JSON, __proto__ e teto estourado são recusados', async () => {
  // não-JSON
  {
    const { fetchImpl } = fakeChat('desculpe, não posso fazer isso')
    const agent = createDesignAgent({ adapter: 'openai-compatible', env: { OPENAI_API_KEY: 'sk-teste' }, fetchImpl })
    await assert.rejects(() => agent.review(REVIEW_REQ), /não é JSON válido/)
  }
  // tentativa de poluição de protótipo via texto externo
  {
    const { fetchImpl } = fakeChat('{"issues":[],"__proto__":{"polluted":true}}')
    const agent = createDesignAgent({ adapter: 'openai-compatible', env: { OPENAI_API_KEY: 'sk-teste' }, fetchImpl })
    await assert.rejects(() => agent.review(REVIEW_REQ), /__proto__/)
    assert.equal({}.polluted, undefined, 'texto externo nunca polui o protótipo')
  }
  // usage real acima do teto => "teto violado"
  {
    const { fetchImpl } = fakeChat(JSON.stringify({ issues: [] }), 999_999)
    const agent = createDesignAgent({ adapter: 'openai-compatible', env: { OPENAI_API_KEY: 'sk-teste' }, fetchImpl })
    await assert.rejects(() => agent.review({ ...REVIEW_REQ, budgetTokens: 100 }), /teto violado/)
  }
})

test('adapters: envelope do runtime sobrescreve o texto externo (identidade/gasto)', async () => {
  const hostile = JSON.stringify({
    schemaVersion: 99,
    operation: 'hack',
    adapter: 'evil',
    model: 'evil-model',
    tokensUsed: 999_999,
    issues: [],
  })
  const { calls, fetchImpl } = fakeChat(hostile, 123)
  const agent = createDesignAgent({
    adapter: 'openai-compatible',
    env: { OPENAI_API_KEY: 'sk-teste', OPENAI_MODEL: 'modelo-teste' },
    fetchImpl,
  })
  const res = await agent.review(REVIEW_REQ)
  assert.equal(res.schemaVersion, 1)
  assert.equal(res.operation, 'review')
  assert.equal(res.adapter, 'openai-compatible')
  assert.equal(res.model, 'modelo-teste')
  assert.equal(res.tokensUsed, 123)
  validatePayload(res, 'review-response')
  const sent = JSON.parse(calls[0].init.body)
  assert.equal(sent.max_tokens, REVIEW_REQ.budgetTokens, 'o teto do request vira max_tokens')
})

test('adapters: happy path offline via fetch injetado (openai-compatible e google-genai)', async () => {
  const screens = JSON.stringify({ screens: [{ screen: '01-inicio', html: '<!doctype html><html><body><p>g</p></body></html>' }] })
  const issues = JSON.stringify({ issues: [ISSUE] })
  const patch = JSON.stringify({
    patch: { screen: '01-inicio', html: '<html><body><p>melhorado</p></body></html>', rationale: 'melhora x', decIds: ['DEC-001'] },
  })
  const { calls, fetchImpl } = fakeChat([screens, issues, patch], 123)
  const agent = createDesignAgent({ adapter: 'openai-compatible', env: { OPENAI_API_KEY: 'sk-teste' }, fetchImpl })
  const gen = await agent.generate(GENERATE_REQ)
  validatePayload(gen, 'generate-response')
  assert.deepEqual(gen.screens.map((s) => s.screen), ['01-inicio'])
  const rev = await agent.review(REVIEW_REQ)
  validatePayload(rev, 'review-response')
  assert.equal(rev.issues.length, 1)
  const imp = await agent.improve(IMPROVE_REQ)
  validatePayload(imp, 'improve-response')
  assert.match(imp.patch.rationale, /melhora/)
  assert.equal(calls.length, 3)

  const g = fakeGoogle(issues, 77)
  const google = createDesignAgent({
    adapter: 'google-genai',
    env: { GOOGLE_API_KEY: 'g-teste', GOOGLE_GENAI_MODEL: 'modelo-g' },
    fetchImpl: g.fetchImpl,
  })
  const gr = await google.review(REVIEW_REQ)
  validatePayload(gr, 'review-response')
  assert.equal(gr.model, 'modelo-g')
  assert.equal(gr.tokensUsed, 77)
  assert.equal(gr.issues.length, 1)
})

// ---------- stale_state + documentação do versionamento ----------

test('contrato: schemaVersion ausente/errado e campos fora do schema são recusados nomeando o campo', () => {
  const base = { operation: 'review', screen: 'x', html: '<p>x</p>', budgetTokens: 10 }
  assert.throws(
    () => validatePayload({ ...base }, 'review-request'),
    (err) => {
      assert.match(err.message, /\$\.schemaVersion/)
      assert.match(err.message, /antes da interpretação/)
      return true
    }
  )
  assert.throws(() => validatePayload({ ...base, schemaVersion: 2 }, 'review-request'), /\$\.schemaVersion/)
  assert.throws(() => validatePayload({ ...base, schemaVersion: '1' }, 'review-request'), /\$\.schemaVersion/)
  assert.throws(
    () => validatePayload({ schemaVersion: 1, operation: 'review', screen: 'x', html: '<p>x</p>', budgetTokens: 0 }, 'review-request'),
    /budgetTokens/
  )
  assert.throws(
    () => validatePayload({ schemaVersion: 1, operation: 'generate', screens: [{ screen: '01' }], budgetTokens: 10 }, 'generate-request'),
    /brief/
  )
})

test('contrato: documento e schema documentam versionamento, envs e disciplina de teto', () => {
  const md = readFileSync(join(ASSETS, 'design-agent.contract.md'), 'utf8')
  for (const needle of [
    'schemaVersion',
    'migration-guide',
    'DESIGN_AGENT_ADAPTER',
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
    'budgetTokens',
    '--adapter',
    'generate',
    'review',
    'improve',
  ]) {
    assert.ok(md.includes(needle), `design-agent.contract.md não documenta "${needle}"`)
  }
  const schema = JSON.parse(readFileSync(join(ASSETS, 'design-agent.schema.json'), 'utf8'))
  assert.match(schema.description, /schemaVersion/)
  assert.match(schema.properties.schemaVersion.description, /migra|migration/i)
  assert.deepEqual(schema.$defs.ReviewResponse.required, ['schemaVersion', 'operation', 'adapter', 'model', 'tokensUsed', 'issues'])
})

// ---------- probe de sensibilidade (failure mode do aceite) ----------

test('probe de sensibilidade: stub corrompido faz a suíte falhar nomeando o campo inválido', () => {
  const mirror = tmpRoot('probe-mirror-')
  mkdirSync(join(mirror, 'skills', 'design', 'scripts', 'lib'), { recursive: true })
  mkdirSync(join(mirror, 'skills', 'design', 'assets'), { recursive: true })
  cpSync(HERE, join(mirror, 'skills', 'design', 'scripts', 'agent-adapters'), { recursive: true })
  cpSync(join(HERE, '..', 'lib'), join(mirror, 'skills', 'design', 'scripts', 'lib'), { recursive: true })
  cpSync(join(ASSETS, 'design-agent.schema.json'), join(mirror, 'skills', 'design', 'assets', 'design-agent.schema.json'))

  const stubPath = join(mirror, 'skills', 'design', 'scripts', 'agent-adapters', 'stub-deterministic.mjs')
  const src = readFileSync(stubPath, 'utf8')
  assert.equal(src.split("severity: 'minor'").length - 1, 1, 'o ponto de corrupção precisa ser único')
  const corrupted = src.replace("severity: 'minor'", "severity: 'catastrófico'")
  assert.notEqual(corrupted, src)
  writeFileSync(stubPath, corrupted)

  const run = spawnSync(
    process.execPath,
    ['--test', '--test-name-pattern', 'stub: generate', join(mirror, 'skills', 'design', 'scripts', 'agent-adapters', 'contract.test.mjs')],
    { cwd: ROOT, encoding: 'utf8', env: cleanEnv(), timeout: 120_000 }
  )
  const output = `${run.stdout}${run.stderr}`
  assert.notEqual(run.status, 0, 'suite contra stub corrompido PRECISA falhar (exit≠0)')
  assert.match(output, /\$\.issues\[0\]\.severity/, 'a falha precisa nomear o campo inválido')
})

// ---------- critic --vision --adapter stub (ponta a ponta, zero rede) ----------

test('critic: --vision --adapter stub roda de ponta a ponta com zero sockets/fetch', () => {
  const dir = tmpRoot('critic-e2e-')
  const outDir = join(dir, 'out')
  const probeLog = join(dir, 'net.json')
  const probeFile = join(dir, 'net-probe.mjs')
  writeFileSync(
    probeFile,
    [
      "import net from 'node:net'",
      "import tls from 'node:tls'",
      "import { writeFileSync } from 'node:fs'",
      'const log = { fetch: [], connect: [] }',
      'globalThis.fetch = async (url) => { log.fetch.push(String(url)); throw new Error(`fetch bloqueado pelo probe: ${String(url)}`) }',
      'const origConnect = net.Socket.prototype.connect',
      'net.Socket.prototype.connect = function (...args) {',
      "  const first = args[0]",
      "  log.connect.push(typeof first === 'object' && first !== null ? JSON.stringify(first) : String(first))",
      '  return origConnect.apply(this, args)',
      '}',
      'const origNet = net.connect',
      "net.connect = (...args) => { log.connect.push('net.connect') ; return origNet(...args) }",
      'net.createConnection = net.connect',
      'const origTls = tls.connect',
      "tls.connect = (...args) => { log.connect.push('tls.connect'); return origTls(...args) }",
      "process.on('exit', () => { writeFileSync(process.env.NET_PROBE_LOG, JSON.stringify(log)) })",
      '',
    ].join('\n')
  )
  const run = runCli(
    ['--target', FIXTURE_OK, '--out', outDir, '--vision', '--budget-tokens', '100000', '--adapter', 'stub'],
    { env: cleanEnv({ NET_PROBE_LOG: probeLog, NODE_OPTIONS: `--import ${probeFile}` }) }
  )
  assert.equal(run.status, 0, `critic via stub falhou: ${run.stderr}`)
  const log = JSON.parse(readFileSync(probeLog, 'utf8'))
  assert.deepEqual(log.fetch, [], 'zero fetch no critic via stub')
  assert.deepEqual(log.connect, [], 'zero sockets abertos pelo processo do critic via stub')

  const report = JSON.parse(readFileSync(join(outDir, '01-painel.json'), 'utf8'))
  assert.equal(report.vision.optIn, true)
  assert.equal(report.vision.run, true)
  assert.equal(report.vision.adapter, ADAPTER_ID)
  assert.equal(report.vision.budgetTokens, 100_000)
  assert.ok(report.vision.tokensUsed <= report.vision.budgetTokens)
})

test('critic: --adapter sem chave ou sem --vision => exit≠0 guiado nomeando a env/flag', () => {
  const dir = tmpRoot('critic-keyless-')
  const outDir = join(dir, 'out')
  const openai = runCli(['--target', FIXTURE_OK, '--out', outDir, '--vision', '--budget-tokens', '10', '--adapter', 'openai-compatible'])
  assert.equal(openai.status, 2, 'adapter sem chave => exit≠0')
  assert.match(`${openai.stdout}${openai.stderr}`, /OPENAI_API_KEY/)

  const google = runCli(['--target', FIXTURE_OK, '--out', outDir, '--vision', '--budget-tokens', '10', '--adapter', 'google-genai'])
  assert.equal(google.status, 2, 'adapter sem chave => exit≠0')
  assert.match(`${google.stdout}${google.stderr}`, /GOOGLE_API_KEY/)

  const noVision = runCli(['--target', FIXTURE_OK, '--out', outDir, '--adapter', 'stub'])
  assert.equal(noVision.status, 2, '--adapter sem --vision => exit≠0')
  assert.match(`${noVision.stdout}${noVision.stderr}`, /--adapter só faz sentido com --vision/)
})

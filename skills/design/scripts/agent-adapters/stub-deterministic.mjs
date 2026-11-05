/**
 * stub-deterministic.mjs — DesignAgent determinístico offline (todo 32, GAP-E2;
 * contrato em skills/design/assets/design-agent.contract.md +
 * design-agent.schema.json; caminho fixado por docs/arquitetura-evolutiva.md
 * §5.5 desde o todo 11).
 *
 * Cumpre o contrato COMPLETO {role, capabilities, generate, review, improve}
 * com IO JSON schema-válido (validado de ponta a ponta por contract.test.mjs) e
 * mantém o alias legado analyze() = review() com o envelope antigo
 * {schemaVersion, model, tokensUsed, issues} — o seam estável dos consumidores
 * dos todos 11/14 (visual-critic --vision, benchmark). Respostas são validadas
 * contra o schema ANTES de sair daqui: o stub nunca emite payload fora do
 * contrato (misleading_success é impossível por construção e verificado por
 * determinismo estrito + sensibilidade a entrada no teste).
 *
 * OFFLINE e DETERMINÍSTICO: mesma entrada => mesma saída, zero sockets/fetch,
 * sempre disponível para testes. O sinal de review é real e barato
 * (uniformidade dos pixels do screenshot, decodificado com lib/image-diff.mjs);
 * generate e improve derivam o HTML deterministicamente do request — texto de
 * brief/issues é NÃO confiável e é escapado, nunca vira markup. Contabilidade
 * de tokens NOMINAL (chars/4 + bytes/1000), sempre tokensUsed <= budgetTokens.
 *
 * createDesignAgent(options) é o seam de seleção de adaptadores do sistema
 * (todo 32): default = este stub offline; adaptadores reais
 * (openai-compatible, google-genai) são OPT-IN por id (--adapter no critic,
 * DESIGN_AGENT_ADAPTER, options.adapter) e exigem chave em variável de
 * ambiente — nunca provedor pago por padrão, nunca chamada paga sem teto
 * (budgetTokens >= 1). Id desconhecido ou sem chave => AdapterConfigError
 * nomeando os ids/variáveis (quem chama devolve exit≠0 guiado).
 */
import { decodePng } from '../lib/image-diff.mjs'
import { GoogleGenAIAdapter } from './google-genai.mjs'
import { OpenAICompatibleAdapter } from './openai-compatible.mjs'
import { AdapterConfigError, DESIGN_AGENT_SCHEMA_VERSION, validatePayload } from './validate.mjs'

export const ADAPTER_ID = 'stub-deterministic'
export const DESIGN_AGENT_CONTRACT_VERSION = DESIGN_AGENT_SCHEMA_VERSION

/** Identificação do papel no contrato DesignAgent (todo 32). */
export const role = 'design-agent'
export const capabilities = Object.freeze(['generate', 'review', 'improve'])

/** Ids canônicos de adapter (seam de seleção de createDesignAgent). */
export const ADAPTER_IDS = Object.freeze(['stub', 'openai-compatible', 'google-genai'])

/** Contabilidade nominal determinística do stub (nunca excede o teto). */
function nominalTokens(htmlChars, pngBytes) {
  return Math.ceil(htmlChars / 4) + Math.ceil(pngBytes / 1000)
}

/** Escapa texto não confiável antes de virar markup/comentário HTML. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Sinal visual determinístico do review: tela quase uniforme (sem hierarquia
 * visual perceptível) vira issue de diagnóstico. Só roda se o PNG decodificar
 * (a lib compartilhada guia erros de PNG; o stub nunca quebra a execução).
 */
function visionIssues({ screen, screenshotPng, model }) {
  const issues = []
  try {
    const png = decodePng(screenshotPng)
    const pixels = png.width * png.height
    const first = [png.pixels[0], png.pixels[1], png.pixels[2]]
    let identical = 0
    for (let i = 0; i < pixels; i += 1) {
      const at = i * png.channels
      if (png.pixels[at] === first[0] && png.pixels[at + 1] === first[1] && png.pixels[at + 2] === first[2]) {
        identical += 1
      }
    }
    const uniformity = identical / pixels
    if (uniformity > 0.98) {
      issues.push({
        severity: 'minor',
        category: 'hierarquia',
        element: 'html',
        problem: `passe de visão (stub): tela quase uniforme (${(uniformity * 100).toFixed(1)}% dos pixels idênticos) — sem hierarquia visual perceptível`,
        suggestion: 'verificar se a tela renderizou conteúdo (quadro vazio/monocromático) e se há contraste visual entre regiões',
        evidence: `vision:${model}: ${screen} (${png.width}x${png.height}, uniformidade ${(uniformity * 100).toFixed(1)}%)`,
      })
    }
  } catch {
    // PNG ilegível: sem sinal visual, sem issue — diagnóstico, não veredito.
  }
  return issues
}

/** HTML determinístico do generate: tela autocontida derivada do brief. */
function generateScreenHtml(brief, screenReq) {
  const esc = escapeHtml
  const list = (items) => (items ?? []).map((item) => `      <li>${esc(item)}</li>`).join('\n')
  const optional = []
  if (brief.audience) optional.push(`    <p data-attr="audience">${esc(brief.audience)}</p>`)
  if (brief.tone) optional.push(`    <p data-attr="tone">${esc(brief.tone)}</p>`)
  if (brief.visualDirection) optional.push(`    <p data-attr="visual-direction">${esc(brief.visualDirection)}</p>`)
  if (brief.platform) optional.push(`    <p data-attr="platform">${esc(brief.platform)}</p>`)
  const sections = []
  if ((brief.must ?? []).length > 0) sections.push(`    <section data-attr="must">\n      <h2>must</h2>\n      <ul>\n${list(brief.must)}\n      </ul>\n    </section>`)
  if ((brief.mustNot ?? []).length > 0) sections.push(`    <section data-attr="must-not">\n      <h2>mustNot</h2>\n      <ul>\n${list(brief.mustNot)}\n      </ul>\n    </section>`)
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${esc(screenReq.screen)} — ${esc(brief.goal)}</title>`,
    '</head>',
    '<body>',
    `  <main data-screen="${esc(screenReq.screen)}" data-state="${esc(screenReq.state ?? 'default')}">`,
    `    <h1>${esc(brief.goal)}</h1>`,
    ...optional,
    ...sections,
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

export class DeterministicStubAdapter {
  constructor(options = {}) {
    this.id = ADAPTER_ID
    this.model = 'offline-stub'
    this.offline = true
    this.role = options.role ?? role
    this.capabilities = capabilities
  }

  /** generate(request) -> screens. */
  async generate(request) {
    const req = validatePayload(request, 'generate-request')
    const screens = req.screens.map((screenReq) => ({
      screen: screenReq.screen,
      html: generateScreenHtml(req.brief, screenReq),
    }))
    const totalChars = screens.reduce((n, s) => n + s.html.length, 0)
    const tokensUsed = Math.min(nominalTokens(totalChars, 0), req.budgetTokens)
    const response = {
      schemaVersion: DESIGN_AGENT_CONTRACT_VERSION,
      operation: 'generate',
      adapter: this.id,
      model: this.model,
      tokensUsed,
      screens,
    }
    return validatePayload(response, 'generate-response')
  }

  /** review(reportSchema) -> issues. */
  async review(request) {
    const req = validatePayload(request, 'review-request')
    const screenshotPng = Buffer.from(req.screenshotPng ?? '', 'base64')
    const issues = visionIssues({ screen: req.screen, screenshotPng, model: this.model })
    const tokensUsed = Math.min(nominalTokens(req.html.length, screenshotPng.length), req.budgetTokens)
    const response = {
      schemaVersion: DESIGN_AGENT_CONTRACT_VERSION,
      operation: 'review',
      adapter: this.id,
      model: this.model,
      tokensUsed,
      issues,
    }
    return validatePayload(response, 'review-response')
  }

  /** improve(issues) -> patch. */
  async improve(request) {
    const req = validatePayload(request, 'improve-request')
    const notes = req.issues.map(
      (it) => `  <!-- mockbird-improve [${escapeHtml(it.severity)}|${escapeHtml(it.category)}] ${escapeHtml(it.element)}: ${escapeHtml(it.problem)} -->`
    )
    const marker = '</body>'
    const at = req.html.toLowerCase().lastIndexOf(marker)
    const html =
      at === -1
        ? `${req.html}\n${notes.join('\n')}\n`
        : `${req.html.slice(0, at)}${notes.join('\n')}\n${req.html.slice(at)}`
    const patch = {
      screen: req.screen,
      html,
      rationale: `stub determinístico: ${req.issues.length} issue(s) registradas como comentário auditável no fechamento do body — a edição semântica é responsabilidade do adaptador de provedor`,
      decIds: [],
    }
    const tokensUsed = Math.min(nominalTokens(req.html.length + html.length, 0), req.budgetTokens)
    const response = {
      schemaVersion: DESIGN_AGENT_CONTRACT_VERSION,
      operation: 'improve',
      adapter: this.id,
      model: this.model,
      tokensUsed,
      patch,
    }
    return validatePayload(response, 'improve-response')
  }

  /**
   * Alias legado (todos 11/14): analyze = review com o envelope antigo
   * {schemaVersion, model, tokensUsed, issues}. O screenshot chega em bytes
   * (Buffer/Uint8Array) e vira base64 para o request JSON do contrato; o
   * resultado é idêntico ao de review() para a mesma entrada.
   */
  async analyze(request) {
    const response = await this.review(
      JSON.parse(
        JSON.stringify({
          schemaVersion: DESIGN_AGENT_CONTRACT_VERSION,
          operation: 'review',
          screen: request.screen,
          viewport: request.viewport,
          state: request.state,
          html: request.html,
          screenshotPng: request.screenshotPng ? Buffer.from(request.screenshotPng).toString('base64') : '',
          budgetTokens: request.budgetTokens,
        })
      )
    )
    return {
      schemaVersion: response.schemaVersion,
      model: response.model,
      tokensUsed: response.tokensUsed,
      issues: response.issues,
    }
  }
}

const ADAPTER_FACTORIES = Object.freeze({
  stub: (options) => new DeterministicStubAdapter(options),
  'stub-deterministic': (options) => new DeterministicStubAdapter(options),
  'openai-compatible': (options) => new OpenAICompatibleAdapter(options),
  'google-genai': (options) => new GoogleGenAIAdapter(options),
})

/**
 * Fábrica/seam do adapter DesignAgent (todo 32). Seleção:
 *   options.adapter > options.env.DESIGN_AGENT_ADAPTER > process.env.DESIGN_AGENT_ADAPTER > 'stub'.
 * Default SEMPRE o stub offline (nunca provedor pago por padrão); adaptadores
 * reais são opt-in e recusam criação sem chave de env (AdapterConfigError).
 */
export function createDesignAgent(options = {}) {
  const env = options.env ?? process.env
  const id = options.adapter ?? env.DESIGN_AGENT_ADAPTER ?? 'stub'
  const factory = ADAPTER_FACTORIES[id]
  if (factory === undefined) {
    throw new AdapterConfigError(`adapter desconhecido "${String(id)}" — ids válidos: ${ADAPTER_IDS.join(', ')}`)
  }
  return factory(options)
}

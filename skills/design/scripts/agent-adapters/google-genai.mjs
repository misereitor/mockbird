/**
 * google-genai.mjs — adapter DesignAgent de EXEMPLO para a API Google
 * Generative Language (generateContent) (todo 32, GAP-E2). Prova agnosticismo:
 * fala o MESMO contrato (design-agent.schema.json) do stub offline, por HTTP
 * simples com fetch nativo (zero dependências novas).
 *
 * OPT-IN: nunca é o default (o default é o stub offline); só é criado quando
 * nomeado explicitamente (--adapter google-genai, DESIGN_AGENT_ADAPTER ou
 * options.adapter). Sem a chave de env => AdapterConfigError nomeando a
 * variável (quem chama devolve exit≠0 guiado — documentado no contrato).
 *
 * Env:
 *   GOOGLE_API_KEY      obrigatória (chave nunca hardcoded; só variável de ambiente)
 *   GOOGLE_GENAI_BASE_URL  default https://generativelanguage.googleapis.com/v1beta
 *   GOOGLE_GENAI_MODEL     default gemini-2.5-flash
 *
 * Disciplina de orçamento (§5.6): toda operação exige budgetTokens inteiro >= 1
 * e é recusada ANTES do fetch sem teto; tokensUsed real (usageMetadata do
 * provedor) acima do teto => ContractViolationError "teto violado". Resposta do
 * modelo é texto NÃO confiável: o envelope é do runtime e o corpo só é aceito
 * depois de validatePayload (que nomeia o campo fora do schema).
 */
import {
  AdapterConfigError,
  ContractViolationError,
  DESIGN_AGENT_SCHEMA_VERSION,
  validatePayload,
} from './validate.mjs'
import {
  DESIGN_AGENT_SYSTEM_PROMPT,
  assembleResponse,
  assertBudget,
  parseModelText,
} from './protocol.mjs'

export const ADAPTER_ID = 'google-genai'

/** Identificação do papel no contrato DesignAgent (todo 32). */
export const role = 'design-agent'
export const capabilities = Object.freeze(['generate', 'review', 'improve'])

export class GoogleGenAIAdapter {
  constructor(options = {}) {
    const env = options.env ?? process.env
    this.id = ADAPTER_ID
    this.role = options.role ?? role
    this.capabilities = capabilities
    this.offline = false
    this.apiKey = env.GOOGLE_API_KEY
    if (!this.apiKey) {
      throw new AdapterConfigError(
        `adapter ${ADAPTER_ID} exige a variável de ambiente GOOGLE_API_KEY — sem chave o adaptador não é criado (opt-in; exit≠0 documentado em skills/design/assets/design-agent.contract.md)`
      )
    }
    this.baseUrl = String(env.GOOGLE_GENAI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    this.model = env.GOOGLE_GENAI_MODEL ?? 'gemini-2.5-flash'
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  /** generate(request) -> screens. */
  async generate(request) {
    return this.#run('generate', request)
  }

  /** review(reportSchema) -> issues. */
  async review(request) {
    return this.#run('review', request)
  }

  /** improve(issues) -> patch. */
  async improve(request) {
    return this.#run('improve', request)
  }

  /**
   * Alias legado (todos 11/14): analyze = review com o envelope antigo
   * {schemaVersion, model, tokensUsed, issues}.
   */
  async analyze(request) {
    const response = await this.review(
      JSON.parse(
        JSON.stringify({
          schemaVersion: DESIGN_AGENT_SCHEMA_VERSION,
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

  async #run(operation, request) {
    const req = validatePayload(request, `${operation}-request`)
    assertBudget(req, this.id)
    const res = await this.fetchImpl(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: DESIGN_AGENT_SYSTEM_PROMPT }, { text: JSON.stringify(req) }],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: req.budgetTokens },
        }),
      }
    )
    if (!res || !res.ok) {
      throw new ContractViolationError(
        `adapter ${this.id}: HTTP ${res?.status ?? '?'} do provedor ${this.baseUrl}`
      )
    }
    const data = await res.json()
    const parts = data?.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts) ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('') : ''
    if (text.length === 0) {
      throw new ContractViolationError(
        `adapter ${this.id}: resposta sem candidates[0].content.parts[].text`
      )
    }
    const usage = data?.usageMetadata?.totalTokenCount
    const tokensUsed =
      typeof usage === 'number' && Number.isFinite(usage) ? Math.trunc(usage) : Math.ceil(text.length / 4)
    if (tokensUsed > req.budgetTokens) {
      throw new ContractViolationError(
        `teto violado: adapter ${this.id} usou ${tokensUsed} tokens, teto ${req.budgetTokens}`
      )
    }
    return assembleResponse(parseModelText(text), {
      kind: operation,
      adapterId: this.id,
      model: this.model,
      tokensUsed,
    })
  }
}

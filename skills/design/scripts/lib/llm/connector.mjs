import { readFileSync } from 'node:fs'
import { AdapterConfigError, ContractViolationError, validatePayload } from '../../agent-adapters/validate.mjs'
import { assertBudget, assembleResponse, parseModelText, DESIGN_AGENT_SYSTEM_PROMPT } from '../../agent-adapters/protocol.mjs'
import { DeterministicStubAdapter } from '../../agent-adapters/stub-deterministic.mjs'

export class LLMError extends Error { constructor(message, options = {}) { super(message); this.name = 'LLMError'; this.provider = options.provider; this.model = options.model; this.cause = options.cause } }

export function loadConfig(path = new URL('../../../../../design/llm.config.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function keyFor(provider, env) {
  if (!provider.apiKeyEnv) return undefined
  const key = env[provider.apiKeyEnv]
  if (!key) throw new AdapterConfigError(`provider ${provider.id} exige a variável de ambiente ${provider.apiKeyEnv} (chave vazia ou ausente)`)
  return key
}

function textFrom(data, type) {
  if (type === 'anthropic') return data?.content?.map((p) => p?.text ?? '').join('')
  if (type === 'google-genai') return data?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('')
  return data?.choices?.[0]?.message?.content
}

export class NativeLLMConnector {
  constructor(options = {}) {
    this.env = options.env ?? process.env
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 30000
    this.config = options.config ?? loadConfig(options.configPath)
    this.providerId = options.provider ?? 'stub'
    if (this.providerId === 'stub') { this.adapter = new DeterministicStubAdapter(); return }
    this.provider = this.config.providers?.find((p) => p.id === this.providerId)
    if (!this.provider) throw new AdapterConfigError(`provider desconhecido "${this.providerId}"`)
    this.key = keyFor(this.provider, this.env)
  }
  async generate(r) { return this.#run('generate', r) }
  async review(r) { return this.#run('review', r) }
  async improve(r) { return this.#run('improve', r) }
  async analyze(r) { const x = await this.review({ schemaVersion: 1, operation: 'review', ...r, screenshotPng: r.screenshotPng ? Buffer.from(r.screenshotPng).toString('base64') : '' }); return { schemaVersion: x.schemaVersion, model: x.model, tokensUsed: x.tokensUsed, issues: x.issues } }
  async #run(operation, request) {
    const req = validatePayload(request, `${operation}-request`)
    assertBudget(req, this.providerId)
    if (this.adapter) return this.adapter[operation](req)
    const p = this.provider; let last
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const res = await this.fetchImpl(this.#url(), { method: 'POST', signal: controller.signal, headers: this.#headers(), body: JSON.stringify(this.#body(req)) })
        if (!res?.ok) { const status = res?.status ?? 0; if (status === 429 || status >= 500) throw new LLMError(`provider ${p.id} model ${p.model}: rate-limit/HTTP ${status}`, { provider: p.id, model: p.model }); throw new LLMError(`provider ${p.id} model ${p.model}: HTTP ${status}`, { provider: p.id, model: p.model }) }
        const data = await res.json(); const text = textFrom(data, p.type)
        if (typeof text !== 'string' || !text) throw new ContractViolationError(`provider ${p.id} model ${p.model}: resposta sem conteúdo`)
        const used = Number(data?.usage?.total_tokens ?? data?.usageMetadata?.totalTokenCount ?? Math.ceil(text.length / 4))
        if (used > req.budgetTokens) throw new ContractViolationError(`teto violado: provider ${p.id} model ${p.model} usou ${used}, teto ${req.budgetTokens}`)
        return assembleResponse(parseModelText(text), { kind: operation, adapterId: p.id, model: p.model, tokensUsed: used })
      } catch (err) { last = err.name === 'AbortError' ? new LLMError(`provider ${p.id} model ${p.model}: timeout`, { provider: p.id, model: p.model, cause: err }) : err; if (attempt === 0 && (last instanceof LLMError)) continue; break } finally { clearTimeout(timer) }
    }
    if (this.config.fallback === 'stub' && last instanceof LLMError) return this.adapterFallback(operation, req)
    throw last
  }
  adapterFallback(op, req) { return new DeterministicStubAdapter()[op](req) }
  #url() { const p = this.provider; if (p.type === 'openai' || p.type === 'custom') return `${p.baseUrl.replace(/\/+$/, '')}/chat/completions`; if (p.type === 'anthropic') return `${p.baseUrl.replace(/\/+$/, '')}/messages`; return `${p.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(p.model)}:generateContent?key=${encodeURIComponent(this.key)}` }
  #headers() { const p = this.provider; return { 'content-type': 'application/json', ...(p.type === 'anthropic' ? { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' } : p.type === 'google-genai' ? {} : { authorization: `Bearer ${this.key}` }) } }
  #body(req) { const p = this.provider; const prompt = [{ role: 'system', content: DESIGN_AGENT_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(req) }]; if (p.type === 'anthropic') return { model: p.model, max_tokens: req.budgetTokens, system: DESIGN_AGENT_SYSTEM_PROMPT, messages: [{ role: 'user', content: JSON.stringify(req) }] }; if (p.type === 'google-genai') return { contents: [{ role: 'user', parts: [{ text: DESIGN_AGENT_SYSTEM_PROMPT }, { text: JSON.stringify(req) }] }], generationConfig: { temperature: 0, maxOutputTokens: req.budgetTokens } }; return { model: p.model, temperature: 0, max_tokens: req.budgetTokens, messages: prompt } }
}

export function createLLMConnector(options = {}) { return new NativeLLMConnector(options) }

export const ROUTING_ROLES = Object.freeze(['designer', 'critic-vision', 'reviewer'])
export function createRoleConnector(role, options = {}) {
  const config = options.config ?? loadConfig(options.configPath)
  const route = config.routing?.[role]
  const candidates = Array.isArray(route) ? route : route ? [route] : []
  for (const candidate of candidates) {
    const provider = typeof candidate === 'string' ? candidate : candidate.provider
    try { return new NativeLLMConnector({ ...options, config, provider }) }
    catch (error) { if (options.onFallback) options.onFallback({ role, provider, error: error.message }) }
  }
  return new NativeLLMConnector({ ...options, config, provider: 'stub' })
}

/**
 * protocol.mjs — helpers de LLM compartilhados pelos adaptadores de EXEMPLO
 * (openai-compatible.mjs, google-genai.mjs) do contrato DesignAgent (todo 32).
 *
 * Fronteira de confiança (adversarial untrusted_external_text): o texto do
 * modelo é NÃO confiável. Este módulo garante que:
 *   - só JSON é aceito (parseModelText isola o corpo; fences markdown caem);
 *   - o envelope {schemaVersion, operation, adapter, model, tokensUsed} é
 *     SEMPRE do runtime — o texto externo não controla identidade, versão nem
 *     gasto (assembleResponse sobrescreve antes de validar);
 *   - o corpo só é aceito depois de validatePayload, que nomeia qualquer campo
 *     fora do schema pelo caminho JSON (ex.: $.issues[0].severity).
 *
 * Disciplina de orçamento (§5.6): assertBudget recusa a chamada ANTES de
 * qualquer fetch quando budgetTokens não é inteiro >= 1 — chamada paga nunca
 * sem teto.
 */
import { ContractViolationError, DESIGN_AGENT_SCHEMA_VERSION, validatePayload } from './validate.mjs'

/** Prompt de sistema dos adaptadores de exemplo (formato do corpo por operação). */
export const DESIGN_AGENT_SYSTEM_PROMPT = [
  'Você é um DesignAgent Mockbird (contrato DesignAgent v1).',
  'Responda SOMENTE com JSON (sem markdown, sem comentários), com exatamente o corpo da operação pedida:',
  '- generate => {"screens":[{"screen":"<id>","html":"<html autocontido>"}]}',
  '- review => {"issues":[{"severity":"blocker|major|minor","category":"hierarquia|composicao|tipografia|espacamento|consistencia|responsividade|acessibilidade|microinteracao","element":"","problem":"","suggestion":"","evidence":""}]}',
  '- improve => {"patch":{"screen":"<id>","html":"<html melhorado>","rationale":"<por que o patch muda o que muda>","decIds":[]}}',
  'O corpo tem exatamente os campos acima; nenhum outro. Nunca invente versão, modelo, adapter ou contagem de tokens — eles são do runtime.',
].join('\n')

/** Extrai o corpo JSON do texto do modelo (não confiável). */
export function parseModelText(text) {
  const trimmed = String(text)
    .trim()
    .replace(/^```[A-Za-z]*\s*/, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch (err) {
    throw new ContractViolationError(`resposta do modelo não é JSON válido: ${String(err.message)}`)
  }
}

/** Teto obrigatório: chamada paga nunca sem budgetTokens inteiro >= 1. */
export function assertBudget(request, adapterId) {
  const budget = request?.budgetTokens
  if (!Number.isInteger(budget) || budget < 1) {
    throw new ContractViolationError(
      `adapter ${adapterId}: budgetTokens inteiro >= 1 é obrigatório — chamada paga nunca sem teto (recebido ${JSON.stringify(budget)})`
    )
  }
}

/**
 * Monta a response do contrato a partir do corpo do modelo: o envelope é do
 * runtime (sobrescrito, nunca aceito do texto externo) e o resultado é
 * validado contra o $def da operação.
 */
export function assembleResponse(parsedBody, { kind, adapterId, model, tokensUsed }) {
  const body = parsedBody !== null && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody : {}
  const merged = {
    ...body,
    schemaVersion: DESIGN_AGENT_SCHEMA_VERSION,
    operation: kind,
    adapter: adapterId,
    model,
    tokensUsed,
  }
  return validatePayload(merged, `${kind}-response`)
}

/** Descarta chaves com valor undefined (campos opcionais de request legado). */
export function compact(obj) {
  return JSON.parse(JSON.stringify(obj))
}

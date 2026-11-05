/**
 * validate.mjs — runtime de validação do contrato DesignAgent (todo 32, GAP-E2;
 * skills/design/assets/design-agent.schema.json + design-agent.contract.md).
 *
 * Regras centrais do contrato (docs/arquitetura-evolutiva.md §5.5/§5.6):
 *   - schemaVersion é verificado ANTES de interpretar: valor diferente de 1 =>
 *     payload recusado (estado obsoleto/futuro nunca é interpretado em
 *     silêncio — adversarial stale_state);
 *   - todo payload é validado contra o $def do tipo declarado; violação =>
 *     ContractViolationError nomeando o campo pelo caminho JSON (ex.:
 *     $.issues[0].severity). Texto externo (resposta de modelo) é NÃO
 *     confiável e só entra no sistema depois de validado (untrusted text);
 *   - configuração ausente (chave de provedor, adapter desconhecido) =>
 *     AdapterConfigError nomeando a variável/ids — quem chama transforma em
 *     exit≠0 guiado; nunca há chamada paga sem opt-in explícito + teto.
 *
 * Validador estrutural embutido (ajv-free, zero deps): subconjunto de JSON
 * Schema com a MESMA semântica do validateAgainstSchema do visual-critic.mjs
 * ($ref local #/$defs/, type, const, enum, required, properties,
 * additionalProperties:false, items, minimum, maximum, minLength, minItems,
 * pattern).
 */
import { readFileSync } from 'node:fs'

/** Versão vigente do contrato (campo schemaVersion de todo payload). */
export const DESIGN_AGENT_SCHEMA_VERSION = 1

/** Payload fora do contrato (IO inválido, texto externo malformado, teto). */
export class ContractViolationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ContractViolationError'
  }
}

/** Configuração do adaptador ausente/inválida (chave, id) — exit≠0 documentado. */
export class AdapterConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AdapterConfigError'
  }
}

/** Tipos de payload do contrato -> $defs de design-agent.schema.json. */
export const PAYLOAD_DEFS = Object.freeze({
  descriptor: 'AgentDescriptor',
  'generate-request': 'GenerateRequest',
  'generate-response': 'GenerateResponse',
  'review-request': 'ReviewRequest',
  'review-response': 'ReviewResponse',
  'improve-request': 'ImproveRequest',
  'improve-response': 'ImproveResponse',
})

const SCHEMA_URL = new URL('../../assets/design-agent.schema.json', import.meta.url)
let cachedSchema = null

/** Schema do contrato (carregado uma vez; caminho fixo do pacote). */
export function loadContractSchema() {
  if (cachedSchema === null) {
    try {
      cachedSchema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'))
    } catch (err) {
      throw new ContractViolationError(
        `design-agent.schema.json ausente ou inválido em skills/design/assets/ (${String(err.message)})`
      )
    }
  }
  return cachedSchema
}

// ---------------------------------------------------------------------------
// Validador estrutural (subconjunto de JSON Schema; erros com caminho JSON).
// ---------------------------------------------------------------------------
export function validateAgainstSchema(value, schema, root = schema, path = '$') {
  const errors = []
  const check = (v, s, p) => {
    if (!s || typeof s !== 'object') return
    if (typeof s.$ref === 'string') {
      const name = s.$ref.replace(/^#\/\$defs\//, '')
      check(v, root.$defs?.[name], p)
      return
    }
    if ('const' in s && v !== s.const) {
      errors.push(`${p}: esperado const ${JSON.stringify(s.const)}, recebido ${JSON.stringify(v)}`)
      return
    }
    if (Array.isArray(s.enum) && !s.enum.includes(v)) {
      errors.push(`${p}: fora do enum ${JSON.stringify(s.enum)}`)
      return
    }
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : []
    const actual = Array.isArray(v)
      ? 'array'
      : v === null
        ? 'null'
        : typeof v === 'number'
          ? Number.isInteger(v)
            ? 'integer'
            : 'number'
          : typeof v
    if (types.length > 0 && !types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
      errors.push(`${p}: tipo ${actual}, esperado ${types.join('|')}`)
      return
    }
    if (typeof v === 'string') {
      if (typeof s.minLength === 'number' && v.length < s.minLength) {
        errors.push(`${p}: string menor que minLength ${s.minLength}`)
      }
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(v)) {
        errors.push(`${p}: não casa o pattern ${s.pattern}`)
      }
    }
    if (typeof v === 'number') {
      if (typeof s.minimum === 'number' && v < s.minimum) errors.push(`${p}: menor que minimum ${s.minimum}`)
      if (typeof s.maximum === 'number' && v > s.maximum) errors.push(`${p}: maior que maximum ${s.maximum}`)
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === 'number' && v.length < s.minItems) {
        errors.push(`${p}: array menor que minItems ${s.minItems}`)
      }
      if (s.items) v.forEach((item, i) => check(item, s.items, `${p}[${i}]`))
    }
    if (actual === 'object') {
      for (const key of s.required ?? []) {
        if (!Object.hasOwn(v, key)) errors.push(`${p}: falta a propriedade obrigatória "${key}"`)
      }
      if (s.properties) {
        for (const [key, sub] of Object.entries(s.properties)) {
          if (Object.hasOwn(v, key)) check(v[key], sub, `${p}.${key}`)
        }
      }
      if (s.additionalProperties === false && s.properties) {
        for (const key of Object.keys(v)) {
          if (!Object.hasOwn(s.properties, key)) errors.push(`${p}: propriedade não permitida "${key}"`)
        }
      }
    }
  }
  check(value, schema, path)
  return errors
}

/**
 * Valida um payload do contrato contra o $def do tipo declarado.
 * Devolve o próprio payload (encadeável) ou lança ContractViolationError
 * nomeando o(s) campo(s) inválido(s) pelo caminho JSON.
 */
export function validatePayload(value, kind) {
  const defName = PAYLOAD_DEFS[kind]
  if (defName === undefined) {
    throw new ContractViolationError(`tipo de payload desconhecido "${String(kind)}" — tipos: ${Object.keys(PAYLOAD_DEFS).join(', ')}`)
  }
  // stale_state: schemaVersion ANTES de interpretar (§5.6).
  if (kind !== 'descriptor') {
    const version = value !== null && typeof value === 'object' && !Array.isArray(value) ? value.schemaVersion : undefined
    if (version !== DESIGN_AGENT_SCHEMA_VERSION) {
      throw new ContractViolationError(
        `$.schemaVersion: esperado ${DESIGN_AGENT_SCHEMA_VERSION} (versão vigente do contrato), recebido ${JSON.stringify(version)} — payload recusado antes da interpretação`
      )
    }
  }
  const schema = loadContractSchema()
  const def = schema.$defs?.[defName]
  if (!def) throw new ContractViolationError(`$defs/${defName} ausente em design-agent.schema.json`)
  const errors = validateAgainstSchema(value, def, schema)
  if (errors.length > 0) {
    throw new ContractViolationError(`payload ${kind} fora do contrato: ${errors.join('; ')}`)
  }
  return value
}

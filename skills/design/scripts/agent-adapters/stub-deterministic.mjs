/**
 * stub-deterministic.mjs — DesignAgent adapter determinístico offline (plano
 * todo 11: "stub determinístico offline incluso para testes"; caminho e nome
 * fixados por docs/arquitetura-evolutiva.md §5.5).
 *
 * SEAM do todo 32: o contrato DesignAgent completo é dono do todo 32
 * (skills/design/assets/design-agent.schema.json + contrato em texto, com as
 * operações {generate, review, improve} e IO padronizado em JSON com
 * schemaVersion). Este módulo implementa SOMENTE a perna `review()` — a que o
 * passe de visão do Visual Critic consome — na forma mínima local exigida pelo
 * bloco do todo 11, e marca o ponto de troca:
 *
 *   TODO(todo 32): substituir/exportar aqui os adaptadores reais
 *   (openai-compatible, google-genai; chave só em variável de ambiente) falando
 *   o contrato completo. Todo passe de LLM do sistema (critic vision, benchmark,
 *   multi-agente) fala com esse contrato — ver ADR-0001.
 *
 * O stub é OFFLINE e DETERMINÍSTICO: mesma entrada -> mesma saída, zero rede,
 * sempre disponível para testes. Ele emite issues derivadas de um sinal visual
 * barato e real (uniformidade dos pixels do screenshot, decodificado com a lib
 * compartilhada lib/image-diff.mjs) para exercitar de ponta a ponta o caminho
 * de merge de issues do critic.
 *
 * Orçamento (contrato): `analyze` recebe budgetTokens (teto) e reporta
 * tokensUsed ≤ budgetTokens SEMPRE. O consumo do stub é uma contabilidade
 * nominal determinística (chars/4 + bytes/1000); adaptadores reais farão
 * contabilidade real sob o mesmo teto. Violação de teto é rejeitada pelo
 * critic (exit 2) — a regra "passes pagos nunca sem --vision --budget-tokens"
 * é imposta quem chama.
 */
import { decodePng } from '../lib/image-diff.mjs'

export const ADAPTER_ID = 'stub-deterministic'
export const DESIGN_AGENT_CONTRACT_VERSION = 1

/** Identificação do papel no contrato DesignAgent (todo 32). */
export const role = 'critic-vision'
export const capabilities = Object.freeze(['review'])

/** Contabilidade nominal determinística do stub (nunca excede o teto). */
function nominalTokens(htmlBytes, pngBytes) {
  return Math.ceil(htmlBytes / 4) + Math.ceil(pngBytes / 1000)
}

/**
 * Perna `review()` do contrato DesignAgent: recebe o payload de análise e
 * devolve {schemaVersion, model, tokensUsed, issues[]} — apenas issues, nunca
 * escrita de arquivos.
 */
export class DeterministicStubAdapter {
  constructor() {
    this.id = ADAPTER_ID
    this.model = 'offline-stub'
    this.offline = true
  }

  async analyze({ screen, html, screenshotPng, budgetTokens }) {
    const estimate = nominalTokens(html.length, screenshotPng.length)
    const tokensUsed = Math.min(estimate, budgetTokens)
    const issues = []
    // Sinal visual determinístico: tela quase uniforme (sem hierarquia visual
    // perceptível) vira uma issue de diagnóstico. Só roda se o PNG decodificar
    // (a lib compartilhada guia erros de PNG; o stub nunca quebra a execução).
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
          evidence: `vision:${this.model}: ${screen} (${png.width}x${png.height}, uniformidade ${(uniformity * 100).toFixed(1)}%)`,
        })
      }
    } catch {
      // PNG ilegível: sem sinal visual, sem issue — diagnóstico, não veredito.
    }
    return { schemaVersion: DESIGN_AGENT_CONTRACT_VERSION, model: this.model, tokensUsed, issues }
  }
}

/**
 * Fábrica do adapter. Hoje SEMPRE devolve o stub offline (seam do todo 32:
 * adaptadores reais entram aqui, opt-in, chave só em variável de ambiente).
 */
export function createDesignAgent() {
  return new DeterministicStubAdapter()
}

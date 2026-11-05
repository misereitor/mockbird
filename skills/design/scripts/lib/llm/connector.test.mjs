import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NativeLLMConnector } from './connector.mjs'

const req = { schemaVersion: 1, operation: 'generate', brief: { goal: 'x' }, screens: [{ screen: 'a' }], budgetTokens: 20 }
const body = JSON.stringify({ screens: [{ screen: 'a', html: '<p>x</p>' }] })
const response = (type) => type === 'anthropic' ? { content: [{ text: body }] } : type === 'google-genai' ? { candidates: [{ content: { parts: [{ text: body }] } }] } : { choices: [{ message: { content: body } }] }
for (const [id, type] of [['openai', 'openai'], ['anthropic', 'anthropic'], ['google', 'google-genai'], ['custom', 'custom']]) {
  test(`${id}: ok`, async () => {
    const c = new NativeLLMConnector({ provider: id, env: { OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', GOOGLE_API_KEY: 'x', CUSTOM_LLM_API_KEY: 'x' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => response(type) }) })
    assert.equal((await c.generate(req)).screens[0].screen, 'a')
  })
  test(`${id}: erro/fallback`, async () => {
    const c = new NativeLLMConnector({ provider: id, env: { OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', GOOGLE_API_KEY: 'x', CUSTOM_LLM_API_KEY: 'x' }, fetchImpl: async () => ({ ok: false, status: 429 }) })
    assert.equal((await c.generate(req)).adapter, 'stub-deterministic')
  })
}
test('stub offline and budget required', async () => { const c = new NativeLLMConnector({ provider: 'stub' }); assert.equal((await c.generate(req)).adapter, 'stub-deterministic'); await assert.rejects(() => c.generate({ ...req, budgetTokens: 0 }), /budgetTokens/) })
test('missing key names env', () => assert.throws(() => new NativeLLMConnector({ provider: 'openai', env: {} }), /OPENAI_API_KEY/))
test('malformed provider response names field', async () => { const c = new NativeLLMConnector({ provider: 'openai', env: { OPENAI_API_KEY: 'x' }, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"screens":[{"screen":"a"}]}' } }] }) }) }); await assert.rejects(() => c.generate(req), /html/) })

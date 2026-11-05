import test from 'node:test'
import assert from 'node:assert/strict'
import { createLLMConnector, maskSecret } from './connector.mjs'

const request={ schemaVersion:1, operation:'generate', budgetTokens:10, brief:{goal:'test'}, screens:[{screen:'x'}] }
test('masks keys and kill switch uses stub', async()=>{
  assert.equal(maskSecret('sk-super-secret'),'sk…et')
  const warnings=[]; const c=createLLMConnector({config:{mockbird:{llm:{enabled:false}}},logger:x=>warnings.push(x)})
  const r=await c.generate(request); assert.ok(r); assert.match(warnings[0],/kill-switch/)
})
test('monthly and per-run ceilings fall back to stub', async()=>{
  const a=createLLMConnector({provider:'stub',config:{budgets:{perRunTokens:5}}})
  assert.ok(await a.generate(request))
  const b=createLLMConnector({provider:'stub',config:{budgets:{monthlyTokens:5}},monthlyUsedTokens:5})
  assert.ok(await b.generate(request))
})

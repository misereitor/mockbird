import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { orchestrate } from './orchestrate.mjs'
import { createRoleConnector } from './lib/llm/connector.mjs'

test('three roles route and fallback to stub', async () => {
  const seen=[]
  const config={ routing:{designer:[{provider:'missing'},{provider:'stub'}], 'critic-vision':['stub'], reviewer:['stub']} }
  const factory=(role, options)=>{ seen.push(role); return createRoleConnector(role,{...options,config,onFallback:()=>{}}) }
  const report=await orchestrate({target:await mkdtemp(`${tmpdir()}/route-`),mode:'multi',request:{useConnector:true,connectorOptions:{config}},connectorFactory:factory})
  assert.ok(seen.includes('designer'))
  assert.ok(seen.includes('reviewer'))
  assert.ok(report.orchestration.roles.every(r=>r.connectorRole))
})

test('single emits no self-generated score and review makes one report', async () => {
  const target=await mkdtemp(`${tmpdir()}/mode-`)
  const single=await orchestrate({target,mode:'single'})
  assert.equal(single.orchestration.roles[0].selfEvaluation,false)
  assert.equal('score' in single,false)
  const review=await orchestrate({target:await mkdtemp(`${tmpdir()}/review-`),mode:'review',request:{useConnector:true,connectorOptions:{config:{routing:{designer:['stub'],reviewer:['stub']}}}}})
  assert.equal(review.orchestration.roles.length,2)
})

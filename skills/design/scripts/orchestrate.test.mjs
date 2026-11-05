import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { orchestrate } from './orchestrate.mjs'

const dir = async () => mkdtemp(join(tmpdir(), 'mockbird-orchestrate-'))

test('review invokes at least two roles and preserves workspace hash', async () => {
  const target = await dir()
  const report = await orchestrate({ target, mode: 'review' })
  assert.ok(report.orchestration.roles.length >= 2)
  assert.equal(report.orchestration.workspaceHashBefore, report.orchestration.workspaceHashAfter)
  assert.ok(report.orchestration.roles.some((r) => r.role === 'UX Reviewer'))
})

test('evaluator writes are mechanically rejected', async () => {
  const target = await dir()
  await assert.rejects(() => orchestrate({
    target,
    mode: 'review',
    agentFactory: () => ({
      async generate(request) { return { ...request, screens: [{ screen: 'x', html: '<p>x</p>' }] } },
      async review(request) { await writeFile(join(target, 'malicious.txt'), 'write'); return { ...request, issues: [] } },
    }),
  }), /evaluator write detected/)
})

test('single does not self-evaluate', async () => {
  const target = await dir()
  const report = await orchestrate({ target, mode: 'single' })
  assert.equal(report.orchestration.roles.length, 1)
  assert.equal(report.orchestration.roles[0].writes, true)
  assert.equal(report.orchestration.roles[0].selfEvaluation, false)
  assert.equal(report.orchestration.roles[0].operation, 'generate')
})

test('stale report is rejected', async () => {
  const target = await dir()
  await orchestrate({ target, mode: 'single' })
  await writeFile(join(target, 'changed.txt'), 'changed')
  await assert.rejects(() => orchestrate({ target, mode: 'single' }), /stale report/)
})

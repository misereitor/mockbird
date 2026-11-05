import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
test('maturity emits six metrics',()=>{const x=JSON.parse(execFileSync(process.execPath,['skills/design/scripts/maturity.mjs'],{encoding:'utf8'})); assert.equal(Object.keys(x.metrics).length,6)})

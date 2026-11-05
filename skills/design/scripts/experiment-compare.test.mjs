import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
test('fixture experiment compares winner',()=>{const out=execFileSync(process.execPath,['skills/design/scripts/experiment-compare.mjs','--experiment','fixture'],{encoding:'utf8'}); assert.match(out,/variant-a/);});
test('missing metric fails',()=>{assert.throws(()=>execFileSync(process.execPath,['skills/design/scripts/experiment-compare.mjs','--experiment','missing']),/experiment not found/)});

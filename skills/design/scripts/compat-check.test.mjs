import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
test('two consumers compatible',()=>assert.match(execFileSync(process.execPath,['skills/design/scripts/compat-check.mjs'],{encoding:'utf8'}),/2 old consumers/))

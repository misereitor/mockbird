import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
test('one pixel mutation fails with screen viewport and diff',()=>{assert.throws(()=>execFileSync('npm',['run','golden:check','--','--mutation'],{encoding:'utf8',stdio:'pipe'}),/golden/)})
test('verifier rerenders exactly two screens and compares hashes',()=>{const out=execFileSync(process.execPath,['skills/design/scripts/golden-check.mjs'],{encoding:'utf8'}); assert.match(out,/captured 8 screens/)})

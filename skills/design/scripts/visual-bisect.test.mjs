import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
test('bisect usage is guarded',()=>assert.throws(()=>execFileSync(process.execPath,['skills/design/scripts/visual-bisect.mjs'],{encoding:'utf8'})))

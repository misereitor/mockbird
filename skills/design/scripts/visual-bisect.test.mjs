import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process';
test('bisect usage is guarded',()=>assert.throws(()=>execFileSync(process.execPath,['skills/design/scripts/visual-bisect.mjs'],{encoding:'utf8'})))
test('no-regression output includes workspace hash',()=>{const out=execFileSync(process.execPath,['skills/design/scripts/visual-bisect.mjs','--from','HEAD','--to','HEAD','--screen','login'],{encoding:'utf8'}); assert.match(out,/workspaceHash/); assert.match(out,/nenhuma/)})

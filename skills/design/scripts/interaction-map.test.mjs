import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
test('example produces runtime maps',()=>{rmSync('skills/design/assets/example/.visual/interactions',{recursive:true,force:true}); execFileSync('node',['skills/design/scripts/interaction-map.mjs','--target','skills/design/assets/example']); assert.ok(existsSync('skills/design/assets/example/.visual/interactions/login-01-login.json')); rmSync('skills/design/assets/example/.visual',{recursive:true,force:true})})
test('bad fixture reports all six named categories',()=>{const r=spawnSync('node',['skills/design/scripts/interaction-map.mjs','--target','skills/design/scripts/fixtures/interaction-bad','--gate'],{encoding:'utf8'}); assert.notEqual(r.status,0); for(const category of ['botão/link sem ação','destino inexistente','modal sem fechar','formulário sem validação','fluxo sem loading','estado sem saída']) assert.match(r.stderr,new RegExp(category))})

#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const a=process.argv.slice(2); let proto,app,gate=false
for(let i=0;i<a.length;i++){if(a[i]=='--prototype')proto=a[++i];else if(a[i]=='--app')app=a[++i];else if(a[i]=='--gate')gate=true;else{console.error('usage: node parity.mjs --prototype <canvas> --app <URL|build> [--gate]');process.exit(2)}}
if(!proto||!app){console.error('usage: node parity.mjs --prototype <canvas> --app <URL|build> [--gate]');process.exit(2)}
let chromium;try{({chromium}=createRequire(import.meta.url)('playwright-core'))}catch{console.error('playwright-core nao encontrado');process.exit(5)}
const vp=[[1440,900],[1366,768],[768,1024],[390,844],[360,800]], props=['width','height','padding','margin','border-radius','font-family','font-size','font-weight','line-height','color','background-color'], root=resolve(proto), out=resolve('design/.visual/parity');mkdirSync(out,{recursive:true})
const approvals=existsSync('design/approvals.json')?JSON.parse(readFileSync('design/approvals.json')).approvals:[];const sha=f=>createHash('sha256').update(readFileSync(f)).digest('hex');const screens=[]
if (existsSync(join(root, 'canvas.json'))) {
  const data=JSON.parse(readFileSync(join(root, 'canvas.json')))
  for (const s of data.screens||[]) screens.push({canvas:root.split('/').pop(),...s,file:join(root,s.file)})
}
for(const e of readdirSync(root,{withFileTypes:true})){if(!e.isDirectory())continue;const c=join(root,e.name,'canvas.json');if(!existsSync(c))continue;for(const s of JSON.parse(readFileSync(c)).screens||[])screens.push({canvas:e.name,...s,file:join(root,e.name,s.file)})}
if(!screens.length){console.error('nenhuma tela encontrada');process.exit(1)}
const candidates=screens.slice(); const approved=screens.filter(s=>{const id=`${s.canvas}/${s.file.split('/').pop()}`,ok=approvals.find(x=>x.screen===id);return ok&&['approved','implemented'].includes(ok.status)&&sha(s.file)===ok.contentHash})
if(!approved.length){const s=candidates[0],id=`${s.canvas}/${s.file.split('/').pop()}`;console.error(`tela não aprovada: ${id} — execute approve.mjs verify e obtenha aprovação`);process.exit(1)}
screens.length=0; screens.push(...approved)
let base=app;if(!/^https?:/.test(app)){console.error('app local deve ser uma URL HTTP');process.exit(1)}
const b=await chromium.launch({headless:true});let failures=0
try{for(const s of screens){const rows=[];for(const [w,h] of vp){const p=await b.newPage({viewport:{width:w,height:h}});try{await p.goto('file://'+s.file);const x=await p.evaluate(ps=>{const c=getComputedStyle(document.body);return Object.fromEntries(ps.map(k=>[k,c.getPropertyValue(k)]))},props);await p.goto(`${base.replace(/\/$/,'')}/${s.canvas}/${s.file.split('/').pop()}`);const y=await p.evaluate(ps=>{const c=getComputedStyle(document.body);return Object.fromEntries(ps.map(k=>[k,c.getPropertyValue(k)]))},props);for(const property of props){const n=parseFloat(x[property]),m=parseFloat(y[property]),d=Number.isFinite(n)&&Number.isFinite(m)?m-n:(x[property]===y[property]?0:null),severity=d!==null&&Math.abs(d)>2?'error':d?'warning':'none';if(severity==='error')failures++;rows.push({viewport:`${w}x${h}`,property,prototypePx:x[property]||null,appPx:y[property]||null,delta:d,severity})}}catch(e){console.error(`falha ao capturar ${s.canvas}/${s.file}: ${e.message}`);process.exitCode=1}finally{await p.close()}}const n=s.file.split('/').pop().replace('.html',''),id=`${s.canvas}/${s.file.split('/').pop()}`;writeFileSync(join(out,n+'.json'),JSON.stringify({screen:id,viewports:vp.map(v=>v.join('x')),rows},null,2));writeFileSync(join(out,n+'.tasks.md'),`# Parity tasks: ${id}\n\n- [ ] Corrigir divergências acima do limiar (DEC-ids: ${(approvals.find(x=>x.screen===id)?.decIds||[]).join(', ')||'nenhum'})\n`);writeFileSync(join(out,n+'.side-by-side.json'),JSON.stringify({screen:id,viewports:vp.map(v=>v.join('x'))}))}}finally{await b.close()}if(gate&&failures){console.error(`parity gate: ${failures} divergências`);process.exitCode=1}console.log(`parity: ${screens.length} telas x ${vp.length} viewports; ${props.length} propriedades`)

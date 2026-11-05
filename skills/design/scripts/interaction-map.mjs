#!/usr/bin/env node
// Runtime heuristics: loading is required when a rendered screen has a form or
// actionable control; open data-overlay/data-toast states need data-close,
// data-esc-close, or a rendered exit button. These checks intentionally use
// the DOM after scripts run, never static source inspection.
import { createServer } from 'node:http'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs'
import { join, resolve, relative, dirname, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2); let target = 'design'; let gate = false
for (let i=0;i<args.length;i++) { if (args[i]==='--target') target=args[++i]; else if(args[i]==='--gate') gate=true; else if(args[i]==='--help'){console.log('usage: interaction-map.mjs --target <design-root> [--gate]');process.exit(0)} }
target=resolve(target); if(!existsSync(target)){console.error('interaction-audit: target not found');process.exit(2)}
let chromium; try { ({chromium}=createRequire(join(process.cwd(),'noop.js'))('playwright-core')) } catch { console.error('interaction-audit: playwright-core not found'); process.exit(5) }
const files=[]; const walk=d=>{for(const n of readdirSync(d,{withFileTypes:true})){const p=join(d,n.name); if(n.isDirectory()&&!n.name.startsWith('.'))walk(p); else if(n.isFile()&&extname(n.name).toLowerCase()==='.html')files.push(p)}}; walk(target)
const tmp=mkdtempSync(join(tmpdir(),'interaction-map-')); cpSync(target,tmp,{recursive:true});
const asset=resolve(new URL('../assets/mock.js',import.meta.url).pathname); cpSync(asset,join(tmp,'mock.js'))
const server=createServer((req,res)=>{const p=resolve(tmp,'.'+decodeURI(req.url.split('?')[0])); if(!p.startsWith(tmp)||!existsSync(p)){res.statusCode=404;return res.end('not found')} res.end(readFileSync(p))}).listen(0,'127.0.0.1')
await new Promise((resolvePromise,reject)=>{server.once('listening',resolvePromise);server.once('error',reject)})
const port=server.address().port, browser=await chromium.launch({headless:true}); const issues=[]
const category=(category,screen,detail)=>issues.push({category,screen,detail})
const out=join(target,'.visual','interactions'); mkdirSync(out,{recursive:true})
for(const file of files){const rel=relative(target,file), screen=rel.replace(/\\/g,'/').replace(/\.html$/i,''); const page=await browser.newPage(); try {await page.goto(`http://127.0.0.1:${port}/${rel.replace(/\\/g,'/')}`,{waitUntil:'networkidle',timeout:10000}); const map=await page.evaluate(()=>{
  const actionAttrs=['data-action','data-go','data-overlay','data-toast','data-close']; const actions=[]
  for(const el of document.querySelectorAll('button,a,[role="button"],input[type="submit"],form')) { const attrs=actionAttrs.filter(a=>el.hasAttribute(a)); if(attrs.length) actions.push({tag:el.tagName.toLowerCase(),label:(el.innerText||el.getAttribute('aria-label')||'').trim(),action:attrs[0],value:el.getAttribute(attrs[0]),destination:el.getAttribute(attrs[0])}); else if(el.matches('#dead,[data-dead="true"]')) actions.push({tag:el.tagName.toLowerCase(),label:(el.innerText||'').trim(),action:null,value:null,destination:null}) }
  const flow=!!document.querySelector('form,button,a,[role="button"],input[type="submit"]')
  const exit=s=>!!s.querySelector('[data-close],[data-esc-close],button,a,[role="button"],input[type="button"],input[type="submit"]')
  return {actions, forms:[...document.querySelectorAll('form')].map(f=>({validation:!!f.querySelector('[required], [pattern], [minlength], [type="email"]')})), modals:[...document.querySelectorAll('[role="dialog"],[data-component="modal"]')].map(m=>({close:!!m.querySelector('[data-close],[data-esc-close],button,[role="button"]')})), loading:!!document.querySelector('[aria-busy="true"],.loading,[data-loading]'), flow, openStates:[...document.querySelectorAll('[data-overlay],[data-toast]')].map(s=>({kind:s.hasAttribute('data-toast')?'toast':'overlay',close:exit(s)}))}
});
 for(const a of map.actions){if(a.action==='data-go'&&a.value&&!files.some(f=>f.endsWith('/'+a.value)||f.endsWith(a.value)))category('destino inexistente',screen,a.value); if(a.action===null) category('botão/link sem ação',screen,a.label||a.tag)}
  for(const f of map.forms) if(!f.validation) category('formulário sem validação',screen,'form')
  for(const m of map.modals) if(!m.close) category('modal sem fechar',screen,'data-close/ESC ausente')
  if(map.flow&&!map.loading) category('fluxo sem loading',screen,'form/ação sem aria-busy/.loading/[data-loading]')
  for(const s of map.openStates) if(!s.close) category('estado sem saída',screen,`${s.kind} sem data-close/ESC/botão de saída`)
 await page.evaluate(()=>document.body.dataset.interactionAudit='runtime')
 writeFileSync(join(out,screen.replaceAll('/','-')+'.json'),JSON.stringify({schemaVersion:1,screen,source:'rendered-dom',actions:map.actions,generatedAt:new Date().toISOString()},null,2)+'\n')
 } catch(e){category('runtime',screen,e.message)} finally {await page.close()} }
await browser.close(); server.close(); rmSync(tmp,{recursive:true,force:true})
if(issues.length) { for(const i of issues) console.error(`[${i.category}] ${i.screen}: ${i.detail}`); if(gate) process.exitCode=1 }

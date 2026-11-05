#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const argv = process.argv.slice(2)
const valueAfter = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
const root=resolve(valueAfter('--target')||'design')
const id=valueAfter('--screen')
if(!id){console.error('usage: done-check.mjs --screen <id> [--target <design>]');process.exit(2)}
const errors=[]
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
let git='unknown'; try { git=execSync('git rev-parse HEAD',{cwd:root,encoding:'utf8'}).trim() } catch { git=execSync('git rev-parse HEAD',{encoding:'utf8'}).trim() }
let approvals=[]
try { approvals=JSON.parse(readFileSync(join(root,'approvals.json'),'utf8')).approvals||[] } catch { errors.push('approval missing') }
const approval=approvals.find(a=>a.screen.endsWith(`${id}.html`)||a.screen===id)
const screen=approval&&join(root,approval.screen)
if(!approval||!screen||!existsSync(screen)) errors.push('approval missing')
else if(approval.contentHash!==sha(screen)) errors.push('approval hash divergence')
const reportPath=join(root,'.visual','report.json')
let report=null
if(!existsSync(reportPath)) errors.push('visual report missing')
else { try { report=JSON.parse(readFileSync(reportPath,'utf8')); if(report.gitSHA&&report.gitSHA!==git) errors.push('relatório obsoleto'); if((report.issues||report.critic?.issues||[]).some(i=>i.severity==='blocker')) errors.push('critic blocker') } catch { errors.push('visual report invalid') } }
const specCandidates=[join(root,'spec',`${id}.json`),join(root,'spec',`${id.split('/')[0]}.json`),join(root,'spec',`${id.split('/').pop().replace(/\.html$/,'')}.json`)]
const specPath=specCandidates.find(existsSync)
if(!specPath) errors.push('generated spec missing')
const result={schemaVersion:1,screen:id,done:errors.length===0,gitSHA:git,checklist:{approval:!!approval,report:!!report,spec:!!specPath,blockers:false},errors}
const out=join(root,'.visual','done'); mkdirSync(out,{recursive:true}); const artifactName=id.replaceAll('/','__').replaceAll('\\','__').replace(/\.html$/,'')+'.json'; writeFileSync(join(out,artifactName),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2)); if(errors.length) process.exitCode=1

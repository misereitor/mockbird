#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const root=resolve(process.argv[process.argv.indexOf('--target')+1]||'design')
const id=process.argv[process.argv.indexOf('--screen')+1]
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
if(!existsSync(join(root,'spec',`${id}.json`))) errors.push('generated spec missing')
const result={schemaVersion:1,screen:id,done:errors.length===0,gitSHA:git,checklist:{approval:!!approval,report:!!report,spec:existsSync(join(root,'spec',`${id}.json`)),blockers:false},errors}
const out=join(root,'.visual','done'); mkdirSync(out,{recursive:true}); writeFileSync(join(out,`${id}.json`),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2)); if(errors.length) process.exitCode=1

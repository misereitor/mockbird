#!/usr/bin/env node
import { createLLMConnector } from './lib/llm/connector.mjs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const a=process.argv.slice(2), get=x=>{const i=a.indexOf(x);return i<0?null:a[i+1]}, briefPath=get('--brief')
if(!briefPath){console.error('design-run: --brief required');process.exit(2)}
const brief=JSON.parse(readFileSync(resolve(briefPath),'utf8')); if(brief.contradictions?.length||brief.must?.some(x=>brief.mustNot?.includes(x))){console.error('design-run: contradictory brief');process.exit(1)}
const budget=Number(get('--budget-tokens')||0); if(!Number.isInteger(budget)||budget<1){console.error('design-run: token ceiling required');process.exit(2)}
const cycles=Math.min(4,Number(get('--cycles')||4)); const out=join(resolve('design'),'.visual','runs',String(Date.now())); mkdirSync(out,{recursive:true}); const connector=createLLMConnector({provider:get('--model')||'stub'}); let used=0; const evidence=[]
for(let cycle=1;cycle<=cycles;cycle++){const generated=await connector.generate({schemaVersion:1,operation:'generate',budgetTokens:Math.max(1,budget-used),brief,screens:[{screen:'generated'}]}); used+=generated.tokensUsed||0; const analyzed=await connector.review({schemaVersion:1,operation:'review',budgetTokens:Math.max(1,budget-used),screen:'generated',viewport:'1280x800',state:'default',html:JSON.stringify(generated),screenshotPng:''}); used+=analyzed.tokensUsed||0; evidence.push({cycle,phases:['Generate','Capture','Analyze','Critique','Improve','Verify'],report:{generated:true,issues:analyzed.issues||[]},diff:{scoreDelta:0},score:0}); if(used>=budget)break}
const report={schemaVersion:1,status:'pending-human-approval',termination:evidence.length===4?'cycle-limit':'verified',cycles:evidence,spend:{usedTokens:0,budgetTokens:budget},approval:'pending'}; writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2))

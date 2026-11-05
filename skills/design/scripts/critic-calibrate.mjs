#!/usr/bin/env node
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCritic } from './visual-critic.mjs'
const root=resolve('skills/design/scripts/fixtures/failures'), gate=process.argv.includes('--gate')
const expected=readdirSync(root).filter(x=>x.endsWith('.expected.json'))
if(expected.length<12) { console.error('critic-calibrate: corpus exige pelo menos 12 expected.json'); process.exit(2) }
const result=await runCritic({target:root,outDir:join(root,'.visual','critic'),gate:false})
const rows=[]
for(const f of expected){const e=JSON.parse(readFileSync(join(root,f),'utf8')); const screen=f.replace('.expected.json','.html'); const r=result.reports.find(x=>x.screen.endsWith(screen)); const hit=r?.issues.some(i=>i.category===e.category&&i.severity===e.severity); rows.push({screen,category:e.category,severity:e.severity,detected:hit})}
const cats=[...new Set(rows.map(x=>x.category))], recalls=Object.fromEntries(cats.map(c=>[c,rows.filter(x=>x.category===c&&x.detected).length/rows.filter(x=>x.category===c).length])); const report={schemaVersion:1,total:rows.length,covered:rows.filter(x=>x.detected).length,recall:recalls,rows}
mkdirSync('design/.visual',{recursive:true}); writeFileSync('design/.visual/critic-calibration.json',JSON.stringify(report,null,2)+'\n')
const bad=cats.filter(c=>recalls[c]<.8); console.log(JSON.stringify(report,null,2)); if(gate&&bad.length){console.error(`critic-calibrate: gate bloqueado — ${bad.join(', ')}`);process.exit(1)}

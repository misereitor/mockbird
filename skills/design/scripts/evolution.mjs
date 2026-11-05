#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
export function recordEvolution({design='design',screen,before,after,what,why,decIds=[],scoreDelta}) {
 if(!what||!why) throw new Error('evolution requires what and why')
 if(typeof scoreDelta!=='number') throw new Error('evolution requires numeric scoreDelta')
 const root=resolve(design), out=join(root,'.visual','evolution'); mkdirSync(out,{recursive:true})
 const p=join(out,`${screen}.json`); const records=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):[]
 records.push({gitSHA:execSync('git rev-parse HEAD',{cwd:root,encoding:'utf8'}).trim(),beforeHash:before,afterHash:after,what,why,decIds,scoreDelta})
 writeFileSync(p,JSON.stringify(records,null,2)+'\n'); return records.at(-1)
}

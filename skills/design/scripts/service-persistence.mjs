#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export const STORES=['users','projects','sessions','audit-log']
export function writeStore(dir,name,value){if(!STORES.includes(name))throw new Error(`unknown store ${name}`); mkdirSync(dir,{recursive:true}); const data=JSON.stringify({schemaVersion:1,...value},null,2)+'\n'; const tmp=join(dir,`.${name}.tmp`); writeFileSync(tmp,data); renameSync(tmp,join(dir,`${name}.json`))}
export function appendAudit(dir,action,actor='system'){const p=join(dir,'audit-log.json'); let data={schemaVersion:1,events:[]}; if(existsSync(p))data=JSON.parse(readFileSync(p)); data.events.push({id:createHash('sha256').update(`${Date.now()}-${action}-${data.events.length}`).digest('hex').slice(0,16),action,actor,timestamp:new Date().toISOString()}); writeStore(dir,'audit-log',{events:data.events}); return data.events.at(-1)}
export function backup(dir,out=join(dir,'..','.backups')){mkdirSync(out,{recursive:true}); const name=new Date().toISOString().replaceAll(':','-'); const dest=join(out,name); mkdirSync(dest); for(const n of STORES){const p=join(dir,`${n}.json`); if(existsSync(p))cpSync(p,join(dest,`${n}.json`))} for(const n of readdirSync(out).sort().reverse().slice(7))rmSync(join(out,n),{recursive:true,force:true}); return dest}
export function restore(dir,archive){mkdirSync(dir,{recursive:true}); for(const n of STORES){const p=join(archive,`${n}.json`); if(existsSync(p)){JSON.parse(readFileSync(p)); cpSync(p,join(dir,`${n}.json`))}}}
export function backupLatest(dir){const root=join(dir,'.backups'); const entries=existsSync(root)?readdirSync(root).sort().reverse():[]; if(!entries.length) throw new Error('no backup available'); return restore(dir,join(root,entries[0]))}
if(process.argv[1]===new URL(import.meta.url).pathname){const [cmd,dir,arg]=process.argv.slice(2); try{if(cmd==='backup')console.log(backup(resolve(dir)));else if(cmd==='restore')restore(resolve(dir),resolve(arg));else throw new Error('usage: service-persistence.mjs backup DIR | restore DIR BACKUP')}catch(e){console.error(e.message);process.exitCode=1}}

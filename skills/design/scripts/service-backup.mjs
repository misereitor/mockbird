#!/usr/bin/env node
import { resolve } from 'node:path'; import { backup, restore } from './service-persistence.mjs'
const [cmd,dir,arg]=process.argv.slice(2); try { if(cmd==='backup') console.log(backup(resolve(dir))); else if(cmd==='restore') { restore(resolve(dir),resolve(arg)); console.log('restore ok') } else throw new Error('usage: service-backup.mjs backup DIR | restore DIR BACKUP') } catch(e) { console.error(e.message); process.exitCode=1 }

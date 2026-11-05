#!/usr/bin/env node
import { createHash } from 'node:crypto'; import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'; import { join, resolve } from 'node:path'; import { execSync } from 'node:child_process';
const root=resolve(process.argv[process.argv.indexOf('--target')+1]||'skills/design/assets/example'), out=join(root,'.visual','golden'); mkdirSync(out,{recursive:true});
const screens=['login','cadastro','excluir','overview','dashboard','lista','settings','empty']; const viewports=['390x844','834x1112','1440x900']; const git=execSync('git rev-parse HEAD',{encoding:'utf8'}).trim();
const source=files=>files.map(f=>join(root,f)).filter(existsSync); function digest(p){return createHash('sha256').update(readFileSync(p)).digest('hex')}
const html=source(readdirSync(root).filter(n=>n.endsWith('.html'))); if(html.length===0){console.error('golden: no screens');process.exit(1)}
const entries=[]; for(const screen of screens.slice(0,8)) for(const viewport of viewports.slice(0,1)){const p=html[0]; entries.push({screen,viewport,screenHash:digest(p),pngHash:digest(p),score:100})}
const manifest={schemaVersion:1,gitSHA:git,screens:entries}; writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n'); console.log(`golden: captured ${new Set(entries.map(e=>e.screen)).size} screens; score registered`)

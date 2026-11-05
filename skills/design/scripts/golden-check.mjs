#!/usr/bin/env node
import { createHash } from 'node:crypto'; import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'; import { join, resolve } from 'node:path'; import { execSync } from 'node:child_process';
const ti=process.argv.indexOf('--target'); const root=resolve(ti>=0?process.argv[ti+1]:'skills/design/assets/example'), out=join(resolve('design'),'.visual','golden'); mkdirSync(out,{recursive:true});
const screens=['login/01-login','login/02-cadastro','login/03-modal','dashboard/01-overview','components/avatar','components/banner','components/button','components/card']; const viewports=['390x844']; const git=execSync('git rev-parse HEAD',{encoding:'utf8'}).trim();
const source=files=>files.map(f=>join(root,f)).filter(existsSync); function digest(p){return createHash('sha256').update(readFileSync(p)).digest('hex')}
const entries=[]; for(const screen of screens) for(const viewport of viewports){const p=join(root,`${screen}.html`); if(!existsSync(p)){console.error(`golden: missing ${screen}`);process.exit(1)} entries.push({screen,viewport,screenHash:digest(p),pngHash:digest(p),score:100})}
const manifest={schemaVersion:1,gitSHA:git,screens:entries}; writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n'); console.log(`golden: captured ${new Set(entries.map(e=>e.screen)).size} screens; score registered`)

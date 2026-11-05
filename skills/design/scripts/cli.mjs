#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const commands={serve:'serve.mjs',capture:'visual-capture.mjs',diff:'visual-gate.mjs',critic:'visual-critic.mjs',score:'visual-score.mjs',visual:'visual-orchestrator.mjs',validate:'validate.mjs',qa:'qa.mjs',brief:'validate-brief.mjs',decisions:'decisions.mjs',approve:'approve.mjs',parity:'parity.mjs',experiment:'experiment-compare.mjs',golden:'golden-check.mjs',maturity:'maturity.mjs',done:'done-check.mjs',pack:'pack.mjs',backup:'service-backup.mjs'}
const script=join('skills','design','scripts'); const cmd=process.argv[2]
if(!cmd||cmd==='help'){console.log(`mockbird commands: ${Object.keys(commands).join(', ')}\nExamples:\n  node skills/design/scripts/cli.mjs validate\n  node skills/design/scripts/cli.mjs golden\n  node skills/design/scripts/cli.mjs status`);process.exit(0)}
if(cmd==='version'){console.log(JSON.parse(readFileSync('package.json')).version);process.exit(0)}
if(cmd==='status'){console.log(`version ${JSON.parse(readFileSync('package.json')).version}\nlast gate: npm run ci`);process.exit(0)}
if(!commands[cmd]){const suggestion=Object.keys(commands).find(x=>x.startsWith(cmd[0]));console.error(`unknown command ${cmd}; did-you-mean ${suggestion||'help'}`);process.exit(2)}
const r=spawnSync(process.execPath,[join(script,commands[cmd]),...process.argv.slice(3)],{stdio:'inherit'});process.exit(r.status??1)

#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const root=resolve('.'); const skills=['skills/taste/SKILL.md','skills/design/SKILL.md'];
const schemaPaths=['skills/design/assets/critic-report.schema.json','skills/design/assets/design-brief.schema.json','skills/design/assets/design-decisions.schema.json','design/approvals.json','design/components/catalog.json'];
const errors=[]; const text=skills.map(p=>readFileSync(p,'utf8')).join('\n');
for(const p of schemaPaths) if(!text.includes(p.split('/').slice(-1)[0])) errors.push(`schema not cited by skill: ${p}`);
for(const p of skills){const s=readFileSync(p,'utf8'); for(const m of s.matchAll(/`([^`]+)`/g)){const x=m[1]; if(/^(https?:|DEC-|@|[a-z-]+\/[a-z-]+$)/.test(x)||x.includes(' ')||x.includes('<')||x==='/') continue; if(!(/[/.]/.test(x))||!(/\.(md|json|mjs|css|html)$|\/$/.test(x))) continue; const candidate=x.startsWith('.')?resolve(dirname(resolve(root,p)),x):resolve(root,x); if(!existsSync(candidate)) errors.push(`broken path in ${p}: ${x}`)}}
const taste=readFileSync('skills/taste/SKILL.md','utf8'), craft=readFileSync('skills/design/assets/craft.md','utf8');
if(!taste.includes('8 / 6 / 4')||!craft.includes('product UI (canvas screens) | 7 | 4 | 4')) errors.push('craft↔taste dial baselines are inconsistent');
if(errors.length){for(const e of errors) console.error(`sync-check: ${e}`); process.exit(1)}
console.log(`sync-check: ${schemaPaths.length} schemas checked; 0 broken paths; craft↔taste coherent`);

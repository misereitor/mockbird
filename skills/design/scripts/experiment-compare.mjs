#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'; import { join, resolve } from 'node:path'
const id=process.argv[2]; if(!id) { console.error('usage: experiment-compare <id>'); process.exit(2) }
const p=resolve('design/experiments',id,'experiment.json'); if(!existsSync(p)) { console.error(`experiment not found: ${id}`); process.exit(2) }
const e=JSON.parse(readFileSync(p,'utf8')); if(!e.metric||!e.variants||e.variants.length<3) { console.error('experiment requires metric and control plus two variants'); process.exit(1) }
const winner=e.variants.reduce((a,b)=>b.metric>a.metric?b:a); console.log(JSON.stringify({experiment:id,metric:e.metric,winner:winner.id,evidence:e.evidence},null,2))

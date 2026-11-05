#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || 'skills/design/assets/example/explorations')
let dirs
try { dirs = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name)) } catch (e) { console.error(`explorations: ${e.message}`); process.exit(2) }
if (dirs.length !== 3) { console.error(`expected 3 directions, found ${dirs.length}`); process.exit(1) }
const values = []
for (const d of dirs) {
  try {
    const v = JSON.parse(readFileSync(join(root, d.name, 'direction.json'), 'utf8'))
    if (!v.brief || !v.palette || !v.typePair || !v.density || !v.layout) throw new Error('requires brief, palette, typePair, density and layout')
    values.push({ name: d.name, v })
  } catch (e) { console.error(`${d.name}: invalid direction.json (${e.message})`); process.exit(1) }
}
for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
  const a = values[i].v, b = values[j].v
  const axes = ['palette', 'typePair', 'density'].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
  if (axes.length < 2) { console.error(`direção duplicada: ${values[j].name} diverge de ${values[i].name} em ${axes.join(', ') || 'nenhum eixo'}`); process.exit(1) }
}
console.log(`directions: ${values.map(x => x.name).join(', ')}; all pairs diverge on >=2 axes`)

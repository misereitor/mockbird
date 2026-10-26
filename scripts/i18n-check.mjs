/**
 * i18n consistency check (CI): the viewer's I18N dictionary must stay in sync
 * (en/pt same keys, every key used, same {vars}), and the docs' bilingual
 * blocks must carry the same section ids with working same-page anchors.
 *
 * Run: node scripts/i18n-check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

/* ---------------------------------------------- viewer: I18N dictionary */

const viewer = readFileSync(join(ROOT, 'skills/design/assets/viewer.html'), 'utf8')
const dictSrc = /const I18N = (\{[\s\S]*?\n\})\n\nconst LANG/.exec(viewer)
if (!dictSrc) {
  errors.push('viewer: I18N dictionary not found')
} else {
  const I18N = new Function(`return ${dictSrc[1]}`)()
  const en = Object.keys(I18N.en)
  const pt = Object.keys(I18N.pt)
  for (const key of en) if (!pt.includes(key)) errors.push(`viewer: missing pt: ${key}`)
  for (const key of pt) if (!en.includes(key)) errors.push(`viewer: missing en: ${key}`)

  const used = new Set()
  for (const m of viewer.matchAll(/[^a-zA-Z]t\('([^']+)'/g)) used.add(m[1])
  for (const m of viewer.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria|-alt)?="([^"]+)"/g)) used.add(m[1])
  for (const m of viewer.matchAll(/DEVICE_LABEL = \{([^}]*)\}/g)) {
    for (const kv of m[1].matchAll(/:\s*'([^']+)'/g)) used.add(kv[1])
  }
  for (const key of used) {
    if (!(key in I18N.en)) errors.push(`viewer: used but missing in en: ${key}`)
    if (!(key in I18N.pt)) errors.push(`viewer: used but missing in pt: ${key}`)
  }
  for (const key of en) if (!used.has(key)) errors.push(`viewer: defined but never used: ${key}`)

  for (const [lang, dict] of Object.entries(I18N)) {
    for (const [key, value] of Object.entries(dict)) {
      const vars = [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      const other = lang === 'en' ? I18N.pt[key] : I18N.en[key]
      const otherVars = [...String(other).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      if (vars !== otherVars) errors.push(`viewer: var mismatch in ${key}: "${vars}" vs "${otherVars}"`)
    }
  }
  console.log(`viewer: ${en.length} keys`)
}

/* -------------------------------------------------- docs: bilingual blocks */

const docs = readFileSync(join(ROOT, 'skills/design/assets/docs.html'), 'utf8')
const blocks = new Map()
for (const m of docs.matchAll(/<div data-lang="(en|pt)">([\s\S]*?)\n  <\/div>/g)) blocks.set(m[1], m[2])
if (blocks.size !== 2) {
  errors.push(`docs: expected 2 data-lang blocks, found ${blocks.size}`)
} else {
  const ids = {}
  for (const [lang, body] of blocks) {
    ids[lang] = [...body.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]).sort()
    const idSet = new Set(ids[lang])
    for (const m of body.matchAll(/href="#([^"]+)"/g)) {
      if (!idSet.has(m[1])) errors.push(`docs[${lang}]: anchor #${m[1]} has no target`)
    }
  }
  if (ids.en.join(',') !== ids.pt.join(',')) {
    errors.push('docs: en/pt blocks declare different ids')
  }
  console.log(`docs: ${ids.en.length} section ids per language`)
}

if (errors.length > 0) {
  console.error(`FAIL (${errors.length}):\n` + errors.map((e) => ` - ${e}`).join('\n'))
  process.exit(1)
}
console.log('i18n OK — dictionaries and docs in sync')

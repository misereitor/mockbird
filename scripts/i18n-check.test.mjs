import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { extractI18N, parseStaticObject } from './i18n-check.mjs'

const viewerPath = join(import.meta.dirname, '../skills/design/assets/viewer.html')
function checkerWith(mutator) {
  const original = readFileSync(viewerPath, 'utf8')
  try { writeFileSync(viewerPath, mutator(original)); return spawnSync(process.execPath, ['scripts/i18n-check.mjs'], { encoding: 'utf8' }) } finally { writeFileSync(viewerPath, original) }
}

test('parses comments, unicode, HTML, escapes, interpolation, nested objects and trailing commas', () => {
  const d = parseStaticObject(`{/* x */ en: { greeting: 'Olá {name}', html: "<b>ok</b>", nested: { value: 'a\\n', }, }, pt: { greeting: 'Oi {name}', html: '<b>ok</b>', nested: { value: 'a', }, },}`)
  assert.equal(d.en.greeting, 'Olá {name}')
  assert.equal(d.en.html, '<b>ok</b>')
  assert.equal(d.en.nested.value, 'a\n')
})

test('rejects unsafe and malformed syntax', () => {
  for (const source of [
    '{ x: foo() }', '{ ...x }', '{ [x]: \'a\' }', '{ x: `a` }',
    '{ __proto__: \'x\' }', '{ x: \'a\', x: \'b\' }', "{ x: 'unterminated }", '{ x: 1 }',
  ]) assert.throws(() => parseStaticObject(source), /position/)
})

test('extracts the real dictionary without executing text', () => {
  const d = extractI18N(`const I18N = { en: { x: 'injection; process.exit()' }, pt: { x: 'ok' } }`)
  assert.equal(d.en.x, 'injection; process.exit()')
})

test('checker reports missing locale keys through its real validation path', () => {
  const result = checkerWith((source) => source.replace("    tabOpen: 'Pending',", ''))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing en:/)
})

test('checker reports EN/PT placeholder mismatches through its real validation path', () => {
  const result = checkerWith((source) => source.replace("    tabOpen: 'Pending',", "    tabOpen: 'Pending {count}',"))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /var mismatch in tabOpen/)
})

test('rejected executable payload cannot create a side-effect marker', () => {
  const marker = join(import.meta.dirname, 'i18n-sideeffect-marker.txt')
  try {
    if (existsSync(marker)) unlinkSync(marker)
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { parseStaticObject } from './scripts/i18n-check.mjs'; parseStaticObject("{x: require('node:fs').writeFileSync('${marker}', 'pwned')}")`], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(marker), false)
  } finally { if (existsSync(marker)) unlinkSync(marker) }
})

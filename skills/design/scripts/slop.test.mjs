import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const VALIDATE = join(ROOT, 'validate.mjs')
const BAD = join(ROOT, 'fixtures/bad-slop')
const OK = join(ROOT, 'fixtures/ok-slop')
const CONFIG = join(ROOT, '../assets/validate.config.json')

function run(target, config = CONFIG) {
  return spawnSync(process.execPath, [VALIDATE, target, '--config', config], { encoding: 'utf8' })
}

function slopCategories(output) {
  return new Set([...output.matchAll(/WARN slop-([a-z-]+): ([^\n]+):(\d+):/g)].map((match) => match[1]))
}

test('bad-slop cobre as oito categorias documentadas com arquivo e linha', () => {
  const result = run(BAD)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const output = result.stdout
  const categories = slopCategories(output)
  assert.deepEqual([...categories].sort(), [
    'ai-gradient', 'banned-font', 'decorative-emoji', 'em-dash-copy',
    'generic-hero', 'glassmorphism', 'heavy-shadow', 'placeholder',
  ])
  for (const category of categories) assert.match(output, new RegExp(`WARN slop-${category}: \\S+:\\d+:`))
})

test('ok-slop valida sem achados', () => {
  const result = run(OK)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, /WARN slop-/)
})

test('slop.rules false fica silenciosa', () => {
  const directory = mkdtempSync(join(tmpdir(), 'slop-config-'))
  try {
    const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
    config.slop.rules = false
    const configPath = join(ROOT, '../assets/.slop-test-config.json')
    writeFileSync(configPath, JSON.stringify(config))
    try {
      const result = run(BAD, configPath)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.doesNotMatch(result.stdout, /WARN slop-/)
    } finally {
      rmSync(configPath, { force: true })
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

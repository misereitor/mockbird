import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { MIRROR, SEED, syncProject } from '../plugin/core.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')

test('CI matrix has every OS/node cell and exclusive browser conditions', () => {
  assert.match(workflow, /os:\s*\[ubuntu-latest, windows-latest\]/)
  assert.match(workflow, /node:\s*\[18, 20, 22, 24\]/)
  assert.match(workflow, /if: matrix\.os == 'ubuntu-latest' && matrix\.node >= 20[\s\S]*run: npm run ci\b/)
  assert.match(workflow, /if: matrix\.os != 'ubuntu-latest' \|\| matrix\.node < 20[\s\S]*run: npm run ci:base\b/)
  assert.doesNotMatch(workflow, /if: matrix\.os == 'windows-latest'[\s\S]*playwright-core install/)
})

test('CI commands and fresh install are shell-portable', () => {
  assert.match(workflow, /run: npm ci\n/)
  assert.match(workflow, /run: node scripts\/ci-contract\.test\.mjs --fresh-install/)
  assert.doesNotMatch(workflow, /^\s+run:.*(?:&&|\|\||;\s*exit)/m)
})

function freshInstallAssertions() {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-ci-install-'))
  try {
    execFileSync(process.execPath, ['install.mjs', '--dir', dir], { cwd: root, encoding: 'utf8' })
    for (const name of ['design', 'taste', 'emil-design-eng', 'impeccable']) {
      assert.ok(existsSync(join(dir, name, 'SKILL.md')), `post-install file missing: ${name}/SKILL.md`)
    }
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).license, 'MIT', 'package license missing')
    mkdirSync(join(dir, 'project', 'design'), { recursive: true })
    const summary = syncProject(join(dir, 'project'))
    assert.ok(summary, 'post-install syncProject assertion failed: no summary')
    for (const [dest] of [...MIRROR, ...SEED]) assert.ok(existsSync(join(dir, 'project', 'design', dest)), `post-install syncProject missing: ${dest}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('fresh install verifies files, license, and syncProject', { skip: !process.argv.includes('--fresh-install') }, freshInstallAssertions)

if (process.argv.includes('--fresh-install')) freshInstallAssertions()

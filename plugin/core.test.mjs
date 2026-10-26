/**
 * Unit tests for plugin/core.mjs (plain JS, stock Node 18+ via node:test).
 * Run: node --test plugin/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, frontmatter, loadSkills, MIRROR, PACK_ROOT, SEED, syncProject } from './core.mjs'

test('frontmatter parses name/description with indented continuations', () => {
  const fm = frontmatter('---\nname: design\ndescription: line one\n  line two\n---\n# body')
  assert.equal(fm.name, 'design')
  assert.equal(fm.description, 'line one line two')
})

test('frontmatter returns empty object without frontmatter', () => {
  assert.deepEqual(frontmatter('# just a heading'), {})
})

test('frontmatter handles CRLF', () => {
  assert.equal(frontmatter('---\r\nname: taste\r\n---\r\nbody').name, 'taste')
})

test('loadSkills finds the four skills with valid metadata', () => {
  const skills = loadSkills()
  const ids = skills.map((s) => s.id).sort()
  assert.deepEqual(ids, ['design', 'emil-design-eng', 'impeccable', 'taste'])
  for (const skill of skills) {
    assert.equal(skill.name, skill.id)
    assert.ok(skill.description.length > 0, `${skill.id} needs a description`)
    assert.ok(skill.content.length > 0, `${skill.id} needs content`)
    assert.ok(existsSync(skill.path), `${skill.id} path must exist`)
  }
})

test('MIRROR and SEED sources all exist in the pack', () => {
  for (const [dest, src] of [...MIRROR, ...SEED]) {
    assert.ok(existsSync(src), `missing source for ${dest}: ${src}`)
    assert.ok(src.startsWith(PACK_ROOT), `source escapes the pack: ${src}`)
  }
})

test('syncProject returns null without a design/ folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    assert.equal(syncProject(dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncProject seeds a fresh design/ with every MIRROR and SEED file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    const summary = syncProject(dir)
    assert.ok(summary)
    assert.equal(summary.updated.length, 0)
    assert.equal(summary.added.length, MIRROR.length + SEED.length)
    for (const [dest, src] of [...MIRROR, ...SEED]) {
      const target = join(dir, 'design', dest)
      assert.ok(existsSync(target), `not mirrored: ${dest}`)
      assert.deepEqual(readFileSync(target), readFileSync(src), `content differs: ${dest}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncProject backs up a divergent file as .bak before updating', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    const local = join(dir, 'design', 'mock.js')
    writeFileSync(local, '// local experiment')
    const summary = syncProject(dir)
    assert.deepEqual(summary.updated, ['mock.js'])
    assert.equal(readFileSync(local, 'utf8'), readFileSync(join(MIRROR.find(([d]) => d === 'mock.js')[1]), 'utf8'))
    assert.equal(readFileSync(`${local}.bak`, 'utf8'), '// local experiment')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncProject never overwrites evolved components (SEED policy)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    const button = join(dir, 'design', 'components', 'button.html')
    writeFileSync(button, '<button>project evolved</button>')
    const summary = syncProject(dir)
    assert.ok(!summary.updated.includes('components/button.html'))
    assert.equal(readFileSync(button, 'utf8'), '<button>project evolved</button>')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('describe summarizes the sync for the setup log', () => {
  assert.equal(describe(null), 'design/: no design/ folder in this project — nothing to sync')
  assert.equal(describe({ updated: [], added: [] }), 'design/: updated = none; added = none')
  assert.equal(describe({ updated: ['a'], added: ['b', 'c'] }), 'design/: updated = a; added = b, c')
})

/**
 * Unit tests for plugin/core.mjs (plain JS, stock Node 18+ via node:test).
 * Run: node --test plugin/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, frontmatter, loadCommands, loadSkills, MIRROR, PACK_ROOT, SEED, syncProject } from './core.mjs'

// Independent recomputation of the stamp hash — same documented rule as the
// stamp itself: `dest\n<sha256>\n` per MIRROR entry, in order, fed to SHA-256.
function recomputedMirrorHash(designDir) {
  const composite = createHash('sha256')
  for (const [dest] of MIRROR) {
    const file = join(designDir, dest)
    if (!existsSync(file)) continue
    const hex = createHash('sha256').update(readFileSync(file)).digest('hex')
    composite.update(`${dest}\n${hex}\n`)
  }
  return composite.digest('hex')
}

function readStamp(designDir) {
  return JSON.parse(readFileSync(join(designDir, '.mockbird-version'), 'utf8'))
}

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

test('syncProject stamps design/.mockbird-version with version, mirrorHash and date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    const stamp = readStamp(join(dir, 'design')) // written, then re-read
    const packVersion = JSON.parse(readFileSync(join(PACK_ROOT, 'package.json'), 'utf8')).version
    assert.equal(stamp.version, packVersion)
    assert.match(stamp.mirrorHash, /^[0-9a-f]{64}$/)
    assert.ok(Number.isFinite(Date.parse(stamp.date)), `unparseable date: ${stamp.date}`)
    assert.deepEqual(Object.keys(stamp.files).sort(), MIRROR.map(([d]) => d).sort())
    assert.equal(stamp.mirrorHash, recomputedMirrorHash(join(dir, 'design')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stamp records divergent files backed up as .bak', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    const local = join(dir, 'design', 'mock.js')
    writeFileSync(local, '// local experiment')
    syncProject(dir)
    assert.equal(readFileSync(`${local}.bak`, 'utf8'), '// local experiment')
    assert.deepEqual(readStamp(join(dir, 'design')).divergent, ['mock.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stamp detects a corrupted recorded hash and backs up divergent content (QA failure path)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    const stampPath = join(dir, 'design', '.mockbird-version')
    // corrupt the recorded hash and re-run syncProject: the divergence must
    // be detected (drift record), not silently accepted
    const corrupt = JSON.parse(readFileSync(stampPath, 'utf8'))
    corrupt.mirrorHash = '0'.repeat(64)
    writeFileSync(stampPath, JSON.stringify(corrupt, null, 2))
    syncProject(dir)
    let stamp = readStamp(join(dir, 'design'))
    assert.equal(stamp.mirrorHash, recomputedMirrorHash(join(dir, 'design')))
    assert.ok(stamp.drift, 'corrupted recorded hash must be flagged as drift')
    assert.equal(stamp.drift.mirrorMismatch, true)
    assert.equal(stamp.drift.previousMirrorHash, '0'.repeat(64))
    // diverging mirrored content: .bak created/updated + divergence recorded
    const local = join(dir, 'design', 'mock.js')
    writeFileSync(local, '// local experiment')
    syncProject(dir)
    assert.equal(readFileSync(`${local}.bak`, 'utf8'), '// local experiment')
    stamp = readStamp(join(dir, 'design'))
    assert.deepEqual(stamp.divergent, ['mock.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stamp drift reports a missing mirrored file (mismatch signal)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    rmSync(join(dir, 'design', 'mock.js'))
    syncProject(dir)
    const stamp = readStamp(join(dir, 'design'))
    assert.ok(stamp.drift, 'missing mirrored file must be signalled')
    assert.equal(stamp.drift.mirrorMismatch, true)
    assert.ok(stamp.drift.missing.includes('mock.js'), `missing not reported: ${JSON.stringify(stamp.drift)}`)
    assert.ok(existsSync(join(dir, 'design', 'mock.js')), 'mirror loop still re-adds the file')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a pre-existing design/ without the stamp adopts it on the next sync', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    writeFileSync(join(dir, 'design', 'mock.js'), '// project evolved before the stamp')
    syncProject(dir)
    const stamp = readStamp(join(dir, 'design'))
    assert.equal(stamp.mirrorHash, recomputedMirrorHash(join(dir, 'design')))
    assert.equal(stamp.drift, undefined, 'no previous stamp — nothing to verify')
    assert.deepEqual(stamp.divergent, ['mock.js'])
    assert.equal(readFileSync(join(dir, 'design', 'mock.js.bak'), 'utf8'), '// project evolved before the stamp')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a malformed stamp is replaced without crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-test-'))
  try {
    mkdirSync(join(dir, 'design'))
    syncProject(dir)
    writeFileSync(join(dir, 'design', '.mockbird-version'), 'not json {')
    const summary = syncProject(dir)
    assert.ok(summary)
    const stamp = readStamp(join(dir, 'design'))
    assert.match(stamp.mirrorHash, /^[0-9a-f]{64}$/)
    assert.equal(stamp.drift, undefined, 'malformed stamp counts as absent')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('describe summarizes the sync for the setup log', () => {
  assert.equal(describe(null), 'design/: no design/ folder in this project — nothing to sync')
  assert.equal(describe({ updated: [], added: [] }), 'design/: updated = none; added = none')
  assert.equal(describe({ updated: ['a'], added: ['b', 'c'] }), 'design/: updated = a; added = b, c')
})

test('loadCommands ships one slash command per skill', () => {
  const commands = loadCommands()
  assert.deepEqual(commands.map((c) => c.name).sort(), ['design', 'emil-design-eng', 'impeccable', 'taste'])
  for (const command of commands) {
    assert.ok(command.description.length > 0, `/${command.name} needs a description`)
    assert.ok(command.template.includes('$ARGUMENTS'), `/${command.name} must forward $ARGUMENTS`)
    assert.ok(command.template.includes(`\`${command.name}\``), `/${command.name} must point at its skill id`)
  }
})

test('install.mjs places slash commands next to OpenCode skill dirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mockbird-install-'))
  try {
    const skillsDir = join(dir, '.opencode', 'skills')
    const result = spawnSync(process.execPath, [join(PACK_ROOT, 'install.mjs'), '--dir', skillsDir], {
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(result.status, 0, result.stderr)
    for (const name of ['design', 'taste', 'emil-design-eng', 'impeccable']) {
      assert.ok(existsSync(join(skillsDir, name, 'SKILL.md')), `missing skill ${name}`)
      assert.ok(existsSync(join(dir, '.opencode', 'commands', `${name}.md`)), `missing slash command /${name}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const checker = join(process.cwd(), "scripts/check-subsystem-boundaries.mjs")
function probe(map, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "subsystem-boundaries-"))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  const file = join(dir, "map.json"); writeFileSync(file, JSON.stringify({ root: ".", owners: map.owners, allowedEdges: map.allowedEdges || [] }))
  const result = spawnSync(process.execPath, [checker, file], { encoding: "utf8" }); rmSync(dir, { recursive: true, force: true }); return result
}
test("real map passes", () => assert.equal(spawnSync(process.execPath, [checker], { encoding: "utf8" }).status, 0))
test("cycle names subsystems", () => { const r = probe({ owners: { A: ["a.mjs"], B: ["b.mjs"] }, allowedEdges: [["A", "B"], ["B", "A"] ] }, { "a.mjs": "", "b.mjs": "" }); assert.notEqual(r.status, 0); assert.match(r.stderr, /dependency cycle.*A.*B/) })
test("forbidden edge names path", () => { const r = probe({ owners: { A: ["a.mjs"], B: ["b.mjs"] } }, { "a.mjs": "import './b.mjs'", "b.mjs": "" }); assert.notEqual(r.status, 0); assert.match(r.stderr, /forbidden edge.*a\.mjs/) })
test("duplicate owner names path", () => { const r = probe({ owners: { A: ["a.mjs"], B: ["a.mjs"] } }, { "a.mjs": "" }); assert.notEqual(r.status, 0); assert.match(r.stderr, /duplicate owner.*a\.mjs/) })
test("missing path names subsystem and path", () => { const r = probe({ owners: { A: ["missing.mjs"] } }); assert.notEqual(r.status, 0); assert.match(r.stderr, /missing path: A owns missing\.mjs/) })

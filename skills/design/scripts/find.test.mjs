/**
 * Unit + CLI tests for find.mjs (plan todo 8 — busca direta find).
 *
 * Fixture contract (fixtures/find-target/): `planted-term` planted exactly
 * 6 times (3 telas as visible text + 1 class attr + 1 token value + 1 data-*
 * attr), `mockbird-probe-42` exactly 3 times across 2 files (one in a
 * data-* attribute), literal `a.*b` once (with `acb`/`axxb` decoys a regex
 * would match), literal `preço (R$)` once (with a no-parens decoy), one line
 * carrying ANSI escape bytes, plus one icone and one arquivo probe.
 *
 * Run: node --test skills/design/scripts/find.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "./find.mjs";

const SCRIPT = fileURLToPath(new URL("./find.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/find-target", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function jsonRun(args) {
  const r = run([...args, "--json"]);
  return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr };
}

function listTree(dir, prefix = "") {
  const out = [];
  const entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(entry.isDirectory() ? `${rel}/` : rel);
    if (entry.isDirectory()) out.push(...listTree(dir, rel));
  }
  return out;
}

test("happy: planted-term --json lists exactly the 6 planted hits (arquivo:linha)", () => {
  const { status, out } = jsonRun(["planted-term", "--target", FIXTURE]);
  assert.equal(status, 0);
  assert.equal(out.total, 6);
  assert.deepEqual(
    out.hits.map((h) => [h.arquivo, h.linha, h.campo]),
    [
      ["components/button.html", 1, "data"],
      ["components/card.html", 1, "classe"],
      ["dashboard/01-overview.html", 7, "texto"],
      ["login/01-login.html", 7, "texto"],
      ["login/02-cadastro.html", 7, "texto"],
      ["tokens.json", 6, "token"],
    ]
  );
  for (const hit of out.hits) assert.ok(hit.preview.length > 0, hit.arquivo);
});

test("--campo filters isolate exactly one campo each", () => {
  const expect = { texto: 3, classe: 1, token: 1, data: 1, icone: 0, arquivo: 0 };
  for (const [campo, total] of Object.entries(expect)) {
    const { status, out } = jsonRun(["planted-term", "--target", FIXTURE, "--campo", campo]);
    assert.equal(out.total, total, campo);
    assert.ok(out.hits.every((h) => h.campo === campo), campo);
    assert.equal(status, total > 0 ? 0 : 1, campo);
  }
});

test("mockbird-probe-42: exactly 3 hits in 2 files, count=3, file:line each", () => {
  const r = run(["mockbird-probe-42", "--target", FIXTURE]);
  assert.equal(r.status, 0);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.pop(), "3 ocorrências");
  const tuples = lines.map((line) => {
    const m = /^(.+):(\d+): (.+)$/.exec(line);
    assert.ok(m, line);
    return [m[1], Number(m[2])];
  });
  assert.deepEqual(tuples, [
    ["dashboard/01-overview.html", 8],
    ["dashboard/01-overview.html", 9],
    ["login/01-login.html", 8],
  ]);
  assert.equal(new Set(tuples.map(([f]) => f)).size, 2);
});

test("mockbird-probe-42 --campo data returns only the data-attribute hit", () => {
  const { status, out } = jsonRun(["mockbird-probe-42", "--target", FIXTURE, "--campo", "data"]);
  assert.equal(status, 0);
  assert.equal(out.total, 1);
  assert.deepEqual([out.hits[0].arquivo, out.hits[0].linha, out.hits[0].campo], ["dashboard/01-overview.html", 9, "data"]);
});

test("regex metacharacters are literal: a.*b matches only the literal plant", () => {
  const { status, out } = jsonRun(["a.*b", "--target", FIXTURE]);
  assert.equal(status, 0);
  assert.deepEqual(
    out.hits.map((h) => [h.arquivo, h.linha]),
    [["login/02-cadastro.html", 8]]
  );
});

test("preço (R$) is searched literally (parens and $ are inert)", () => {
  const { status, out } = jsonRun(["preço (R$)", "--target", FIXTURE]);
  assert.equal(status, 0);
  assert.deepEqual(
    out.hits.map((h) => [h.arquivo, h.linha]),
    [["login/01-login.html", 9]]
  );
});

test("mockbird-probe-42( is a clear no-match, never a stack trace", () => {
  const r = run(["mockbird-probe-42(", "--target", FIXTURE]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /0 ocorrências/);
  assert.equal(r.stderr, "");
  assert.doesNotMatch(r.stdout, /SyntaxError|Error:|find\.mjs:\d+/);
});

test("empty and whitespace-only terms are usage errors (exit 2, message)", () => {
  for (const term of ["", "   "]) {
    const r = run([term, "--target", FIXTURE]);
    assert.equal(r.status, 2, JSON.stringify(term));
    assert.notEqual(r.stderr, "");
  }
});

test("unknown --campo exits 2 listing every valid campo", () => {
  const r = run(["x", "--target", FIXTURE, "--campo", "estilo"]);
  assert.equal(r.status, 2);
  for (const campo of ["texto", "classe", "token", "data", "icone", "arquivo"]) {
    assert.ok(r.stderr.includes(campo), campo);
  }
});

test("nonexistent term: exit 1 with '0 ocorrências' (text and --json)", () => {
  const r = run(["termo-que-nao-existe-zz", "--target", FIXTURE]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trimEnd().split("\n").at(-1), "0 ocorrências");
  const { status, out, stderr } = jsonRun(["termo-que-nao-existe-zz", "--target", FIXTURE]);
  assert.equal(status, 1);
  assert.equal(out.total, 0);
  assert.deepEqual(out.hits, []);
  assert.match(stderr, /0 ocorrências/);
});

test("ANSI escapes in file content never reach the terminal", () => {
  const { status, out } = jsonRun(["mockbird-esc-7", "--target", FIXTURE]);
  assert.equal(status, 0);
  assert.equal(out.total, 1);
  assert.ok(!out.hits[0].preview.includes("\x1b"));
  assert.ok(out.hits[0].preview.includes("\\x1B"));
  const r = run(["mockbird-esc-7", "--target", FIXTURE]);
  assert.ok(!r.stdout.includes("\x1b"));
  assert.ok(r.stdout.includes("\\x1B"));
});

test("arquivo and icone campos cover file names and svg icon paths", () => {
  const ra = jsonRun(["arquivo-probe-9", "--target", FIXTURE]);
  assert.equal(ra.out.total, 1);
  assert.deepEqual([ra.out.hits[0].arquivo, ra.out.hits[0].campo], ["notes/arquivo-probe-9.md", "arquivo"]);
  const ri = jsonRun(["icon-probe-7", "--target", FIXTURE]);
  assert.deepEqual(
    ri.out.hits.map((h) => [h.arquivo, h.linha, h.campo]),
    [["components/button.html", 2, "icone"]]
  );
});

test("output is deterministic across runs (sorted by arquivo, linha)", () => {
  const a = run(["planted-term", "--target", FIXTURE, "--json"]);
  const b = run(["planted-term", "--target", FIXTURE, "--json"]);
  assert.equal(a.stdout, b.stdout);
});

test(".map/index.json (schemaVersion 1) is used and yields scan-identical hits", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mockbird-find-"));
  try {
    cpSync(FIXTURE, tmp, { recursive: true });
    mkdirSync(join(tmp, ".map"), { recursive: true });
    writeFileSync(join(tmp, ".map", "index.json"), JSON.stringify(buildIndex(tmp)));
    const indexed = jsonRun(["planted-term", "--target", tmp]);
    assert.equal(indexed.out.fonte, "index");
    const scanned = jsonRun(["planted-term", "--target", FIXTURE]);
    assert.equal(scanned.out.fonte, "scan");
    assert.deepEqual(indexed.out.hits, scanned.out.hits);

    writeFileSync(join(tmp, ".map", "index.json"), JSON.stringify({ schemaVersion: 99, files: [] }));
    const fallback = jsonRun(["planted-term", "--target", tmp]);
    assert.equal(fallback.out.fonte, "scan");
    assert.deepEqual(fallback.out.hits, scanned.out.hits);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("find.mjs never writes to the target", () => {
  const before = listTree(FIXTURE);
  run(["planted-term", "--target", FIXTURE]);
  run(["mockbird-probe-42", "--target", FIXTURE, "--json"]);
  assert.deepEqual(listTree(FIXTURE), before);
});

test("missing target dir is a guided usage error (exit 2)", () => {
  const r = run(["x", "--target", join(tmpdir(), "mockbird-find-missing-dir")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /alvo não encontrado/);
});

/**
 * Unit + CLI tests for component-docs.mjs (plan todo 22 — Component
 * Intelligence: catálogo com variantes, estados e documentação automática).
 *
 * Fixture strategy: every test builds its own design root under os.tmpdir()
 * (process-isolated, like visual-orchestrator.test.mjs) by copying the real
 * corpus (skills/design/assets/example: extended registry + REAL partials +
 * utilities.css + tokens.json) and mutating the copy for the adversarial
 * cases. NOTHING is written into the repo tree.
 *
 * Pinned asserts (todo 22 acceptance):
 *   - every doc snippet is byte-identical to its partial (extracted snippet
 *     diff — the misleading-success guard: a doc without the partial code
 *     fails);
 *   - the 6 canonical states + schemaVersion are present (registry, catalog);
 *   - codegen regression: the extended registry generates byte-identical TSX
 *     to the old-format registry;
 *   - guided non-zero exits naming the exact file/component for corrupt
 *     registry, undeclared variant, missing partial, stale tokensUsed and
 *     stale outputs (--check).
 *
 * Run: node --test skills/design/scripts/component-docs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATES,
  CATALOG_SCHEMA_VERSION,
  PREVIEW_HOOK,
  extractSnippet,
  loadUtilities,
  deriveTokensUsed,
  buildPreviews,
  buildCatalog,
  renderOutputs,
  diffCatalogs,
} from "./component-docs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "component-docs.mjs");
const CODEGEN = join(HERE, "codegen.mjs");
const SYNC = join(HERE, "sync-components.mjs");
const CONFIG = join(HERE, "..", "assets", "validate.config.json");
const CORPUS = join(HERE, "..", "assets", "example");

const tmpRoots = [];
function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), "component-docs-"));
  tmpRoots.push(dir);
  mkdirSync(join(dir, "components"), { recursive: true });
  cpSync(join(CORPUS, "components"), join(dir, "components"), { recursive: true });
  for (const file of ["utilities.css", "tokens.json"]) {
    cpSync(join(CORPUS, file), join(dir, file));
  }
  return dir;
}
process.on("exit", () => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function generate(root) {
  const r = run(["--target", root]);
  assert.equal(r.status, 0, `generation failed: ${r.stderr}`);
  return r;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function mdSnippet(md) {
  const start = md.indexOf("```html\n");
  assert.notEqual(start, -1, "doc has no html code block");
  const body = md.slice(start + "```html\n".length);
  const end = body.indexOf("\n```");
  assert.notEqual(end, -1, "code block is not closed");
  return body.slice(0, end);
}

test("acceptance: gera catalog.json + 1 doc por componente com trecho idêntico ao partial, 6 states e schemaVersion", () => {
  const root = makeRoot();
  generate(root);
  const registry = readJson(join(root, "components", "components.json"));
  const catalog = readJson(join(root, "components", "catalog.json"));
  assert.equal(typeof registry.schemaVersion, "number");
  assert.ok(registry.schemaVersion >= 1);
  assert.equal(catalog.schemaVersion, CATALOG_SCHEMA_VERSION);

  const ids = Object.keys(registry).filter((k) => k !== "schemaVersion");
  assert.equal(ids.length, 14);
  assert.deepEqual(
    catalog.components.map((c) => c.id),
    ids
  );
  for (const record of catalog.components) {
    // 6 states listed in registry AND catalog
    assert.deepEqual(registry[record.id].states, [...STATES], record.id);
    assert.deepEqual(record.states, [...STATES], record.id);
    // one .md per component
    const md = readFileSync(join(root, "components", `${record.id}.md`), "utf8");
    // misleading-success guard: the doc snippet must be the partial bytes
    const partial = readFileSync(join(root, "components", record.file), "utf8");
    assert.equal(mdSnippet(md), extractSnippet(partial), `${record.id}.md snippet differs from ${record.file}`);
    for (const state of STATES) {
      assert.ok(md.includes(`\`${state}\``), `${record.id}.md lists state ${state}`);
    }
    assert.ok(record.previews.length > 0, record.id);
    assert.equal(record.source.partialSha256.length, 64, record.id);
  }
  // the mounting hook is documented in the catalog
  assert.equal(catalog.mountPreviewHook.name, "mountPreviewHook");
  assert.equal(PREVIEW_HOOK.name, "mountPreviewHook");
});

test("misleading_success: doc gerado sem o código do partial é flagrado (assert de trecho + --check stale)", () => {
  const root = makeRoot();
  generate(root);
  const partial = readFileSync(join(root, "components", "button.html"), "utf8");
  const good = readFileSync(join(root, "components", "button.md"), "utf8");
  // the guard itself: a doc whose snippet lost the partial code is NOT equal
  const tamperedSnippet = extractSnippet(partial).replace("Ação", "OUTRA");
  assert.notEqual(mdSnippet(good.replace(extractSnippet(partial), tamperedSnippet)), extractSnippet(partial));
  // and the CLI flags the tampered doc as stale, naming it
  writeFileSync(join(root, "components", "button.md"), good.replace(extractSnippet(partial), "<div>sem partial</div>"));
  const r = run(["--target", root, "--check"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /stale: components\/button\.md/);
});

test("stale_state: partial editado após a geração → --check exit 1 nomeando o componente", () => {
  const root = makeRoot();
  generate(root);
  const partial = readFileSync(join(root, "components", "card.html"), "utf8");
  writeFileSync(join(root, "components", "card.html"), partial.replace("bg-surface", "bg-bg"));
  const r = run(["--target", root, "--check"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /stale: components\/(card\.md|catalog\.json)/);
  // regeneration repairs it
  generate(root);
  assert.equal(run(["--target", root, "--check"]).status, 0);
});

test("malformed_input: components.json corrompido → exit≠0 guiado nomeando o arquivo", () => {
  const root = makeRoot();
  writeFileSync(join(root, "components", "components.json"), "{ \"button\": {");
  const r = run(["--target", root]);
  assert.notEqual(r.status, 0);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /components\/components\.json/);
  assert.match(r.stderr, /not valid JSON/);
});

test("violação: partial com variante não declarada → exit≠0 nomeando componente+variante", () => {
  const root = makeRoot();
  const partial = readFileSync(join(root, "components", "button.html"), "utf8");
  writeFileSync(join(root, "components", "button.html"), partial.replace('data-size="md"', 'data-size="xl"'));
  const r = run(["--target", root]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /entry "button"/);
  assert.match(r.stderr, /undeclared variant data-size="xl"/);
});

test("registry com componente cujo file não existe → exit≠0 nomeando o partial faltante", () => {
  const root = makeRoot();
  const registry = readJson(join(root, "components", "components.json"));
  registry.button.template = "nao-existe.html";
  registry.button.file = "nao-existe.html";
  writeFileSync(join(root, "components", "components.json"), JSON.stringify(registry, null, 2) + "\n");
  const r = run(["--target", root]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /entry "button"/);
  assert.match(r.stderr, /partial not found: components\/nao-existe\.html/);
});

test("stale_state (registry): tokensUsed defasado vs o partial → exit≠0 nomeando o drift", () => {
  const root = makeRoot();
  const registry = readJson(join(root, "components", "components.json"));
  registry.button.tokensUsed = [...registry.button.tokensUsed, "color-inventado"];
  writeFileSync(join(root, "components", "components.json"), JSON.stringify(registry, null, 2) + "\n");
  const r = run(["--target", root]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /entry "button"/);
  assert.match(r.stderr, /tokensUsed/);
});

test("schema: states fora do contrato canônico → exit≠0 nomeando o campo", () => {
  const root = makeRoot();
  const registry = readJson(join(root, "components", "components.json"));
  registry.card.states = ["default", "hover"];
  writeFileSync(join(root, "components", "components.json"), JSON.stringify(registry, null, 2) + "\n");
  const r = run(["--target", root]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /entry "card"/);
  assert.match(r.stderr, /"states" must be exactly/);
});

test("codegen regression: registry estendido gera TSX byte-idêntico ao formato antigo", () => {
  const extendedRoot = makeRoot();
  // old-format twin: same entries minus schemaVersion and the catalog fields
  const oldRoot = makeRoot();
  const registry = readJson(join(extendedRoot, "components", "components.json"));
  const old = {};
  for (const [id, entry] of Object.entries(registry)) {
    if (id === "schemaVersion") continue;
    const classic = {};
    for (const key of ["name", "template", "variants", "slots", "realComponent", "dataProps"]) {
      classic[key] = entry[key];
    }
    old[id] = classic;
  }
  writeFileSync(join(oldRoot, "components", "components.json"), JSON.stringify(old, null, 2) + "\n");

  const outs = [];
  for (const root of [extendedRoot, oldRoot]) {
    const out = join(root, "generated");
    const r = spawnSync(
      process.execPath,
      [CODEGEN, "--config", CONFIG, "--design", root, "--out", out],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, `codegen failed on ${root}: ${r.stderr}`);
    assert.match(r.stdout, /wrote 14 file\(s\)/);
    outs.push(out);
  }
  for (const file of ["Button.tsx", "Modal.tsx", "Chip.tsx"]) {
    assert.equal(
      readFileSync(join(outs[0], file), "utf8"),
      readFileSync(join(outs[1], file), "utf8"),
      `${file} differs between extended and old registry`
    );
  }
});

test("compat: sync-components --check continua exit 0 sobre o registry estendido", () => {
  const root = makeRoot();
  const r = spawnSync(process.execPath, [SYNC, root, "--check", "--config", CONFIG], { encoding: "utf8" });
  assert.equal(r.status, 0, `sync --check regressed: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /up to date/);
});

test("history: diff de catalog entre gitSHAs por componente + catalog stale detectado no diff", () => {
  const root = makeRoot();
  const git = (...args) =>
    spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  assert.equal(git("init").status, 0);

  generate(root); // v1: sources + fresh catalog committed together
  assert.equal(git("add", "-A").status, 0);
  assert.equal(git("commit", "-m", "v1").status, 0);
  const v1 = git("rev-parse", "HEAD").stdout.trim();

  // v2: the partial changes but the catalog is NOT regenerated (stale commit)
  const partial = readFileSync(join(root, "components", "button.html"), "utf8");
  writeFileSync(join(root, "components", "button.html"), partial.replace("bg-accent", "bg-surface"));
  assert.equal(git("add", "-A").status, 0);
  assert.equal(git("commit", "-m", "v2").status, 0);
  const v2 = git("rev-parse", "HEAD").stdout.trim();

  const r = run(["--target", root, "--history", `${v1}..${v2}`]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.schemaVersion, CATALOG_SCHEMA_VERSION);
  const button = report.components.find((c) => c.id === "button");
  assert.equal(button.status, "changed");
  for (const field of ["source", "previews", "tokensUsed"]) {
    assert.ok(button.changedFields.includes(field), `changedFields misses ${field}: ${button.changedFields}`);
  }
  const unchanged = report.components.find((c) => c.id === "card");
  assert.equal(unchanged.status, "unchanged");
  // stale committed catalog is flagged, never trusted silently
  assert.deepEqual(report.catalog[v1].stale, []);
  assert.deepEqual(report.catalog[v2].stale, ["button"]);
  assert.equal(report.catalog[v2].present, true);
});

test("previews: buildPreviews cobre cada valor de variante + os 6 estados, com html derivado do partial", () => {
  const root = makeRoot();
  const registry = readJson(join(root, "components", "components.json"));
  const partial = readFileSync(join(root, "components", "button.html"), "utf8");
  const previews = buildPreviews(registry.button, partial);
  assert.deepEqual(
    previews.map((p) => p.previewId),
    [
      "size=sm", "size=md", "size=lg",
      "tone=primary", "tone=secondary", "tone=ghost", "tone=danger",
      "state=default", "state=hover", "state=focus", "state=active", "state=disabled", "state=loading",
    ]
  );
  const lg = previews.find((p) => p.previewId === "size=lg");
  assert.match(lg.html, /data-size="lg"/);
  assert.match(lg.html, /class="[^"]*p-3 text-heading/);
  assert.ok(lg.html.includes("<!-- slot:label -->Ação<!-- /slot:label -->"), "slot defaults preserved byte-exact");
  const loading = previews.find((p) => p.previewId === "state=loading");
  assert.match(loading.html, /data-state="loading"/);
  assert.equal(loading.state, "loading");
  // every preview derives from the same root tag family as the partial
  for (const preview of previews) {
    assert.ok(preview.html.includes('data-component="button"'), preview.previewId);
    assert.ok(preview.html.startsWith("<button"), preview.previewId);
  }
});

test("unidade: deriveTokensUsed resolve classes via utilities.css; extractSnippet é estável", () => {
  const utilMap = loadUtilities(readFileSync(join(CORPUS, "utilities.css"), "utf8"));
  const partial = readFileSync(join(CORPUS, "components", "button.html"), "utf8");
  assert.deepEqual(deriveTokensUsed(partial, utilMap), [
    "border-radius-md",
    "color-accent",
    "color-bg",
    "dimension-space-2",
    "typography-body-font-family",
    "typography-body-font-size",
  ]);
  assert.equal(extractSnippet(partial + "\n\n"), extractSnippet(partial));
});

test("determinismo + utilitários puros: duas gerações byte-idênticas, diffCatalogs campo a campo", () => {
  const root = makeRoot();
  const readFile = (rel) => {
    try {
      return readFileSync(join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const first = buildCatalog({ readFile });
  const second = buildCatalog({ readFile });
  const a = renderOutputs(first);
  const b = renderOutputs(second);
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [rel, content] of a) assert.equal(content, b.get(rel), rel);
  // --check agrees the freshly generated tree is clean
  generate(root);
  assert.equal(run(["--target", root, "--check"]).status, 0);
  // diffCatalogs: field-level change list
  const after = JSON.parse(JSON.stringify(first.catalog));
  after.components[0].docs = { ...after.components[0].docs, description: "mudou" };
  const diff = diffCatalogs(first.catalog, after);
  assert.deepEqual(
    diff.filter((c) => c.status !== "unchanged"),
    [{ id: "button", status: "changed", changedFields: ["docs"] }]
  );
});

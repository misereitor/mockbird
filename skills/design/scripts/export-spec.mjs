#!/usr/bin/env node
/**
 * export-spec.mjs - per-screen spec export (plan todo 18, GAP-8 spec half).
 *
 * For every screen of a design root emits <design-root>/spec/<telaId>.md AND
 * <telaId>.json with EXACTLY these five keys (the handoff contract, D9):
 *
 *   states   DECLARED screen states, via state markers `<!-- state:nome -->`
 *            or in-page hash shortcuts `href="#nome"` (the client corpus'
 *            `#estado` mechanism). NEVER scraped from CSS pseudo-classes:
 *            hover/active/disabled are pointer/variant states, not screen
 *            states (plan: "state = estados declarados, nao hover/active CSS").
 *   flows    the data-go/data-overlay navigation graph, plus the same
 *            runtime's other navigation edges: literal Mock.go()/Mock.overlay()
 *            call sites and plain screen links (mock.js screenLink contract:
 *            a canvas-relative `<a href="*.html">` opens the screen as an
 *            overlay with JS and navigates to it without JS). Each edge is
 *            { from, to, target, via }: target = as declared, to = telaId
 *            when the target resolves to a known screen (else null).
 *   texts    literal strings on the screen: text nodes outside
 *            script/style/comments plus copy-bearing attributes
 *            (placeholder, aria-label, alt, title, data-toast), entity-
 *            decoded and deduplicated in document order. Inline script
 *            literals are code, not declared copy - out of scope.
 *   rules    rules DECLARED in markers or data.json: `<!-- rule:texto -->`
 *            markers, plus the named data.json scenarios (the declared data
 *            override rules) read through the resolved $ref values (todo 21
 *            semantics: {"$ref": "file.json#key"} -> <design-root>/data/).
 *   parity   the D8 parity checklist rows emitted per screen: mock component
 *            -> realComponent -> status. Components come from the marker
 *            regions (marker-parser.mjs) and realComponent from the design
 *            root's components/components.json. status "pending" = mapping
 *            declared (the check against the real frontend is todo 23);
 *            "unmapped" = the registry declares no realComponent.
 *
 * Rule (plan-literal): EVERY screen must declare >=1 state. A screen with
 * zero declared states fails the export (exit 1, one line citing the screen;
 * fixture fixtures/bad/spec-undeclared). The SAME rule is enforced at
 * validate time by rules/spec-undeclared.mjs, which imports the exported
 * `detectScreenStates` from this module (ONE state-detection
 * implementation, no duplicated heuristics; this module is import-safe - the
 * CLI entry point is main-guarded).
 *
 * Usage: node export-spec.mjs --design <design-root>
 *   --design <dir>   design root: project mode (canvases below it) or canvas
 *                    mode (the dir itself holds canvas.json - same discovery
 *                    semantics as validate.mjs)
 *   writes <design-root>/spec/<telaId>.md + <telaId>.json (telaId = the
 *   screen id from canvas.json; duplicate ids across canvases fail).
 *
 * Output is DETERMINISTIC: fixed key order, document order for extracted
 *   declarations, sorted parity rows, no timestamps - the same input bytes
 *   always produce byte-identical spec files (spec diffs and qa stability
 *   depend on it). Nothing is written when any screen fails.
 *
 * Exit codes: 0 ok, 1 spec problems (each line cites the screen), 2 usage or
 * structural input error (bad root, invalid canvas.json/JSON, duplicate
 * telaId, unknown argument).
 * Node 18+, stdlib only (node:fs, node:path) + the local marker parser.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_REGISTRY, MarkerError, parseAll } from "./marker-parser.mjs";

const usage = "usage: export-spec.mjs --design <design-root>";

function fail(message) {
  process.stderr.write(`export-spec: ${message}\n`);
  process.exit(2);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ---- discovery -----------------------------------------------------------

// Infra folders that can never hold canvases (snapshots/ embeds frozen canvas
// copies - walking them would double every telaId). The spec output dir is
// skipped so re-runs never see their own artifacts.
const SKIP_DIRS = new Set(["node_modules", ".history", "snapshots", "vendor", "scripts", "spec"]);

function discoverCanvases(root) {
  const canvases = []; // { dir, relDir, manifest }
  if (existsSync(join(root, "canvas.json"))) {
    canvases.push({ dir: root, relDir: ".", manifest: readManifest(join(root, "canvas.json")) });
    return canvases;
  }
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (existsSync(join(full, "canvas.json"))) {
        canvases.push({ dir: full, relDir: relative(root, full), manifest: readManifest(join(full, "canvas.json")) });
      }
      walk(full);
    }
  };
  walk(root);
  return canvases;
}

function readManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`invalid JSON in ${path}: ${String(error.message)}`);
  }
  if (!isPlainObject(manifest)) fail(`${path}: root must be an object`);
  if (!Array.isArray(manifest.screens)) fail(`${path}: "screens" must be a list`);
  return manifest;
}

function loadRegistry(root) {
  const path = join(root, "components", "components.json");
  if (!existsSync(path)) return DEFAULT_REGISTRY;
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`invalid JSON in ${path}: ${String(error.message)}`);
  }
  if (!isPlainObject(registry)) fail(`${path}: root must be an object`);
  return registry;
}

// ---- shared extraction helpers ------------------------------------------

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, " ");
}

/** Inline scripts/styles hold code, not markup: strip before scanning
 * attributes and text nodes (Mock.go call sites are scanned separately). */
function stripCode(html) {
  return stripComments(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : full;
  });
}

function attrValue(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
}

function hasAttr(tag, name) {
  return new RegExp(`\\b${name}\\b`, "i").test(tag);
}

// ---- states: declared via markers or hash shortcuts ---------------------

const STATE_MARKER_ANY_RE = /<!--[ \t]*state:([^\r\n]*?)[ \t]*-->/g;
const HASH_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * detectScreenStates - THE screen-state detection (todo 18), shared with
 * rules/spec-undeclared.mjs by import (ONE implementation; this module is
 * import-safe - the CLI entry point below is main-guarded). Pure: no fs.
 * Returns { states: [{ name, via }], invalid: [name] }:
 *   - declared states, in document order, first occurrence wins: state
 *     markers `<!-- state:nome -->` (via "marker") and in-page hash
 *     shortcuts `href="#nome"` (via "hash", the `#estado` mechanism);
 *     CSS pseudo-classes are never declarations ("state = estados
 *     declarados, nao hover/active CSS");
 *   - invalid: state marker names outside the kebab-case grammar.
 */
export function detectScreenStates(html) {
  const declared = []; // { name, via, index }
  const invalid = [];
  for (const m of html.matchAll(STATE_MARKER_ANY_RE)) {
    const name = m[1].trim();
    if (!HASH_NAME.test(name)) {
      invalid.push(name);
      continue;
    }
    declared.push({ name, via: "marker", index: m.index });
  }
  // Hash shortcuts: in-page anchors `href="#nome"` (the `#estado` mechanism).
  // Ordinary anchors to non-kebab fragments (#modal-titulo) are not states.
  for (const m of stripCode(html).matchAll(/<a\b[^>]*>/gi)) {
    const href = attrValue(m[0], "href");
    if (href === null || !href.startsWith("#")) continue;
    const name = href.slice(1);
    if (!HASH_NAME.test(name)) continue;
    declared.push({ name, via: "hash", index: m.index });
  }
  declared.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const states = [];
  for (const entry of declared) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    states.push({ name: entry.name, via: entry.via });
  }
  return { states, invalid };
}

function extractStates(html, screenLabel, problems) {
  const { states, invalid } = detectScreenStates(html);
  for (const name of invalid) {
    problems.push(`spec-state: ${screenLabel}: invalid state marker name ${JSON.stringify(name)} (expected kebab-case, e.g. <!-- state:vazio -->)`);
  }
  return states;
}

// ---- flows: the data-go/data-overlay navigation graph -------------------

const GO_ATTR_RE = /\bdata-(go|overlay)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const MOCK_CALL_RE = /\bMock\.(go|overlay)\s*\(\s*(?:"([^"]*)"|'([^']*)')/g;

function extractFlows(html, telaId, canvasDir, resolveTarget) {
  const found = []; // { index, from, to, target, via }
  const code = stripCode(html);
  for (const m of code.matchAll(GO_ATTR_RE)) {
    const target = decodeEntities(m[2] ?? m[3] ?? "");
    if (!target) continue;
    found.push({ index: m.index, from: telaId, to: resolveTarget(canvasDir, target), target, via: `data-${m[1]}` });
  }
  for (const m of code.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    // mock.js screenLink contract: action attributes belong to the delegation
    // router (captured above), and target/download links are not screen links.
    if (["data-go", "data-overlay", "data-toast", "data-close", "data-action"].some((a) => hasAttr(tag, a))) continue;
    if (hasAttr(tag, "download")) continue;
    const frame = attrValue(tag, "target");
    if (frame !== null && frame !== "_self") continue;
    const href = attrValue(tag, "href");
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) continue;
    const file = href.split(/[?#]/)[0];
    if (!/\.html?$/i.test(file)) continue;
    // canvas-relative screen links open as overlay (JS) / navigate (JS-off);
    // links crossing folders are plain navigations.
    const via = file.includes("/") || file.includes("\\") ? "link-nav" : "link-overlay";
    found.push({ index: m.index, from: telaId, to: resolveTarget(canvasDir, href), target: href, via });
  }
  for (const m of html.matchAll(MOCK_CALL_RE)) {
    const target = decodeEntities(m[2] ?? m[3] ?? "");
    if (!target) continue;
    found.push({ index: m.index, from: telaId, to: resolveTarget(canvasDir, target), target, via: `Mock.${m[1]}` });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const flows = [];
  for (const { index, ...edge } of found) {
    const key = `${edge.from}|${edge.to}|${edge.target}|${edge.via}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flows.push(edge);
  }
  return flows;
}

// ---- texts: literal strings on the screen -------------------------------

const COPY_ATTRS = ["placeholder", "aria-label", "alt", "title", "data-toast"];

function extractTexts(html) {
  const found = []; // { index, text }
  const code = stripCode(html);
  for (const m of code.matchAll(/<[^>]*>/g)) {
    for (const name of COPY_ATTRS) {
      const value = attrValue(m[0], name);
      if (value !== null && value.trim()) found.push({ index: m.index, text: value.replace(/\s+/g, " ").trim() });
    }
  }
  for (const m of code.matchAll(/<[^>]*>|[^<]+/g)) {
    if (m[0].startsWith("<")) continue;
    const text = decodeEntities(m[0]).replace(/\s+/g, " ").trim();
    if (text) found.push({ index: m.index, text });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const texts = [];
  for (const { text } of found) {
    if (seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
  }
  return texts;
}

// ---- rules: declared in markers or data.json ----------------------------

const RULE_MARKER_RE = /<!--[ \t]*rule:([^\r\n]*?)[ \t]*-->/g;
const REF_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\.json#([A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** Resolve {"$ref": "file.json#key"} values from <design-root>/data/ (the
 * todo 21 runtime semantics). Broken or circular refs stay as declared -
 * rules/data-ref.mjs owns their validation - so the export never throws. */
function resolveRefs(value, dataRoot, cache, chain) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, dataRoot, cache, chain));
  if (!isPlainObject(value)) return value;
  if ("$ref" in value) {
    const match = typeof value.$ref === "string" ? REF_RE.exec(value.$ref) : null;
    if (!match || Object.keys(value).length !== 1) return value;
    const ref = `${match[1]}.json#${match[2]}`;
    if (chain.includes(ref)) return value;
    const dataset = loadDataset(dataRoot, `${match[1]}.json`, cache);
    if (!dataset || !Object.prototype.hasOwnProperty.call(dataset, match[2])) return value;
    return resolveRefs(dataset[match[2]], dataRoot, cache, chain.concat(ref));
  }
  const out = {};
  for (const key of Object.keys(value)) out[key] = resolveRefs(value[key], dataRoot, cache, chain);
  return out;
}

function loadDataset(dataRoot, file, cache) {
  if (cache.has(file)) return cache.get(file);
  let dataset = null;
  try {
    const parsed = JSON.parse(readFileSync(join(dataRoot, file), "utf8"));
    dataset = isPlainObject(parsed) ? parsed : null;
  } catch {
    dataset = null;
  }
  cache.set(file, dataset);
  return dataset;
}

function extractRules(html, dataJson, dataRoot) {
  const rules = [];
  for (const m of html.matchAll(RULE_MARKER_RE)) {
    const text = m[1].trim();
    if (text) rules.push({ source: "marker", rule: text });
  }
  const scenarios = dataJson && isPlainObject(dataJson.scenarios) ? dataJson.scenarios : null;
  if (scenarios) {
    const cache = new Map();
    for (const name of Object.keys(scenarios)) {
      const overrides = scenarios[name];
      if (!isPlainObject(overrides)) continue; // mock.js only applies object overrides
      const resolved = {};
      for (const key of Object.keys(overrides)) resolved[key] = resolveRefs(overrides[key], dataRoot, cache, []);
      const keys = Object.keys(overrides);
      rules.push({
        source: "data.json",
        rule: `scenario ${JSON.stringify(name)} overrides: ${keys.length ? keys.join(", ") : "(nothing)"}`,
        scenario: name,
        overrides: resolved,
      });
    }
  }
  return rules;
}

// ---- parity: the D8 checklist rows --------------------------------------

function extractParity(html, registry) {
  const ids = [...new Set(parseAll(html, registry).map((region) => region.id))].sort();
  return ids.map((id) => {
    const real = registry[id]?.realComponent;
    const realComponent = typeof real === "string" && real.length > 0 ? real : null;
    return {
      component: id,
      realComponent,
      status: realComponent === null ? "unmapped" : "pending",
    };
  });
}

// ---- spec rendering -----------------------------------------------------

function renderMd(spec, info, states) {
  const lines = [];
  lines.push(`# ${info.name}`);
  lines.push("");
  lines.push(`- tela: \`${info.telaId}\` - canvas: \`${info.canvasRel}\` - file: \`${info.file}\``);
  lines.push("");
  lines.push("## states (declared)");
  lines.push("");
  for (const state of states) lines.push(`- \`${state.name}\` (${state.via})`);
  lines.push("");
  lines.push("## flows (data-go/data-overlay graph)");
  lines.push("");
  if (spec.flows.length === 0) {
    lines.push("(none)");
  } else {
    lines.push("| from | to | target | via |");
    lines.push("| --- | --- | --- | --- |");
    for (const edge of spec.flows) {
      lines.push(`| \`${edge.from}\` | ${edge.to === null ? "-" : `\`${edge.to}\``} | \`${edge.target}\` | ${edge.via} |`);
    }
  }
  lines.push("");
  lines.push("## texts (literal strings)");
  lines.push("");
  if (spec.texts.length === 0) {
    lines.push("(none)");
  } else {
    for (const text of spec.texts) lines.push(`- ${JSON.stringify(text)}`);
  }
  lines.push("");
  lines.push("## rules (declared in markers/data.json)");
  lines.push("");
  if (spec.rules.length === 0) {
    lines.push("(none)");
  } else {
    for (const rule of spec.rules) lines.push(`- (${rule.source}) ${rule.rule}`);
  }
  lines.push("");
  lines.push("## parity (D8 checklist)");
  lines.push("");
  if (spec.parity.length === 0) {
    lines.push("(none)");
  } else {
    lines.push("| mock component | realComponent | status |");
    lines.push("| --- | --- | --- |");
    for (const row of spec.parity) {
      lines.push(`| \`${row.component}\` | ${row.realComponent === null ? "-" : `\`${row.realComponent}\``} | ${row.status} |`);
    }
  }
  lines.push("");
  lines.push("status: `pending` = realComponent declared in the registry (the check against the real frontend is todo 23); `unmapped` = registry declares no realComponent.");
  lines.push("");
  return lines.join("\n");
}

// ---- main ---------------------------------------------------------------

function parseArgs(argv) {
  let design = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--design") {
      if (i + 1 >= argv.length) fail(`--design requires a path - ${usage}`);
      if (design !== null) fail(`--design given twice - ${usage}`);
      design = argv[i + 1];
      i += 1;
    } else {
      fail(`unknown argument "${arg}" - ${usage}`);
    }
  }
  if (design === null) fail(`missing --design <design-root> - ${usage}`);
  return resolve(design);
}

function main(argv) {
  const root = parseArgs(argv);
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`design root not found or not a directory: ${root}`);
  const canvases = discoverCanvases(root);
  if (canvases.length === 0) fail(`no canvas.json found under ${root}`);
  // Canvas mode (the root itself is a canvas): data/ and components/ live one
  // level up at the design root (same semantics as mock.js MOCK_BASE and
  // rules/data-ref.mjs); project mode: the root IS the design root.
  const designRoot = canvases.some((canvas) => canvas.dir === root) ? dirname(root) : root;
  const registry = loadRegistry(designRoot);

  // Screen roster: structural problems are usage-level (exit 2).
  const byPath = new Map(); // absolute screen file -> telaId
  const seenIds = new Set();
  const screens = [];
  for (const canvas of canvases) {
    for (const [index, entry] of canvas.manifest.screens.entries()) {
      const label = `${join(canvas.relDir, "canvas.json")} screen #${index + 1}`;
      if (!isPlainObject(entry)) fail(`${label}: screen entry must be an object`);
      const id = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : null;
      const file = typeof entry.file === "string" && entry.file.length > 0 ? entry.file : null;
      if (id === null || file === null) fail(`${label}: screen entry needs non-empty "id" and "file"`);
      if (seenIds.has(id)) fail(`${label}: duplicate screen id "${id}" - spec/<telaId>.md must be unique`);
      seenIds.add(id);
      const absFile = resolve(canvas.dir, file);
      byPath.set(absFile, id);
      screens.push({
        telaId: id,
        name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : id,
        canvasDir: canvas.dir,
        canvasRel: canvas.relDir,
        file,
        absFile,
      });
    }
  }

  const resolveTarget = (canvasDir, target) => {
    const file = String(target).split(/[?#]/)[0];
    if (!file) return null;
    return byPath.get(resolve(canvasDir, file)) ?? null;
  };

  const problems = [];
  const specs = [];
  for (const screen of screens) {
    const screenLabel = `tela "${screen.telaId}" (${join(screen.canvasRel, screen.file)})`;
    let html = null;
    try {
      html = readFileSync(screen.absFile, "utf8");
    } catch (error) {
      problems.push(`spec-unreadable: ${screenLabel}: cannot read screen file (${String(error.message)})`);
      continue;
    }
    let dataJson = null;
    const dataPath = join(screen.canvasDir, "data.json");
    if (existsSync(dataPath)) {
      try {
        dataJson = JSON.parse(readFileSync(dataPath, "utf8"));
      } catch (error) {
        problems.push(`spec-data: ${screenLabel}: invalid JSON in ${join(screen.canvasRel, "data.json")} (${String(error.message)})`);
        continue;
      }
    }
    let parity = null;
    try {
      parity = extractParity(html, registry);
    } catch (error) {
      if (error instanceof MarkerError) {
        problems.push(`spec-marker: ${screenLabel}: ${error.message}`);
        continue;
      }
      throw error;
    }
    const states = extractStates(html, screenLabel, problems);
    if (states.length === 0) {
      problems.push(`spec-undeclared: ${screenLabel}: declares no screen state - declare >=1 via <!-- state:nome --> or a hash shortcut href="#nome"`);
    }
    specs.push({
      screen,
      states,
      spec: {
        states: states.map((s) => s.name),
        flows: extractFlows(html, screen.telaId, screen.canvasDir, resolveTarget),
        texts: extractTexts(html),
        rules: extractRules(html, dataJson, join(designRoot, "data")),
        parity,
      },
    });
  }

  if (problems.length > 0) {
    for (const line of problems) process.stderr.write(`export-spec: ${line}\n`);
    return 1;
  }

  const specDir = join(designRoot, "spec");
  mkdirSync(specDir, { recursive: true });
  for (const { screen, states, spec } of specs) {
    const info = {
      telaId: screen.telaId,
      name: screen.name,
      canvasRel: screen.canvasRel,
      file: screen.file,
    };
    writeFileSync(join(specDir, `${screen.telaId}.json`), `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    writeFileSync(join(specDir, `${screen.telaId}.md`), renderMd(spec, info, states), "utf8");
  }
  process.stdout.write(`export-spec: wrote ${specs.length} screens (states/flows/texts/rules/parity) to ${specDir}\n`);
  return 0;
}

// CLI entry point - guarded so rules/spec-undeclared.mjs can import
// detectScreenStates without running the export (import-safe module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)) ?? 0);
}
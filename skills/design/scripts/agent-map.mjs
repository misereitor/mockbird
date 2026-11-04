#!/usr/bin/env node
/**
 * agent-map.mjs — the agent map generator (plan todo 6, GAP-J1/J2).
 *
 * For a target design root (`--target design/`) writes `<target>/agent-map.json`
 * + `<target>/agent-map.md` with EXACTLY four sections, every fact derived from
 * the target's files (nothing hand-curated that can drift):
 *
 *   (i)   per-screen inventory — elements carrying data-cta/data-action/
 *         data-go/data-overlay/data-toast/data-close, components used (the
 *         `<!-- component:… -->` markers), svg icons used (svg paths) and
 *         declared states, EVERY item cited as { file, line };
 *   (ii)  the runtime verb table (data-go/data-overlay/data-toast/data-close/
 *         data-action, Mock.state/flash, the actions/<stem>.js loader)
 *         DERIVED from mock.js and verified against its source by
 *         `--check-verbs` (table × code, bidirectional);
 *   (iii) the contracts index (tokens, icon conventions = taste SKILL.md §3.C
 *         + the icon slots of marker-parser.mjs's registry, breakpoints,
 *         partials);
 *   (iv)  "contratos mortos": data-action without its actions/<stem>.js,
 *         links to missing screens, orphan partials, divergent icons.
 *
 * Screen discovery follows the export-spec.mjs convention: a root canvas.json
 * makes the target itself the canvas, otherwise every canvas.json below it
 * (infra folders skipped). The design root — where actions/, components/ and
 * tokens.json live — is the target root itself in project mode (the plan's
 * `--target design/`) and one level up in canvas mode (same semantics as
 * mock.js MOCK_BASE and export-spec.mjs).
 *
 * The verb source is `<design-root>/mock.js` when the target ships its own
 * runtime, else the pack's skills/design/assets/mock.js. `--check-verbs` compares the
 * VERB_SPEC table against that source and fails (exit 1) naming the divergent
 * verb; it never touches the target.
 *
 * Output is DETERMINISTIC: fixed key order, sorted screens, document-order
 * citations, and a derived stamp { schemaVersion, gitSHA, contentHash,
 * timestamp } — timestamp is the git committer date of the target's HEAD (or
 * the newest scanned mtime), never the wall clock, so re-running on an
 * unchanged target is byte-identical. contentHash is the sha256 of the map
 * content without the stamp.
 *
 * Pack mode (plan todo 7): `--screen <tela> --pack` writes ONE self-contained
 * context pack per screen to `<target>/.map/<tela>.md` (telaId = the screen id
 * of canvas.json) — everything an agent needs to edit that screen in a single
 * read: data-* elements (selector/attribute/file:line, every occurrence),
 * declared actions × the actions/<stem>.js modules that exist (exact
 * registered handlers), components + marker args, svg icons, tokens touched
 * (literal var(--…) plus classes resolved through the stylesheets the screen
 * links), the DEC decisions that govern the screen (design/decisions.json,
 * todo 18 — the section ALWAYS exists; before todo 18 it declares "sem
 * decisões registradas"), open 🎯 comments (comments.json), baselines + last
 * smoke result (design/.visual/ + snapshots/ — graceful placeholders when
 * absent) and the screen's dead-contract warnings. An empty section is always
 * DECLARED, never omitted, and a screen with zero data-* elements says so
 * loudly (a pack must never read as "green-complete" for an empty screen).
 * The pack carries the same deterministic stamp as the map.
 *
 * Exit codes: 0 map written / pack written / check-verbs coherent (dead
 * contracts are REPORTED, never fatal), 1 verb table diverges from mock.js, 2
 * usage or structural input error (missing target, no canvas.json, a
 * canvas.json with zero screens, invalid JSON, unreadable screen, unknown or
 * ambiguous --screen, --pack without --screen).
 * Node 18+, stdlib only, zero deps.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectScreenStates } from "./export-spec.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const PACK_MOCK = join(SCRIPT_DIR, "..", "assets", "mock.js");
const PACK_CONFIG = join(SCRIPT_DIR, "..", "assets", "validate.config.json");
const PACK_MARKER_PARSER = join(SCRIPT_DIR, "marker-parser.mjs");
const PACK_TASTE = join(PACK_ROOT, "skills", "taste", "SKILL.md");

const usage =
  "usage: agent-map.mjs [--target <design-root>] [--check-verbs] [--help] | " +
  "[--target <design-root>] --screen <tela> --pack";

function fail(message) {
  process.stderr.write(`agent-map: ${message}\n`);
  process.exit(2);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Design root = where the runtime and the payload live (export-spec semantics:
 *  canvas mode (root canvas.json) keeps them one level up). */
function designRootOf(targetRoot) {
  return existsSync(join(targetRoot, "canvas.json")) ? dirname(targetRoot) : targetRoot;
}

function packLabel(full) {
  return relative(PACK_ROOT, full).split("\\").join("/");
}

// ---- verb table (todo 6 ii) ---------------------------------------------

/**
 * The closed action vocabulary (SKILL.md "Ações e acessibilidade" §3 — one
 * click router, no third mechanism). `evidence` pins the constructs that MUST
 * stay in mock.js: `--check-verbs` fails naming the verb when any pattern
 * stops matching, and cross-checks the router selector against the table in
 * BOTH directions, so corrupting either side is detected.
 */
export const VERB_SPEC = Object.freeze([
  Object.freeze({
    verb: "data-go",
    kind: "attr",
    evidence: Object.freeze([/target\.hasAttribute\('data-go'\)/, /window\.Mock\.go\(/]),
  }),
  Object.freeze({
    verb: "data-overlay",
    kind: "attr",
    evidence: Object.freeze([/target\.hasAttribute\('data-overlay'\)/, /window\.Mock\.overlay\(/]),
  }),
  Object.freeze({
    verb: "data-toast",
    kind: "attr",
    evidence: Object.freeze([/target\.hasAttribute\('data-toast'\)/, /window\.Mock\.toast\(/]),
  }),
  Object.freeze({
    verb: "data-close",
    kind: "attr",
    evidence: Object.freeze([/target\.hasAttribute\('data-close'\)/, /window\.Mock\.close\(/]),
  }),
  Object.freeze({
    verb: "data-action",
    kind: "attr",
    evidence: Object.freeze([/target\.hasAttribute\('data-action'\)/, /\brunAction\(/, /\bregisterActions\(/]),
  }),
  Object.freeze({
    verb: "Mock.state/flash",
    kind: "api",
    evidence: Object.freeze([/\bstate:\s*\{/, /\bget\(key\)/, /\bset\(key, value\)/, /\bclear\(\)/, /\btoast\(message/]),
  }),
  Object.freeze({
    verb: "actions/<stem>.js",
    kind: "loader",
    evidence: Object.freeze([/'actions\/' \+ id \+ '\.js'/, /\bloadActions\(/, /\bregisterActions\(/]),
  }),
]);

/** The click router's `event.target.closest('[data-…]')` selector, as a set. */
function routerSelector(source) {
  const m = /event\.target\.closest\('(\[[^\]]+\](?:\s*,\s*\[[^\]]+\])*)'\)/.exec(source);
  if (m === null) return null;
  const out = new Set();
  for (const attr of m[1].matchAll(/\[data-([a-z-]+)\]/g)) out.add(`data-${attr[1]}`);
  return out;
}

/** Derives the verb table rows (runs text + file:line) from the mock.js source. */
export function deriveVerbTable(source, label) {
  const offsets = lineIndex(source);
  const rows = [];
  for (const spec of VERB_SPEC) {
    if (spec.kind === "attr") {
      const hit = new RegExp(`target\\.hasAttribute\\('${spec.verb}'\\)`).exec(source);
      const call = hit
        ? /\b(?:window\.Mock\.[A-Za-z]+|runAction)\([^;\n]*\)/.exec(source.slice(hit.index, hit.index + 300))
        : null;
      rows.push({
        verb: spec.verb,
        kind: spec.kind,
        runs: call ? call[0] : null,
        source: hit ? `${label}:${lineOf(offsets, hit.index)}` : null,
      });
    } else if (spec.kind === "api") {
      const hit = /\bstate:\s*\{/.exec(source);
      const block = hit ? source.slice(hit.index, hit.index + 1500) : "";
      const methods = ["get", "set", "clear"].filter((name) => new RegExp(`\\b${name}\\(`).test(block));
      const toast = /\btoast\(([^)]*)\)/.exec(source);
      rows.push({
        verb: spec.verb,
        kind: spec.kind,
        runs: `Mock.state.${methods.join("/") || "?"}` + (toast ? ` · Mock.toast(${toast[1]})` : ""),
        source: hit ? `${label}:${lineOf(offsets, hit.index)}` : null,
      });
    } else {
      const hit = /new URL\('actions\/' \+ id \+ '\.js'[^)]*\)|'actions\/' \+ id \+ '\.js'/.exec(source);
      rows.push({
        verb: spec.verb,
        kind: spec.kind,
        runs: hit ? `Mock.loadActions(id) → ${hit[0]}` : null,
        source: hit ? `${label}:${lineOf(offsets, hit.index)}` : null,
      });
    }
  }
  return rows;
}

/**
 * Sync test: VERB_SPEC table × mock.js source. Returns problem lines (empty =
 * coherent). Every failure names the divergent verb.
 */
export function checkVerbs(source, label) {
  const problems = [];
  for (const spec of VERB_SPEC) {
    for (const pattern of spec.evidence) {
      if (!pattern.test(source)) {
        problems.push(
          `verb "${spec.verb}": expected ${String(pattern)} in ${label} — ` +
            `verb table diverges from the runtime source`,
        );
        break;
      }
    }
  }
  const selector = routerSelector(source);
  if (selector === null) {
    problems.push(`click router selector [data-…] not found in ${label} — cannot cross-check the verb table`);
    return problems;
  }
  const tableAttrs = new Set(VERB_SPEC.filter((spec) => spec.kind === "attr").map((spec) => spec.verb));
  for (const attr of selector) {
    if (!tableAttrs.has(attr)) {
      problems.push(
        `verb "${attr}": dispatched by ${label}'s click router but NOT declared in the verb table — ` +
          `verb table diverges from the runtime source`,
      );
    }
  }
  for (const attr of tableAttrs) {
    if (!selector.has(attr)) {
      problems.push(
        `verb "${attr}": declared in the verb table but NOT dispatched by ${label}'s click router — ` +
          `verb table diverges from the runtime source`,
      );
    }
  }
  return problems;
}

// ---- discovery (same semantics as export-spec.mjs) ----------------------

// Infra folders that can never hold canvases (snapshots/ embeds frozen canvas
// copies - walking them would double every screen).
const SKIP_DIRS = new Set(["node_modules", ".history", "snapshots", "vendor", "scripts", "spec"]);

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

export function discoverCanvases(root) {
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

// ---- extraction helpers (length-preserving mask; house scanner contract) -

/**
 * Comments and <script>/<style> bodies hold code or notes, not markup: blank
 * them with SPACES (length-preserving) so every index below maps 1:1 onto the
 * raw source and line numbers stay true. Script strings can never masquerade
 * as markup (the same contract as rules/action-contract.mjs).
 */
function maskCode(html) {
  return html.replace(
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,
    (match) => " ".repeat(match.length),
  );
}

function lineIndex(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") offsets.push(i + 1);
  return offsets;
}

function lineOf(offsets, index) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function attrValue(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(tag);
  return m ? m[1] ?? m[2] ?? "" : null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

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

function normalizeLabel(text) {
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, 60);
}

// ---- (i) per-screen inventory ------------------------------------------

const SCAN_ATTRS = ["data-cta", "data-action", "data-go", "data-overlay", "data-toast", "data-close"];
const TAG_RE = /<[a-zA-Z][^>]*>/g;
const COMPONENT_MARKER_RE = /<!--[ \t]*component:([^\s>]+)([^>]*?)-->/g;

function scanScreen(html, relFile) {
  const offsets = lineIndex(html);
  const masked = maskCode(html);
  const cite = (index) => ({ file: relFile, line: lineOf(offsets, index) });

  const elements = [];
  for (const m of masked.matchAll(TAG_RE)) {
    const tag = m[0];
    const tagName = /^<([a-zA-Z][\w-]*)/.exec(tag)[1];
    for (const [order, attr] of SCAN_ATTRS.entries()) {
      if (!new RegExp(`\\b${attr}\\b(?![\\w-])`).test(tag)) continue;
      elements.push({
        attr,
        value: attrValue(tag, attr) ?? "",
        tag: tagName,
        order,
        ...cite(m.index),
      });
    }
  }
  elements.sort((a, b) => a.line - b.line || a.order - b.order);
  for (const item of elements) delete item.order;

  const components = [];
  for (const m of html.matchAll(COMPONENT_MARKER_RE)) {
    const args = {};
    for (const arg of m[2].matchAll(/\b(size|tone|state)=([^\s>]+)/g)) args[arg[1]] = arg[2];
    components.push({
      id: m[1],
      size: args.size ?? null,
      tone: args.tone ?? null,
      state: args.state ?? null,
      ...cite(m.index),
    });
  }
  components.sort((a, b) => a.line - b.line);

  const icons = [];
  for (const m of masked.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    const startTag = /^<svg\b[^>]*>/i.exec(m[0])[0];
    const paths = [...m[0].matchAll(/<path\b[^>]*>/gi)]
      .map((p) => attrValue(p[0], "d"))
      .filter((d) => typeof d === "string" && d.length > 0);
    const viewBox = attrValue(startTag, "viewBox");
    const labelAfter = normalizeLabel(masked.slice(m.index + m[0].length).split("<")[0]);
    const name =
      attrValue(startTag, "data-icon") ||
      attrValue(startTag, "aria-label") ||
      ((/\bicon-([a-z0-9_-]+)\b/i.exec(attrValue(startTag, "class") ?? "") ?? [])[1] ?? null) ||
      labelAfter ||
      null;
    icons.push({
      name: name ? name.toLowerCase() : null,
      viewBox,
      paths,
      signature: createHash("sha256").update(JSON.stringify([viewBox, paths])).digest("hex").slice(0, 12),
      ...cite(m.index),
    });
  }
  icons.sort((a, b) => a.line - b.line);

  // Declared states come from THE state detection (export-spec.mjs, shared by
  // import); the scans below only position the first occurrence for citation.
  const { states: detected } = detectScreenStates(html);
  const states = detected.map(({ name, via }) => {
    let index = null;
    if (via === "marker") {
      for (const m of html.matchAll(/<!--[ \t]*state:([^\r\n]*?)[ \t]*-->/g)) {
        if (m[1].trim() === name) {
          index = m.index;
          break;
        }
      }
    } else {
      for (const m of masked.matchAll(/<a\b[^>]*>/gi)) {
        if (attrValue(m[0], "href") === `#${name}`) {
          index = m.index;
          break;
        }
      }
    }
    return { name, via, ...(index === null ? { file: relFile, line: null } : cite(index)) };
  });
  states.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  return { elements, components, icons, states };
}

// ---- (iv) contratos mortos ---------------------------------------------

const HTML_TARGET_RE = /\.html?$/i;
const EXTERNAL_RE = /^[a-z][a-z0-9+.-]*:/i;

function resolveScreenTarget(screenAbs, targetRoot, value) {
  const file = String(value).split(/[?#]/)[0];
  if (!file) return null;
  if (EXTERNAL_RE.test(file) || file.startsWith("//")) return null;
  if (!HTML_TARGET_RE.test(file)) return null;
  return file.startsWith("/") ? join(targetRoot, file.slice(1)) : resolve(dirname(screenAbs), file);
}

function collectDeadContracts(designRoot, targetRoot, canvases, screens) {
  const actionWithoutModule = [];
  const missingScreenLinks = [];
  const orphanPartials = [];
  const divergentIcons = [];

  const iconGroups = new Map(); // name -> [{ signature, file, line }]
  const usedPartials = new Set();
  const seenLinks = new Set();

  for (const screen of screens) {
    for (const item of screen.inventory.components) usedPartials.add(item.id);
    for (const item of screen.inventory.icons) {
      if (!item.name) continue; // an unnamed icon cannot be compared
      const group = iconGroups.get(item.name) ?? [];
      group.push({ signature: item.signature, file: item.file, line: item.line });
      iconGroups.set(item.name, group);
    }
    if (screen.html === null) continue; // missing file: already flagged below
    const masked = maskCode(screen.html);

    for (const item of screen.inventory.elements) {
      if (item.attr === "data-action") {
        const namespace = item.value.includes(".") ? item.value.split(".")[0] : item.value;
        const module = `actions/${namespace}.js`;
        if (!existsSync(join(designRoot, module))) {
          actionWithoutModule.push({ value: item.value, module, file: item.file, line: item.line });
        }
      }
      if (item.attr === "data-go" || item.attr === "data-overlay") {
        const abs = resolveScreenTarget(screen.abs, targetRoot, item.value);
        if (abs && !existsSync(abs)) {
          missingScreenLinks.push({ via: item.attr, target: item.value, file: item.file, line: item.line });
        }
      }
    }

    for (const m of masked.matchAll(/<a\b[^>]*>/gi)) {
      const href = attrValue(m[0], "href");
      if (href === null) continue;
      const abs = resolveScreenTarget(screen.abs, targetRoot, href);
      if (!abs) continue;
      const key = `${screen.rel}:${lineOf(screen.offsets, m.index)}:${href}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      if (!existsSync(abs)) {
        missingScreenLinks.push({
          via: "a[href]",
          target: href,
          file: screen.rel,
          line: lineOf(screen.offsets, m.index),
        });
      }
    }
    for (const m of masked.matchAll(/<[^>]*\bdata-component\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
      const id = m[1] ?? m[2] ?? "";
      if (id) usedPartials.add(id);
    }
  }

  // Screens listed by a canvas.json whose file is missing on disk.
  for (const canvas of canvases) {
    const manifestRel = canvas.relDir === "." ? "canvas.json" : `${canvas.relDir}/canvas.json`;
    const manifestRaw = readFileSync(join(canvas.dir, "canvas.json"), "utf8");
    const offsets = lineIndex(manifestRaw);
    for (const entry of canvas.manifest.screens) {
      const abs = resolve(canvas.dir, entry.file);
      if (existsSync(abs)) continue;
      const escaped = entry.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hit = new RegExp(`"file"\\s*:\\s*"${escaped}"`).exec(manifestRaw);
      missingScreenLinks.push({
        via: "canvas.json",
        target: entry.file,
        file: manifestRel,
        line: hit ? lineOf(offsets, hit.index) : 1,
      });
    }
  }

  // Orphan partials: a template under components/ that NOTHING references —
  // neither the registry (components/components.json, the declared universe)
  // nor any screen (marker or data-component). Registry templates are the
  // shipped library; a template outside both references is a leftover.
  const referencedTemplates = new Set();
  for (const id of usedPartials) referencedTemplates.add(`${id}.html`);
  const registryPath = join(designRoot, "components", "components.json");
  if (existsSync(registryPath)) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      for (const entry of Object.values(registry)) {
        if (!isPlainObject(entry)) continue;
        if (typeof entry.template === "string") referencedTemplates.add(entry.template);
        if (typeof entry.name === "string") referencedTemplates.add(`${entry.name}.html`);
      }
    } catch {
      /* unparseable registry: validate.mjs reports it; orphans fall back to usage */
    }
  }
  const partialsDir = join(designRoot, "components");
  if (existsSync(partialsDir)) {
    for (const name of readdirSync(partialsDir).sort()) {
      if (!name.endsWith(".html")) continue;
      const id = name.replace(/\.html$/i, "");
      if (!referencedTemplates.has(name)) {
        orphanPartials.push({ id, file: `components/${name}`, line: 1 });
      }
    }
  }

  for (const [name, group] of [...iconGroups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const signatures = new Set(group.map((variant) => variant.signature));
    if (signatures.size > 1) {
      divergentIcons.push({ name, variants: group.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) });
    }
  }

  const byLine = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
  actionWithoutModule.sort(byLine);
  missingScreenLinks.sort(byLine);
  orphanPartials.sort(byLine);
  return { actionWithoutModule, missingScreenLinks, orphanPartials, divergentIcons };
}

// ---- (iii) contracts index ---------------------------------------------

function collectContracts(designRoot) {
  // tokens: the target's tokens.json (themes/groups/leaf count).
  let tokens = null;
  const tokensPath = join(designRoot, "tokens.json");
  if (existsSync(tokensPath)) {
    tokens = { file: "tokens.json", line: 1, themes: [], groups: [], count: 0 };
    try {
      const doc = JSON.parse(readFileSync(tokensPath, "utf8"));
      const groups = new Set();
      const walk = (node, depth) => {
        if (!isPlainObject(node)) return;
        if (Object.prototype.hasOwnProperty.call(node, "$value")) {
          tokens.count += 1;
          return;
        }
        for (const [key, value] of Object.entries(node)) {
          if (key.startsWith("$")) continue;
          if (depth === 1) groups.add(key);
          walk(value, depth + 1);
        }
      };
      for (const [theme, body] of Object.entries(doc)) {
        if (theme.startsWith("$") || !isPlainObject(body)) continue;
        tokens.themes.push(theme);
        walk(body, 1);
      }
      tokens.themes.sort();
      tokens.groups = [...groups].sort();
    } catch (error) {
      tokens = { file: "tokens.json", line: 1, error: String(error.message) };
    }
  }

  // icon conventions: taste SKILL.md §3.C (heading line derived at generation)
  // + the icon slots of the marker registry (marker-parser.mjs, line-derived).
  let conventionLine = null;
  try {
    const taste = readFileSync(PACK_TASTE, "utf8");
    const hit = /^### 3\.C Icons/m.exec(taste);
    conventionLine = hit ? lineOf(lineIndex(taste), hit.index) : null;
  } catch {
    conventionLine = null;
  }
  const iconSlots = [];
  try {
    const parser = readFileSync(PACK_MARKER_PARSER, "utf8");
    let lastName = null;
    parser.split("\n").forEach((line, index) => {
      const name = /name:\s*"([a-z0-9_-]+)"/.exec(line);
      if (name) lastName = name[1];
      if (/slots:/.test(line) && /"icon"/.test(line) && lastName) {
        iconSlots.push({ component: lastName, file: packLabel(PACK_MARKER_PARSER), line: index + 1 });
      }
    });
  } catch {
    /* missing parser: the index reports no slots */
  }

  // breakpoints: the design root's validate.config.json, else the pack default.
  let breakpoints = null;
  for (const [path, label, note] of [
    [join(designRoot, "validate.config.json"), "validate.config.json", null],
    [PACK_CONFIG, packLabel(PACK_CONFIG), "default do pack (alvo sem validate.config.json)"],
  ]) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const config = JSON.parse(raw);
      const declared = config.canvasMeta?.breakpoints ?? null;
      const hit = /"breakpoints"/.exec(raw);
      breakpoints = {
        file: label,
        line: hit ? lineOf(lineIndex(raw), hit.index) : 1,
        mobileMax: declared?.mobileMax ?? null,
        tabletMax: declared?.tabletMax ?? null,
        note,
      };
    } catch (error) {
      breakpoints = { file: label, line: 1, error: String(error.message), note };
    }
    break;
  }

  // partials: the registry templates of the design root.
  const partials = [];
  const partialsDir = join(designRoot, "components");
  if (existsSync(partialsDir)) {
    for (const name of readdirSync(partialsDir).sort()) {
      if (name.endsWith(".html")) partials.push({ id: name.replace(/\.html$/i, ""), file: `components/${name}`, line: 1 });
    }
  }

  return {
    tokens,
    icons: {
      convention: { file: packLabel(PACK_TASTE), line: conventionLine, section: "3.C" },
      iconSlots,
    },
    breakpoints,
    partials,
  };
}

// ---- map assembly + rendering ------------------------------------------

function buildContent(targetLabel, canvases, screens, verbs, contracts, deadContracts) {
  return {
    target: targetLabel,
    canvases: canvases.map((canvas) => ({
      dir: canvas.relDir,
      title: canvas.manifest.title ?? null,
      screens: canvas.manifest.screens.length,
    })),
    screens: screens.map((screen) => ({
      id: screen.id,
      name: screen.name,
      canvas: screen.canvasRel,
      file: screen.rel,
      elements: screen.inventory.elements,
      components: screen.inventory.components,
      icons: screen.inventory.icons,
      states: screen.inventory.states,
    })),
    verbs,
    contracts,
    deadContracts,
  };
}

function stampFor(targetRoot, content, mtimeMs) {
  const gitSHA = gitOutput(targetRoot, ["rev-parse", "HEAD"]);
  const committed = gitOutput(targetRoot, ["log", "-1", "--format=%cI"]);
  const timestamp =
    committed ??
    (Number.isFinite(mtimeMs) ? new Date(mtimeMs).toISOString() : "1970-01-01T00:00:00.000Z");
  const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return { schemaVersion: 1, gitSHA, contentHash, timestamp };
}

function gitOutput(targetRoot, args) {
  try {
    return execFileSync("git", ["-C", targetRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function renderMd(content, stamp) {
  const lines = [];
  lines.push(`# Agent map — ${content.target}`);
  lines.push("");
  lines.push("> GERADO por `skills/design/scripts/agent-map.mjs` — não editar à mão; regenere com `/design-map`.");
  lines.push(
    `> schemaVersion ${stamp.schemaVersion} · gitSHA ${stamp.gitSHA ?? "n/a"} · contentHash ${stamp.contentHash} · timestamp ${stamp.timestamp}`,
  );
  lines.push("");

  lines.push("## (i) Inventário por tela");
  lines.push("");
  for (const screen of content.screens) {
    lines.push(`### ${screen.file} — \`${screen.id}\` (canvas ${screen.canvas})`);
    const states = screen.states.map((s) => `\`${s.name}\` (${s.file}:${s.line ?? "?"})`).join(", ");
    lines.push(`- estados declarados: ${states || "nenhum"}`);
    const components = screen.components
      .map((c) => `\`${c.id}\` size=${c.size ?? "?"} tone=${c.tone ?? "?"} state=${c.state ?? "?"} (${c.file}:${c.line})`)
      .join("; ");
    lines.push(`- componentes: ${components || "nenhum"}`);
    const icons = screen.icons
      .map((i) => `${i.name ? `\`${i.name}\` ` : ""}viewBox=${i.viewBox ?? "?"} paths=${i.paths.length} (${i.file}:${i.line})`)
      .join("; ");
    lines.push(`- ícones (svg): ${icons || "nenhum"}`);
    const elements = screen.elements.map((e) => `${e.tag} ${e.attr}=${JSON.stringify(e.value)} (${e.file}:${e.line})`).join("; ");
    lines.push(`- elementos data-*: ${elements || "nenhum"}`);
    lines.push("");
  }

  lines.push("## (ii) Verbos do runtime (derivado de mock.js; verificado por --check-verbs)");
  lines.push("");
  lines.push("| verbo | executa | fonte |");
  lines.push("| --- | --- | --- |");
  for (const row of content.verbs) {
    lines.push(`| \`${row.verb}\` | ${row.runs ? `\`${row.runs}\`` : "AUSENTE"} | ${row.source ?? "AUSENTE"} |`);
  }
  lines.push("");

  lines.push("## (iii) Índice de contratos");
  lines.push("");
  const tokens = content.contracts.tokens;
  lines.push(
    tokens
      ? `- tokens: ${tokens.file}:${tokens.line} — temas [${(tokens.themes ?? []).join(", ")}], grupos [${(tokens.groups ?? []).join(", ")}], ${tokens.count} tokens${tokens.error ? ` (ERRO: ${tokens.error})` : ""}`
      : "- tokens: nenhum tokens.json no alvo",
  );
  const convention = content.contracts.icons.convention;
  const slots = content.contracts.icons.iconSlots
    .map((s) => `${s.file}:${s.line} (${s.component})`)
    .join(", ");
  lines.push(
    `- convenções de ícones: ${convention.file}:${convention.line ?? "?"} §${convention.section}` +
      (slots ? ` + slots de ícone em ${slots}` : ""),
  );
  const bp = content.contracts.breakpoints;
  lines.push(
    bp
      ? `- breakpoints: ${bp.file}:${bp.line} — mobileMax ${bp.mobileMax}, tabletMax ${bp.tabletMax}${bp.note ? ` (${bp.note})` : ""}${bp.error ? ` (ERRO: ${bp.error})` : ""}`
      : "- breakpoints: não declarados",
  );
  const partials = content.contracts.partials.map((p) => `\`${p.id}\` (${p.file})`).join(", ");
  lines.push(`- partials: ${partials || "nenhum"}`);
  lines.push("");

  lines.push("## (iv) Contratos mortos");
  lines.push("");
  const dead = content.deadContracts;
  const total =
    dead.actionWithoutModule.length + dead.missingScreenLinks.length + dead.orphanPartials.length + dead.divergentIcons.length;
  lines.push(total === 0 ? "SEM CONTRATOS MORTOS — 4/4 verificações limpas." : `${total} contrato(s) morto(s) listado(s) abaixo.`);
  lines.push("");
  lines.push("### data-action sem actions/<stem>.js");
  lines.push("");
  if (dead.actionWithoutModule.length === 0) lines.push("- nenhum");
  for (const item of dead.actionWithoutModule) {
    lines.push(`- ${item.file}:${item.line} — data-action=${JSON.stringify(item.value)} sem \`${item.module}\``);
  }
  lines.push("");
  lines.push("### links para telas inexistentes");
  lines.push("");
  if (dead.missingScreenLinks.length === 0) lines.push("- nenhum");
  for (const item of dead.missingScreenLinks) {
    lines.push(`- ${item.file}:${item.line} — ${item.via} → \`${item.target}\``);
  }
  lines.push("");
  lines.push("### parciais órfãos");
  lines.push("");
  if (dead.orphanPartials.length === 0) lines.push("- nenhum");
  for (const item of dead.orphanPartials) {
    lines.push(`- ${item.file}:${item.line} — \`${item.id}\` sem referência em components.json nem em telas`);
  }
  lines.push("");
  lines.push("### ícones divergentes entre telas");
  lines.push("");
  if (dead.divergentIcons.length === 0) lines.push("- nenhum");
  for (const item of dead.divergentIcons) {
    lines.push(`- \`${item.name}\` — ${item.variants.length} variantes:`);
    for (const variant of item.variants) {
      lines.push(`  - ${variant.file}:${variant.line} (assinatura ${variant.signature})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ---- (v) per-screen context pack (todo 7) ------------------------------

const ACTION_VERBS = ["data-action", "data-go", "data-overlay", "data-toast", "data-close"];

function normPath(value) {
  return String(value).split("\\").join("/");
}

function selectorFor(tag, tagName) {
  const id = attrValue(tag, "id");
  if (id) return `#${id}`;
  const classes = (attrValue(tag, "class") ?? "").trim().split(/\s+/).filter(Boolean);
  return tagName + classes.map((name) => `.${name}`).join("");
}

/**
 * Every data-* ATTRIBUTE OCCURRENCE of the screen's markup, cited at the
 * attribute's own line so each row matches `grep -n` on the raw file. Comment
 * and script/style bodies are masked (code can never masquerade as markup) and
 * quoted attribute values are blanked per tag so a value like "data-go" can
 * never fake an attribute name (values are read back from the raw tag).
 */
function scanDataAttributes(html, relFile) {
  const offsets = lineIndex(html);
  const masked = maskCode(html);
  const rows = [];
  for (const m of masked.matchAll(TAG_RE)) {
    const tag = m[0];
    const tagName = /^<([a-zA-Z][\w-]*)/.exec(tag)[1];
    const names = tag.replace(
      /"[^"]*"|'[^']*'/g,
      (quoted) => quoted[0] + " ".repeat(quoted.length - 2) + quoted[quoted.length - 1],
    );
    for (const a of names.matchAll(/\bdata-[a-z0-9_-]+/gi)) {
      rows.push({
        selector: selectorFor(tag, tagName),
        attr: a[0],
        value: attrValue(tag, a[0]) ?? "",
        file: relFile,
        line: lineOf(offsets, m.index + a.index),
      });
    }
  }
  rows.sort((a, b) => a.line - b.line || (a.attr < b.attr ? -1 : a.attr > b.attr ? 1 : 0));
  return rows;
}

/** Length-preserving JS mask: comment and string bodies become spaces (quotes
 *  kept) so brace matching is honest and raw offsets stay 1:1. */
function jsMask(source) {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    (match) => " ".repeat(match.length),
  );
}

function matchBrace(masked, openAt) {
  let depth = 0;
  for (let i = openAt; i < masked.length; i += 1) {
    if (masked[i] === "{") depth += 1;
    else if (masked[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level keys of the object literal [objStart, objEnd] — depth tracked on
 *  the masked text (string braces cannot break it), key text read back from the
 *  raw source at the same offsets. */
function topLevelKeys(masked, raw, objStart, objEnd) {
  const keys = [];
  let depth = 0;
  let expectKey = false;
  for (let i = objStart; i < objEnd; i += 1) {
    const ch = masked[i];
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
      if (depth === 1 && ch === "{") expectKey = true;
    } else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
    } else if (ch === "," && depth === 1) {
      expectKey = true;
    } else if (expectKey && !/\s/.test(ch)) {
      expectKey = false;
      const key = /^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))/.exec(raw.slice(i, i + 200));
      if (key) {
        keys.push(key[1] ?? key[2] ?? key[3]);
        i += key[0].length - 1;
      }
    }
  }
  return keys;
}

/**
 * actions/<stem>.js (the mock.js registerActions contract): existence + the
 * EXACT handler names registered by Mock.registerActions('<stem>', { … }).
 */
function actionModuleInfo(designRoot, stem) {
  const rel = `actions/${stem}.js`;
  const full = join(designRoot, rel);
  if (!existsSync(full)) return { module: rel, exists: false, registerLine: null, handlers: [] };
  let source;
  try {
    source = readFileSync(full, "utf8");
  } catch (error) {
    return { module: rel, exists: true, registerLine: null, handlers: [], error: String(error.message) };
  }
  const masked = jsMask(source);
  const offsets = lineIndex(source);
  const handlers = [];
  let registerLine = null;
  for (const m of masked.matchAll(/\bMock\.registerActions\s*\(\s*/g)) {
    const argAt = m.index + m[0].length;
    const literal = /^'[^']*'|^"[^"]*"/.exec(masked.slice(argAt));
    if (literal === null) continue;
    const id = source.slice(argAt + 1, argAt + 1 + literal[0].length - 2);
    if (id !== stem) continue; // another namespace: action-module.mjs polices it
    if (registerLine === null) registerLine = lineOf(offsets, m.index);
    const objAt = masked.indexOf("{", argAt + literal[0].length);
    const objEnd = objAt === -1 ? -1 : matchBrace(masked, objAt);
    if (objEnd === -1) continue;
    for (const key of topLevelKeys(masked, source, objAt, objEnd)) {
      if (!handlers.includes(key)) handlers.push(key);
    }
  }
  handlers.sort();
  return { module: rel, exists: true, registerLine, handlers };
}

function linkedStylesheets(screen) {
  const out = [];
  const masked = maskCode(screen.html);
  for (const m of masked.matchAll(/<link\b[^>]*>/gi)) {
    if ((attrValue(m[0], "rel") ?? "").toLowerCase() !== "stylesheet") continue;
    const href = attrValue(m[0], "href");
    if (!href || EXTERNAL_RE.test(href) || href.startsWith("//")) continue;
    const full = resolve(dirname(screen.abs), href.split(/[?#]/)[0]);
    if (!existsSync(full)) continue;
    try {
      out.push(readFileSync(full, "utf8"));
    } catch {
      /* unreadable stylesheet: tokens via its classes are simply not reported */
    }
  }
  return out;
}

/** className -> Set of var(--…) tokens referenced by the rules naming it. */
function cssClassTokens(cssText) {
  const byClass = new Map();
  for (const rule of cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const tokens = [...rule[2].matchAll(/\bvar\(\s*(--[a-z][\w-]*)/gi)].map((v) => v[1]);
    if (tokens.length === 0) continue;
    for (const cls of rule[1].matchAll(/\.([a-z][\w-]*)/gi)) {
      const set = byClass.get(cls[1]) ?? new Set();
      for (const token of tokens) set.add(token);
      byClass.set(cls[1], set);
    }
  }
  return byClass;
}

/** Tokens touched by the screen: literal var(--…) references plus class names
 *  whose rules in the stylesheets the screen LINKS reference tokens. */
function collectTokens(screen) {
  const touched = new Map(); // token -> [{ via, file, line }]
  const add = (name, via, file, line) => {
    const list = touched.get(name) ?? [];
    list.push({ via, file, line });
    touched.set(name, list);
  };
  for (const m of screen.html.matchAll(/\bvar\(\s*(--[a-z][\w-]*)/gi)) {
    add(m[1], "var()", screen.rel, lineOf(screen.offsets, m.index));
  }
  const masked = maskCode(screen.html);
  const classMaps = linkedStylesheets(screen).map(cssClassTokens);
  for (const m of masked.matchAll(TAG_RE)) {
    const cls = attrValue(m[0], "class");
    if (!cls) continue;
    const line = lineOf(screen.offsets, m.index);
    for (const name of cls.trim().split(/\s+/)) {
      for (const byClass of classMaps) {
        const tokens = byClass.get(name);
        if (!tokens) continue;
        for (const token of [...tokens].sort()) add(token, `classe .${name}`, screen.rel, line);
      }
    }
  }
  return [...touched.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, sites]) => ({
      name,
      sites: sites.sort((a, b) => a.line - b.line || (a.via < b.via ? -1 : a.via > b.via ? 1 : 0)),
    }));
}

// decisions.json (todo 18) — before it exists the DEC section is a declared
// placeholder; a schemaVersion mismatch NEVER silently merges (stale-state).
const DECISIONS_SCHEMA_VERSION = 1;

function collectDecisions(designRoot, screenId) {
  const rel = "decisions.json";
  const full = join(designRoot, rel);
  if (!existsSync(full)) return { file: rel, status: "absent", total: 0, decisions: [] };
  let raw;
  try {
    raw = readFileSync(full, "utf8");
  } catch (error) {
    return { file: rel, status: "invalid", error: String(error.message), total: 0, decisions: [] };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    return { file: rel, status: "invalid", error: String(error.message), total: 0, decisions: [] };
  }
  const found = isPlainObject(doc) && doc.schemaVersion !== undefined ? doc.schemaVersion : null;
  if (!isPlainObject(doc) || doc.schemaVersion !== DECISIONS_SCHEMA_VERSION) {
    return { file: rel, status: "schema-mismatch", found, total: 0, decisions: [] };
  }
  const all = Array.isArray(doc.decisions) ? doc.decisions : [];
  const offsets = lineIndex(raw);
  const decisions = [];
  for (const d of all) {
    if (!isPlainObject(d) || !Array.isArray(d.screens) || !d.screens.includes(screenId)) continue;
    const escaped = String(d.id ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = escaped ? new RegExp(`"id"\\s*:\\s*"${escaped}"`).exec(raw) : null;
    decisions.push({
      id: d.id ?? null,
      category: d.category ?? null,
      decision: d.decision ?? null,
      reason: d.reason ?? null,
      status: d.status ?? null,
      scope: d.scope ?? null,
      supersedes: d.supersedes ?? null,
      createdAt: d.createdAt ?? null,
      line: hit ? lineOf(offsets, hit.index) : 1,
    });
  }
  decisions.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { file: rel, status: "ok", total: all.length, decisions };
}

// comments.json (the viewer's 🎯 pins) — open pins of THIS screen with
// author/screen/element; absent or invalid input is a declared placeholder.
function collectComments(designRoot, screen, fileName) {
  const rel = "comments.json";
  const full = join(designRoot, rel);
  if (!existsSync(full)) return { file: rel, status: "absent", open: [], other: 0 };
  let doc;
  try {
    doc = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    return { file: rel, status: "invalid", error: String(error.message), open: [], other: 0 };
  }
  const all = Array.isArray(doc?.comments) ? doc.comments : [];
  const canvases = new Set([normPath(screen.canvasRel), basename(dirname(screen.abs))]);
  const open = [];
  let other = 0;
  for (const pin of all) {
    if (!isPlainObject(pin)) continue;
    const pinFile = normPath(String(pin.file ?? ""));
    const matchesFile = pinFile === fileName || basename(pinFile) === basename(fileName);
    if (!matchesFile || !canvases.has(String(pin.canvas ?? ""))) continue;
    if (pin.status === "open") {
      open.push({
        id: pin.id ?? null,
        author: typeof pin.author === "string" ? pin.author : null,
        selector: typeof pin.selector === "string" ? pin.selector : null,
        snippet: typeof pin.snippet === "string" ? pin.snippet : null,
        createdAt: typeof pin.createdAt === "string" ? pin.createdAt : null,
        replies: Array.isArray(pin.replies) ? pin.replies.length : 0,
      });
    } else {
      other += 1;
    }
  }
  open.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { file: rel, status: "ok", open, other };
}

/** Baselines + last smoke result: smoke.mjs snapshots/manifest.json (the last
 *  recorded run) and the todo 9 matrix under design/.visual/ — both optional,
 *  both declared when absent. */
function collectVisual(designRoot, screen, fileName) {
  const visual = {
    smoke: { file: "snapshots/manifest.json", status: "absent", entries: [] },
    baselines: [],
    matrix: { dir: ".visual", status: "absent", files: [], entries: [] },
  };
  const manifestPath = join(designRoot, "snapshots", "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const doc = JSON.parse(readFileSync(manifestPath, "utf8"));
      const entries = [];
      for (const entry of Array.isArray(doc?.screens) ? doc.screens : []) {
        if (!isPlainObject(entry)) continue;
        const entryFile = normPath(String(entry.file ?? ""));
        const matches = entryFile === fileName || basename(entryFile) === basename(fileName);
        if (!matches) continue;
        entries.push({
          viewport: Array.isArray(entry.viewport) ? entry.viewport.join("x") : null,
          snapshot: typeof entry.snapshot === "string" ? entry.snapshot : null,
          diffRatio: isPlainObject(entry.asserts) && entry.asserts.snapshotDiffRatio !== undefined
            ? entry.asserts.snapshotDiffRatio
            : null,
        });
      }
      entries.sort((a, b) => String(a.snapshot).localeCompare(String(b.snapshot)));
      visual.smoke = { file: "snapshots/manifest.json", status: "ok", entries };
      for (const entry of entries) {
        if (!entry.snapshot) continue;
        visual.baselines.push({
          file: `snapshots/${entry.snapshot}`,
          present: existsSync(join(designRoot, "snapshots", entry.snapshot)),
        });
      }
    } catch (error) {
      visual.smoke = { file: "snapshots/manifest.json", status: "invalid", error: String(error.message), entries: [] };
    }
  }
  const visualDir = join(designRoot, ".visual");
  if (existsSync(visualDir) && statSync(visualDir).isDirectory()) {
    visual.matrix.status = "ok";
    const screenDir = join(visualDir, screen.id);
    if (existsSync(screenDir) && statSync(screenDir).isDirectory()) {
      visual.matrix.files = readdirSync(screenDir)
        .filter((name) => name.endsWith(".png"))
        .sort()
        .map((name) => `.visual/${screen.id}/${name}`);
    }
    const matrixManifest = join(visualDir, "manifest.json");
    if (existsSync(matrixManifest)) {
      try {
        const doc = JSON.parse(readFileSync(matrixManifest, "utf8"));
        const entries = Array.isArray(doc?.images) ? doc.images : Array.isArray(doc?.screens) ? doc.screens : [];
        for (const entry of entries) {
          if (!isPlainObject(entry)) continue;
          const entryFile = normPath(String(entry.file ?? ""));
          const matches =
            entry.screen === screen.id ||
            entry.tela === screen.id ||
            (entryFile && (entryFile === fileName || basename(entryFile) === basename(fileName)));
          if (matches) visual.matrix.entries.push(entry);
        }
      } catch (error) {
        visual.matrix.status = "invalid";
        visual.matrix.error = String(error.message);
      }
    }
  }
  return visual;
}

function buildPackContent(target, screen, designRoot, deadContracts) {
  const fileName =
    normPath(screen.canvasRel) === "."
      ? normPath(screen.rel)
      : normPath(screen.rel).slice(normPath(screen.canvasRel).length + 1);
  const missingFile = screen.html === null;
  const dataAttrs = missingFile ? [] : scanDataAttributes(screen.html, screen.rel);

  const moduleCache = new Map();
  const moduleInfo = (stem) => {
    if (!moduleCache.has(stem)) moduleCache.set(stem, actionModuleInfo(designRoot, stem));
    return moduleCache.get(stem);
  };
  const actions = dataAttrs
    .filter((row) => ACTION_VERBS.includes(row.attr))
    .map((row) => {
      const action = { ...row };
      if (row.attr === "data-action") {
        const dot = row.value.indexOf(".");
        action.stem = dot > 0 ? row.value.slice(0, dot) : row.value;
        action.handler = dot > 0 ? row.value.slice(dot + 1) : null;
        action.module = moduleInfo(action.stem);
      }
      return action;
    });

  // Handler-level dead contracts (the module-level ones come from the map).
  const handlerWarnings = [];
  for (const action of actions) {
    if (action.attr !== "data-action") continue;
    if (action.handler === null) {
      handlerWarnings.push({
        kind: "sem-namespace",
        value: action.value,
        file: action.file,
        line: action.line,
      });
    } else if (action.module.exists && !action.module.handlers.includes(action.handler)) {
      handlerWarnings.push({
        kind: "handler-ausente",
        value: action.value,
        module: action.module.module,
        handler: action.handler,
        file: action.file,
        line: action.line,
      });
    }
  }

  const dead = {
    actionWithoutModule: deadContracts.actionWithoutModule.filter((item) => item.file === screen.rel),
    missingScreenLinks: deadContracts.missingScreenLinks.filter((item) => item.file === screen.rel),
    divergentIcons: deadContracts.divergentIcons
      .map((group) => ({
        name: group.name,
        total: group.variants.length,
        variants: group.variants.filter((variant) => variant.file === screen.rel),
      }))
      .filter((group) => group.variants.length > 0),
    handlerWarnings,
  };

  return {
    target,
    screen: {
      id: screen.id,
      name: screen.name,
      canvas: normPath(screen.canvasRel),
      file: normPath(screen.rel),
      missingFile,
      states: screen.inventory.states,
    },
    elements: dataAttrs,
    actions,
    components: screen.inventory.components,
    icons: screen.inventory.icons,
    tokens: missingFile ? [] : collectTokens(screen),
    decisions: collectDecisions(designRoot, screen.id),
    comments: collectComments(designRoot, screen, fileName),
    visual: collectVisual(designRoot, screen, fileName),
    deadContracts: dead,
  };
}

function renderPackMd(content, stamp) {
  const lines = [];
  const screen = content.screen;
  lines.push(`# Pack de contexto — \`${screen.id}\` (${screen.file})`);
  lines.push("");
  lines.push(
    "> GERADO por `skills/design/scripts/agent-map.mjs --screen <tela> --pack` — não editar à mão; regenere com `/design-map`.",
  );
  lines.push(
    `> schemaVersion ${stamp.schemaVersion} · gitSHA ${stamp.gitSHA ?? "n/a"} · contentHash ${stamp.contentHash} · timestamp ${stamp.timestamp}`,
  );
  const states = screen.states.map((s) => `\`${s.name}\` (${s.file}:${s.line ?? "?"})`).join(", ");
  lines.push(
    `> tela \`${screen.id}\` “${screen.name}” · canvas ${screen.canvas} · arquivo ${screen.file} · estados declarados: ${states || "nenhum"}`,
  );
  lines.push("");

  lines.push("## Elementos (data-*) — seletor · atributo · arquivo:linha");
  lines.push("");
  if (screen.missingFile) {
    lines.push(
      `⚠ ARQUIVO DA TELA AUSENTE — ${screen.file} está declarado no canvas.json mas não existe no disco; nada foi extraído.`,
    );
  } else if (content.elements.length === 0) {
    lines.push(
      "⚠ TELA SEM NENHUM ELEMENTO data-* — a seção está vazia porque a tela não declara atributos data-*, " +
        "NÃO porque o levantamento está completo. Não leia esta tela como pronta/verde.",
    );
  } else {
    for (const element of content.elements) {
      const attr = element.value === "" ? element.attr : `${element.attr}=${JSON.stringify(element.value)}`;
      lines.push(`- ${element.selector} — ${attr} (${element.file}:${element.line})`);
    }
  }
  lines.push("");

  lines.push("## Ações declaradas × módulos (actions/<stem>.js)");
  lines.push("");
  const dataActions = content.actions.filter((action) => action.attr === "data-action");
  if (content.actions.length === 0) {
    lines.push("- nenhuma ação declarada (a tela não usa data-action/data-go/data-overlay/data-toast/data-close)");
  }
  for (const action of content.actions) {
    const attr = `${action.attr}=${JSON.stringify(action.value)}`;
    if (action.attr !== "data-action") {
      lines.push(`- ${action.selector} — ${attr} (${action.file}:${action.line}) → verbo embutido do runtime (mock.js), sem módulo`);
      continue;
    }
    const module = action.module;
    const where = module.registerLine === null ? module.module : `${module.module}:${module.registerLine}`;
    const handlers = module.handlers.length > 0 ? module.handlers.map((h) => `\`${h}\``).join(", ") : "—";
    const handlerState =
      action.handler === null
        ? `valor sem \`namespace.<handler>\` — runAction nunca despacha`
        : module.exists
          ? `handler \`${action.handler}\` ${module.handlers.includes(action.handler) ? "REGISTRADO" : "NÃO REGISTRADO"}`
          : `handler \`${action.handler}\` NÃO REGISTRADO (módulo ausente)`;
    lines.push(
      `- ${action.selector} — ${attr} (${action.file}:${action.line}) → \`${module.module}\` ` +
        `${module.exists ? `EXISTE (${where})` : "AUSENTE"} · handlers registrados: ${handlers} · ${handlerState}`,
    );
  }
  if (dataActions.length === 0 && content.actions.length > 0) {
    lines.push("- nenhum data-action na tela (módulos actions/<stem>.js não se aplicam)");
  }
  lines.push("");

  lines.push("## Componentes usados (marker args)");
  lines.push("");
  if (content.components.length === 0) {
    lines.push("- nenhum componente declarado (sem marcadores `component:…`)");
  }
  for (const component of content.components) {
    lines.push(
      `- \`${component.id}\` size=${component.size ?? "?"} tone=${component.tone ?? "?"} state=${component.state ?? "?"} (${component.file}:${component.line})`,
    );
  }
  lines.push("");

  lines.push("## Ícones (svg) usados");
  lines.push("");
  if (content.icons.length === 0) {
    lines.push("- nenhum ícone svg na tela");
  }
  for (const icon of content.icons) {
    lines.push(
      `- ${icon.name ? `\`${icon.name}\` ` : ""}viewBox=${icon.viewBox ?? "?"} · ${icon.paths.length} path(s) · assinatura ${icon.signature} (${icon.file}:${icon.line})`,
    );
  }
  lines.push("");

  lines.push("## Tokens tocados");
  lines.push("");
  if (content.tokens.length === 0) {
    lines.push("- nenhum token tocado (sem `var(--…)` e sem classes ligadas a tokens nos CSS carregados pela tela)");
  }
  for (const token of content.tokens) {
    const sites = token.sites.map((site) => `${site.via} (${site.file}:${site.line})`).join(", ");
    lines.push(`- \`${token.name}\` — ${sites}`);
  }
  lines.push("");

  lines.push("## DEC — decisões que governam esta tela");
  lines.push("");
  const dec = content.decisions;
  if (dec.status === "absent") {
    lines.push(`- sem decisões registradas (${dec.file} ausente no design root — fonte futura: todo 18)`);
  } else if (dec.status === "invalid") {
    lines.push(`- sem decisões registradas (${dec.file} inválido: ${dec.error})`);
  } else if (dec.status === "schema-mismatch") {
    lines.push(
      `- sem decisões registradas (${dec.file} schemaVersion ${JSON.stringify(dec.found)} ≠ ${DECISIONS_SCHEMA_VERSION} — ` +
        "conteúdo ignorado até a migração; nada foi mesclado)",
    );
  } else if (dec.decisions.length === 0) {
    lines.push(
      `- sem decisões registradas para esta tela (${dec.total} decisão(ões) em ${dec.file}; ` +
        `nenhuma declara screens com \`${screen.id}\`)`,
    );
  } else {
    for (const decision of dec.decisions) {
      lines.push(
        `- ${decision.id ?? "?"} (${dec.file}:${decision.line}) — category=${decision.category ?? "?"} · ` +
          `status=${decision.status ?? "?"} · scope=${decision.scope ?? "?"} · supersedes=${decision.supersedes ?? "—"} · ` +
          `criada=${decision.createdAt ?? "?"}`,
      );
      lines.push(`  - decisão: ${decision.decision ?? "—"}`);
      lines.push(`  - motivo: ${decision.reason ?? "—"}`);
    }
  }
  lines.push("");

  lines.push("## Comentários 🎯 abertos");
  lines.push("");
  const comments = content.comments;
  const emptyComment = (note) => lines.push(`- sem comentários 🎯 abertos (${note})`);
  if (comments.status === "absent") {
    emptyComment(`${comments.file} ausente no design root`);
  } else if (comments.status === "invalid") {
    emptyComment(`${comments.file} inválido: ${comments.error}`);
  } else if (comments.open.length === 0) {
    emptyComment(
      comments.other > 0
        ? `${comments.other} comentário(s) resolvido(s)/stale(s) nesta tela, não listados`
        : `${comments.file} sem pins para esta tela`,
    );
  } else {
    for (const pin of comments.open) {
      lines.push(
        `- ${pin.id ?? "?"} — autor: ${pin.author ?? "não declarado"} · tela: ${screen.file} · ` +
          `elemento: ${pin.selector ?? "—"} · “${pin.snippet ?? ""}” · criado: ${pin.createdAt ?? "?"} · ` +
          `${pin.replies} resposta(s)`,
      );
    }
    if (comments.other > 0) {
      lines.push(`- (${comments.other} comentário(s) resolvido(s)/stale(s) nesta tela, não listados)`);
    }
  }
  lines.push("");

  lines.push("## Baselines e último smoke");
  lines.push("");
  const visual = content.visual;
  if (visual.baselines.length === 0) {
    lines.push("- baselines (smoke): nenhuma baseline registrada");
  } else {
    for (const baseline of visual.baselines) {
      lines.push(`- baseline (smoke): \`${baseline.file}\` — ${baseline.present ? "presente" : "AUSENTE no disco"}`);
    }
  }
  if (visual.matrix.status === "absent") {
    lines.push("- baselines (matriz .visual/): design/.visual/ ausente (todo 9) — sem capturas matriciais registradas");
  } else if (visual.matrix.status === "invalid") {
    lines.push(`- baselines (matriz .visual/): manifest inválido: ${visual.matrix.error}`);
  } else if (visual.matrix.files.length === 0 && visual.matrix.entries.length === 0) {
    lines.push(`- baselines (matriz .visual/): nenhuma captura registrada para esta tela em \`${visual.matrix.dir}/${screen.id}/\``);
  } else {
    for (const file of visual.matrix.files) lines.push(`- baseline (matriz .visual/): \`${file}\``);
    for (const entry of visual.matrix.entries) {
      const fields = Object.keys(entry)
        .sort()
        .map((key) => `${key}=${JSON.stringify(entry[key])}`)
        .join(" · ");
      lines.push(`- registro .visual/manifest.json: ${fields}`);
    }
  }
  if (visual.smoke.status === "absent") {
    lines.push(`- último smoke: nenhum resultado registrado (${visual.smoke.file} ausente)`);
  } else if (visual.smoke.status === "invalid") {
    lines.push(`- último smoke: ${visual.smoke.file} inválido: ${visual.smoke.error}`);
  } else if (visual.smoke.entries.length === 0) {
    lines.push(`- último smoke: nenhum resultado registrado para esta tela em ${visual.smoke.file}`);
  } else {
    for (const entry of visual.smoke.entries) {
      lines.push(
        `- último smoke (${visual.smoke.file}): viewport ${entry.viewport ?? "?"} · snapshot \`${entry.snapshot ?? "?"}\` · ` +
          `diffRatio ${entry.diffRatio ?? "?"}`,
      );
    }
  }
  lines.push("");

  lines.push("## Contratos mortos desta tela");
  lines.push("");
  const dead = content.deadContracts;
  const total =
    dead.actionWithoutModule.length + dead.missingScreenLinks.length + dead.divergentIcons.length + dead.handlerWarnings.length;
  lines.push(total === 0 ? "SEM CONTRATOS MORTOS NESTA TELA — verificações limpas." : `${total} contrato(s) morto(s) nesta tela:`);
  lines.push("");
  for (const item of dead.actionWithoutModule) {
    lines.push(`- ${item.file}:${item.line} — data-action=${JSON.stringify(item.value)} sem \`${item.module}\``);
  }
  for (const item of dead.missingScreenLinks) {
    lines.push(`- ${item.file}:${item.line} — ${item.via} → \`${item.target}\` (tela inexistente)`);
  }
  for (const item of dead.handlerWarnings) {
    if (item.kind === "sem-namespace") {
      lines.push(`- ${item.file}:${item.line} — data-action=${JSON.stringify(item.value)} sem \`namespace.<handler>\` (não despacha)`);
    } else {
      lines.push(
        `- ${item.file}:${item.line} — data-action=${JSON.stringify(item.value)} com módulo \`${item.module}\` ` +
          `EXISTENTE mas sem handler \`${item.handler}\` registrado`,
      );
    }
  }
  for (const group of dead.divergentIcons) {
    lines.push(`- ícone \`${group.name}\` divergente entre telas (${group.total} variantes no alvo):`);
    for (const variant of group.variants) {
      lines.push(`  - ${variant.file}:${variant.line} (assinatura ${variant.signature})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ---- main --------------------------------------------------------------

function resolveMockSource(designRoot) {
  const local = join(designRoot, "mock.js");
  if (existsSync(local)) return { path: local, label: "mock.js" };
  if (existsSync(PACK_MOCK)) return { path: PACK_MOCK, label: packLabel(PACK_MOCK) };
  return null;
}

function parseArgs(argv) {
  let target = "design";
  let checkVerbsOnly = false;
  let screen = null;
  let pack = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      if (i + 1 >= argv.length) fail(`--target requires a path - ${usage}`);
      target = argv[i + 1];
      i += 1;
    } else if (arg === "--screen") {
      if (i + 1 >= argv.length) fail(`--screen requires a screen id - ${usage}`);
      screen = argv[i + 1];
      i += 1;
    } else if (arg === "--pack") {
      pack = true;
    } else if (arg === "--check-verbs") {
      checkVerbsOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    } else {
      fail(`unknown argument "${arg}" - ${usage}`);
    }
  }
  if (pack !== (screen !== null)) {
    fail(`--screen <tela> and --pack must be used together - ${usage}`);
  }
  if (checkVerbsOnly && pack) fail(`--check-verbs cannot be combined with --pack - ${usage}`);
  return { target, checkVerbsOnly, screen, pack };
}

function main(argv) {
  const { target, checkVerbsOnly, screen: packScreen, pack } = parseArgs(argv);
  const targetRoot = resolve(target);
  const designRoot = designRootOf(targetRoot);

  if (checkVerbsOnly) {
    const mock = resolveMockSource(designRoot);
    if (mock === null) fail(`no mock.js found (looked in ${designRoot} and ${packLabel(PACK_MOCK)})`);
    const problems = checkVerbs(readFileSync(mock.path, "utf8"), mock.label);
    if (problems.length > 0) {
      for (const problem of problems) process.stderr.write(`agent-map: --check-verbs: ${problem}\n`);
      return 1;
    }
    process.stdout.write(`agent-map: --check-verbs OK — ${VERB_SPEC.length} verbos coerentes com ${mock.label}\n`);
    return 0;
  }

  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory()) {
    fail(`target not found or not a directory: ${targetRoot}`);
  }
  const canvases = discoverCanvases(targetRoot);
  if (canvases.length === 0) fail(`no canvas.json found under ${targetRoot} — nothing to map`);
  for (const canvas of canvases) {
    if (canvas.manifest.screens.length === 0) {
      fail(
        `empty target: ${canvas.relDir === "." ? "canvas.json" : `${canvas.relDir}/canvas.json`} declares zero screens — ` +
          `refusing to emit a map that would read as "0 problems"`,
      );
    }
  }

  const screens = [];
  let newestMtime = NaN;
  const noteMtime = (full) => {
    try {
      const mtime = statSync(full).mtimeMs;
      if (!Number.isFinite(newestMtime) || mtime > newestMtime) newestMtime = mtime;
    } catch {
      /* unreadable: the structural error below reports it */
    }
  };
  for (const canvas of canvases) {
    noteMtime(join(canvas.dir, "canvas.json"));
    for (const entry of canvas.manifest.screens) {
      const abs = resolve(canvas.dir, entry.file);
      const rel = (canvas.relDir === "." ? entry.file : `${canvas.relDir}/${entry.file}`).split("\\").join("/");
      if (!existsSync(abs)) {
        screens.push({
          id: entry.id,
          name: entry.name ?? entry.id,
          canvasRel: canvas.relDir,
          rel,
          abs,
          html: null,
          offsets: null,
          inventory: { elements: [], components: [], icons: [], states: [] },
        });
        continue;
      }
      let html;
      try {
        html = readFileSync(abs, "utf8");
      } catch (error) {
        fail(`cannot read screen file ${rel} (${String(error.message)})`);
      }
      noteMtime(abs);
      screens.push({
        id: entry.id,
        name: entry.name ?? entry.id,
        canvasRel: canvas.relDir,
        rel,
        abs,
        html,
        offsets: lineIndex(html),
        inventory: scanScreen(html, rel),
      });
    }
  }
  screens.sort((a, b) => a.rel.localeCompare(b.rel) || a.id.localeCompare(b.id));

  if (pack) {
    // Pack mode (todo 7): ONE self-contained .map/<tela>.md, nothing else —
    // the map files are NOT written by this invocation.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(packScreen)) {
      fail(`screen id ${JSON.stringify(packScreen)} is not a safe file name - ${usage}`);
    }
    const matches = screens.filter((screen) => screen.id === packScreen);
    if (matches.length === 0) {
      fail(
        `screen "${packScreen}" not found under ${target} - known screens: ` +
          screens.map((screen) => screen.id).join(", "),
      );
    }
    if (matches.length > 1) {
      fail(
        `screen "${packScreen}" is ambiguous under ${target} (${matches.map((screen) => screen.rel).join(", ")}) - ` +
          "screen ids must be unique to name a pack file",
      );
    }
    const deadContracts = collectDeadContracts(designRoot, targetRoot, canvases, screens);
    const content = buildPackContent(target, matches[0], designRoot, deadContracts);
    const stamp = stampFor(targetRoot, content, newestMtime);
    mkdirSync(join(targetRoot, ".map"), { recursive: true });
    writeFileSync(join(targetRoot, ".map", `${packScreen}.md`), renderPackMd(content, stamp), "utf8");
    process.stdout.write(
      `agent-map: wrote .map/${packScreen}.md in ${target} ` +
        `(${content.elements.length} elementos, ${content.actions.length} ações, contentHash ${stamp.contentHash.slice(0, 12)})\n`,
    );
    return 0;
  }

  const mock = resolveMockSource(designRoot);
  if (mock === null) fail(`no mock.js found (looked in ${designRoot} and ${packLabel(PACK_MOCK)})`);
  const mockSource = readFileSync(mock.path, "utf8");
  const verbs = deriveVerbTable(mockSource, mock.label);
  const contracts = collectContracts(designRoot);
  const deadContracts = collectDeadContracts(designRoot, targetRoot, canvases, screens);
  const content = buildContent(target, canvases, screens, verbs, contracts, deadContracts);
  const stamp = stampFor(targetRoot, content, newestMtime);

  writeFileSync(join(targetRoot, "agent-map.json"), `${JSON.stringify({ ...stamp, ...content }, null, 2)}\n`, "utf8");
  writeFileSync(join(targetRoot, "agent-map.md"), renderMd(content, stamp), "utf8");

  const deadTotal =
    deadContracts.actionWithoutModule.length +
    deadContracts.missingScreenLinks.length +
    deadContracts.orphanPartials.length +
    deadContracts.divergentIcons.length;
  process.stdout.write(
    `agent-map: wrote agent-map.json + agent-map.md in ${target} ` +
      `(${screens.length} telas, ${canvases.length} canvas, ${deadTotal} contratos mortos)\n`,
  );
  return 0;
}

// CLI entry point - guarded so tests/todo-7 modes can import this module
// without running the export (import-safe module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)) ?? 0);
}

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
 * Exit codes: 0 map written / check-verbs coherent (dead contracts are
 * REPORTED, never fatal), 1 verb table diverges from mock.js, 2 usage or
 * structural input error (missing target, no canvas.json, a canvas.json with
 * zero screens, invalid JSON, unreadable screen).
 * Node 18+, stdlib only, zero deps.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectScreenStates } from "./export-spec.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const PACK_MOCK = join(SCRIPT_DIR, "..", "assets", "mock.js");
const PACK_CONFIG = join(SCRIPT_DIR, "..", "assets", "validate.config.json");
const PACK_MARKER_PARSER = join(SCRIPT_DIR, "marker-parser.mjs");
const PACK_TASTE = join(PACK_ROOT, "skills", "taste", "SKILL.md");

const usage = "usage: agent-map.mjs [--target <design-root>] [--check-verbs] [--help]";

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
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      if (i + 1 >= argv.length) fail(`--target requires a path - ${usage}`);
      target = argv[i + 1];
      i += 1;
    } else if (arg === "--check-verbs") {
      checkVerbsOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    } else {
      fail(`unknown argument "${arg}" - ${usage}`);
    }
  }
  return { target, checkVerbsOnly };
}

function main(argv) {
  const { target, checkVerbsOnly } = parseArgs(argv);
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

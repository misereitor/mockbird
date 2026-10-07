#!/usr/bin/env node
/**
 * sync-components.mjs — marker-based component rematerializer (w2-8).
 *
 * For every `<!-- component:id … --> … <!-- /component:id -->` region under the
 * design-root, rewrites ONLY the region's inner content:
 *
 *   - Structure        = the partial's markup (registry maps id -> partial file;
 *                        registry loaded from `<design-root>/components/components.json`,
 *                        falling back to the parser's DEFAULT_REGISTRY).
 *   - Root class attr  = the partial's FIXED base classes (its class list minus every
 *                        class appearing in any variantClasses combo) PLUS
 *                        `variantClasses(markerArgs)` — marker-args-win.
 *   - Root data-attrs  = `data-component` from the partial + `data-size/tone/state`
 *                        re-emitted FROM the marker args (marker wins over anything
 *                        present).
 *   - Preserved byte-identical across rewrites: slot contents
 *     (`<!-- slot:name -->USER CONTENT<!-- /slot:name -->` — the inner bytes) and
 *     user extra `data-*` attributes on the root beyond the variant trio
 *     (data-size/data-tone/data-state).
 *   - The opener/closer marker comments stay EXACTLY as the user wrote them.
 *
 * Usage: node sync-components.mjs [design-root] [--check]
 *   design-root   default `./design` relative to cwd
 *   --check       dry-run: report `file:line` for every region whose current
 *                 bytes differ from the materialized bytes (with a line diff);
 *                 exit 1 if any divergence, 0 if clean; never writes
 *
 * Exit codes: 0 = up to date / clean, 1 = --check found divergence(s),
 * 2 = usage error or marker/slot parse error (the message carries the parser's
 * `component-marker` / `slot-marker` code).
 *
 * Node 18+, stdlib only, ZERO deps. Imports the shared marker grammar parser
 * (marker-parser.mjs) — `parseAll`, `parseSlots`, `variantCompare`,
 * `variantClasses`, `DEFAULT_REGISTRY`, `VARIANT_KEYS` — never reimplemented here.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  parseAll,
  parseSlots,
  variantCompare,
  variantClasses,
  DEFAULT_REGISTRY,
  VARIANT_KEYS,
  VARIANT_CLASSES,
  MarkerError,
} from "./marker-parser.mjs";

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------
const usage = "usage: node sync-components.mjs [design-root] [--check]";
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const unknownFlags = flags.filter((f) => f !== "--check");
if (unknownFlags.length > 0) {
  console.error(`unknown flag "${unknownFlags[0]}" — ${usage}`);
  process.exit(2);
}
const positional = argv.filter((a) => !a.startsWith("--"));
if (positional.length > 1) {
  console.error(`${usage} (got ${positional.length} positional args)`);
  process.exit(2);
}
const check = flags.includes("--check");
const designRootArg = positional[0] ?? "./design";

// Walk exemptions = the validator's exempt names (the .css/.json ones are n/a
// for an .html-only walk; kept for parity with validate.mjs).
const EXEMPT_FILES = new Set(["viewer.html", "docs.html", "mock.js"]);
const EXEMPT_DIRS = new Set(["vendor", "scripts", "snapshots"]); // **/snapshots/** exempt whole tree

/** Non-marker input error (missing partial, unusable registry, ...) -> exit 2. */
class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

/** Every class that appears in ANY variantClasses combo (utilities-spec.md). */
const VARIANT_CLASS_SET = new Set();
for (const key of VARIANT_KEYS) {
  const combos = VARIANT_CLASSES[key] ?? {};
  for (const value of Object.keys(combos)) {
    for (const cls of combos[value]) VARIANT_CLASS_SET.add(cls);
  }
}

// Root open tag: lazy attrs so a trailing `/>` is captured separately.
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/;
// One attribute: name + optional `=value` (double/single-quoted or bare).
const ATTR_RE = /([^\s=/>"'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]*)))?/g;
// Slot pair inside a partial: rewrite the CONTENT span only, markers untouched.
const SLOT_PAIR_RE =
  /(<!--[ \t]*slot:([a-z][a-z0-9-]*)[ \t]*\r?-->)([\s\S]*?)(<!--[ \t]*\/slot:\2[ \t]*\r?-->)/g;

// ---------------------------------------------------------------------------
// Small helpers (tag/attr spans only — the marker GRAMMAR lives in
// marker-parser.mjs and is imported above)
// ---------------------------------------------------------------------------
function findRootTag(text) {
  const m = TAG_RE.exec(text);
  if (!m) return null;
  return {
    raw: m[0],
    name: m[1],
    attrsRaw: m[2],
    selfClose: m[3] === "/",
    index: m.index,
    attrsStart: m.index + 1 + m[1].length,
  };
}

function parseAttrList(attrsRaw) {
  const out = [];
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(attrsRaw)) !== null) {
    if (m[0].length === 0) {
      ATTR_RE.lastIndex += 1;
      continue;
    }
    const value =
      m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null;
    out.push({
      name: m[1],
      value,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Root variant data-attrs of a region's inner, keyed `data-size`/`data-tone`/`data-state`. */
function rootVariantData(inner) {
  const out = {};
  const tag = findRootTag(inner);
  if (!tag) return out;
  for (const attr of parseAttrList(tag.attrsRaw)) {
    const lname = attr.name.toLowerCase();
    if (lname === "data-size" || lname === "data-tone" || lname === "data-state") {
      out[lname] = attr.value;
    }
  }
  return out;
}

/**
 * Rebuild the ROOT OPEN TAG: the partial's markup is the base; class + variant
 * data-attrs are re-emitted from the marker args (marker-args-win);
 * `data-component` is kept from the partial; user extra `data-*` attrs are
 * appended byte-identical.
 */
function rebuildRootTag(tag, markerArgs, id, extrasRaw) {
  const attrs = parseAttrList(tag.attrsRaw);
  const combo = variantClasses(markerArgs);
  const edits = []; // { start, end, text } in tag.raw coordinates
  const handled = new Set();

  for (const attr of attrs) {
    const lname = attr.name.toLowerCase();
    const s = tag.attrsStart + attr.start;
    const e = tag.attrsStart + attr.end;
    if (lname === "class") {
      const base = (attr.value ?? "")
        .split(/\s+/)
        .filter((c) => c.length > 0 && !VARIANT_CLASS_SET.has(c));
      edits.push({ start: s, end: e, text: `class="${[...base, ...combo].join(" ")}"` });
      handled.add("class");
    } else if (lname === "data-size" || lname === "data-tone" || lname === "data-state") {
      edits.push({
        start: s,
        end: e,
        text: `${attr.name}="${markerArgs[lname.slice("data-".length)]}"`,
      });
      handled.add(lname);
    } else if (lname === "data-component") {
      handled.add("data-component"); // kept byte-identical from the partial
    }
    // every other attribute is untouched partial markup
  }

  const insertions = [];
  if (!handled.has("class")) insertions.push(`class="${combo.join(" ")}"`);
  if (!handled.has("data-component")) insertions.push(`data-component="${id}"`);
  for (const key of VARIANT_KEYS) {
    const lk = `data-${key}`;
    if (!handled.has(lk)) insertions.push(`${lk}="${markerArgs[key]}"`);
  }
  for (const raw of extrasRaw) insertions.push(raw);

  const closeIndex = tag.raw.length - (tag.selfClose ? 2 : 1);
  edits.push({
    start: closeIndex,
    end: closeIndex,
    text: insertions.map((t) => ` ${t}`).join(""),
  });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);

  let out = tag.raw;
  for (const ed of edits) out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  return out;
}

/** Replace each partial slot's CONTENT span with the region's preserved bytes. */
function substituteSlots(text, slotContents) {
  return text.replace(SLOT_PAIR_RE, (whole, open, name, _content, close) =>
    Object.prototype.hasOwnProperty.call(slotContents, name)
      ? open + slotContents[name] + close
      : whole
  );
}

/** Materialized inner bytes for a region (everything between its two markers). */
function materializeInner(region, partialText, id) {
  const tag = findRootTag(partialText);
  if (!tag) throw new InputError(`partial for component "${id}" has no root element`);

  // User extra data-* on the CURRENT root: everything beyond the variant trio
  // (and beyond data-component, which is re-emitted from the partial).
  const extrasRaw = [];
  const currentTag = findRootTag(region.inner);
  if (currentTag) {
    for (const attr of parseAttrList(currentTag.attrsRaw)) {
      const lname = attr.name.toLowerCase();
      if (!lname.startsWith("data-")) continue;
      if (lname === "data-size" || lname === "data-tone") continue;
      if (lname === "data-state" || lname === "data-component") continue;
      extrasRaw.push(attr.raw);
    }
  }

  const newTagRaw = rebuildRootTag(tag, region.args, id, extrasRaw);
  const rest = substituteSlots(partialText.slice(tag.index + tag.raw.length), region.slots);
  return partialText.slice(0, tag.index) + newTagRaw + rest;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function relLabel(rootDir, full) {
  return full.startsWith(rootDir + sep)
    ? full.slice(rootDir.length + 1).replaceAll(sep, "/")
    : full.replaceAll(sep, "/");
}

// ---------------------------------------------------------------------------
// Design-root walk + registry/partials loading
// ---------------------------------------------------------------------------
function walkHtml(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (EXEMPT_DIRS.has(ent.name)) continue;
      walkHtml(full, out);
    } else if (ent.isFile()) {
      if (!/\.html$/i.test(ent.name)) continue;
      if (EXEMPT_FILES.has(ent.name)) continue;
      out.push(full);
    }
  }
}

function loadRegistry(rootDir) {
  const registryPath = join(rootDir, "components", "components.json");
  let raw;
  try {
    raw = readFileSync(registryPath, "utf8");
  } catch {
    return DEFAULT_REGISTRY; // seeded registry from the shared parser
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InputError(`invalid registry ${registryPath}: ${String(error?.message ?? error)}`);
  }
  return parsed;
}

function loadPartial(rootDir, entry, id) {
  const rel = `components/${entry.file}`;
  const partialPath = join(rootDir, "components", entry.file);
  let raw;
  try {
    raw = readFileSync(partialPath, "utf8");
  } catch {
    throw new InputError(`partial not found for component "${id}" (expected ${rel})`);
  }
  const text = raw.replace(/\s+$/, "");
  parseSlots(text); // partial slot grammar is parser-owned; errors propagate
  return text;
}

// ---------------------------------------------------------------------------
// Main (two-phase: materialize everything first, then write — a marker error
// exits 2 with ZERO writes)
// ---------------------------------------------------------------------------
try {
  const rootDir = resolve(process.cwd(), designRootArg.replaceAll("\\", "/"));
  let st = null;
  try {
    st = statSync(rootDir);
  } catch {}
  if (!st?.isDirectory()) {
    throw new InputError(`${designRootArg} is not a folder`);
  }

  const registry = loadRegistry(rootDir);
  const files = [];
  walkHtml(rootDir, files);

  const pending = []; // { full, rel, html, regions: [{ region, id, nextInner }] }
  const divergences = []; // --check report rows
  const partialCache = new Map();

  for (const full of files) {
    const html = readFileSync(full, "utf8");
    const rel = relLabel(rootDir, full);
    let regions;
    try {
      regions = parseAll(html, registry);
    } catch (error) {
      if (error instanceof MarkerError) {
        console.error(`${rel}: ${error.code}: ${error.message}`);
        process.exit(2);
      }
      throw error;
    }
    if (regions.length === 0) continue;

    const rewrites = [];
    for (const region of regions) {
      const entry = registry[region.id];
      if (!entry || typeof entry.file !== "string") {
        throw new InputError(`registry has no partial file for component "${region.id}"`);
      }
      if (!partialCache.has(entry.file)) {
        partialCache.set(entry.file, loadPartial(rootDir, entry, region.id));
      }
      const nextInner = materializeInner(region, partialCache.get(entry.file), region.id);
      if (nextInner !== region.inner) {
        if (check) {
          divergences.push({ rel, region, html, nextInner });
        } else {
          rewrites.push({ region, nextInner });
        }
      }
    }
    if (!check && rewrites.length > 0) pending.push({ full, rel, html, rewrites });
  }

  if (check) {
    for (const d of divergences) {
      console.log(
        `${d.rel}:${lineOf(d.html, d.region.start)}: component:${d.region.id}: stale region (bytes differ from materialized; run sync)`
      );
      const cur = d.region.inner.split("\n");
      const next = d.nextInner.split("\n");
      for (const line of cur) console.log(`- ${line}`);
      for (const line of next) console.log(`+ ${line}`);
      for (const div of variantCompare(d.region.args, rootVariantData(d.region.inner))) {
        console.log(
          `  variant data-${div.key}: marker=${div.marker ?? "(absent)"} root=${div.root ?? "(absent)"} (marker wins)`
        );
      }
    }
    if (divergences.length > 0) {
      console.log(`${divergences.length} divergent region(s)`);
      process.exit(1);
    }
    console.log("up to date");
    process.exit(0);
  }

  let regionCount = 0;
  for (const p of pending) {
    // Splice back-to-front so earlier region offsets stay valid. Marker
    // openers/closers are never rewritten: only the bytes between them.
    let html = p.html;
    for (const r of [...p.rewrites].sort((a, b) => b.region.start - a.region.start)) {
      const openerEnd = r.region.start + r.region.open.length;
      const closerStart = r.region.end - r.region.close.length;
      html = html.slice(0, openerEnd) + r.nextInner + html.slice(closerStart);
      regionCount += 1;
    }
    writeFileSync(p.full, html, "utf8");
    console.log(`${p.rel}: rematerialized ${p.rewrites.length} region(s)`);
  }
  console.log(
    regionCount > 0
      ? `updated ${regionCount} region(s) in ${pending.length} file(s)`
      : "up to date"
  );
  process.exit(0);
} catch (error) {
  if (error instanceof MarkerError) {
    console.error(`${error.code}: ${error.message}`);
    process.exit(2);
  }
  if (error instanceof InputError) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
  console.error(`internal: ${String(error?.message ?? error)}`);
  process.exit(2);
}

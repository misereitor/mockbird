#!/usr/bin/env node
/* mockbird:config-driven:v2 */
/**
 * sync-components.mjs — marker-based component rematerializer (w2-8).
 *
 * For every `<!-- component:id … --> … <!-- /component:id -->` region under the
 * design-root, rewrites ONLY the region's inner content:
 *
 *   - Structure        = the partial's markup (registry maps id -> partial
 *                        template; registry loaded from
 *                        `<design-root>/components/components.json`, falling
 *                        back to the parser's DEFAULT_REGISTRY).
 *   - Root class attr  = the partial's FIXED base classes (its class list minus every
 *                        class appearing in any variantClasses combo) PLUS
 *                        `variantClasses(markerArgs)` — marker-args-win.
 *   - Root data-attrs  = `data-component` from the partial + `data-size/tone/state`
 *                        re-emitted FROM the marker args (marker wins over anything
 *                        present). Entry variant keys OUTSIDE the marker trio
 *                        (e.g. `device`) are the per-device override (todo 16):
 *                        the INSTANCE root's value wins over the partial's own
 *                        default, re-emitted exactly once.
 *   - Preserved byte-identical across rewrites: slot contents
 *     (`<!-- slot:name -->USER CONTENT<!-- /slot:name -->` — the inner bytes) and
 *     user extra `data-*` attributes on the root beyond the schema attrs
 *     (data-component and one `data-<key>` per registry variant key).
 *   - The opener/closer marker comments stay EXACTLY as the user wrote them.
 *
 * Usage: node sync-components.mjs [design-root] [--check] [--config <path>]
 *   design-root   default `./design` relative to cwd
 *   --check       dry-run: report `file:line` for every region whose current
 *                 bytes differ from the materialized bytes (with a line diff);
 *                 exit 1 if any divergence, 0 if clean; never writes. ALSO
 *                 enforces the registry schema v2 and instance drift below —
 *                 plain sync (no --check) keeps its rematerialization
 *                 semantics untouched.
 *   --config      explicit validate.config.json path (config-driven v2; the
 *                 same discovery chain as validate.mjs applies without it)
 *
 * Registry schema v2 (one entry per component in components.json):
 *   { name, template, variants: {size, tone, state, device}, slots,
 *     realComponent, dataProps }
 *   - entry keys are EXACTLY name/template/variants/slots/realComponent/
 *     dataProps — an unknown key fails citing the key, a missing one fails
 *     citing it too (`name` must equal the registry key; `realComponent` is
 *     the target React component name; `dataProps` maps instance `data-*`
 *     attributes to its props, both consumed by codegen);
 *   - `variants` declares EXACTLY the `componentVariantKeys` of
 *     validate.config.json (config-driven — the key set is never hardcoded
 *     here); each value is a list of marker-safe values (empty = variant not
 *     offered);
 *   - every declared slot must exist as a `<!-- slot:name -->` pair in the
 *     template — a missing declared slot fails citing the slot.
 * Instance drift (--check, exit 1): a root `data-*` attribute outside the
 * entry schema (data-component + variant keys + dataProps keys), a region
 * slot the entry never declared, or a variant value outside the registered
 * list (marker arg or root data-*) — each citing the exact attribute, slot,
 * component+variant.
 *
 * Exit codes: 0 = up to date / clean, 1 = --check found divergence(s) or
 * schema/drift violation(s), 2 = usage error or marker/slot parse error (the
 * message carries the parser's `component-marker` / `slot-marker` code),
 * 3 = missing/broken validate.config.json (guided setup — never a silent
 * fallback).
 *
 * Node 18+, stdlib only, ZERO deps. Imports the shared marker grammar parser
 * (marker-parser.mjs) — `parseAll`, `parseSlots`, `variantCompare`,
 * `variantClasses`, `DEFAULT_REGISTRY`, `VARIANT_KEYS` — never reimplemented here.
 *
 * Import-safe module contract (w2-9): validate.mjs imports `materializeRegion`
 * and `rootVariantData` from here (the materializer is NEVER reimplemented in
 * the validator). Importing this module has ZERO side effects — the CLI runs
 * only when executed directly (`node sync-components.mjs …`).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
const usage = "usage: node sync-components.mjs [design-root] [--check] [--config <path>]";

// Walk exemptions come from the external validate.config.json (loaded in
// main(): `exemptFilesSync` for the .html-only walk, `exemptDirs` shared with
// validate.mjs) — never hardcoded here (flip-flop settle, §3.3/R2).
let EXEMPT_FILES = new Set();
let EXEMPT_DIRS = new Set(); // **/snapshots/** exempt whole tree
// Registry schema v2 (schema enforcement, --check): the variant key set comes
// from the external `componentVariantKeys` — never hardcoded here.
let SCHEMA_VARIANT_KEYS = [];

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

/** Root variant data-attrs of a region's inner, keyed `data-size`/`data-tone`/`data-state`.
 * Exported for validate.mjs (w2-9): the `component-divergence` marker↔`data-*`
 * check feeds this into `variantCompare` — same root semantics as the sync CLI. */
export function rootVariantData(inner) {
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
function rebuildRootTag(tag, markerArgs, id, extrasRaw, overrides) {
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
    } else if (hasOwn(overrides, lname)) {
      // per-device override (todo 16): the instance root's value wins over the
      // partial's own default; re-emitted here so it is never duplicated.
      edits.push({ start: s, end: e, text: `${lname}="${overrides[lname]}"` });
      handled.add(lname);
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
  for (const [lk, value] of Object.entries(overrides)) {
    if (!handled.has(lk)) insertions.push(`${lk}="${value}"`);
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
function materializeInner(region, partialText, id, entry) {
  const tag = findRootTag(partialText);
  if (!tag) throw new InputError(`partial for component "${id}" has no root element`);

  // User extra data-* on the CURRENT root: everything beyond the schema attrs
  // (data-component and one data-<key> per variant key — the marker trio from
  // the parser plus the entry's own variant keys, e.g. device). Schema attrs
  // are managed by the partial/marker pair, never preserved as user extras.
  const schemaAttrs = new Set(["data-component"]);
  const variantKeys = isPlainObject(entry?.variants) ? Object.keys(entry.variants) : VARIANT_KEYS;
  for (const key of [...VARIANT_KEYS, ...variantKeys]) schemaAttrs.add(`data-${key}`);
  // Variant keys the marker grammar cannot express (its trio is size/tone/
  // state): the INSTANCE root's value is the per-device override (device lives
  // in template/registry — todo 16), re-emitted by rebuildRootTag below.
  const overrideKeys = new Set(
    variantKeys.filter((key) => !VARIANT_KEYS.includes(key)).map((key) => `data-${key}`)
  );
  const overrides = {};
  const extrasRaw = [];
  const currentTag = findRootTag(region.inner);
  if (currentTag) {
    for (const attr of parseAttrList(currentTag.attrsRaw)) {
      const lname = attr.name.toLowerCase();
      if (!lname.startsWith("data-")) continue;
      if (overrideKeys.has(lname)) {
        overrides[lname] = attr.value ?? "";
        continue;
      }
      if (schemaAttrs.has(lname)) continue;
      extrasRaw.push(attr.raw);
    }
  }

  const newTagRaw = rebuildRootTag(tag, region.args, id, extrasRaw, overrides);
  const rest = substituteSlots(partialText.slice(tag.index + tag.raw.length), region.slots);
  return partialText.slice(0, tag.index) + newTagRaw + rest;
}

/**
 * Materialized INNER bytes for a region (everything between its two markers),
 * loading the component's partial from `<rootDir>/components/<entry.template>`.
 * THE materialization entry point — exported for validate.mjs's
 * `component-divergence` byte check (w2-9); the validator never reimplements it.
 * Throws InputError (missing partial / no root element) or MarkerError (partial
 * slot grammar) exactly like the sync CLI.
 */
export function materializeRegion(rootDir, region, registry = DEFAULT_REGISTRY) {
  const entry = registry[region.id];
  if (!entry || typeof entry.template !== "string") {
    throw new InputError(`registry has no partial template for component "${region.id}"`);
  }
  return materializeInner(region, loadPartial(rootDir, entry, region.id), region.id, entry);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
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

/** Registry + whether it came from a real components.json (schema enforcement
 * applies to authored registries only — the parser's seeded DEFAULT_REGISTRY
 * is trusted, absence policy like validate.mjs). */
function loadRegistry(rootDir) {
  const registryPath = join(rootDir, "components", "components.json");
  let raw;
  try {
    raw = readFileSync(registryPath, "utf8");
  } catch {
    return { registry: DEFAULT_REGISTRY, fromFile: false }; // seeded registry from the shared parser
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InputError(`invalid registry ${registryPath}: ${String(error?.message ?? error)}`);
  }
  return { registry: parsed, fromFile: true };
}

function loadPartial(rootDir, entry, id) {
  const rel = `components/${entry.template}`;
  const partialPath = join(rootDir, "components", entry.template);
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
// Registry schema v2 + instance drift — enforced in --check mode ONLY (plain
// sync keeps its rematerialization semantics untouched). Every violation
// string cites the exact offending key, attribute, slot or component+variant
// (misleading-success rule: never a generic error).
// ---------------------------------------------------------------------------
const SCHEMA_ENTRY_KEYS = ["name", "template", "variants", "slots", "realComponent", "dataProps"];
const VALUE_RE = /^[a-zA-Z0-9_-]+$/; // marker-safe variant value (parser's own rule)
const DATA_PROPS_KEY_RE = /^data-[a-z][a-z0-9-]*$/;

/** Registry schema v2 violations for components/components.json (empty =
 * schema-clean). Keys allowed = SCHEMA_ENTRY_KEYS; variant keys = the
 * configured `componentVariantKeys` (SCHEMA_VARIANT_KEYS). */
function registrySchemaErrors(rootDir, registry) {
  const errors = [];
  for (const [key, entry] of Object.entries(registry)) {
    const where = `components/components.json: entry "${key}"`;
    if (!isPlainObject(entry)) {
      errors.push(`${where}: must be an object`);
      continue;
    }
    for (const k of Object.keys(entry)) {
      if (!SCHEMA_ENTRY_KEYS.includes(k)) {
        errors.push(`${where}: unknown key "${k}" (allowed: ${SCHEMA_ENTRY_KEYS.join(", ")})`);
      }
    }
    for (const k of SCHEMA_ENTRY_KEYS) {
      if (!hasOwn(entry, k)) errors.push(`${where}: missing required key "${k}"`);
    }
    if (typeof entry.name === "string" && entry.name !== key) {
      errors.push(`${where}: name "${entry.name}" must equal the registry key "${key}"`);
    }
    // template: non-empty string + parseable slot grammar (the slot check
    // below needs the parsed names).
    let templateSlots = null;
    if (typeof entry.template === "string" && entry.template.length > 0) {
      try {
        const text = readFileSync(join(rootDir, "components", entry.template), "utf8").replace(/\s+$/, "");
        templateSlots = parseSlots(text);
      } catch (error) {
        if (error instanceof MarkerError) {
          errors.push(`${where}: template "${entry.template}": ${error.code}: ${error.message}`);
        } else {
          errors.push(`${where}: template "${entry.template}" not found (components/${entry.template})`);
        }
      }
    } else if (hasOwn(entry, "template")) {
      errors.push(`${where}: template must be a non-empty string`);
    }
    // variants: EXACTLY the configured key set (config-driven), each a list of
    // unique marker-safe values (empty list = variant not offered).
    if (isPlainObject(entry.variants)) {
      for (const vk of Object.keys(entry.variants)) {
        if (!SCHEMA_VARIANT_KEYS.includes(vk)) {
          errors.push(`${where}: unknown key "${vk}" in variants (allowed: ${SCHEMA_VARIANT_KEYS.join(", ")})`);
        }
      }
      for (const vk of SCHEMA_VARIANT_KEYS) {
        if (!hasOwn(entry.variants, vk)) {
          errors.push(`${where}: missing required key "${vk}" in variants`);
          continue;
        }
        const list = entry.variants[vk];
        if (!Array.isArray(list) || list.some((v) => typeof v !== "string" || !VALUE_RE.test(v))) {
          errors.push(`${where}: variants.${vk} must be a list of marker-safe values`);
          continue;
        }
        if (new Set(list).size !== list.length) errors.push(`${where}: variants.${vk} has duplicate value(s)`);
      }
    } else if (hasOwn(entry, "variants")) {
      errors.push(`${where}: variants must be an object`);
    }
    // slots: unique names; every DECLARED slot must exist in the template.
    if (Array.isArray(entry.slots) && entry.slots.every((s) => typeof s === "string" && s.length > 0)) {
      if (new Set(entry.slots).size !== entry.slots.length) errors.push(`${where}: slots has duplicate value(s)`);
      if (templateSlots !== null) {
        for (const slot of entry.slots) {
          if (!hasOwn(templateSlots, slot)) {
            errors.push(`${where}: declared slot "${slot}" is missing from the template "${entry.template}"`);
          }
        }
      }
    } else if (hasOwn(entry, "slots")) {
      errors.push(`${where}: slots must be a list of strings`);
    }
    if (hasOwn(entry, "realComponent") && (typeof entry.realComponent !== "string" || entry.realComponent.length === 0)) {
      errors.push(`${where}: realComponent must be a non-empty string`);
    }
    if (isPlainObject(entry.dataProps)) {
      for (const [attr, prop] of Object.entries(entry.dataProps)) {
        if (!DATA_PROPS_KEY_RE.test(attr)) {
          errors.push(`${where}: dataProps key "${attr}" must be a data-* attribute`);
        }
        if (typeof prop !== "string" || prop.length === 0) {
          errors.push(`${where}: dataProps["${attr}"] must be a non-empty prop name`);
        }
      }
    } else if (hasOwn(entry, "dataProps")) {
      errors.push(`${where}: dataProps must be an object`);
    }
  }
  return errors;
}

/** Instance drift (schema v2): root data-* attrs outside the entry schema,
 * variant values outside the registered lists, region slots the entry never
 * declared. Called from main() in --check mode. */
function instanceDriftChecks(registry, regions, rel, html, violations) {
  for (const region of regions) {
    const entry = registry[region.id];
    if (!isPlainObject(entry)) continue;
    const where = `${rel}:${lineOf(html, region.start)}: component:${region.id}`;
    const dataPropsAttrs = isPlainObject(entry.dataProps) ? Object.keys(entry.dataProps) : [];
    const allowedAttrs = [
      "component",
      ...SCHEMA_VARIANT_KEYS,
      ...dataPropsAttrs.map((attr) => attr.slice("data-".length)),
    ];
    const tag = findRootTag(region.inner);
    if (tag) {
      for (const attr of parseAttrList(tag.attrsRaw)) {
        const lname = attr.name.toLowerCase();
        if (!lname.startsWith("data-")) continue;
        const bare = lname.slice("data-".length);
        if (!allowedAttrs.includes(bare)) {
          const allowed = allowedAttrs.map((k) => `data-${k}`).join(", ");
          violations.push(`${where}: instance attribute "${lname}" is outside the schema (allowed data-*: ${allowed})`);
          continue;
        }
        const enums = isPlainObject(entry.variants) ? entry.variants[bare] : undefined;
        if (Array.isArray(enums) && !enums.includes(attr.value)) {
          violations.push(`${where}: variant ${bare}="${attr.value}" is outside the registered list (allowed: ${enums.join(", ")})`);
        }
      }
    }
    const declaredSlots = Array.isArray(entry.slots) ? entry.slots : [];
    for (const slot of Object.keys(region.slots)) {
      if (!declaredSlots.includes(slot)) {
        violations.push(`${where}: unknown slot "${slot}" (declared slots: ${declaredSlots.join(", ")})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// External config — validate.config.json (config-driven v2): the SAME loader
// logic as validate.mjs. Discovery chain: --config <path> ->
// validate.config.json in the validated root -> in the CWD; absent = exit 3
// guided, never a silent fallback. toolchainScripts entries resolve RELATIVE
// to the config file's own directory; every entry must exist and carry the
// config marker (R2), else exit 2 citing the exact file.
// ---------------------------------------------------------------------------
const CONFIG_NAME = "validate.config.json";
const CONFIG_MARKER = "/* mockbird:config-driven:v2 */";
const CONFIG_SEED_HINT = `run setup-design.mjs to seed it (or copy skills/design/assets/${CONFIG_NAME} from the skill folder)`;

function configFatal(message, code) {
  console.error(message);
  process.exit(code);
}

function configStringArray(parsed, key) {
  const value = parsed[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    configFatal(`${CONFIG_NAME}: "${key}" must be a list of strings`, 2);
  }
  return value;
}

function loadConfig(configArg, targetDir) {
  let configPath = null;
  if (configArg !== null) {
    if (!pathExists(configArg)) {
      configFatal(`${configArg}: ${CONFIG_NAME} not found — ${CONFIG_SEED_HINT}`, 3);
    }
    configPath = configArg;
  } else {
    const candidates = [join(targetDir, CONFIG_NAME), join(process.cwd(), CONFIG_NAME)];
    configPath = candidates.find((candidate) => pathExists(candidate)) ?? null;
    if (configPath === null) {
      configFatal(`${CONFIG_NAME} not found (checked ${candidates[0]} and ${candidates[1]}) — ${CONFIG_SEED_HINT}`, 3);
    }
  }
  let raw = null;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    configFatal(`${configPath}: cannot read ${CONFIG_NAME} — ${CONFIG_SEED_HINT}`, 3);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    configFatal(`${configPath}: ${CONFIG_NAME} is not valid JSON — ${CONFIG_SEED_HINT}`, 3);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    configFatal(`${configPath}: ${CONFIG_NAME} must have a JSON object at its root`, 2);
  }
  const exemptFilesSync = configStringArray(parsed, "exemptFilesSync");
  const exemptDirs = configStringArray(parsed, "exemptDirs");
  const variantKeys = configStringArray(parsed, "componentVariantKeys");
  const toolchain = configStringArray(parsed, "toolchainScripts");
  // R2: every toolchain script must exist and carry the config marker.
  const configDir = dirname(resolve(configPath));
  for (const entry of toolchain) {
    const full = resolve(configDir, entry);
    let content = null;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      configFatal(`toolchainScripts: ${full} not found (entries resolve relative to ${configDir})`, 2);
    }
    if (!content.includes(CONFIG_MARKER)) {
      configFatal(`toolchainScripts: ${full} lacks the ${CONFIG_MARKER} marker (pre-config script?)`, 2);
    }
  }
  console.log(`config: ${configPath}`);
  EXEMPT_FILES = new Set(exemptFilesSync);
  EXEMPT_DIRS = new Set(exemptDirs);
  SCHEMA_VARIANT_KEYS = variantKeys;
}

function pathExists(target) {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main (two-phase: materialize everything first, then write — a marker error
// exits 2 with ZERO writes). CLI-only: see the isMain guard at the bottom.
// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  const flags = [];
  const positional = [];
  let configArg = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`--config requires a path — ${usage}`);
        process.exit(2);
      }
      configArg = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--")) flags.push(token);
    else positional.push(token);
  }
  const unknownFlags = flags.filter((f) => f !== "--check");
  if (unknownFlags.length > 0) {
    console.error(`unknown flag "${unknownFlags[0]}" — ${usage}`);
    process.exit(2);
  }
  if (positional.length > 1) {
    console.error(`${usage} (got ${positional.length} positional args)`);
    process.exit(2);
  }
  const check = flags.includes("--check");
  const designRootArg = positional[0] ?? "./design";

  // Config-driven v2: same discovery chain as validate.mjs (validated root =
  // the resolved design-root), loaded before anything else.
  loadConfig(configArg, resolve(process.cwd(), designRootArg.replaceAll("\\", "/")));

try {
  const rootDir = resolve(process.cwd(), designRootArg.replaceAll("\\", "/"));
  let st = null;
  try {
    st = statSync(rootDir);
  } catch {}
  if (!st?.isDirectory()) {
    throw new InputError(`${designRootArg} is not a folder`);
  }

  const { registry, fromFile } = loadRegistry(rootDir);
  if (check && fromFile) {
    // Registry schema v2 enforcement (authored registries only): unknown key
    // / missing key / wrong shape / declared slot missing from its template.
    const schemaErrors = registrySchemaErrors(rootDir, registry);
    if (schemaErrors.length > 0) {
      for (const error of schemaErrors) console.log(`registry-schema: ${error}`);
      console.log(`${schemaErrors.length} registry schema violation(s)`);
      process.exit(1);
    }
  }
  const files = [];
  walkHtml(rootDir, files);

  const pending = []; // { full, rel, html, regions: [{ region, id, nextInner }] }
  const divergences = []; // --check report rows
  const violations = []; // --check schema/drift rows
  const partialCache = new Map();

  for (const full of files) {
    const html = readFileSync(full, "utf8");
    const rel = relLabel(rootDir, full);
    let regions;
    try {
      regions = parseAll(html, registry);
    } catch (error) {
      if (error instanceof MarkerError) {
        // --check drift: a registry enum failure IS "variant outside the
        // registered list" (exit 1, citing component+variant); every other
        // marker failure keeps the parser's own exit 2.
        const enumFailure = /^invalid ([a-z]+)="([^"]*)" for component "([^"]*)"/.exec(error.message);
        if (check && enumFailure) {
          const [, key, value, id] = enumFailure;
          const entry = registry[id];
          const allowed =
            isPlainObject(entry?.variants) && Array.isArray(entry.variants[key])
              ? entry.variants[key].join(", ")
              : "(none)";
          violations.push(
            `${rel}:${lineOf(html, html.indexOf(`component:${id}`))}: component:${id}: variant ${key}="${value}" is outside the registered list (allowed: ${allowed})`
          );
          continue;
        }
        console.error(`${rel}: ${error.code}: ${error.message}`);
        process.exit(2);
      }
      throw error;
    }
    if (regions.length === 0) continue;

    if (check) instanceDriftChecks(registry, regions, rel, html, violations);

    const rewrites = [];
    for (const region of regions) {
      const entry = registry[region.id];
      if (!entry || typeof entry.template !== "string") {
        throw new InputError(`registry has no partial template for component "${region.id}"`);
      }
      if (!partialCache.has(entry.template)) {
        partialCache.set(entry.template, loadPartial(rootDir, entry, region.id));
      }
      const nextInner = materializeInner(region, partialCache.get(entry.template), region.id, entry);
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
    for (const v of violations) console.log(v);
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
    if (divergences.length > 0) console.log(`${divergences.length} divergent region(s)`);
    if (violations.length > 0) console.log(`${violations.length} schema/drift violation(s)`);
    if (divergences.length > 0 || violations.length > 0) {
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
}

// Run the CLI only when executed directly — importing this module (validate.mjs
// w2-9) must never parse argv or exit. realpathSync normalizes case/symlinks so
// the comparison is Windows-safe.
const isMain = (() => {
  try {
    return (
      typeof process.argv[1] === "string" &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (isMain) main();

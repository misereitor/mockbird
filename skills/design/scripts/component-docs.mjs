#!/usr/bin/env node
/**
 * component-docs.mjs — Component Intelligence (todo 22, GAP-C1): the component
 * catalog + automatic per-component docs, derived from the REAL partials
 * (`<design-root>/components/*.html`) and the extended registry
 * (`<design-root>/components/components.json`, schema v2 + catalog extension:
 * schemaVersion + per-entry id/file/states/props/tokensUsed/docs).
 *
 * MARKUP IS NEVER DUPLICATED HERE: every code snippet rendered into a doc is
 * extracted from the partial file at generation time (the doc carries the
 * partial bytes minus trailing whitespace; `--check` and the test suite diff
 * the extracted snippet back against the partial).
 *
 * Derived truth vs declared metadata: `tokensUsed` and `props.markerArgs` in
 * the catalog are ALWAYS derived from the partial (class tokens -> the
 * `var(--token)` names of utilities.css; root `data-*` defaults). The
 * registry's declared copies are validated by `validateComponent`, in two
 * layers:
 *   - buildComponent     = lenient snapshot record (derived values). Used by
 *                          --check/--history so a drifted historical state
 *                          still yields a report (a stale catalog is DETECTED
 *                          in the diff instead of aborting it) and so the
 *                          diff reflects the real partials at each git SHA.
 *   - validateComponent  = the full extension contract (declared keys, id/
 *                          file/name equalities, the six canonical states,
 *                          enum coverage, marker-args mirroring the partial
 *                          root, tokensUsed naming real utility tokens). Run
 *                          by generation as a hard gate (exit 2, every
 *                          violation names the exact component/field) and by
 *                          --check as reported findings (`drift:` rows).
 *                          tokensUsed DRIFT vs the partial is not a violation
 *                          (class-level edits just re-derive; the catalog
 *                          records the derived truth and regeneration repairs
 *                          the docs) — an unknown token name is.
 *
 * Outputs (deterministic — same inputs => byte-identical outputs, registry
 * declaration order everywhere, zero timestamps):
 *   <target>/components/catalog.json   {schemaVersion, generatedBy, registry,
 *                                       mountPreviewHook,
 *                                       components:[{id, name, file, slots,
 *                                       variants, states, props, tokensUsed,
 *                                       docs, source:{partial, partialSha256},
 *                                       previews:[{previewId, variant, state,
 *                                       html}]}]}
 *   <target>/components/<id>.md        one doc per component: description,
 *                                       variants, states, props (marker-args),
 *                                       tokensUsed, slots and the code snippet
 *                                       extracted from the partial.
 *
 * Previews: `buildPreviews` renders every declared variant value (one
 * dimension varied at a time, the rest at the partial's own defaults) and the
 * six canonical interaction states (default, hover, focus, active, disabled,
 * loading — plus any extra state the registry declares) straight from the
 * partial markup. State variants emit NO classes (marker-parser contract), so
 * a preview swaps only the varied dimension's variant class combo
 * (VARIANT_CLASSES — imported, never reimplemented) and the root `data-*`
 * attrs, keeping the partial's own bytes for everything else. The viewer
 * mounting is a documented hook — `mountPreviewHook` (see PREVIEW_HOOK /
 * catalog.json); wiring it into the viewer panels (todo 21) is a separate
 * follow-up.
 *
 * Change history: `--history <from>..<to>` rebuilds the catalog snapshot from
 * the SOURCES at each git SHA (registry + partials + utilities.css via
 * `git show`) and diffs them per component — the diff therefore reflects the
 * real partials even when a committed catalog.json went stale (which is
 * flagged in `catalog.<ref>.stale`, never silently trusted).
 *
 * Usage: node component-docs.mjs --target <design-root> [--check]
 *                                [--history <from>..<to>]
 *   --target    design root (the dir holding components/ and utilities.css)
 *   --check     dry-run: compare the on-disk catalog.json + <id>.md against a
 *               fresh regeneration; exit 1 naming every stale/missing/leftover
 *               file and every registry drift (never writes)
 *   --history   per-component change report between two git SHAs as JSON on
 *               stdout (never writes)
 *
 * Exit codes: 0 ok, 1 = --check found stale outputs or drift, 2 = usage/input
 * error (malformed components.json, missing partial, undeclared variant,
 * registry contract violation during generation, unknown flag/ref). All
 * guided: every error names the exact file/component/field. Generation is
 * all-or-nothing — zero files are written on any failure.
 *
 * Node 18+, stdlib only, ZERO deps. Imports the shared marker grammar parser
 * (marker-parser.mjs) — `parseSlots`, `MarkerError`, `VARIANT_KEYS`,
 * `VARIANT_CLASSES` — never reimplemented here. Import-safe: the CLI runs
 * only when executed directly.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseSlots, MarkerError, VARIANT_KEYS, VARIANT_CLASSES } from "./marker-parser.mjs";

const usage =
  "usage: node component-docs.mjs --target <design-root> [--check] [--history <from>..<to>]";

/** The six canonical interaction states (contract shared with todo 25). */
export const STATES = Object.freeze([
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
]);

export const CATALOG_SCHEMA_VERSION = 1;

/** Documented mounting hook for the viewer panels (todo 21 wires it up). */
export const PREVIEW_HOOK = Object.freeze({
  name: "mountPreviewHook",
  signature: "mountPreviewHook(root: HTMLElement, previews: Preview[]) -> void",
  contract:
    "Monta os previews de variante/estado de um componente num painel do viewer. " +
    "previews = catalog.components[i].previews (cada item traz previewId, variant, state e html " +
    "renderizado a partir do partial real). O viewer registra window.mountPreviewHook e o painel " +
    "de componentes chama uma vez por componente.",
  source: "components/catalog.json#components[].previews",
  status: "documented — montagem no viewer.html é follow-up (arquitetura de painéis, todo 21)",
});

/** Failure with a stable exit code (1 = --check staleness, 2 = usage/input). */
export class DocsError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = "DocsError";
    this.exitCode = exitCode;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Same computation as validate.mjs/codegen.mjs: sha256 over \r-stripped utf8. */
function normalizedSha256(raw) {
  return createHash("sha256").update(raw.toString("utf8").replace(/\r/g, ""), "utf8").digest("hex");
}

// Root open tag + attribute spans (the marker GRAMMAR lives in marker-parser;
// this only reads the partial's own root element).
const TAG_RE = /<([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/;
const ATTR_RE = /([^\s=/>"'<]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]*)))?/g;

function findRootTag(text) {
  const m = TAG_RE.exec(text);
  if (!m) return null;
  return {
    raw: m[0],
    name: m[1],
    attrsRaw: m[2],
    selfClose: m[3] === "/",
    index: m.index,
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
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null;
    out.push({ name: m[1], value, raw: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Partial bytes minus trailing whitespace = the snippet embedded in docs. */
export function extractSnippet(partialHtml) {
  return partialHtml.replace(/\s+$/, "");
}

/** utilities.css -> Map(class -> token names, sorted, no `--` prefix). */
export function loadUtilities(cssText) {
  const map = new Map();
  for (const m of cssText.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
    const tokens = [...new Set([...m[2].matchAll(/var\(--([\w-]+)\)/g)].map((v) => v[1]))].sort();
    map.set(m[1], tokens);
  }
  return map;
}

/** Token names the partial resolves to, through its class tokens. */
export function deriveTokensUsed(partialHtml, utilMap) {
  const classes = [];
  for (const m of partialHtml.matchAll(/class="([^"]*)"/g)) classes.push(...m[1].split(/\s+/).filter(Boolean));
  const tokens = new Set();
  for (const cls of classes) for (const token of utilMap.get(cls) ?? []) tokens.add(token);
  return [...tokens].sort();
}

/**
 * Root `data-*` variant attrs of a partial: { size, tone, state, ... } for
 * every requested key present on the root (values as written).
 */
function rootVariantAttrs(partialHtml, keys) {
  const tag = findRootTag(partialHtml);
  if (tag === null) return {};
  const out = {};
  for (const attr of parseAttrList(tag.attrsRaw)) {
    const bare = attr.name.toLowerCase().startsWith("data-") ? attr.name.toLowerCase().slice("data-".length) : null;
    if (bare !== null && keys.includes(bare)) out[bare] = attr.value ?? "";
  }
  return out;
}

/**
 * Preview render of one variant/state combination: the partial with the root
 * `data-*` attrs set to the resolved values and — only for the varied
 * dimension — the variant class combo swapped (VARIANT_CLASSES — imported,
 * never reimplemented). "One dimension varied at a time, the rest at the
 * partial's own defaults": inner markup, slot defaults and the other
 * dimensions' classes are preserved byte-exact. States emit NO classes
 * (marker-parser contract), so a state preview only rewrites the root attrs.
 * Lenient: a value without a class combo contributes no classes (the strict
 * enum/combo contract is enforced by validateComponent before generation).
 */
function renderPreviewHtml(partialHtml, id, file, resolved, variedKey) {
  const tag = findRootTag(partialHtml);
  if (tag === null) {
    throw new DocsError(2, `entry "${id}": components/${file}: no root element to preview`);
  }
  const remove = new Set();
  const add = [];
  if (variedKey === "size" || variedKey === "tone") {
    const own = rootVariantAttrs(partialHtml, [variedKey])[variedKey];
    // Equal value = no swap: the default preview stays byte-identical to the
    // partial (a truthful preview of "the component as shipped").
    if (own !== resolved[variedKey]) {
      for (const cls of VARIANT_CLASSES[variedKey]?.[own] ?? []) remove.add(cls);
      add.push(...(VARIANT_CLASSES[variedKey]?.[resolved[variedKey]] ?? []));
    }
  }
  const handled = new Set();
  const edits = [];
  // Attribute offsets are relative to the root tag raw text: the edits below
  // apply to `out` (the tag), not to the whole partial.
  const attrBase = 1 + tag.name.length;
  for (const attr of parseAttrList(tag.attrsRaw)) {
    const lname = attr.name.toLowerCase();
    const s = attrBase + attr.start;
    const e = attrBase + attr.end;
    if (lname === "class" && (remove.size > 0 || add.length > 0)) {
      const kept = (attr.value ?? "").split(/\s+/).filter((c) => c.length > 0 && !remove.has(c));
      edits.push({ start: s, end: e, text: `class="${[...kept, ...add].join(" ")}"` });
      handled.add("class");
    } else if (lname.startsWith("data-")) {
      const bare = lname.slice("data-".length);
      if (hasOwn(resolved, bare) && resolved[bare] !== undefined && resolved[bare] !== null) {
        edits.push({ start: s, end: e, text: `${attr.name}="${resolved[bare]}"` });
        handled.add(lname);
      }
    }
  }
  const insertions = [];
  if (!handled.has("class") && add.length > 0) insertions.push(`class="${add.join(" ")}"`);
  for (const [bare, value] of Object.entries(resolved)) {
    if (value === undefined || value === null || handled.has(`data-${bare}`)) continue;
    insertions.push(`data-${bare}="${value}"`);
  }
  const closeIndex = tag.raw.length - (tag.selfClose ? 2 : 1);
  edits.push({ start: closeIndex, end: closeIndex, text: insertions.map((t) => ` ${t}`).join("") });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = tag.raw;
  for (const ed of edits) out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  return partialHtml.slice(0, tag.index) + out + partialHtml.slice(tag.index + tag.raw.length);
}

/**
 * Previews for one component: every declared value of every non-state variant
 * dimension (one varied at a time) + every interaction state (the canonical
 * six first, then any extra state the registry declares). Deterministic order.
 */
export function buildPreviews(entry, partialHtml) {
  const variants = isPlainObject(entry.variants) ? entry.variants : {};
  const defaults = rootVariantAttrs(partialHtml, Object.keys(variants));
  for (const key of VARIANT_KEYS) {
    if (defaults[key] === undefined) defaults[key] = rootVariantAttrs(partialHtml, VARIANT_KEYS)[key];
  }
  const previews = [];
  for (const [key, values] of Object.entries(variants)) {
    if (key === "state") continue; // states are covered below
    for (const value of values) {
      const resolved = { ...defaults, [key]: value };
      previews.push({
        previewId: `${key}=${value}`,
        variant: resolved,
        state: resolved.state ?? "default",
        html: renderPreviewHtml(partialHtml, entry.id, entry.file ?? entry.template, resolved, key),
      });
    }
  }
  const declaredStates = Array.isArray(variants.state) ? variants.state : [];
  const stateValues = [...STATES, ...declaredStates.filter((v) => !STATES.includes(v))];
  for (const value of stateValues) {
    const resolved = { ...defaults, state: value };
    previews.push({
      previewId: `state=${value}`,
      variant: resolved,
      state: value,
      html: renderPreviewHtml(partialHtml, entry.id, entry.file ?? entry.template, resolved, "state"),
    });
  }
  return previews;
}

// ---------------------------------------------------------------------------
// Registry (schema v2 + catalog extension).
// ---------------------------------------------------------------------------
const REQUIRED_ENTRY_KEYS = [
  "name",
  "template",
  "variants",
  "slots",
  "realComponent",
  "dataProps",
  "id",
  "file",
  "states",
  "props",
  "tokensUsed",
  "docs",
];

function readRegistry(readFile, strict = true) {
  const rel = "components/components.json";
  const raw = readFile(rel);
  if (raw === null) {
    throw new DocsError(2, `${rel} not found — expected the extended registry (todo 22)`);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DocsError(2, `${rel}: not valid JSON (${String(error?.message ?? error)}) — fix the file and run again`);
  }
  if (!isPlainObject(parsed)) {
    throw new DocsError(2, `${rel}: the root must be a JSON object of registry entries`);
  }
  // Historical snapshots (--history) may predate the catalog extension: the
  // schemaVersion gate runs for generation/--check only.
  if (strict && (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1)) {
    throw new DocsError(
      2,
      `${rel}: "schemaVersion" must be a positive integer (catalog extension, todo 22) — got ${JSON.stringify(parsed.schemaVersion)}`
    );
  }
  return parsed;
}

/**
 * The full extension contract for ONE entry + its partial. Returns the list of
 * violations (empty = contract-clean); every string names the exact
 * component/field (misleading-success rule: never a generic error).
 */
export function validateComponent(id, entry, partialHtml, utilMap) {
  const violations = [];
  const cite = (message) => violations.push(`entry "${id}": ${message}`);
  if (!isPlainObject(entry)) {
    cite("registry entry must be a JSON object");
    return violations;
  }
  for (const key of REQUIRED_ENTRY_KEYS) {
    if (!hasOwn(entry, key)) cite(`missing required key "${key}"`);
  }
  if (hasOwn(entry, "name") && entry.name !== id) cite(`"name" must equal the registry key (got ${JSON.stringify(entry.name)})`);
  if (hasOwn(entry, "id") && entry.id !== id) cite(`"id" must equal the registry key (got ${JSON.stringify(entry.id)})`);
  if (hasOwn(entry, "file") && hasOwn(entry, "template") && entry.file !== entry.template) {
    cite(`"file" ${JSON.stringify(entry.file)} must equal "template" ${JSON.stringify(entry.template)}`);
  }
  if (typeof entry.realComponent !== "string" || entry.realComponent === "") {
    cite(`"realComponent" must be a non-empty string`);
  }
  if (!isPlainObject(entry.variants)) {
    cite(`"variants" must be a JSON object`);
  } else {
    for (const [key, values] of Object.entries(entry.variants)) {
      if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
        cite(`variants.${key} must be a list of strings`);
        continue;
      }
      if (key === "size" || key === "tone") {
        for (const value of values) {
          if (VARIANT_CLASSES[key]?.[value] === undefined) {
            cite(`variants.${key} value "${value}" has no variant class combo (marker-parser VARIANT_CLASSES)`);
          }
        }
      }
    }
  }
  if (!Array.isArray(entry.states) || entry.states.join(",") !== STATES.join(",")) {
    cite(`"states" must be exactly [${STATES.join(", ")}] (got ${JSON.stringify(entry.states)})`);
  }
  if (!isPlainObject(entry.props) || !isPlainObject(entry.props.markerArgs)) {
    cite(`"props" must be { "markerArgs": { ... } } (marker args of the partial root)`);
  } else {
    const markerArgs = entry.props.markerArgs;
    if (Object.keys(markerArgs).sort().join(",") !== [...VARIANT_KEYS].sort().join(",")) {
      cite(`props.markerArgs must declare exactly ${VARIANT_KEYS.join("/")} (got ${JSON.stringify(Object.keys(markerArgs))})`);
    }
  }
  if (!Array.isArray(entry.tokensUsed) || entry.tokensUsed.some((t) => typeof t !== "string")) {
    cite(`"tokensUsed" must be a list of token names`);
  }
  if (!isPlainObject(entry.docs) || typeof entry.docs.description !== "string" || entry.docs.description === "" ||
      typeof entry.docs.usage !== "string" || entry.docs.usage === "") {
    cite(`"docs" must carry non-empty "description" and "usage" strings`);
  }
  if (!Array.isArray(entry.slots) || entry.slots.some((s) => typeof s !== "string" || s === "")) {
    cite(`"slots" must be a list of non-empty strings`);
  }

  // Cross-checks against the REAL partial.
  const file = typeof entry.file === "string" ? entry.file : entry.template;
  const partialPath = typeof file === "string" ? `components/${file}` : "components/(unset)";
  if (partialHtml === null) {
    cite(`partial not found: ${partialPath}`);
    return violations;
  }
  const tag = findRootTag(partialHtml);
  if (tag === null) {
    cite(`${partialPath}: no root element`);
    return violations;
  }
  const variantKeys = isPlainObject(entry.variants) ? Object.keys(entry.variants) : [];
  for (const attr of parseAttrList(tag.attrsRaw)) {
    const lname = attr.name.toLowerCase();
    if (!lname.startsWith("data-")) continue;
    const bare = lname.slice("data-".length);
    if (bare !== "component" && !variantKeys.includes(bare)) {
      cite(`${partialPath}: undeclared variant attribute "${attr.name}" on the root (declared: data-component, ${variantKeys.map((k) => `data-${k}`).join(", ")})`);
    }
  }
  const rootAttrs = rootVariantAttrs(partialHtml, variantKeys);
  for (const key of variantKeys) {
    const value = rootAttrs[key];
    if (value === undefined) continue; // not carried by the root (e.g. device)
    const enums = isPlainObject(entry.variants) && Array.isArray(entry.variants[key]) ? entry.variants[key] : null;
    if (enums === null || !enums.includes(value)) {
      cite(`${partialPath}: undeclared variant data-${key}="${value}" (allowed: ${enums === null ? "(none)" : enums.join(", ")})`);
    }
  }
  const derivedMarker = rootVariantAttrs(partialHtml, VARIANT_KEYS);
  if (isPlainObject(entry.props) && isPlainObject(entry.props.markerArgs)) {
    for (const key of VARIANT_KEYS) {
      if (!hasOwn(entry.props.markerArgs, key)) continue;
      if (derivedMarker[key] === undefined) {
        cite(`props.markerArgs.${key} has no matching data-${key} on the partial root (${partialPath})`);
      } else if (entry.props.markerArgs[key] !== derivedMarker[key]) {
        cite(`props.markerArgs.${key} ${JSON.stringify(entry.props.markerArgs[key])} differs from the partial root data-${key} ${JSON.stringify(derivedMarker[key])} (${partialPath})`);
      }
    }
  }
  if (Array.isArray(entry.tokensUsed)) {
    // Contract (header): an unknown token NAME is a violation; declared-vs-
    // derived DRIFT is not — class edits just re-derive, the catalog records
    // the derived truth and regeneration repairs the docs.
    const known = new Set([...utilMap.values()].flat());
    const unknown = entry.tokensUsed.filter((t) => typeof t === "string" && !known.has(t));
    if (unknown.length > 0) {
      cite(`"tokensUsed" names ${unknown.map((t) => `"${t}"`).join(", ")} — not a utility token (no var(--*) in utilities.css)`);
    }
  }
  try {
    const slotNames = Object.keys(parseSlots(partialHtml));
    if (Array.isArray(entry.slots)) {
      for (const slot of entry.slots) {
        if (typeof slot === "string" && slot !== "" && !slotNames.includes(slot)) {
          cite(`declared slot "${slot}" is missing from ${partialPath}`);
        }
      }
    }
  } catch (error) {
    if (error instanceof MarkerError) cite(`${partialPath}: ${error.code}: ${error.message}`);
    else throw error;
  }
  return violations;
}

/**
 * Lenient snapshot record from the registry entry + its partial: derived truth
 * for tokensUsed/props.markerArgs/previews/source/snippet, declared values for
 * the descriptive fields (with safe fallbacks so historical states that
 * predate the extension still diff). Contract enforcement lives in
 * validateComponent.
 */
export function buildComponent(id, entry, partialHtml, utilMap) {
  if (!isPlainObject(entry)) {
    throw new DocsError(2, `entry "${id}": registry entry must be a JSON object`);
  }
  const file = typeof entry.file === "string" ? entry.file : entry.template;
  if (typeof file !== "string" || file === "") {
    throw new DocsError(2, `entry "${id}": no partial file (missing "file"/"template")`);
  }
  const partialPath = `components/${file}`;
  if (partialHtml === null) {
    throw new DocsError(2, `entry "${id}": partial not found: ${partialPath}`);
  }
  const derivedMarker = rootVariantAttrs(partialHtml, VARIANT_KEYS);
  const record = {
    id,
    name: typeof entry.name === "string" ? entry.name : id,
    file,
    realComponent: typeof entry.realComponent === "string" ? entry.realComponent : "",
    slots: Array.isArray(entry.slots) ? [...entry.slots] : [],
    variants: isPlainObject(entry.variants) ? JSON.parse(JSON.stringify(entry.variants)) : {},
    states: Array.isArray(entry.states) ? [...entry.states] : [],
    props: { markerArgs: derivedMarker },
    tokensUsed: deriveTokensUsed(partialHtml, utilMap),
    docs: {
      description: isPlainObject(entry.docs) && typeof entry.docs.description === "string" ? entry.docs.description : "",
      usage: isPlainObject(entry.docs) && typeof entry.docs.usage === "string" ? entry.docs.usage : "",
    },
    source: { partial: partialPath, partialSha256: normalizedSha256(partialHtml) },
    previews: buildPreviews({ ...entry, id, file }, partialHtml),
  };
  return { record, snippet: extractSnippet(partialHtml) };
}

/** File-level metadata keys of the extended registry (never components). */
const REGISTRY_METADATA_KEYS = new Set(["schemaVersion"]);

/**
 * Snapshot of the whole catalog from a source reader — `readFile(rel)` returns
 * the file bytes or null when absent (real fs for generation/--check, `git
 * show` at a SHA for --history). Two passes: the validateComponent contract
 * violations of every entry are collected first (never fatal here), then the
 * lenient snapshot records are built. Returns {catalog, parts, violations}
 * with `parts` = [{id, record, snippet}] in registry declaration order.
 */
export function buildCatalog({ readFile, strict = true }) {
  const registry = readRegistry(readFile, strict);
  const cssText = readFile("utilities.css");
  if (cssText === null) {
    throw new DocsError(2, "utilities.css not found — expected the design root utilities (tokensUsed derivation)");
  }
  const utilMap = loadUtilities(cssText);
  const prepared = [];
  for (const id of Object.keys(registry)) {
    if (REGISTRY_METADATA_KEYS.has(id)) continue;
    const entry = registry[id];
    const file = isPlainObject(entry) ? (typeof entry.file === "string" ? entry.file : entry.template) : null;
    const partialHtml = typeof file === "string" && file !== "" ? readFile(`components/${file}`) : null;
    prepared.push({ id, entry, partialHtml });
  }
  const violations = prepared.flatMap(({ id, entry, partialHtml }) => validateComponent(id, entry, partialHtml, utilMap));
  const parts = prepared.map(({ id, entry, partialHtml }) => ({ id, ...buildComponent(id, entry, partialHtml, utilMap) }));
  const catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    generatedBy: "skills/design/scripts/component-docs.mjs",
    registry: "components/components.json",
    mountPreviewHook: { ...PREVIEW_HOOK },
    components: parts.map(({ record }) => record),
  };
  return { catalog, parts, violations };
}

/** Marker every generated doc carries — the leftover detector's identity test. */
const GENERATED_MARKER = "<!-- generated by skills/design/scripts/component-docs.mjs";

function tickList(values) {
  return values.length > 0 ? values.map((v) => `\`${v}\``).join(", ") : "(nenhum)";
}

/**
 * One generated doc per component: descriptive fields from the registry, the
 * code snippet extracted from the real partial (byte-preserved — the misleading
 * success guard; --check and the test suite diff it back). No timestamps.
 */
function renderDoc(record, snippet) {
  const lines = [];
  lines.push(`${GENERATED_MARKER} - do not edit -->`);
  lines.push("");
  lines.push(`# \`${record.id}\` (${record.realComponent})`);
  lines.push("");
  lines.push(record.docs.description);
  lines.push("");
  lines.push("## Uso");
  lines.push("");
  lines.push(record.docs.usage);
  lines.push("");
  lines.push("## Arquivo");
  lines.push("");
  lines.push(`- Parcial: \`components/${record.file}\``);
  lines.push(`- Componente React: \`${record.realComponent}\``);
  lines.push(`- Slots: ${tickList(record.slots)}`);
  lines.push("");
  lines.push("## Variantes");
  lines.push("");
  for (const [key, values] of Object.entries(record.variants)) {
    lines.push(`- \`${key}\`: ${tickList(values)}`);
  }
  lines.push("");
  lines.push("## Estados");
  lines.push("");
  lines.push(tickList(record.states));
  lines.push("");
  lines.push("## Props (marker-args)");
  lines.push("");
  for (const key of VARIANT_KEYS) {
    lines.push(`- \`${key}\`: \`${record.props.markerArgs[key]}\``);
  }
  lines.push("");
  lines.push("## Tokens usados");
  lines.push("");
  lines.push(tickList(record.tokensUsed));
  lines.push("");
  lines.push("## Código do partial");
  lines.push("");
  lines.push(`Extraído de \`components/${record.file}\` na geração (diff assertado contra o partial real):`);
  lines.push("");
  lines.push("```html");
  lines.push(snippet);
  lines.push("```");
  return lines.join("\n") + "\n";
}

/**
 * Output files for a built catalog: `components/catalog.json` + one
 * `components/<id>.md` per component. Pure + deterministic (same build => same
 * bytes; Map order is the write/check order).
 */
export function renderOutputs(build) {
  const outputs = new Map();
  outputs.set("components/catalog.json", JSON.stringify(build.catalog, null, 2) + "\n");
  for (const { id, record, snippet } of build.parts) {
    outputs.set(`components/${id}.md`, renderDoc(record, snippet));
  }
  return outputs;
}

/**
 * Field-level catalog diff: one {id, status, changedFields} per component
 * (union of both catalogs, before order first). status = added|removed|
 * changed|unchanged; changedFields lists the differing record fields in record
 * key order. Pure.
 */
export function diffCatalogs(before, after) {
  const byId = (catalog) => new Map((isPlainObject(catalog) && Array.isArray(catalog.components) ? catalog.components : []).map((c) => [c.id, c]));
  const a = byId(before);
  const b = byId(after);
  const ids = [...a.keys(), ...[...b.keys()].filter((id) => !a.has(id))];
  return ids.map((id) => {
    const x = a.get(id);
    const y = b.get(id);
    if (x === undefined) return { id, status: "added", changedFields: Object.keys(y) };
    if (y === undefined) return { id, status: "removed", changedFields: Object.keys(x) };
    const keys = [...Object.keys(x), ...Object.keys(y).filter((k) => !hasOwn(x, k))];
    const changedFields = keys.filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
    return { id, status: changedFields.length > 0 ? "changed" : "unchanged", changedFields };
  });
}

// ---------------------------------------------------------------------------
// CLI — runs only when executed directly (import-safe module contract).
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { target: null, check: false, history: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check") {
      opts.check = true;
      continue;
    }
    if (token === "--target" || token === "--history") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new DocsError(2, `${token} requires a value — ${usage}`);
      }
      if (token === "--target") opts.target = value;
      else opts.history = value;
      i += 1;
      continue;
    }
    throw new DocsError(2, `unexpected argument "${token}" — ${usage}`);
  }
  if (opts.target === null) throw new DocsError(2, `--target is required — ${usage}`);
  if (opts.check && opts.history !== null) {
    throw new DocsError(2, `--check and --history are mutually exclusive — ${usage}`);
  }
  return opts;
}

function runGenerate(root, build) {
  if (build.violations.length > 0) {
    for (const violation of build.violations) console.error(violation);
    console.error(`component-docs: ${build.violations.length} registry contract violation(s) — nothing written`);
    process.exit(2);
  }
  const outputs = renderOutputs(build);
  mkdirSync(join(root, "components"), { recursive: true });
  for (const [rel, content] of outputs) {
    writeFileSync(join(root, rel), content, "utf8");
    console.log(`wrote ${rel}`);
  }
  console.log(`ok: ${outputs.size} file(s)`);
}

function runCheck(root, build) {
  const outputs = renderOutputs(build);
  const findings = [];
  for (const [rel, content] of outputs) {
    let current = null;
    try {
      current = readFileSync(join(root, rel), "utf8");
    } catch {
      current = null;
    }
    if (current === null) findings.push(`missing: ${rel}`);
    else if (current !== content) findings.push(`stale: ${rel}`);
  }
  // Leftovers = generated docs (self-identified by their marker) whose
  // component no longer maps to an expected output.
  const expected = new Set(outputs.keys());
  let names = [];
  try {
    names = readdirSync(join(root, "components"));
  } catch {
    names = [];
  }
  for (const name of names.sort()) {
    const rel = `components/${name}`;
    if (expected.has(rel) || !name.endsWith(".md")) continue;
    let text = "";
    try {
      text = readFileSync(join(root, "components", name), "utf8");
    } catch {
      continue;
    }
    if (text.includes(GENERATED_MARKER)) findings.push(`leftover: ${rel}`);
  }
  for (const violation of build.violations) findings.push(`drift: ${violation}`);
  if (findings.length > 0) {
    for (const finding of findings) console.log(finding);
    process.exit(1);
  }
  console.log(`up to date (${outputs.size} files)`);
}

function runHistory(opts, root) {
  const [from, to] = opts.history.split("..");
  if (!from || !to) throw new DocsError(2, `--history expects <from>..<to> — ${usage}`);
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  let repoRoot = null;
  try {
    repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new DocsError(2, `${opts.target}: not inside a git repository — --history reads the sources at each SHA`);
  }
  for (const ref of [from, to]) {
    try {
      git(["rev-parse", "--verify", `${ref}^{commit}`]);
    } catch {
      throw new DocsError(2, `unknown git ref "${ref}" (${opts.history})`);
    }
  }
  const prefix = relative(repoRoot, root).split(sep).join("/");
  const readFileAt = (ref) => (rel) => {
    const path = prefix === "" ? rel : `${prefix}/${rel}`;
    try {
      return git(["show", `${ref}:${path}`]);
    } catch {
      return null;
    }
  };
  const catalogState = {};
  const snapshots = {};
  for (const ref of [from, to]) {
    const build = buildCatalog({ readFile: readFileAt(ref), strict: false });
    snapshots[ref] = build.catalog;
    // A committed catalog.json is TRUSTED only after being diffed against the
    // rebuild from the real sources at the same SHA: any component whose
    // record differs (or is absent/malformed) lands in `stale`.
    const committedRaw = readFileAt(ref)("components/catalog.json");
    const byId = new Map();
    if (committedRaw !== null) {
      try {
        const committed = JSON.parse(committedRaw);
        if (isPlainObject(committed) && Array.isArray(committed.components)) {
          for (const record of committed.components) {
            if (isPlainObject(record) && typeof record.id === "string") byId.set(record.id, record);
          }
        }
      } catch {
        // malformed committed catalog: every record reads as stale
      }
    }
    catalogState[ref] = {
      present: committedRaw !== null,
      stale: build.catalog.components
        .filter((record) => {
          const committed = byId.get(record.id);
          return committed === undefined || JSON.stringify(committed) !== JSON.stringify(record);
        })
        .map((record) => record.id),
    };
  }
  const report = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    range: { from, to },
    components: diffCatalogs(snapshots[from], snapshots[to]),
    catalog: { [from]: catalogState[from], [to]: catalogState[to] },
  };
  console.log(JSON.stringify(report, null, 2));
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const root = resolve(opts.target);
    if (opts.history !== null) return runHistory(opts, root);
    const readFile = (rel) => {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return null;
      }
    };
    const build = buildCatalog({ readFile });
    if (opts.check) return runCheck(root, build);
    return runGenerate(root, build);
  } catch (error) {
    if (error instanceof DocsError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(`internal: ${String(error?.message ?? error)}`);
    process.exit(2);
  }
}

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

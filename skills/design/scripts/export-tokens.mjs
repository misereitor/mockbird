#!/usr/bin/env node
/**
 * export-tokens.mjs - W3C/DTCG interchange export (todo 26).
 *
 * The two-file separation (why both exist):
 *   tokens.json     = SOURCE with the pack metadata ("fonte com metadados do
 *                     pack"): the DTCG-ish tree the design system is generated
 *                     from, plus the pack's own `$extensions` (for example
 *                     `$extensions.designPack.contrastPairs`). It never leaves
 *                     the project; every pack tool reads it as-is.
 *   tokens.w3c.json = INTERCHANGE ("intercambio"): PURE DTCG - only groups,
 *                     `$type` and `$value`, with ALL `$extensions` and every
 *                     other metadata key stripped (designPack.contrastPairs
 *                     included). DERIVED artifact: regenerate with this
 *                     script, never edit by hand.
 *
 * Derived-artifact contract: `tokens.w3c.json` is EXEMPT BY NAME from
 * `inventory-extra` and from staleness checks (a derived file is expected to
 * differ from hand-written inventories). The exemption proof runs at the
 * inventory wave (`--example-inventory`); this script does NO inventory work.
 * The file is NEVER versioned in `assets/example/` - regenerate it wherever
 * the project needs the interchange copy.
 *
 * Usage: node export-tokens.mjs [design-root]
 *   design-root   default `./design` relative to the current working directory
 *   writes <design-root>/tokens.w3c.json
 *   Deterministic/idempotent: identical tokens.json bytes => byte-identical
 *   tokens.w3c.json; running it again over the same input changes nothing.
 *
 * Exit codes: 0 ok, 2 usage/input error (unreadable or invalid JSON, root not
 * an object, token missing $value, unknown flag).
 * Node 18+, stdlib only (node:fs, node:path).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const usage = "usage: export-tokens.mjs [design-root]";

function fail(message) {
  process.stderr.write(`export-tokens: ${message}\n`);
  process.exit(2);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * One token-tree node -> pure DTCG node (only $type/$value/groups).
 * Token: owns `$value` -> keep `$type` (when a string) + `$value` (opaque).
 * Group: no `$value` but non-$ children -> keep `$type` (when a string) + the
 *        children; every other key ($extensions, $description, ...) is
 *        stripped on the way out.
 * Anything else (non-object entry, or no `$value` and no children) is an
 * input error - a token without $value can never be exported.
 */
function exportEntry(entry, pathParts) {
  const dotted = pathParts.join(".");
  if (!isPlainObject(entry)) {
    fail(`token "${dotted}" must be an object with $value`);
  }
  if (Object.prototype.hasOwnProperty.call(entry, "$value")) {
    const token = {};
    if (typeof entry.$type === "string") token.$type = entry.$type;
    token.$value = entry.$value;
    return token;
  }
  const hasChildren = Object.keys(entry).some((key) => !key.startsWith("$"));
  if (!hasChildren) {
    fail(`token "${dotted}" missing $value`);
  }
  return exportGroup(entry, pathParts);
}

function exportGroup(group, pathParts) {
  const out = {};
  if (typeof group.$type === "string") out.$type = group.$type;
  for (const [key, entry] of Object.entries(group)) {
    if (key.startsWith("$")) continue; // $extensions & friends never cross the wire
    out[key] = exportEntry(entry, [...pathParts, key]);
  }
  return out;
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  if (flags.length > 0) {
    fail(`unknown flag "${flags[0]}" — ${usage}`);
  }
  if (argv.length > 1) {
    fail(`${usage} (got ${argv.length} positional args)`);
  }

  const root = resolve(argv[0] ?? "./design");
  const tokensPath = join(root, "tokens.json");
  let raw;
  try {
    raw = readFileSync(tokensPath);
  } catch {
    fail(`cannot read ${tokensPath}`);
  }
  let tokens;
  try {
    tokens = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    fail(`invalid JSON in ${tokensPath}: ${err.message}`);
  }
  if (!isPlainObject(tokens)) {
    fail(`invalid tokens in ${tokensPath}: root must be an object`);
  }

  // Root is just the top group: $extensions drops out here like everywhere else.
  const result = exportGroup(tokens, []);

  const outPath = join(root, "tokens.w3c.json");
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${outPath}\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)) ?? 0);

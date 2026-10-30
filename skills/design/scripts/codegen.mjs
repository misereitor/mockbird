#!/usr/bin/env node
/**
 * codegen.mjs — typed React TSX generator driven by components.json (todo 22,
 * GAP-8 bridge half). For every registry entry it emits ONE `<realComponent>.tsx`
 * file into `--out <dir>` (default `<design-root>/generated/`) carrying:
 *
 *   - `<RealComponent>Props` interface + typed `<RealComponent>` function
 *     component — genuinely typed (string-literal unions, ReactNode slots),
 *     zero `any`, zero ts-ignore. Generation ONLY: no TypeScript/esbuild/build
 *     dependency is added anywhere.
 *   - Variants: one optional prop per NON-EMPTY registry variant list
 *     (`variants: {size,tone,state,device}` — empty list = variant not offered),
 *     typed as the DECLARED literal set (e.g. `size?: "sm" | "md" | "lg"`),
 *     re-emitted as `data-<key>={prop}` on the root element.
 *   - data-* <-> props bridge: one optional `string` prop per `dataProps` entry,
 *     named EXACTLY as declared (attr name -> prop name, NEVER invented), and
 *     re-emitted as `<attr>={prop}` on the root element. The interface carries
 *     the literal `attr -> prop` mapping as a comment per prop.
 *   - Slots: `slots?: { <name>?: ReactNode }` over the DECLARED slots list,
 *     rendered as `{slots?.<name>}` children (nested object so slot names never
 *     collide with dataProps prop names — e.g. toast slot "action" vs prop
 *     "action").
 *   - Root element tag = the entry template's root tag (the `template` field of
 *     the entry, read from `<design-root>/components/<template>`).
 *
 * Output contract (per generated file):
 *   - first comment block is a GENERATED banner holding the SAME tokens-hash
 *     validate.mjs staleness pins use (sha256 over `<design-root>/tokens.json`
 *     utf8 bytes with all \r removed — byte-for-byte the validate.mjs
 *     checkStaleness computation, reused by definition, never reimplemented
 *     differently) plus `config-sha256` (same normalization over the
 *     validate.config.json bytes).
 *   - deterministic: identical input bytes => byte-identical output (registry
 *     declaration order everywhere, zero timestamps).
 *
 * Usage: node codegen.mjs [--config <path>] [--design <path>] [--only a,b]
 *                         [--out <dir>]
 *   --design      design root, default `./design` relative to cwd
 *   --config      explicit validate.config.json path (discovery chain without
 *                 it: <design-root>/validate.config.json -> ./validate.config.json)
 *   --only        comma-separated registry keys; ONLY those entries generate
 *                 (partial generation — IS-8); unknown key = exit 2 citing it
 *   --out         output dir, default `<design-root>/generated/`
 *
 * dataProps guard rails (the data-action contract): an entry WITHOUT dataProps
 * (missing/empty/malformed) is NEVER generated — exit 1 citing the component
 * name; `on*` prop names are refused (exit 2) so generated output can never
 * carry an event-handler prop.
 *
 * Exit codes: 0 ok, 1 = selected entry lacks dataProps (cites the component),
 * 2 = usage/input error (unknown flag/key, missing/invalid file or shape),
 * 3 = missing/unreadable validate.config.json (guided setup, mirroring
 * sync-components.mjs). All-or-nothing: zero files are written on any failure.
 *
 * Node 18+, stdlib only (node:fs, node:path, node:crypto), ZERO deps.
 * Import-safe: the CLI runs only when executed directly; `runCodegen` is the
 * entry point `sync-components.mjs --codegen` calls (same code path).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const usage =
  "usage: node codegen.mjs [--config <path>] [--design <path>] [--only a,b] [--out <dir>]";
const CONFIG_NAME = "validate.config.json";

/** Failure with a stable exit code (1 = dataProps gap, 2 = usage/input, 3 = config). */
export class CodegenError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = "CodegenError";
    this.exitCode = exitCode;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DATA_ATTR_RE = /^data-[A-Za-z][A-Za-z0-9-]*$/;
const ON_PROP_RE = /^on[A-Za-z]/;

/** Same computation as validate.mjs checkStaleness: sha256 over \r-stripped utf8. */
function normalizedSha256(raw) {
  return createHash("sha256").update(raw.toString("utf8").replace(/\r/g, ""), "utf8").digest("hex");
}

function readRequired(path, what, exitCode) {
  try {
    return readFileSync(path);
  } catch {
    throw new CodegenError(exitCode, `${path}: ${what} not found`);
  }
}

function loadConfigPath(configArg, rootDir) {
  // Discovery chain mirrors sync-components.mjs/validate.mjs: --config ->
  // <design-root>/validate.config.json -> ./validate.config.json; absent or
  // unreadable = exit 3 guided, never a silent fallback.
  let configPath = null;
  if (configArg !== null) {
    configPath = configArg;
  } else {
    const candidates = [join(rootDir, CONFIG_NAME), join(process.cwd(), CONFIG_NAME)];
    configPath = candidates.find((candidate) => {
      try {
        statSync(candidate);
        return true;
      } catch {
        return false;
      }
    }) ?? null;
    if (configPath === null) {
      throw new CodegenError(
        3,
        `${CONFIG_NAME} not found (checked ${candidates[0]} and ${candidates[1]}) — run setup-design.mjs to seed it (or copy skills/design/assets/${CONFIG_NAME} from the skill folder)`
      );
    }
  }
  const raw = readRequired(configPath, CONFIG_NAME, 3);
  let parsed = null;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new CodegenError(2, `${configPath}: ${CONFIG_NAME} is not valid JSON`);
  }
  if (!isPlainObject(parsed)) {
    throw new CodegenError(2, `${configPath}: ${CONFIG_NAME} must have a JSON object at its root`);
  }
  return { configPath, configSha: normalizedSha256(raw) };
}

/**
 * Validate ONE selected registry entry against schema v2 (the generation
 * contract — names are taken as declared, never invented) and return the
 * normalized shape. dataProps is the ONLY exit-1 class (acceptance (b)).
 */
function validateEntry(key, entry, componentsDir) {
  const cite = (message) => `${key}: ${message}`;
  if (!isPlainObject(entry)) throw new CodegenError(2, cite("registry entry must be a JSON object"));
  if (entry.name !== key) {
    throw new CodegenError(2, cite(`"name" must equal the registry key (got ${JSON.stringify(entry.name)})`));
  }
  const { realComponent } = entry;
  if (typeof realComponent !== "string" || !IDENT_RE.test(realComponent)) {
    throw new CodegenError(2, cite(`"realComponent" must be a TS identifier (got ${JSON.stringify(realComponent)})`));
  }
  if (typeof entry.template !== "string" || entry.template === "") {
    throw new CodegenError(2, cite(`"template" must be a non-empty string (got ${JSON.stringify(entry.template)})`));
  }
  const templatePath = join(componentsDir, entry.template);
  let rootTag = null;
  try {
    const first = readFileSync(templatePath, "utf8").trimStart();
    rootTag = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(first)?.[1] ?? null;
  } catch {
    rootTag = null;
  }
  if (rootTag === null) {
    throw new CodegenError(2, cite(`template ${entry.template}: cannot read a root tag from ${templatePath}`));
  }
  if (!isPlainObject(entry.variants)) {
    throw new CodegenError(2, cite(`"variants" must be a JSON object (got ${JSON.stringify(entry.variants)})`));
  }
  const variants = [];
  for (const [vKey, values] of Object.entries(entry.variants)) {
    if (!IDENT_RE.test(vKey)) throw new CodegenError(2, cite(`variant key ${JSON.stringify(vKey)} must be a TS identifier`));
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
      throw new CodegenError(2, cite(`variant "${vKey}" must be a list of strings`));
    }
    if (values.length > 0) variants.push({ key: vKey, values });
  }
  if (!Array.isArray(entry.slots) || entry.slots.some((s) => typeof s !== "string" || s === "")) {
    throw new CodegenError(2, cite(`"slots" must be a list of non-empty strings (got ${JSON.stringify(entry.slots)})`));
  }
  const slots = [...entry.slots];
  if (new Set(slots).size !== slots.length) throw new CodegenError(2, cite(`"slots" has duplicate names`));

  // dataProps: the declared data-* -> props bridge. Missing/empty/malformed =
  // NEVER generate: exit 1 citing the component (acceptance (b)).
  const dataPropsRaw = entry.dataProps;
  const dataProps = [];
  if (!isPlainObject(dataPropsRaw) || Object.keys(dataPropsRaw).length === 0) {
    throw new CodegenError(
      1,
      `${key} (${realComponent}): entry without dataProps — declare the data-* -> props bridge in components.json (generation refused)`
    );
  }
  for (const [attr, prop] of Object.entries(dataPropsRaw)) {
    if (!DATA_ATTR_RE.test(attr)) {
      throw new CodegenError(2, cite(`dataProps key ${JSON.stringify(attr)} must be a data-* attribute`));
    }
    if (typeof prop !== "string" || !IDENT_RE.test(prop)) {
      throw new CodegenError(2, cite(`dataProps ${attr} -> ${JSON.stringify(prop)}: prop name must be a TS identifier`));
    }
    if (ON_PROP_RE.test(prop)) {
      throw new CodegenError(2, cite(`dataProps ${attr} -> "${prop}": on* props are forbidden (data-action contract)`));
    }
    dataProps.push({ attr, prop });
  }
  // Prop-name collisions produce invalid TSX — refuse loudly instead.
  const seen = new Map([["slots", "slots"]]);
  for (const { key: vKey } of variants) seen.set(vKey, `variant "${vKey}"`);
  for (const { attr, prop } of dataProps) {
    const prior = seen.get(prop);
    if (prior !== undefined) {
      throw new CodegenError(2, cite(`prop "${prop}" (from ${attr}) collides with ${prior}`));
    }
    seen.set(prop, `dataProps ${attr}`);
  }
  return { key, realComponent, rootTag, variants, slots, dataProps };
}

/** Render the TSX for one validated entry. Pure: same shape => same bytes. */
function renderTsx(shape, banner) {
  const { key, realComponent, rootTag, variants, slots, dataProps } = shape;
  const propsName = `${realComponent}Props`;
  const lines = [];
  lines.push(banner);
  lines.push(
    slots.length > 0
      ? `import type { ReactElement, ReactNode } from "react";`
      : `import type { ReactElement } from "react";`
  );
  lines.push("");
  lines.push(`export interface ${propsName} {`);
  for (const { key: vKey, values } of variants) {
    lines.push(`  ${vKey}?: ${values.map((v) => JSON.stringify(v)).join(" | ")};`);
  }
  for (const { attr, prop } of dataProps) {
    lines.push(`  /** ${attr} -> ${prop} (components.json dataProps) */`);
    lines.push(`  ${prop}?: string;`);
  }
  if (slots.length > 0) {
    lines.push(`  slots?: {`);
    for (const slot of slots) {
      lines.push(`    ${IDENT_RE.test(slot) ? slot : JSON.stringify(slot)}?: ReactNode;`);
    }
    lines.push(`  };`);
  }
  lines.push(`}`);
  lines.push("");
  const paramNames = [
    ...variants.map((v) => v.key),
    ...dataProps.map((d) => d.prop),
    ...(slots.length > 0 ? ["slots"] : []),
  ];
  lines.push(
    `export function ${realComponent}({ ${paramNames.join(", ")} }: ${propsName}): ReactElement {`
  );
  lines.push(`  return (`);
  lines.push(`    <${rootTag}`);
  lines.push(`      data-component=${JSON.stringify(key)}`);
  for (const { key: vKey } of variants) {
    lines.push(`      data-${vKey}={${vKey}}`);
  }
  for (const { attr, prop } of dataProps) {
    lines.push(`      ${attr}={${prop}}`);
  }
  if (slots.length > 0) {
    lines.push(`    >`);
    for (const slot of slots) {
      lines.push(`      {slots?.${IDENT_RE.test(slot) ? slot : `[${JSON.stringify(slot)}]`}}`);
    }
    lines.push(`    </${rootTag}>`);
  } else {
    lines.push(`    />`);
  }
  lines.push(`  );`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

/**
 * Generate every selected entry into outDir. `only` = array of registry keys or
 * null (all). `configPath` = resolved validate.config.json (required — its
 * sha256 lands in every header). Returns the written file list in registry
 * order. Throws CodegenError; ZERO writes happen on failure (two-phase).
 */
export function runCodegen({ rootDir, configPath, only = null, outDir = null }) {
  const resolvedRoot = resolve(rootDir);
  const registryPath = join(resolvedRoot, "components", "components.json");
  const registryRaw = readRequired(registryPath, "components.json", 2);
  let registry = null;
  try {
    registry = JSON.parse(registryRaw.toString("utf8"));
  } catch {
    throw new CodegenError(2, `${registryPath}: components.json is not valid JSON`);
  }
  if (!isPlainObject(registry)) {
    throw new CodegenError(2, `${registryPath}: components.json must have a JSON object at its root`);
  }

  const { configSha } = loadConfigPath(configPath, resolvedRoot);
  const tokensRaw = readRequired(join(resolvedRoot, "tokens.json"), "tokens.json", 2);
  const tokensHash = normalizedSha256(tokensRaw);

  let keys = Object.keys(registry);
  if (only !== null) {
    for (const wanted of only) {
      if (!Object.prototype.hasOwnProperty.call(registry, wanted)) {
        throw new CodegenError(2, `--only: unknown component "${wanted}" (not in ${registryPath})`);
      }
    }
    const wantedSet = new Set(only);
    keys = keys.filter((k) => wantedSet.has(k));
  }

  const componentsDir = join(resolvedRoot, "components");
  const seenFiles = new Map();
  const staged = [];
  for (const key of keys) {
    const shape = validateEntry(key, registry[key], componentsDir);
    const file = `${shape.realComponent}.tsx`;
    const prior = seenFiles.get(file);
    if (prior !== undefined) {
      throw new CodegenError(2, `${key}: realComponent ${shape.realComponent} duplicates ${prior} (file ${file})`);
    }
    seenFiles.set(file, key);
    const banner = [
      "/* GENERATED by codegen.mjs — do not edit.",
      ` * component: ${key} -> ${file} (registry: components/components.json)`,
      ` * tokens-hash: ${tokensHash}`,
      ` * config-sha256: ${configSha}`,
      " */",
    ].join("\n");
    staged.push({ key, file, content: renderTsx(shape, banner) });
  }

  const targetDir = resolve(outDir ?? join(resolvedRoot, "generated"));
  mkdirSync(targetDir, { recursive: true });
  for (const { file, content } of staged) {
    writeFileSync(join(targetDir, file), content, "utf8");
  }
  return staged.map(({ key, file }) => ({ key, file, dir: targetDir }));
}

// ---------------------------------------------------------------------------
// CLI — runs only when executed directly (import-safe module contract).
// ---------------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  let configArg = null;
  let designArg = "./design";
  let onlyArg = null;
  let outArg = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config" || token === "--design" || token === "--only" || token === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`${token} requires a value — ${usage}`);
        process.exit(2);
      }
      if (token === "--config") configArg = value;
      else if (token === "--design") designArg = value;
      else if (token === "--only") onlyArg = value;
      else outArg = value;
      i += 1;
      continue;
    }
    console.error(`unknown flag "${token}" — ${usage}`);
    process.exit(2);
  }
  let only = null;
  if (onlyArg !== null) {
    only = onlyArg.split(",").map((name) => name.trim());
    if (only.some((name) => name === "")) {
      console.error(`--only needs comma-separated component names — ${usage}`);
      process.exit(2);
    }
  }
  const rootDir = resolve(process.cwd(), designArg.replaceAll("\\", "/"));
  try {
    const written = runCodegen({ rootDir, configPath: configArg, only, outDir: outArg });
    for (const { key, file, dir } of written) {
      console.log(`codegen: ${key} -> ${join(dir, file).split(sep).join("/")}`);
    }
    console.log(`codegen: wrote ${written.length} file(s)`);
  } catch (error) {
    if (error instanceof CodegenError) {
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

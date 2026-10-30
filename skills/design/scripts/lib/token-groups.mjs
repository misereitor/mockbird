/**
 * token-groups.mjs — the contract token groups (todo 19, GAP-7): motion,
 * density, breakpoints and layers with their EXACT declared values (nothing
 * else). Pure data module: no fs, no side effects, no config discovery.
 *
 * Single source of truth for the contract groups the toolchain emits into the
 * two token artifacts:
 *   gen-tokens.mjs    writes them into every theme section of
 *                     <design-root>/tokens.json (declared values win; the file
 *                     is serialized deterministically, so the tokens-hash
 *                     covers the groups and validate.mjs staleness fires when
 *                     any token value changes);
 *   export-tokens.mjs emits them into every theme section of
 *                     <design-root>/tokens.w3c.json (pure DTCG).
 *
 * Placement: INSIDE every theme section ("light" and "dark" carry identical
 * values — the contract facts are theme-independent but the tokens.json
 * contract is "root sections light and dark with identical structure", so the
 * groups follow the same duplication the space/radius/fontSize groups already
 * use). A root-level entry named like a contract group is superseded and
 * removed by withContractGroups (the groups belong to theme sections).
 *
 * Shape (DTCG-ish, same convention as the themed tree): group objects carry
 * $type; token objects carry $value. `motion` is a namespace folder (no
 * $type) holding the `easing` and `duration` groups. Values are CSS literals
 * (house style: "4px", "120ms", "cubic-bezier(...)") except unitless numbers
 * (breakpoints in px, layers z-index).
 *
 * Semantics pinned by the plan (§13.1 A2 + itens 4-5):
 *   breakpoints  sm 640 / md 900 = the codegen map "width <= 640 -> sm:",
 *                "width <= 900 -> md:" and MUST stay equal to
 *                validate.config.json `canvasMeta.breakpoints`
 *                ({ mobileMax: 640, tabletMax: 900 }, todo 3).
 *   layers       z-index scale (unitless).
 *   density      spacing scale in px, space-1..space-8
 *                ([2, 4, 8, 12, 16, 24, 32, 48]px).
 *   motion.*     easing curves and durations.
 *
 * Node 18+, stdlib only. Importable: gen-tokens.mjs --contract (todo 20)
 * derives the contract table from this structure.
 */

export const CONTRACT_GROUPS = {
  motion: {
    easing: {
      $type: "cubicBezier",
      standard: { $value: "cubic-bezier(0.2,0,0,1)" },
      decelerate: { $value: "cubic-bezier(0,0,0,1)" },
      accelerate: { $value: "cubic-bezier(0.3,0,1,1)" },
    },
    duration: {
      $type: "duration",
      fast: { $value: "120ms" },
      base: { $value: "200ms" },
      slow: { $value: "320ms" },
    },
  },
  density: {
    $type: "dimension",
    "space-1": { $value: "2px" },
    "space-2": { $value: "4px" },
    "space-3": { $value: "8px" },
    "space-4": { $value: "12px" },
    "space-5": { $value: "16px" },
    "space-6": { $value: "24px" },
    "space-7": { $value: "32px" },
    "space-8": { $value: "48px" },
  },
  breakpoints: {
    $type: "number",
    sm: { $value: 640 },
    md: { $value: 900 },
  },
  layers: {
    $type: "number",
    base: { $value: 0 },
    dropdown: { $value: 100 },
    overlay: { $value: 200 },
    modal: { $value: 300 },
    toast: { $value: 400 },
  },
};

const GROUP_NAMES = new Set(Object.keys(CONTRACT_GROUPS));

function cloneGroup(group) {
  return JSON.parse(JSON.stringify(group));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Canonical placement of the contract groups in a token-tree ROOT object:
 * every theme section (any non-$ root object entry) keeps its source keys in
 * order (minus any contract group name) and then gains the contract groups in
 * declared order; root-level entries named like a contract group are dropped
 * (superseded). Deterministic and idempotent: the same input root always
 * serializes to the same bytes and re-running over the output changes nothing.
 */
export function withContractGroups(root) {
  const out = {};
  for (const [key, value] of Object.entries(root)) {
    if (GROUP_NAMES.has(key)) continue;
    if (!isPlainObject(value)) {
      out[key] = value;
      continue;
    }
    const section = {};
    for (const [name, entry] of Object.entries(value)) {
      if (GROUP_NAMES.has(name)) continue;
      section[name] = entry;
    }
    for (const [name, group] of Object.entries(CONTRACT_GROUPS)) {
      section[name] = cloneGroup(group);
    }
    out[key] = section;
  }
  return out;
}

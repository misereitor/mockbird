/* mockbird:config-driven:v2 */
/**
 * marker-parser.mjs — parser for the component marker grammar (w2-7).
 *
 * Grammar (verbatim):
 *   <!-- component:<id> size=<s> tone=<t> state=<st> --> ... <!-- /component:<id> -->
 *   <!-- slot:<name> -->content<!-- /slot:<name> -->
 *
 * Rules:
 *   - ALL THREE marker args (`size=`, `tone=`, `state=`) are REQUIRED.
 *     Missing any one (or an unknown/duplicate/empty arg) = error code `component-marker`.
 *   - Precedence: marker args are the source of truth for variants. On every sync,
 *     `data-size/tone/state` AND the variant class combo on the root are re-emitted
 *     from the marker args (marker-args-win). `variantCompare` reports divergences
 *     between marker args and the materialized root `data-*` attrs; the marker wins.
 *   - Slots are paired markers; contents are extracted byte-preserved for survival
 *     across re-materialization.
 *   - Errors carry a `code` string: `component-marker` (marker grammar/registry) or
 *     `slot-marker` (slot grammar). Thrown as `MarkerError`.
 *
 * Pure functions, Node 18+, stdlib only, ZERO deps. Stateless: same input bytes =>
 * same result. This is the parser `sync-components.mjs` imports.
 */

/** Error with a stable machine-readable `code` string. */
export class MarkerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MarkerError";
    this.code = code;
  }
}

export const ERROR_CODES = Object.freeze({
  MARKER: "component-marker",
  SLOT: "slot-marker",
});

/** Variant keys in marker order (the three required args). */
export const VARIANT_KEYS = Object.freeze(["size", "tone", "state"]);

/**
 * Variant class combos — SINGLE SOURCE: utilities-spec.md
 * "Component variant mapping" table (documentation-only matrix; no size- or
 * tone- classes exist in the vocabulary, only these utility combos).
 * Every value of every registry variant set (todo 13) has an entry here —
 * `variantClasses()` throws on a missing one, so a value without a combo can
 * never materialize. Tone combos are the token-only rendering of each tone
 * value (closed utilities matrix; the danger/error inversion is the strongest
 * negative signal available — the matrix exposes no danger color class).
 * State variants emit NO classes (they resolve to `[data-state=...]` helpers),
 * so state is re-emitted only as the `data-state` attribute.
 */
export const VARIANT_CLASSES = Object.freeze({
  size: Object.freeze({
    sm: Object.freeze(["p-1", "text-body"]),
    md: Object.freeze(["p-2", "text-body"]),
    lg: Object.freeze(["p-3", "text-heading"]),
  }),
  tone: Object.freeze({
    default: Object.freeze(["bg-surface", "text-text"]),
    primary: Object.freeze(["bg-accent", "text-bg"]),
    secondary: Object.freeze(["bg-surface", "text-text", "border-border"]),
    ghost: Object.freeze(["text-accent", "border-accent"]),
    danger: Object.freeze(["bg-text", "text-bg"]),
    elevated: Object.freeze(["bg-accent", "text-bg"]),
    error: Object.freeze(["bg-text", "text-bg"]),
    success: Object.freeze(["bg-accent", "text-bg"]),
    in: Object.freeze(["bg-surface", "text-text"]),
    out: Object.freeze(["bg-accent", "text-bg"]),
    neutral: Object.freeze(["bg-surface", "text-text"]),
    info: Object.freeze(["bg-surface", "text-text", "border-border"]),
    warning: Object.freeze(["text-accent", "border-accent"]),
  }),
  state: Object.freeze({
    default: Object.freeze([]),
    hover: Object.freeze([]),
    active: Object.freeze([]),
    disabled: Object.freeze([]),
    interactive: Object.freeze([]),
    filled: Object.freeze([]),
    focus: Object.freeze([]),
    online: Object.freeze([]),
    offline: Object.freeze([]),
    selected: Object.freeze([]),
  }),
});

/**
 * Seeded registry — must stay byte-identical in content to
 * skills/design/assets/components/components.json (QA asserts equality).
 * Plain map id -> entry (schema v2, todo 12):
 *   { name, template, variants: {size,tone,state,device}, slots,
 *     realComponent, dataProps }
 * `name` equals the registry key; `template` is the partial under
 * components/; `realComponent` is the target React component name (codegen,
 * todo 22) and `dataProps` maps instance `data-*` attributes to its props
 * (partial maps are fine — codegen consumes them as declared).
 */
export const DEFAULT_REGISTRY = Object.freeze({
  button: Object.freeze({
    name: "button",
    template: "button.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md", "lg"]),
      tone: Object.freeze(["primary", "secondary", "ghost", "danger"]),
      state: Object.freeze(["default", "hover", "active", "disabled"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["label"]),
    realComponent: "Button",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  card: Object.freeze({
    name: "card",
    template: "card.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["default", "elevated"]),
      state: Object.freeze(["default", "interactive"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["title", "body"]),
    realComponent: "Card",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  modal: Object.freeze({
    name: "modal",
    template: "modal.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md", "lg"]),
      tone: Object.freeze(["default", "danger"]),
      state: Object.freeze(["default"]),
      device: Object.freeze(["mobile", "desktop"]),
    }),
    slots: Object.freeze(["header", "body", "footer"]),
    realComponent: "Modal",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  drawer: Object.freeze({
    name: "drawer",
    template: "drawer.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md", "lg"]),
      tone: Object.freeze(["default"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["header", "body", "footer"]),
    realComponent: "Drawer",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  field: Object.freeze({
    name: "field",
    template: "field.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["default", "error", "success"]),
      state: Object.freeze(["default", "filled", "focus", "disabled"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["label", "input", "hint"]),
    realComponent: "Field",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  bubble: Object.freeze({
    name: "bubble",
    template: "bubble.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["in", "out"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["content", "meta"]),
    realComponent: "Bubble",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  "menu-row": Object.freeze({
    name: "menu-row",
    template: "menu-row.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["default", "danger"]),
      state: Object.freeze(["default", "active", "disabled"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["icon", "label", "shortcut"]),
    realComponent: "MenuRow",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  "media-card": Object.freeze({
    name: "media-card",
    template: "media-card.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["default"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["media", "title", "body", "actions"]),
    realComponent: "MediaCard",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  toast: Object.freeze({
    name: "toast",
    template: "toast.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["success", "error", "info"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["icon", "message", "action"]),
    realComponent: "Toast",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  pill: Object.freeze({
    name: "pill",
    template: "pill.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["neutral", "info", "success", "warning", "danger"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["label"]),
    realComponent: "Pill",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  avatar: Object.freeze({
    name: "avatar",
    template: "avatar.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md", "lg"]),
      tone: Object.freeze(["default"]),
      state: Object.freeze(["default", "online", "offline"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["image", "initials"]),
    realComponent: "Avatar",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  banner: Object.freeze({
    name: "banner",
    template: "banner.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["info", "warning", "danger", "success"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["icon", "message", "action"]),
    realComponent: "Banner",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  tabs: Object.freeze({
    name: "tabs",
    template: "tabs.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["default"]),
      state: Object.freeze(["default"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["tabs", "panel"]),
    realComponent: "Tabs",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
  chip: Object.freeze({
    name: "chip",
    template: "chip.html",
    variants: Object.freeze({
      size: Object.freeze(["sm", "md"]),
      tone: Object.freeze(["neutral", "info", "success", "warning", "danger"]),
      state: Object.freeze(["default", "selected", "disabled"]),
      device: Object.freeze([]),
    }),
    slots: Object.freeze(["label", "remove"]),
    realComponent: "Chip",
    dataProps: Object.freeze({ "data-action": "action" }),
  }),
});

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VALUE_RE = /^[a-zA-Z0-9_-]+$/;

// Marker regexes are whitespace-tolerant inside the comment, single-line grammar.
// Candidate finders use `g` (search forward from a position); marker matchers use
// sticky `y` (match exactly at the candidate index).
const COMP_CANDIDATE_RE = /<!--[ \t]*\/?component:/g;
const COMP_OPEN_RE = /<!--[ \t]*component:([a-z][a-z0-9-]*)((?:[ \t]+[a-z-]+=[a-zA-Z0-9_-]+)*)[ \t]*\r?-->/y;
const COMP_CLOSE_RE = /<!--[ \t]*\/component:([a-z][a-z0-9-]*)[ \t]*\r?-->/y;
const SLOT_CANDIDATE_RE = /<!--[ \t]*\/?slot:/g;
const SLOT_OPEN_RE = /<!--[ \t]*slot:([a-z][a-z0-9-]*)[ \t]*\r?-->/y;
const SLOT_CLOSE_RE = /<!--[ \t]*\/slot:([a-z][a-z0-9-]*)[ \t]*\r?-->/y;

function matchAt(re, html, index) {
  re.lastIndex = index;
  return re.exec(html);
}

function findCandidate(candidateRe, html, from) {
  candidateRe.lastIndex = from;
  const m = candidateRe.exec(html);
  return m ? m.index : -1;
}

function parseMarkerArgs(id, argsString) {
  const args = {};
  const pairs = argsString.trim().split(/[ \t]+/).filter(Boolean);
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (!VARIANT_KEYS.includes(key)) {
      throw new MarkerError(ERROR_CODES.MARKER, `unknown arg "${key}" in marker for "${id}" (only size=, tone=, state= are allowed)`);
    }
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new MarkerError(ERROR_CODES.MARKER, `duplicate arg "${key}=" in marker for "${id}"`);
    }
    if (!VALUE_RE.test(value)) {
      throw new MarkerError(ERROR_CODES.MARKER, `empty or invalid value for arg "${key}=" in marker for "${id}"`);
    }
    args[key] = value;
  }
  for (const key of VARIANT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      throw new MarkerError(ERROR_CODES.MARKER, `missing required arg "${key}=" in marker for "${id}" (size=, tone= and state= are all required)`);
    }
  }
  return args;
}

function validateAgainstRegistry(id, args, registry) {
  const entry = registry[id];
  if (!entry) {
    throw new MarkerError(ERROR_CODES.MARKER, `unknown component id "${id}" (not in registry)`);
  }
  for (const key of VARIANT_KEYS) {
    const enums = entry.variants ? entry.variants[key] : undefined;
    if (!Array.isArray(enums) || !enums.includes(args[key])) {
      const allowed = Array.isArray(enums) ? enums.join(", ") : "(none)";
      throw new MarkerError(ERROR_CODES.MARKER, `invalid ${key}="${args[key]}" for component "${id}" (allowed: ${allowed})`);
    }
  }
  return entry;
}

/**
 * Parse all paired slot markers: `<!-- slot:name -->content<!-- /slot:name -->`.
 * Returns { name: contentBytes } (byte-preserved). Throws `slot-marker` on:
 * unclosed pair, mismatched closer, stray closer, malformed marker, duplicate name.
 * Flat grammar: nested slot markers are not supported.
 */
export function parseSlots(html) {
  const slots = {};
  let open = null; // { name, contentStart, markerEnd }
  let i = 0;
  for (;;) {
    const idx = findCandidate(SLOT_CANDIDATE_RE, html, i);
    if (idx === -1) break;
    const closeM = matchAt(SLOT_CLOSE_RE, html, idx);
    const openM = closeM ? null : matchAt(SLOT_OPEN_RE, html, idx);
    if (closeM) {
      const end = closeM.index + closeM[0].length;
      if (!open) {
        throw new MarkerError(ERROR_CODES.SLOT, `closing slot marker without opening marker at index ${idx}`);
      }
      if (closeM[1] !== open.name) {
        throw new MarkerError(ERROR_CODES.SLOT, `mismatched slot closer: expected "/slot:${open.name}", found "/slot:${closeM[1]}"`);
      }
      if (Object.prototype.hasOwnProperty.call(slots, open.name)) {
        throw new MarkerError(ERROR_CODES.SLOT, `duplicate slot "${open.name}"`);
      }
      slots[open.name] = html.slice(open.contentStart, idx);
      open = null;
      i = end;
    } else if (openM) {
      const end = openM.index + openM[0].length;
      if (open) {
        throw new MarkerError(ERROR_CODES.SLOT, `nested slot markers are not supported (found "slot:${openM[1]}" inside "slot:${open.name}")`);
      }
      open = { name: openM[1], contentStart: end, markerEnd: end };
      i = end;
    } else {
      throw new MarkerError(ERROR_CODES.SLOT, `malformed slot marker at index ${idx}`);
    }
  }
  if (open) {
    throw new MarkerError(ERROR_CODES.SLOT, `unclosed slot "${open.name}" (missing "/slot:${open.name}")`);
  }
  return slots;
}

/**
 * Parse ALL component regions in `html`.
 * Returns a list of region objects:
 *   {
 *     id, args: { size, tone, state },
 *     open, close, inner,          // raw marker/inner bytes
 *     slots: { name: contentBytes },
 *     start, end,                  // [start, end) boundaries in `html`
 *   }
 * Throws `component-marker` on: malformed marker, missing/unknown/duplicate arg,
 * unclosed pair, mismatched closer, stray closer, nested regions, unknown id,
 * value not in the component's variant enums.
 * Flat grammar: at most one region open at a time.
 */
export function parseAll(html, registry = DEFAULT_REGISTRY) {
  const regions = [];
  let open = null; // { id, args, openText, contentStart, start }
  let i = 0;
  for (;;) {
    const idx = findCandidate(COMP_CANDIDATE_RE, html, i);
    if (idx === -1) break;
    const closeM = matchAt(COMP_CLOSE_RE, html, idx);
    const openM = closeM ? null : matchAt(COMP_OPEN_RE, html, idx);
    if (closeM) {
      const end = closeM.index + closeM[0].length;
      if (!open) {
        throw new MarkerError(ERROR_CODES.MARKER, `closing component marker without opening marker at index ${idx}`);
      }
      if (closeM[1] !== open.id) {
        throw new MarkerError(ERROR_CODES.MARKER, `mismatched closer: expected "/component:${open.id}", found "/component:${closeM[1]}"`);
      }
      const inner = html.slice(open.contentStart, idx);
      regions.push({
        id: open.id,
        args: open.args,
        open: open.openText,
        close: html.slice(closeM.index, end),
        inner,
        slots: parseSlots(inner),
        start: open.start,
        end,
      });
      open = null;
      i = end;
    } else if (openM) {
      const end = openM.index + openM[0].length;
      if (open) {
        throw new MarkerError(ERROR_CODES.MARKER, `nested component regions are not supported (found "component:${openM[1]}" inside "component:${open.id}")`);
      }
      const id = openM[1];
      if (!ID_RE.test(id)) {
        throw new MarkerError(ERROR_CODES.MARKER, `invalid component id "${id}" (expected kebab-case)`);
      }
      const args = parseMarkerArgs(id, openM[2] ?? "");
      validateAgainstRegistry(id, args, registry);
      open = { id, args, openText: html.slice(openM.index, end), contentStart: end, start: openM.index };
      i = end;
    } else {
      throw new MarkerError(ERROR_CODES.MARKER, `malformed component marker at index ${idx}`);
    }
  }
  if (open) {
    throw new MarkerError(ERROR_CODES.MARKER, `unclosed region for "component:${open.id}" (missing "/component:${open.id}")`);
  }
  return regions;
}

/**
 * Parse the FIRST component region in `html` (see `parseAll` for the full
 * contract). Throws `component-marker` if no region is found.
 */
export function parseRegion(html, registry = DEFAULT_REGISTRY) {
  const regions = parseAll(html, registry);
  if (regions.length === 0) {
    throw new MarkerError(ERROR_CODES.MARKER, "no component region found");
  }
  return regions[0];
}

/**
 * Compare marker args (source of truth) against the materialized root's
 * `data-*` variant attrs. `rootDataAttrs` accepts either bare keys
 * (`{size: "lg"}`) or data-prefixed keys (`{"data-size": "lg"}`).
 * Returns the list of divergences: [{ key, marker, root }] — `root: null`
 * means the attribute is missing. Marker wins: sync re-emits `data-size/tone/state`
 * from the marker args (plus the variant class combo), so a non-empty list is
 * expected to shrink to [] right after sync.
 */
export function variantCompare(markerArgs, rootDataAttrs) {
  const root = rootDataAttrs ?? {};
  const divergences = [];
  for (const key of VARIANT_KEYS) {
    const markerValue = markerArgs ? markerArgs[key] : undefined;
    let rootValue;
    let found = false;
    for (const rootKey of [key, `data-${key}`]) {
      if (Object.prototype.hasOwnProperty.call(root, rootKey)) {
        rootValue = root[rootKey];
        found = true;
        break;
      }
    }
    if (!found || rootValue !== markerValue) {
      divergences.push({ key, marker: markerValue ?? null, root: found ? rootValue : null });
    }
  }
  return divergences;
}

/**
 * Variant class combo for the root element, re-emitted from marker args on
 * every sync (utilities-spec.md mapping table — the single source).
 * Fixed per-component base classes (e.g. `rounded-md font-body`) are NOT
 * included here: they live in the partial and are preserved as-is.
 */
export function variantClasses(markerArgs) {
  const out = [];
  for (const key of VARIANT_KEYS) {
    const value = markerArgs ? markerArgs[key] : undefined;
    const combos = VARIANT_CLASSES[key] ? VARIANT_CLASSES[key][value] : undefined;
    if (combos === undefined) {
      throw new MarkerError(ERROR_CODES.MARKER, `invalid ${key}="${value}" (no variant class combo)`);
    }
    out.push(...combos);
  }
  return out;
}

# Utilities vocabulary — derivation matrix (w1-3)

**EXACT TOTAL: 140 (137 classes + 3 [data-state=…] helpers)**

Source of truth: the static closed matrix embedded in `skills/design/scripts/gen-tokens.mjs`
(root-independent — `--list` works with no tokens.json around). Golden list:
`utilities-spec.txt` (one entry per line, matrix order below); `--list` must match it 100%.
`gen-tokens.mjs` emits `<design-root>/utilities.css` containing ONLY these matrix rules —
every color value is `var(--…)`-based; only non-color literals are allowed (`0`, `100%`,
`100vw`, `100vh`, `0.5`, `not-allowed`, `none`). Duplicate class name during build →
`fail()` exit 2.

Naming note: naming is mechanical (family prefix + token name) — `bg-bg`, `text-text`,
`border-border`, and `w-max-width` (`width: var(--dimension-max-width)`) are intentional.
`text-*` suffix sets are disjoint (colors {bg, surface, text, muted, accent, border} vs
type sizes {body, heading}); a collision fails the build with exit 2.

Variable names use the w1-2 flattening: `--color-<name>`, `--dimension-space-<n>`,
`--dimension-max-width`, `--typography-<name>-<kebab(subkey)>`, `--shadow-<name>`,
`--border-radius-<name>`.

## Derivation matrix

### A. Backgrounds (6) — color tokens → `background-color`

| class | declaration | source token |
| --- | --- | --- |
| `bg-bg` | `background-color: var(--color-bg)` | `color.bg` |
| `bg-surface` | `background-color: var(--color-surface)` | `color.surface` |
| `bg-text` | `background-color: var(--color-text)` | `color.text` |
| `bg-muted` | `background-color: var(--color-muted)` | `color.muted` |
| `bg-accent` | `background-color: var(--color-accent)` | `color.accent` |
| `bg-border` | `background-color: var(--color-border)` | `color.border` |

### B. Text colors (6) — color tokens → `color`

| class | declaration | source token |
| --- | --- | --- |
| `text-bg` | `color: var(--color-bg)` | `color.bg` |
| `text-surface` | `color: var(--color-surface)` | `color.surface` |
| `text-text` | `color: var(--color-text)` | `color.text` |
| `text-muted` | `color: var(--color-muted)` | `color.muted` |
| `text-accent` | `color: var(--color-accent)` | `color.accent` |
| `text-border` | `color: var(--color-border)` | `color.border` |

### C. Border colors (6) — color tokens → `border-color`

| class | declaration | source token |
| --- | --- | --- |
| `border-bg` | `border-color: var(--color-bg)` | `color.bg` |
| `border-surface` | `border-color: var(--color-surface)` | `color.surface` |
| `border-text` | `border-color: var(--color-text)` | `color.text` |
| `border-muted` | `border-color: var(--color-muted)` | `color.muted` |
| `border-accent` | `border-color: var(--color-accent)` | `color.accent` |
| `border-border` | `border-color: var(--color-border)` | `color.border` |

### D. Spacing (85) — dimension tokens → padding/margin/gap

Suffix steps `0..4`: step `0` = literal `0`; steps `1–4` = `var(--dimension-space-<n>)`
(`dimension.space-1..space-4`). 17 families × 5 steps = 85.

| family | declarations (per step) | CSS property |
| --- | --- | --- |
| `p-<n>` | `padding: <step>` | padding |
| `px-<n>` | `padding-left: <step>; padding-right: <step>` | padding-left+right |
| `py-<n>` | `padding-top: <step>; padding-bottom: <step>` | padding-top+bottom |
| `pt-<n>` | `padding-top: <step>` | padding-top |
| `pr-<n>` | `padding-right: <step>` | padding-right |
| `pb-<n>` | `padding-bottom: <step>` | padding-bottom |
| `pl-<n>` | `padding-left: <step>` | padding-left |
| `m-<n>` | `margin: <step>` | margin |
| `mx-<n>` | `margin-left: <step>; margin-right: <step>` | margin-left+right |
| `my-<n>` | `margin-top: <step>; margin-bottom: <step>` | margin-top+bottom |
| `mt-<n>` | `margin-top: <step>` | margin-top |
| `mr-<n>` | `margin-right: <step>` | margin-right |
| `mb-<n>` | `margin-bottom: <step>` | margin-bottom |
| `ml-<n>` | `margin-left: <step>` | margin-left |
| `gap-<n>` | `gap: <step>` | gap |
| `gap-x-<n>` | `column-gap: <step>` | column-gap |
| `gap-y-<n>` | `row-gap: <step>` | row-gap |

Class order: `p-0…p-4`, `px-0…px-4`, `py-0…py-4`, `pt-0…pt-4`, `pr-0…pr-4`,
`pb-0…pb-4`, `pl-0…pl-4`, then `m…ml` same pattern, then `gap-0…gap-4`,
`gap-x-0…gap-x-4`, `gap-y-0…gap-y-4`.

### E. Sizing (22) — dimension tokens → width/height/min-height

| class | declaration | source |
| --- | --- | --- |
| `w-0`…`w-4` | `width: <step>` | step rule as in D |
| `w-full` | `width: 100%` | literal |
| `w-screen` | `width: 100vw` | literal |
| `w-max-width` | `width: var(--dimension-max-width)` | `dimension.max-width` |
| `h-0`…`h-4` | `height: <step>` | step rule as in D |
| `h-full` | `height: 100%` | literal |
| `h-screen` | `height: 100vh` | literal |
| `min-h-0`…`min-h-4` | `min-height: <step>` | step rule as in D |
| `min-h-full` | `min-height: 100%` | literal |
| `min-h-screen` | `min-height: 100vh` | literal |

### F. Radii (3) — borderRadius tokens → `border-radius`

| class | declaration | source token |
| --- | --- | --- |
| `rounded-sm` | `border-radius: var(--border-radius-sm)` | `borderRadius.sm` |
| `rounded-md` | `border-radius: var(--border-radius-md)` | `borderRadius.md` |
| `rounded-lg` | `border-radius: var(--border-radius-lg)` | `borderRadius.lg` |

### G. Type scale (8) — typography composites → font-*/leading-*

Typography composites flatten to `--typography-<name>-<kebab(subkey)>` (w1-2 contract).

| class | declaration | source token |
| --- | --- | --- |
| `font-body` | `font-family: var(--typography-body-font-family)` | `typography.body.fontFamily` |
| `font-heading` | `font-family: var(--typography-heading-font-family)` | `typography.heading.fontFamily` |
| `text-body` | `font-size: var(--typography-body-font-size)` | `typography.body.fontSize` |
| `text-heading` | `font-size: var(--typography-heading-font-size)` | `typography.heading.fontSize` |
| `leading-body` | `line-height: var(--typography-body-line-height)` | `typography.body.lineHeight` |
| `leading-heading` | `line-height: var(--typography-heading-line-height)` | `typography.heading.lineHeight` |
| `font-normal` | `font-weight: var(--typography-body-font-weight)` | `typography.body.fontWeight` |
| `font-bold` | `font-weight: var(--typography-heading-font-weight)` | `typography.heading.fontWeight` |

`font-normal`/`font-bold` are aliases documented as: they map to the typography token
carrying that weight in matrix order (`body` = 400 → normal, `heading` = 700 → bold).

### H. Shadows (1) — shadow tokens → `box-shadow`

| class | declaration | source token |
| --- | --- | --- |
| `shadow-card` | `box-shadow: var(--shadow-card)` | `shadow.card` (w1-2 box-shadow shorthand) |

### I. State helpers (3) — `[data-state=…]` attribute selectors

| selector | declarations |
| --- | --- |
| `[data-state="hover"]` | `background-color: var(--color-surface)` |
| `[data-state="active"]` | `background-color: var(--color-border)` |
| `[data-state="disabled"]` | `opacity: 0.5; cursor: not-allowed; pointer-events: none` |

## Component variant mapping (documentation only — NO classes emitted for size/tone)

Component instances carry `data-size`, `data-tone`, `data-state`; styling resolves to
utility combos or the state hooks above. Pure documentation: the vocabulary emits no
`size-*`/`tone-*` classes.

| attribute | value | utility combo / hook |
| --- | --- | --- |
| `data-size` | `sm` | `p-1 text-body` |
| `data-size` | `md` | `p-2 text-body` |
| `data-size` | `lg` | `p-3 text-heading` |
| `data-tone` | `default` | `bg-surface text-text` |
| `data-tone` | `primary` | `bg-accent text-bg` |
| `data-tone` | `secondary` | `bg-surface text-text border-border` |
| `data-tone` | `ghost` | `text-accent border-accent` |
| `data-tone` | `danger` | `bg-text text-bg` |
| `data-tone` | `elevated` | `bg-accent text-bg` |
| `data-tone` | `error` | `bg-text text-bg` |
| `data-tone` | `success` | `bg-accent text-bg` |
| `data-tone` | `in` | `bg-surface text-text` |
| `data-tone` | `out` | `bg-accent text-bg` |
| `data-state` | `default` | (none — baseline) |
| `data-state` | `hover` | `[data-state="hover"]` helper |
| `data-state` | `active` | `[data-state="active"]` helper |
| `data-state` | `disabled` | `[data-state="disabled"]` helper |
| `data-state` | `interactive` | (none — `[data-state="interactive"]` hook) |
| `data-state` | `filled` | (none — `[data-state="filled"]` hook) |
| `data-state` | `focus` | (none — `[data-state="focus"]` hook) |

Tone values map to token-only combos from the closed matrix: fill/positive
signals use the accent token (`primary`/`elevated`/`success`/`out`), neutral
surfaces use the surface token (`default`/`in`), outline shapes pair a border
token with a text token (`ghost`/`secondary`), and negative signals invert
text/bg (`danger`/`error` — the matrix exposes no danger color class; a
`bg-danger`/`text-danger` class would be a matrix extension, out of the
registry's scope). `elevated` keeps the historical accent-panel combo
byte-identical so the card drift migration (todo 13) moves zero rendered
classes.

## BANNED (never in the vocabulary, never in screens)

- `bg-zinc-900` — any Tailwind palette class
  (`^(bg|text|border|from|to|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$`)
- `text-[13px]` — any arbitrary-value class (any `-[`)
- literal hex/rgb/hsl colors in utilities.css declarations (only `var(--…)` or non-color literals)
- family patterns as vocabulary entries (`bg-*` is not a class; the matrix is a closed set)

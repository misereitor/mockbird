# Craft layer — fused from taste, emil-design-eng and impeccable

This file distills the three craft skills installed next to this skill
(`../taste`, `../emil-design-eng`, `../impeccable`) into rules sized for
design-canvas screens. Apply it to every screen you build. When a task goes
beyond the canvas (real frontend code, full audits), invoke those skills
directly — they remain standalone.

## 1. Design read first (taste)

Before building a canvas, declare one line: "Reading this as: <screen kind>
for <audience>, with a <vibe> language, leaning toward <aesthetic family>."
If the brief is ambiguous in a way that changes direction, ask exactly one
question. Never default to AI aesthetics — reach past them deliberately.

## 2. Dials (taste)

Set and honor three dials per canvas:

- `DESIGN_VARIANCE` (1–10, default 7): 1–3 symmetric and equal, 4–7 offset
  compositions, 8–10 asymmetric. Mobile screens collapse to one column.
- `MOTION_INTENSITY` (1–10, default 4 for product screens, 6–7 for landing
  pages): motion must be motivated; a screen that claims motion must show it.
- `VISUAL_DENSITY` (1–10, default 4): 1–3 airy, 4–7 standard, 8–10 tight with
  hairline separators and monospace numerals.

## 3. The bans (taste)

Never on a canvas screen unless the brand brief explicitly asks:

- AI-purple gradients, neon outer glows, pure `#000`/`#fff`, more than one
  accent color, accents drifting between sections (pick one, lock it).
- Three identical feature cards; centered hero as the only hero shape; more
  than two consecutive zigzag image+text sections; an eyebrow label above
  every section (max 1 per 3 sections); split-header (headline left, small
  paragraph floating right) as the default section header.
- Fake screenshots built from `<div>` rectangles; generic filler names
  (John Doe, Acme, Nexus); fake-perfect numbers (99.99%, 50%); lorem ipsum.
- Em-dash anywhere; decorative status dots on every row; scroll cues
  ("Scroll to explore"); version labels (`v0.6`, `BETA`) in heroes.
- Serif as the default display font (`Fraunces` and `Instrument Serif` are
  banned defaults); `Inter` as the default body font (Geist, Satoshi,
  Cabinet Grotesk or a brand-appropriate face first).
- The warm beige + brass + espresso palette as the default reach for
  premium-consumer briefs.
- Buttons whose text fails WCAG AA contrast against their own background;
  CTAs that wrap to two lines at desktop width.
- Literal colors outside `tokens.json`: the sweep checks `<style>` blocks,
  `style=""` attributes and the VALUE positions of SVG `fill=`/`stroke=`.
  Remote URLs (`http(s)://`) in screens. Tailwind palette classes like
  `bg-zinc-900`. Arbitrary values like `text-[13px]`.

**Utilities are the vocabulary.** Token-backed styling (colors, type, spacing,
radius) goes through the generated utilities matrix (exactly 140 entries:
`bg-accent`, `p-2`, `text-heading`, `rounded-md`, the `[data-state=…]` hooks).
Semantic classes carry structure and layout only. `var(--…)` is fine where no
utility fits, and an inline `<style>` block is fine when a screen needs one,
but neither may hold a literal color.

**Components are instances, never loose markup** ("instância usa partial,
nunca markup solto de componente"). Every instance is the partial from
`design/components/` wrapped in a marker pair,
`<!-- component:id size=md tone=primary state=default -->…<!-- /component:id -->`,
with the THREE required args `size=`, `tone=`, `state=`, and slots as paired
markers `<!-- slot:name -->…<!-- /slot:name -->`. Marker args are the source
of truth (marker-args-win): sync re-emits `data-size`/`data-tone`/`data-state`
plus the variant classes from the marker, while slot contents and user extra
`data-*` attributes survive. After editing any partial in
`design/components/`, run `node design/scripts/sync-components.mjs` before
presenting.

**Canvas overrides that win over taste:** the canvas is offline — no remote
images or CDN, so use inline SVG, CSS patterns/gradients or local assets, and
leave a clearly labeled placeholder when a real photo is required. And the
canvas shows light **and** dark through the same tokens: never hard-code a
color, never build a section that only works in one theme.

## 4. Motion rules (emil-design-eng)

Answer in order before animating anything: should it animate at all (never
for actions used hundreds of times a day) → what purpose → which easing →
how fast.

- Entries: ease-out with a strong custom curve, e.g.
  `cubic-bezier(0.23, 1, 0.32, 1)`. On-screen movement: ease-in-out. Hover and
  color: `ease`. Constant motion: linear. Never `ease-in` on an entry.
- UI durations ≤ 300 ms (buttons 100–160, popovers/tooltips 125–200,
  dropdowns 150–250, modals/drawers 200–500).
- Never animate from `scale(0)`: start at `scale(0.95)` with `opacity: 0`.
- Pressable elements: `:active { transform: scale(0.97) }` (subtle, 0.95–0.98).
- Stagger list entries 30–80 ms apart; animate only `transform` and `opacity`;
  honor `prefers-reduced-motion`; gate hover animations behind
  `@media (hover: hover) and (pointer: fine)`.
- Popovers scale from their trigger (`transform-origin`), modals stay centered.

## 5. Verification loop (impeccable)

Build every screen fully first — no half-built screens. Then exactly one
bounded review round: run the validator, open the viewer, look at desktop and
dark theme, fix everything in one batch, confirm with at most one more round,
and stop. No open-ended polishing.

## 6. Interactivity (system preview)

Interactive screens follow the same craft bar:

- Navigation, forms and feedback are the point — but every screen must still
  compose as a static frame if JS fails (progressive enhancement).
- Fictitious data obeys the content rules: plausible, locale-appropriate,
  messy numbers (47.2%, not 50%), no Acme/John Doe.
- Motion on interactive elements follows section 4: press feedback
  (`:active` scale), toasts and list changes ≤ 300 ms ease-out, staggered
  list entries.
- Simulate real states, not just success: an invalid login shows the error
  state, an out-of-stock item shows the empty/low state. Use extra screens
  for whole-page states (loading, empty, error) and inline states inside the
  interactive flow.
- Session state (Mock.state) resets with the viewer's ⟲ Reset fluxo — design
  assuming the user will replay the flow several times.
- Ship named `scenarios` in data.json for the states that matter (empty,
  critical, failure). The viewer's scenario selector must make each one
  compose well — a scenario that renders an empty shell is a broken screen,
  not a scenario.
- When the system spans canvases, the flow must cross them cleanly: the
  login canvas hands the user over through shared state, the next canvas
  never shows a fallback where real data should be, and every canvas
  composes alone (each one is also a deliverable on its own).

## Full rulebooks (when the task exceeds the canvas)

- `../taste/SKILL.md` — complete anti-slop rules, brief → design-system map,
  layout vocabulary.
- `../emil-design-eng/SKILL.md` — full animation and component-craft rules.
- `../impeccable/SKILL.md` — 24 design commands backed by a binary engine
  (`audit`, `critique`, `polish`, `harden`, `typeset`, …).

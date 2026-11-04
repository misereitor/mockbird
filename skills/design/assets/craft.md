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

## 2. Dials (taste) — scoped baselines (ADR-0006)

Set and honor three dials per canvas. The baseline is scoped by screen kind;
the scope's source of truth is the file named below and nothing else:

| Scope | `DESIGN_VARIANCE` | `MOTION_INTENSITY` | `VISUAL_DENSITY` | Source of truth |
|---|---|---|---|---|
| product UI (canvas screens) | 7 | 4 | 4 | this file (§2) |
| landing / portfolio / marketing | 8 | 6 | 4 | `../taste/SKILL.md` §1 (`8 / 6 / 4`) |

- `DESIGN_VARIANCE` (1–10): 1–3 symmetric and equal, 4–7 offset
  compositions, 8–10 asymmetric. Mobile screens collapse to one column.
- `MOTION_INTENSITY` (1–10): motion must be motivated; a screen that claims
  motion must show it. Landing/portfolio pages may run 6–8 per taste §1.A.
- `VISUAL_DENSITY` (1–10): 1–3 airy, 4–7 standard, 8–10 tight with
  hairline separators and monospace numerals.

## 3. The bans (taste owns the list — ADR-0006)

Taste is the reference for the aesthetic bans: apply every ban in
`../taste/SKILL.md` in full — §0.D anti-defaults, §4.1 type bans, §4.2
palette bans, §4.7 layout hard rules, §9 AI tells (incl. §9.G em-dash) and
its final checklist. This file does not repeat that list; if the two ever
seem to disagree, taste's ban wins and this file only narrows it for the
canvas. Never on a canvas screen unless the brand brief explicitly asks.

Machine-enforced canvas bans (the sweep in `validate.mjs` fails them; these
are contract, not advice):

- Literal colors outside `tokens.json`: the sweep checks `<style>` blocks,
  `style=""` attributes and the VALUE positions of SVG `fill=`/`stroke=`.
- Remote URLs (`http(s)://`) anywhere in screens.
- Tailwind palette classes like `bg-zinc-900`.
- Arbitrary values like `text-[13px]` (Tailwind `-[…]` syntax).

**Arbitrary Tailwind values: banned (ADR-0006).** The ban is absolute on
canvas screens. In real frontend code the ban also stands by default; the
ONLY declared exceptions are the arbitrary values taste's own mandatory
rules require, and only when the consumer's framework is Tailwind:

- `leading-[1.1]` / `leading-[1]` — italic descender clearance (taste §4.1).
- Display eyebrow metrics: `text-[11px]`, `text-[10.5px]`,
  `tracking-[0.18em]`, `tracking-[0.22em]` (taste §4.7 eyebrow restraint).
- Measure and viewport: `w-[65ch]`, `h-[100dvh]`, `w-[1400px]`,
  `w-[calc(33%-1rem)]`.
- Micro-transforms and layers: `translate-y-[1px]`, `scale-[0.98]`,
  `z-[60]`.
- Hairline inset: `shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`
  (taste §5 glass edge).

Anything outside this list needs an explicit declaration in the design read
before use; outside Tailwind consumer projects use `var(--…)` or custom CSS.

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

## 4. Motion rules (emil-design-eng) — CSS-first (ADR-0006)

CSS-first wins: implement motion in plain CSS (transitions, `@starting-style`,
scroll-driven animations) — see `../emil-design-eng/SKILL.md`. GSAP / Motion /
Three.js patterns (taste §5.A–§5.C) apply ONLY when that library is already
present in the project; never add one just to animate a canvas screen.

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

## 5. Verification loop (impeccable + design) — until clean, cap 4 (ADR-0006)

Build every screen fully first — no half-built screens. Then review in
batched rounds: run the validator, open the viewer, look at desktop and dark
theme, fix everything in one batch, and re-run until clean — the whole loop
is capped at 4 rounds (screenshots, defect scans, micro-edits and rebuilds
alike). At the cap, stop polishing and hand off with the explicit
pending-issues list; a canvas with open issues is never presented as clean.
No open-ended polishing.

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
- Overlays: a modal is a full canvas screen (one source of truth), never a
  copy of markup inside the host page. The trigger is a plain screen link
  (`<a href="03-modal.html">`) that the mock runtime intercepts into
  `Mock.overlay`; without JS the untouched href navigates to the modal screen
  itself, so the modal must compose as a standalone page. Closing is layered:
  `Mock.close()` / ESC dismiss the topmost layer, a backdrop click dismisses
  only when `dismissible`. Confirm actions close the loop — clear state,
  toast, then `Mock.go` to where the flow continues. Remember the overlay
  re-renders only the screen's `<body>` content: scripts do not run inside
  the layer, so wire overlay actions with inline handlers on wrapper
  elements (component roots keep only extra `data-*` attributes) or with
  delegation from the host page.
- Transitions are declared per screen in `canvas.json`
  (`"transition": "fade"|"slide-left"|"none"`) and ride `Mock.go` as an
  enter class on the destination (`mock-enter-fade`/`mock-enter-slide-left`,
  self-removed within 300 ms; `prefers-reduced-motion` disables the run).
  Use `fade` for state refreshes and same-screen returns, `slide-left` for
  drill-in steps, `none` for jumps that are not spatial. The handoff matches
  the destination filename in the CURRENT canvas's manifest: same-canvas
  hops only — a cross-canvas `Mock.go('../<canvas>/<screen>.html')` is a
  plain navigation with no enter class. Motivate the motion (section 4):
  one enter run per navigation, never on every re-render.
- Scroll positions are preserved per screen (`scroll.<canvas>.<file>`,
  restored when the user returns, surviving ⟲ Reset fluxo which clears only
  `mock.*`). Earn the scroll: if a screen scrolls, the extra content must be
  real value (a long list of items), and returning to the screen must land
  the user where they left — that is part of the flow's continuity.
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

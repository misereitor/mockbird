---
name: taste
description: Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check.
---

# tasteskill: Anti-Slop Frontend Skill

> Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

---

## 0. BRIEF INFERENCE (Read the Room Before Anything Else)

Before touching code or tweaking dials, **infer what the user actually wants**. Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room.

### 0.A Read these signals first
1. **Page kind** - landing (SaaS / consumer / agency / event), portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. **Vibe words** the user used - "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. **Reference signals** - URLs they linked, screenshots they pasted, products they named, brands they're competing with.
4. **Audience** - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio. The audience picks the aesthetic, not your taste.
5. **Brand assets that already exist** - logo, color, type, photography. For redesigns, these are starting material, not optional input (see Section 11).
6. **Quiet constraints** - accessibility-first audiences, public-sector, regulated industries, trust-first commerce, kids' products. These constraints OVERRIDE aesthetic preference.

### 0.B Output a one-line "Design Read" before generating
Before any code, state in one line: **"Reading this as: \<page kind> for \<audience>, with a \<vibe> language, leaning toward \<design system or aesthetic family>."**

Example reads:
- *"Reading this as: B2B SaaS landing for technical buyers, with a Linear-style minimalist language, leaning toward Tailwind utilities + Geist + restrained motion."*
- *"Reading this as: solo designer portfolio for hiring managers, with an editorial / kinetic-type language, leaning toward native CSS + scroll-driven animation + custom typography."*
- *"Reading this as: redesign of a public-sector service site, with a trust-first language, leaning toward GOV.UK Frontend or USWDS."*

### 0.C If the brief is ambiguous, ask one question, do not guess
Ask exactly **one** clarifying question - never a multi-question dump - and only when the design read genuinely diverges. Example: *"Should this feel closer to Linear-clean or Awwwards-experimental?"*

If you can confidently infer from context, **do not ask**. Just declare the design read and proceed.

### 0.D Anti-Default Discipline
Do not default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900. These are the LLM defaults. Reach past them deliberately based on the design read.

---

## 1. THE THREE DIALS (Core Configuration)

After the design read, set three dials. Every layout, motion, and density decision below is gated by these.

* **`DESIGN_VARIANCE: 8`** - 1 = Perfect Symmetry, 10 = Artsy Chaos
* **`MOTION_INTENSITY: 6`** - 1 = Static, 10 = Cinematic / Physics
* **`VISUAL_DENSITY: 4`** - 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data

**Baseline:** `8 / 6 / 4`. Use these unless the design read overrides them. Do not ask the user to edit this file - overrides happen conversationally.

**Scope (ADR-0006):** this `8 / 6 / 4` baseline is the source of truth for landing / portfolio / marketing work. For product UI the scoped baseline is `7 / 4 / 4` and `../design/assets/craft.md` §2 is the source of truth there.

### 1.A Dial Inference (design read → dial values)
| Signal | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| "minimalist / clean / calm / editorial / Linear-style" | 5-6 | 3-4 | 2-3 |
| "premium consumer / Apple-y / luxury / brand" | 7-8 | 5-7 | 3-4 |
| "playful / wild / Dribbble / Awwwards / experimental / agency" | 9-10 | 8-10 | 3-4 |
| "landing page / portfolio / marketing site (default)" | 7-9 | 6-8 | 3-5 |
| "trust-first / public-sector / regulated / accessibility-critical" | 3-4 | 2-3 | 4-5 |
| "redesign - preserve" | match existing | +1 | match existing |
| "redesign - overhaul" | +2 | +2 | match existing |

### 1.B Use-Case Presets
| Use case | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| Landing (SaaS, mainstream) | 7 | 6 | 4 |
| Landing (Agency / creative) | 9 | 8 | 3 |
| Landing (Premium consumer) | 7 | 6 | 3 |
| Portfolio (Designer / studio) | 8 | 7 | 3 |
| Portfolio (Developer) | 6 | 5 | 4 |
| Editorial / Blog | 6 | 4 | 3 |
| Public-sector service | 3 | 2 | 5 |
| Redesign - preserve | match | match+1 | match |
| Redesign - overhaul | +2 | +2 | match |

### 1.C How the Dials Drive Output
Use these (or user-overridden values) as global variables. Cross-references throughout this document refer to these exact variable names - never invent aliases like `LAYOUT_VARIANCE` or `ANIM_LEVEL`.

---

## 2. BRIEF → DESIGN SYSTEM MAP

Once you have the design read (Section 0) and dials (Section 1), pick the right foundation. Do not invent CSS for things that have an official package. Do not pretend an aesthetic trend is an official system.

### 2.A When to reach for a real design system (use official packages)
| Brief reads as… | Reach for | Why |
|---|---|---|
| Microsoft / enterprise SaaS / dashboards | `@fluentui/react-components` or `@fluentui/web-components` | Official Fluent UI, Microsoft tokens, accessibility done |
| Google-ish UI, Material-flavored product | `@material/web` + Material 3 tokens | Official, theme-able via Material Theming |
| IBM-style B2B / enterprise analytics | `@carbon/react` + `@carbon/styles` | Official Carbon, mature data-density patterns |
| Shopify app surfaces | `polaris.js` web components / Polaris React | Required for Shopify admin UI |
| Atlassian / Jira-style product | `@atlaskit/*` + `@atlaskit/tokens` | Official Atlassian DS |
| GitHub-style devtool / community page | `@primer/css` or `@primer/react-brand` | Official Primer; Brand variant for marketing |
| Public-sector UK service | `govuk-frontend` | Legally / regulatorily expected |
| US public-sector / trust-first | `uswds` | Same |
| Fast local-business / agency MVP | Bootstrap 5.3 | Boring, fast, works |
| Modern accessible React foundation | `@radix-ui/themes` | Primitives + polished theme |
| Modern SaaS where you own the components | shadcn/ui (`npx shadcn@latest add ...`) | You own the code, easy to customise; never ship default state |
| Tailwind-based modern SaaS / AI marketing | Tailwind v4 utilities + `dark:` variant | Default for indie + small team builds |

**Honesty rule:** if the brief reads as one of the systems above, install and use the **official** package. Do not recreate its CSS by hand. Do not import a system's tokens but then override 90% of them.

**One system per project.** Do not mix Fluent React with Carbon in the same tree. Do not import shadcn/ui components into a Material 3 app.

### 2.B When the brief is an aesthetic, not a system
For these directions, there is **no single official package**. Build with native CSS + Tailwind + a maintained component library. Be honest in code comments about what is borrowed inspiration vs. official material.

| Aesthetic | Honest implementation |
|---|---|
| Glassmorphism / "frosted glass" | `backdrop-filter`, layered borders, highlight overlays. Provide solid-fill fallback for `prefers-reduced-transparency`. |
| Bento (Apple-style tile grids) | CSS Grid with mixed cell sizes. No single library owns this. |
| Brutalism | Native CSS, monospace, raw borders. No library. |
| Editorial / magazine | Serif type, asymmetric grid, generous whitespace. No library. |
| Dark tech / hacker | Mono + accent neon, terminal motifs. No library. |
| Aurora / mesh gradients | SVG or layered radial gradients. No library. |
| Kinetic typography | Native CSS animations, scroll-driven animations, GSAP for hijacks. No library. |
| **Apple Liquid Glass** | Apple documents this for Apple platforms only. **There is no official `liquid-glass.css`.** Web implementations are approximations using `backdrop-filter` + layered borders + highlights. Label clearly as approximation. |

---

## 3. DEFAULT ARCHITECTURE & CONVENTIONS

Full guidance is loaded on demand from `skills/taste/reference/engineering-guardrails.md`.

## 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS

### 6.A Hardware Acceleration
* Animate ONLY `transform` and `opacity`. Never animate `top`, `left`, `width`, `height`.
* Use `will-change: transform` sparingly - only on elements that will actually animate.

### 6.B Reduced Motion (mandatory)
* **Any motion above `MOTION_INTENSITY > 3` MUST honor `prefers-reduced-motion`.** This is non-negotiable.
* In Motion: wrap with `useReducedMotion()` and degrade to static.
* In CSS: gate animations behind `@media (prefers-reduced-motion: no-preference)` or provide an override block under `@media (prefers-reduced-motion: reduce)` that disables.
* Infinite loops, parallax, scroll-hijack, and magnetic physics MUST collapse to static / instant under reduced motion.

### 6.C Dark Mode (mandatory for any consumer-facing page)
* Design for **both modes from the start**. Never ship light-only or dark-only without explicit user instruction.
* Use Tailwind `dark:` variant OR CSS variables for tokens. Pick one strategy per project.
* **Do not prescribe specific dark-mode colors here.** The brief decides. Maintain visual hierarchy, brand identity, and WCAG AA contrast (AAA for body) across both modes.
* Respect `prefers-color-scheme: dark`. Default to system preference unless the brand insists on one mode.

### 6.D Core Web Vitals Targets
* **LCP** < 2.5s. Hero image must be `next/image priority` or preloaded.
* **INP** < 200ms. Heavy work off main thread.
* **CLS** < 0.1. Reserve space for images, fonts, embeds.
* Run Lighthouse before declaring a page done.

### 6.E DOM Cost
* Apply grain / noise filters EXCLUSIVELY to fixed, `pointer-events-none` pseudo-elements (e.g., `fixed inset-0 z-[60] pointer-events-none`). NEVER on scrolling containers - continuous GPU repaints destroy mobile FPS.
* Be aware of bundle size. Motion is not tiny. Three.js is large. Lazy-load anything that's not above-the-fold.

### 6.F Z-Index Restraint
NEVER spam arbitrary `z-50` or `z-10`. Use z-index strictly for systemic layer contexts (sticky navbars, modals, overlays, grain). Document the z-index scale in a project constants file.

---

## 7. DIAL DEFINITIONS (Technical Reference)

### DESIGN_VARIANCE (Level 1-10)
* **1-3 (Predictable):** Symmetrical CSS Grid (12-col, equal fr-units), equal paddings, centered alignment.
* **4-7 (Offset):** `margin-top: -2rem` overlaps, varied image aspect ratios (4:3 next to 16:9), left-aligned headers over center-aligned data.
* **8-10 (Asymmetric):** Masonry layouts, CSS Grid with fractional units (`grid-template-columns: 2fr 1fr 1fr`), massive empty zones (`padding-left: 20vw`).
* **MOBILE OVERRIDE:** For levels 4-10, asymmetric layouts above `md:` MUST collapse to strict single-column (`w-full`, `px-4`, `py-8`) on viewports `< 768px`.

### MOTION_INTENSITY (Level 1-10)
* **1-3 (Static):** No automatic animations. CSS `:hover` and `:active` states only. `prefers-reduced-motion` is the default mode anyway.
* **4-7 (Fluid CSS):** `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)`. `animation-delay` cascades for load-ins. Focus on `transform` and `opacity`.
* **8-10 (Advanced Choreography):** Complex scroll-triggered reveals, parallax, scroll-driven animation (CSS `animation-timeline` or GSAP ScrollTrigger). Use Motion hooks. **NEVER use `window.addEventListener('scroll')`** - it is a hard ban, not a "prefer-not." See Section 5.D for the allowed alternatives.

### VISUAL_DENSITY (Level 1-10)
* **1-3 (Art Gallery):** Lots of white space. Huge section gaps (`py-32` to `py-48`). Expensive, clean.
* **4-7 (Daily App):** Standard web app spacing (`py-16` to `py-24`).
* **8-10 (Cockpit):** Tight paddings. No card boxes; 1px lines separate data. Mandatory: `font-mono` for all numbers.

---

## 8. DARK MODE PROTOCOL

Dual-mode by default. Never assume light-only unless the brief is print-emulating editorial.

### 8.A Token Strategy (pick one, stick to it)
* **Tailwind `dark:` variant** (default for utility-first projects): every color utility paired with its dark variant (`bg-white dark:bg-zinc-950`, `text-gray-900 dark:text-gray-100`).
* **CSS variables** (for shadcn/ui, Radix Themes, or component libraries with theming): define semantic tokens (`--surface`, `--surface-elevated`, `--text-primary`, `--accent`) and swap values under `[data-theme="dark"]` or `@media (prefers-color-scheme: dark)`.

### 8.B Do Not Prescribe Specific Colors Here
The brief and brand decide. This skill enforces only:
* **Contrast** - WCAG AA minimum for body text, AAA target for hero copy.
* **Hierarchy parity** - visual hierarchy that works in light must work in dark. If a CTA pops in light, it pops in dark.
* **Brand fidelity** - primary brand color stays recognisable. Don't desaturate the brand into a dark mode.
* **No pure `#000000` and no pure `#ffffff`** - use off-black (zinc-950, near-black warm gray) and off-white. Pure values kill depth.

### 8.C Default Mode
Respect `prefers-color-scheme` unless the brand insists. Add a manual toggle if either mode would lose key brand expression.

### 8.D Test in Both Modes Before Finishing
Open the page in both modes during development. Do not ship a page you've only seen in one mode.

---

## 9. AI TELLS (Forbidden Patterns)

Avoid these signatures unless the brief explicitly asks for them.

### 9.A Visual & CSS
* **NO neon / outer glows** by default. Use inner borders or subtle tinted shadows.
* **NO pure black (`#000000`).** Off-black, zinc-950, or charcoal.
* **NO oversaturated accents.** Desaturate to blend with neutrals.
* **NO excessive gradient text** for large headers.
* **NO custom mouse cursors.** Outdated, accessibility-hostile, perf-hostile.

### 9.B Typography
* **AVOID Inter as default.** See Section 4.1. Override path exists.
* **NO oversized H1s** that just scream. Control hierarchy with weight + color, not raw scale.
* **Serif constraints:** Serif for editorial / luxury / publication. Not for dashboards.

### 9.C Layout & Spacing
* **Mathematically perfect** padding and margins. No floating elements with awkward gaps.
* **NO 3-column equal feature cards.** The generic "three identical cards horizontally" feature row is banned. Use 2-column zig-zag, asymmetric grid, scroll-pinned, or horizontal-scroll alternative.

### 9.D Content & Data ("Jane Doe" Effect)
* **NO generic names.** "John Doe", "Sarah Chan", "Jack Su" → use creative, realistic, locale-appropriate names.
* **NO generic avatars.** No SVG "egg" or Lucide user icons → use believable photo placeholders or specific styling.
* **NO fake-perfect numbers.** Avoid `99.99%`, `50%`, `1234567`. Use organic, messy data (`47.2%`, `+1 (312) 847-1928`).
* **NO lorem ipsum or dummy filler text.** Every visible string is real, plausible copy in the user's language.
* **NO startup-slop brand names.** "Acme", "Nexus", "SmartFlow", "Cloudly" → invent contextual, premium names that sound real.
* **NO filler verbs.** "Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionize" → concrete verbs only.

### 9.E External Resources & Components
* **NO hand-rolled SVG icons.** Use Phosphor / HugeIcons / Radix / Tabler. Lucide on explicit request only.
* **Hand-rolled decorative SVGs strongly discouraged** as default (see Section 4.8).
* **NO div-based fake screenshots.** Never build a fake product UI out of `<div>` rectangles to simulate a screenshot. Use real images, generated images, or skip the preview.
* **NO broken Unsplash links.** Use `https://picsum.photos/seed/{descriptive-string}/{w}/{h}`, or generated photo placeholders, or actual assets.
* **shadcn/ui customization:** Allowed, but NEVER in default state. Customize radii, colors, shadows, typography to the project aesthetic.
* **Production-Ready Cleanliness:** Code visually clean, memorable, meticulously refined.

### 9.F Production-Test Tells (banned outright)

These patterns came out of real LLM-generated landing-page tests. They are the signatures the model defaults to when it tries to "look designed." Treat them as hard bans unless the brief explicitly calls for one.

**Hero & top-of-page**
* **NO version labels in the hero.** `V0.6`, `v2.0`, `BETA`, `INVITE-ONLY PREVIEW`, `EARLY ACCESS`, `ALPHA` - banned as default eyebrows. Only acceptable when the brief is explicitly about a product launch / preview status.
* **NO "Brand · No. 01"-style sub-eyebrows.** "Marrow · No. 01 · The 6-quart" type micro-meta lines. Skip them.

**Section numbering & micro-labels**
* **NO section-number eyebrows.** `00 / INDEX`, `001 · Capabilities`, `002 · Featured commission`, `06 · how it works`, `05 · The honest table` - banned. Eyebrows should name the topic in plain language, not enumerate.
* **NO `01 / 4`-style pagination on images or bento tiles.** If the user can count, they don't need the label.
* **NO `Scroll · 001 Capabilities`-style scroll cues.** A simple arrow or "Scroll" is enough; no section-number prefix.
* **NO "Index of Work, 2018 - 2026"-style range labels** as eyebrows. Just say what the section is.

**Separators & dots**
* **The middle-dot (`·`) is rationed.** Maximum 1 per line in metadata strips. Do NOT use it as the default separator for everything ("foo · bar · baz · qux · quux"). If you need a separator family, prefer line breaks, hairlines, or columns.
* **NO decorative colored status dots on every list/nav/badge.** A colored dot before "ONE Q4 SLOT OPEN" or before every nav link, or every task row - banned by default. Acceptable only when the dot conveys actual semantic state (a server status, an availability flag) and is used sparingly.

**Em-dashes & typography flourishes**
* **NO em-dash (`—`) as a design element OR anywhere else.** See Section 9.G below for the complete, non-negotiable ban. The em-dash character is forbidden in headlines, eyebrows, pills, body copy, quotes, attribution, captions, button text, and alt text. Use the regular hyphen (`-`).
* **NO `<br>`-broken-and-italicized headlines** as a default "design move." "for thirty\<br\>*years.*" type splits. Headlines should read naturally first, get clever only when the brief demands it.
* **NO vertical rotated text** ("INDEX OF WORK, 2018 - 2026" rotated 90°). Agency-portfolio cliché. Use it only when the brief is explicitly agency / Awwwards / experimental AND it serves a real composition purpose.
* **NO crosshair / hairline grid lines as decoration.** Vertical and horizontal lines drawn just to make the page "feel designed" - banned. Use them only when they organize real content.

**Fake product previews**
* **NO div-based fake product UI in the hero** (fake task list, fake terminal, fake dashboard built from styled divs). It is the #1 LLM-design Tell. Use a real screenshot, a generated image, a real component preview, or none at all.
* **NO fake version footers** ("v0.6.2-rc.1", "last sync 4s ago · main") inside fake screenshots. Adds nothing, screams AI.

**Marketing-copy Tells**
* **NO "Quietly in use at" / "Quietly trusted by"** social-proof headers. Use natural language: "Trusted by", "Used at", "Customers include", or skip the heading entirely if the logos speak.
* **NO "From the field" / "Field notes" / "Currently on the bench" / "On our desks" / "Loose plates" style poetic labels** on quote, blog, or sidebar sections. Reads as performative-craftsman. Use plain functional labels ("Testimonials", "Latest writing", "Now working on") or skip the label.
* **NO "We respect the French ones"-style** mock-humble industry-references in body copy. Cute and AI-y.
* **NO weather / locale strips** ("LIS 14:23 · 18°C") in headers/footers unless the brief is explicitly about a place / time-zone-distributed studio.
* **NO micro-meta-sentences under eyebrows.** Sentences like *"Each of these is a feature we ship today, not a roadmap promise. The list will stay short on purpose."* sitting under a section heading are clutter. Eyebrow + Headline + Body is enough.
* **NO generic step labels.** "Stage 1 / Stage 2 / Stage 3", "Step 1 / Step 2 / Step 3", "Phase 01 / Phase 02 / Phase 03", "Pass One / Pass Two / Pass Three". Banned. The actual step content is the label. If you must show progression, use the verb-noun directly ("Install", "Configure", "Ship") not "Stage 1: Install".

**Pills, labels and version stamps**
* **NO pills/labels/tags overlaid on images.** No `<span>` overlays on photos with tags like `Brand · 02`, `PLATE · BRAND`, `Field notes - journal`. Either let the image speak alone, or add a caption directly below (outside the image).
* **NO photo-credit captions as decoration.** Strings like `Field study no. 12 · Ines Caetano`, `Plate 03 · House archive`, `Frame XII · 35mm` under stock/picsum images are pretentious. Photo credit is allowed ONLY when there is a real photographer being credited for a real photo (with permission). Otherwise: skip the caption or use a one-line functional caption ("The 6-quart, in Sage.").
* **NO version footers on marketing pages.** Footer strings like `v1.4.2`, `Build 0048`, `last sync 4s ago · main` are CLI / devtool fixtures, not landing-page content. Banned on marketing/landing/portfolio pages.
* **NO "Reservation 412 of 800"-style live-stock counters** as decoration. Only if the brief is explicitly a limited-run waitlist with real data.

**Decoration text strips**
* **NO decoration text strip at hero bottom.** Patterns like `BRAND. MOTION. SPATIAL.`, `TYPE / FORM / MOTION`, `DESIGN · BUILD · SHIP`, `ESTD. 2018 · LISBON · BRAND. MOTION. SPATIAL.` as a small mono-caps strip across the bottom of the hero are an agency-portfolio cliché. Banned by default. Only acceptable when the strip carries real, navigable links (sticky bottom nav) or real status info (cookie banner, build info on a docs site).
* **NO floating top-right sub-text in section headings.** Pattern: section has a giant left-aligned headline; in the top-right corner of the same section header there is a small explainer paragraph floating with no clear alignment to anything else. That floater is the Tell. Either put the sub-text directly under the headline, or build a clean 2-column header (left: headline, right: aligned body), but not a tiny corner paragraph.

**Lists, dividers and scoring**
* **NO `border-t` + `border-b` on every row of a long list / spec table.** Pick one (bottom-border between rows OR top-border above the group) and use it sparsely. A 10-row spec table with hairlines under each row is the laziest layout - see Section 4.9 for alternative UI components.
* **NO scoring/progress bars with filled background tracks** as comparison visuals. If you need to show "X out of Y" comparisons, prefer a number + small icon, or a tiny inline bar WITHOUT a background track. Big filled `bg-zinc-200` tracks with a partial fill on top are dashboard-UI clutter on a landing page.

**Locale, time, scroll cues**
* **Locale / city-name / time / weather strips are banned for 99% of briefs.** "Lisbon, working with founders" in the hero, "1200-690 Lisbon, Portugal" in the footer, "Lisbon 14:23 · 18°C" in the nav. These are agency-portfolio decoration tells. Allowed ONLY when: the brief explicitly describes a globally-distributed studio with timezone-relevant work, OR a travel-focused brand, OR a real-world physical venue. A single contact-address mention in the footer is fine; an atmospheric locale strip is not.
* **Scroll cues are banned.** `Scroll`, `↓ scroll`, `Scroll to explore`, `Scroll to walk through it`, animated mouse-wheel icons. If the user has not scrolled yet, they are looking at the hero. They know what scroll is. The bottom of the viewport does not need a label.
* **ZERO decorative status dots by default.** A coloured dot before nav items, before list rows, before badges, before status labels is a Tell. Only acceptable when conveying real semantic state (a live indicator on actual server status, a live availability flag) and limited to one per page section.

### 9.G EM-DASH BAN (the single most-violated Tell)

**Em-dash (`—`) is COMPLETELY banned.** It is the LLM's signature stylistic crutch and it is the #1 visual Tell in production tests. There is no "limited use" allowance, no "natural language frequency" allowance, no "in body copy is fine" allowance. None.

* **Banned in headlines.** Use a period or a comma.
* **Banned in eyebrows / labels / pills / button text / image captions / nav items.** Replace with line breaks, columns, or hairlines.
* **Banned in body copy.** Restructure the sentence: two sentences with a period, OR a comma, OR parentheses, OR a colon.
* **Banned in quote attribution.** Use a normal hyphen with spaces (` - `) or a line break + smaller-weight name.
* **Banned in en-dash form too (`–`) when used as a separator.** Date ranges (`2018-2026`) use a hyphen. Number ranges (`€40-80k`) use a hyphen.

The ONLY permitted dash characters on the page are:
* Regular hyphen `-` (for compound words, ranges, line dividers in markup)
* Minus sign in math (`-5°C`)

If your output contains a single `—` or `–` anywhere visible to the user, the output fails the Pre-Flight Check and must be rewritten.

This rule is non-negotiable. The agent has historically ignored em-dash limits when phrased as "use sparingly." The phrasing here is binary: zero em-dashes.

---

## 10. REFERENCE VOCABULARY (Pattern Names the Agent Should Know)

This is a vocabulary, not a library. The agent should KNOW these pattern names to communicate about them, design with them in mind, and reach for them when the design read calls for them. **Implementations and code sketches live in the Block Library (Section 12), which is populated iteratively.**

### Hero Paradigms
* **Asymmetric Split Hero** - Text on one side, asset on the other, generous white space.
* **Editorial Manifesto Hero** - Large type, no asset, almost-poster.
* **Video / Media Mask Hero** - Type cut out as mask over video background.
* **Kinetic-Type Hero** - Animated typography as the primary visual.
* **Curtain-Reveal Hero** - Hero parts on scroll like a curtain.
* **Scroll-Pinned Hero** - Hero stays pinned while content scrolls behind.

### Navigation & Menus
* **Mac OS Dock Magnification** - Edge nav, icons scale fluidly on hover.
* **Magnetic Button** - Pulls toward cursor.
* **Gooey Menu** - Sub-items detach like viscous liquid.
* **Dynamic Island** - Morphing pill for status / alerts.
* **Contextual Radial Menu** - Circular menu expanding at click point.
* **Floating Speed Dial** - FAB springing into curved secondary actions.
* **Mega Menu Reveal** - Full-screen dropdown, stagger-fade content.

### Layout & Grids
* **Bento Grid** - Asymmetric tile grouping (Apple Control Center).
* **Masonry Layout** - Staggered grid, no fixed row height.
* **Chroma Grid** - Borders / tiles with subtle animating gradients.
* **Split-Screen Scroll** - Two halves sliding in opposite directions.
* **Sticky-Stack Sections** - Sections that pin and stack on scroll.

### Cards & Containers
* **Parallax Tilt Card** - 3D tilt tracking mouse coordinates.
* **Spotlight Border Card** - Borders illuminate under cursor.
* **Glassmorphism Panel** - Frosted glass with inner refraction.
* **Holographic Foil Card** - Iridescent rainbow shift on hover.
* **Tinder Swipe Stack** - Physical card stack, swipe-away.
* **Morphing Modal** - Button expands into its own dialog.

### Scroll Animations
* **Sticky Scroll Stack** - Cards stick and physically stack.
* **Horizontal Scroll Hijack** - Vertical scroll → horizontal pan.
* **Locomotive / Sequence Scroll** - Video / 3D sequence tied to scrollbar.
* **Zoom Parallax** - Central background image zooming on scroll.
* **Scroll Progress Path** - SVG line drawing along scroll.
* **Liquid Swipe Transition** - Page transition like viscous liquid.

### Galleries & Media
* **Dome Gallery** - 3D panoramic gallery.
* **Coverflow Carousel** - 3D carousel with angled edges.
* **Drag-to-Pan Grid** - Boundless draggable canvas.
* **Accordion Image Slider** - Narrow strips expanding on hover.
* **Hover Image Trail** - Mouse leaves popping image trail.
* **Glitch Effect Image** - RGB-channel shift on hover.

### Typography & Text
* **Kinetic Marquee** - Endless text bands reversing on scroll.
* **Text Mask Reveal** - Massive type as transparent window to video.
* **Text Scramble Effect** - Matrix-style decoding on load / hover.
* **Circular Text Path** - Text curving along spinning circle.
* **Gradient Stroke Animation** - Outlined text with running gradient.
* **Kinetic Typography Grid** - Letters dodging the cursor.

### Micro-Interactions & Effects
* **Particle Explosion Button** - CTA shatters into particles on success.
* **Liquid Pull-to-Refresh** - Reload indicator like detaching droplets.
* **Skeleton Shimmer** - Shifting light reflection across placeholders.
* **Directional Hover-Aware Button** - Fill enters from cursor's exact side.
* **Ripple Click Effect** - Wave from click coordinates.
* **Animated SVG Line Drawing** - Vectors drawing themselves in real time.
* **Mesh Gradient Background** - Organic lava-lamp blobs.
* **Lens Blur Depth** - Background UI blurred to focus foreground action.

### Animation Library Choice
* **Motion (`motion/react`)** - default for UI / Bento / state-change motion.
* **GSAP + ScrollTrigger** - for full-page scrolltelling and scroll hijacks. Isolate in dedicated leaf components with `useEffect` cleanup.
* **Three.js / WebGL** - for canvas backgrounds and 3D scenes. Same isolation rule.
* **NEVER mix GSAP / Three.js with Motion in the same component tree.** They fight over the same frames.

---

## 11. REDESIGN PROTOCOL

This skill handles **greenfield builds AND redesigns**. Misclassifying the mode is the single biggest source of bad redesign output.

### 11.A Detect the Mode (first action)
* **Greenfield** - no existing site, or full overhaul approved. Dial baseline from Section 1.
* **Redesign - Preserve** - modernise without breaking the brand. Audit first, extract brand tokens, evolve gradually.
* **Redesign - Overhaul** - new visual language on top of existing content. Treat as greenfield for visuals; preserve content and IA.

If ambiguous, ask **once**: *"Should this redesign preserve the existing brand, or are we starting visually from scratch?"*

### 11.B Audit Before Touching
Document the current state before proposing changes:
* **Brand tokens** - primary / accent colors, type stack, logo treatment, radii.
* **Information architecture** - page tree, primary nav, key conversion paths.
* **Content blocks** - what exists, what's doing work, what's filler.
* **Patterns to preserve** - signature interactions, recognisable hero, copy voice.
* **Patterns to retire** - AI-slop tells, broken layouts, dead links, generic stock imagery, perf traps.
* **Dial reading of the existing site** - infer current `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY`. That's your starting point, not the baseline.
* **SEO baseline** - current ranking pages, meta titles, structured data, OG cards. **SEO migration is the #1 redesign risk.**

### 11.C Preservation Rules
* **Do not change information architecture** unless asked. Keep page slugs, anchor IDs, primary nav labels stable for SEO and muscle memory.
* **Extract brand colors before applying Section 4.2.** A brand that is already purple stays purple - apply the LILA RULE's override.
* **Preserve copy voice** unless asked for a rewrite. Visual modernisation ≠ content rewrite.
* **Honor existing accessibility wins.** Do not regress focus states, alt text, keyboard nav, contrast.
* **Respect existing analytics events.** Do not rename buttons, form fields, section IDs that downstream tracking depends on.

### 11.D Modernisation Levers (priority order)
Apply in order - stop when the brief is satisfied:
1. **Typography refresh** - biggest visual lift per unit of risk.
2. **Spacing & rhythm** - increase section padding, fix vertical rhythm.
3. **Color recalibration** - desaturate, unify neutrals, keep brand accent.
4. **Motion layer** - add `MOTION_INTENSITY`-appropriate micro-interactions to existing components.
5. **Hero & key-section recomposition** - restructure top-of-funnel using Section 10 vocabulary.
6. **Full block replacement** - only when the existing block is unsalvageable.

### 11.E Decision Tree: Targeted Evolution vs Full Redesign
* IA, content, and SEO sound → **targeted evolution** (Levers 1-4). ~70% of value at ~40% of risk.
* Visual debt is structural (broken IA, no design system, broken mobile) → **full redesign** with strict content preservation.
* Brand itself is changing → **greenfield**.

### 11.F What Never Changes Silently
Never modify without explicit user approval:
* URL structure / route slugs.
* Primary nav labels.
* Form field names or order (breaks analytics + autofill).
* Brand logo or wordmark.
* Existing legal / consent / cookie copy.

---

## 12. THE BLOCK LIBRARY (Contract - Implementations Land Here Iteratively)

The Reference Vocabulary (Section 10) names patterns. The Block Library implements them with real props, real motion specs, and real code sketches.

**Status:** schema defined here. Blocks will be added iteratively. Do not freelance new blocks without following this schema.

### 12.A File Location

Blocks land in `blocks/` next to this SKILL.md (i.e. `skills/taste/blocks/`);
the directory is created with the first block. The shape:
```
skills/taste/blocks/
  hero/
    asymmetric-split.md
    editorial-manifesto.md
    kinetic-type.md
    ...
  feature/
    bento-grid.md
    sticky-scroll-stack.md
    zig-zag.md
    ...
  social-proof/
  pricing/
  cta/
  footer/
  navigation/
  portfolio/
  transition/
```

### 12.B Required Frontmatter
```yaml
---
name: asymmetric-split-hero
category: hero
dial_compatibility:
  variance: [6, 10]
  motion: [3, 10]
  density: [2, 5]
when_to_use: "Landing pages with one strong asset and one strong message. Default hero for SaaS, agency, premium consumer."
not_for: "Editorial / manifesto launches where the message IS the design."
stack: ["react", "next", "tailwind", "motion"]
---
```

### 12.C Required Body Sections
1. **Visual sketch** - short ASCII or description of the layout.
2. **Props API** - the component's interface.
3. **Code sketch** - minimal working implementation (Server Component default, Client island for motion).
4. **Mobile fallback** - explicit collapse rules for `< 768px`.
5. **Motion variants** - one variant per `MOTION_INTENSITY` band (1-3, 4-7, 8-10). Reduced-motion fallback explicit.
6. **Dark-mode notes** - token strategy specific to this block.
7. **Anti-patterns** - common ways this block goes wrong.
8. **References** - links to real examples in production.

### 12.D Block-Library Discipline
* One block per file. No multi-block files.
* Every block must work standalone (drop it into a page, it renders).
* Every block must pass the Pre-Flight Check (Section 14).
* Blocks that depend on a design system from Section 2.A live under `blocks/<category>/<name>--<system>.md` (e.g. `feature/bento-grid--material.md`).

---

## 13. OUT OF SCOPE

Full guidance is loaded on demand from `skills/taste/reference/preflight.md`.

## Appendix B - Canonical Sources (read these before reinventing)

### Material Web
- https://github.com/material-components/material-web
- https://material-web.dev/theming/material-theming/
- https://m3.material.io/develop/web

### Fluent UI
- https://fluent2.microsoft.design/get-started/develop
- https://fluent2.microsoft.design/components/web/react/
- https://github.com/microsoft/fluentui
- https://learn.microsoft.com/en-us/fluent-ui/web-components/

### Carbon
- https://carbondesignsystem.com/
- https://github.com/carbon-design-system/carbon
- https://carbondesignsystem.com/developing/react-tutorial/overview/
- https://carbondesignsystem.com/developing/web-components-tutorial/overview/

### Shopify Polaris
- https://shopify.dev/docs/api/app-home/web-components
- https://github.com/Shopify/polaris-react
- https://polaris-react.shopify.com/components

### Atlassian
- https://atlassian.design/get-started/develop
- https://atlassian.design/components/button/examples
- https://atlaskit.atlassian.com/packages/design-system/button/example/disabled
- https://atlassian.design/tokens/design-tokens

### Primer
- https://primer.style/
- https://github.com/primer/css
- https://github.com/primer/brand

### GOV.UK
- https://design-system.service.gov.uk/components/button/
- https://design-system.service.gov.uk/styles/layout/
- https://github.com/alphagov/govuk-frontend

### USWDS
- https://designsystem.digital.gov/documentation/developers/
- https://designsystem.digital.gov/components/button/
- https://designsystem.digital.gov/components/card/
- https://github.com/uswds/uswds

### Bootstrap
- https://getbootstrap.com/docs/5.3/layout/grid/
- https://getbootstrap.com/docs/5.3/components/card/

### Tailwind
- https://tailwindcss.com/docs/dark-mode
- https://tailwindcss.com/blog/tailwindcss-v4

### Radix
- https://www.radix-ui.com/themes/docs/components/theme
- https://www.radix-ui.com/themes/docs/components/card
- https://github.com/radix-ui/themes

### shadcn/ui
- https://ui.shadcn.com/docs
- https://ui.shadcn.com/docs/components/card
- https://github.com/shadcn-ui/ui

### Native CSS / W3C standards
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations
- https://drafts.csswg.org/scroll-animations-1/

### Apple Liquid Glass (Apple platforms only)
- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass
- https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- https://developer.apple.com/documentation/SwiftUI/Material

---

## Appendix C - Apple Liquid Glass: Honest Web Approximation

Do **not** treat random CSS snippets as official Apple Liquid Glass.

### What is official
Apple documents Liquid Glass inside Apple's Human Interface Guidelines and Developer Documentation for **Apple platforms**. It is a dynamic material used across Apple platform UI. Apple's native implementation belongs to Apple platform APIs and system components, **not a public web CSS package**.

Relevant official docs:
- Apple Human Interface Guidelines → Materials
- Apple Developer Documentation → Liquid Glass
- Apple Developer Documentation → Adopting Liquid Glass
- SwiftUI → Material

### What is NOT official
There is no `liquid-glass.css` from Apple for normal websites.

A web approximation can use:
- `backdrop-filter`
- transparent backgrounds
- layered borders
- highlight overlays
- gradients
- motion
- strong contrast fallbacks

But that is **web glassmorphism / frosted-glass approximation**, not official Apple Liquid Glass. Label it as such in comments.

### Safer web approximation skeleton

```css
.liquid-glass-web-approx {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / .32);
  background:
    linear-gradient(135deg, rgb(255 255 255 / .30), rgb(255 255 255 / .08)),
    rgb(255 255 255 / .12);
  backdrop-filter: blur(24px) saturate(180%) contrast(1.05);
  -webkit-backdrop-filter: blur(24px) saturate(180%) contrast(1.05);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / .48),
    inset 0 -1px 0 rgb(255 255 255 / .12),
    0 18px 60px rgb(0 0 0 / .18);
}

.liquid-glass-web-approx::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background:
    radial-gradient(circle at 20% 0%, rgb(255 255 255 / .55), transparent 34%),
    linear-gradient(90deg, rgb(255 255 255 / .18), transparent 42%, rgb(255 255 255 / .14));
  pointer-events: none;
}

.liquid-glass-web-approx::after {
  content: "";
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  border: 1px solid rgb(255 255 255 / .14);
  pointer-events: none;
}

@media (prefers-color-scheme: dark) {
  .liquid-glass-web-approx {
    border-color: rgb(255 255 255 / .18);
    background:
      linear-gradient(135deg, rgb(255 255 255 / .16), rgb(255 255 255 / .04)),
      rgb(15 23 42 / .42);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / .22),
      0 18px 60px rgb(0 0 0 / .42);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .liquid-glass-web-approx {
    background: rgb(255 255 255 / .96);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

**Important:** `prefers-reduced-transparency` has uneven browser support; test it. Always provide enough contrast even without blur.

---

**End of appendices.** Install commands above are reality anchors. The Apple Liquid Glass skeleton is a labeled approximation, not an Apple-issued package. For canonical docs per design system, consult the system's official docs (links in Section 2 plus Appendix B).

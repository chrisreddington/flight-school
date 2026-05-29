---
name: how-to-design-like-github
description: |
  Use whenever you are designing, building, or reviewing UI in Flight School
  and want it to look and feel like a first-class GitHub experience —
  beautiful, polished, mobile-friendly, and on-brand. Grounds every decision
  in Primer design tokens and the GitHub brand. Trigger phrases: "make this
  look like GitHub", "design this", "make it beautiful", "polish the UI",
  "is this on brand?", "responsive", "mobile-friendly", "design audit",
  "Primer", "design tokens", "look and feel".
---

# How to design like GitHub

> The bar: a GitHub engineer should open any Flight School page and assume
> it was built by the Primer team. Calm, content-first, technically
> precise, beautiful at every viewport. Everything here defends that bar.

Flight School is a GitHub product surface. It must feel native to GitHub —
not "inspired by", but **indistinguishable from** something the Primer team
shipped. This skill gives you the baseline to design confidently offline,
and the live links to verify against the latest source of truth.

## Always check the latest source of truth

Primer and the GitHub brand evolve. The baseline below is the durable core,
but **before any non-trivial design work, fetch the current docs** — token
names, component APIs, and brand rules change.

| What you need | Authoritative source (fetch this) |
|---|---|
| Product components, patterns, usage | https://primer.style/product |
| React component API (props, examples) | https://primer.style/product/components |
| **Design tokens** (color/size/type) | https://primer.style/product/primitives |
| Color token reference | https://primer.style/product/primitives/color |
| Sizing & spacing token reference | https://primer.style/product/primitives/size |
| Typography token reference | https://primer.style/product/primitives/typography |
| Octicons (icon set + search) | https://primer.style/octicons |
| Accessibility guidance | https://primer.style/accessibility |
| **GitHub brand toolkit** (logo/color/type/mascots) | https://brand.github.com |
| Primer Brand (marketing/expressive UI) | https://primer.style/brand |

Repo-local rules that this skill assumes and must stay consistent with:

- [`primer-react.instructions.md`](../../instructions/primer-react.instructions.md) — Primer React component API rules (no `sx`, `Stack` literals, `Banner` over `Flash`, etc.).
- [`iconography.instructions.md`](../../instructions/iconography.instructions.md) — canonical Octicon per concept.
- [`typescript.instructions.md`](../../instructions/typescript.instructions.md) — readable code the styling lives in.

## The toolbox: components & patterns for *this* app

Don't reinvent UI — Primer almost certainly ships it. Before writing a
custom component, find it below and fetch its current API from the linked
page (props change between versions). These are the specific primitives
that matter for a learning/dashboard/AI product like Flight School, grouped
by the job you're doing. Full index: https://primer.style/product/components.

### Page scaffolding & navigation
- [`PageLayout`](https://primer.style/product/components/page-layout) — header / main / pane / footer regions; provides responsive primitives (`hidden`, responsive `position`, `responsiveVariant="fullscreen"` for the sidebar) so you don't hand-roll a CSS grid like `two-column-layout` — but you still choose and **test** the narrow-viewport behavior.
- [`SplitPageLayout`](https://primer.style/product/components/split-page-layout) — two-column main + sidebar (settings, skills).
- [`PageHeader`](https://primer.style/product/components/page-header) — consistent page titles, context actions, back-link. Use on every top-level page.
- [`Breadcrumbs`](https://primer.style/product/components/breadcrumbs) — hierarchy/location (the app already has a breadcrumb context).
- [`NavList`](https://primer.style/product/components/nav-list) — vertical nav (sidebar sections, settings nav).
- [`UnderlineNav`](https://primer.style/product/components/underline-nav) — horizontal page-level tabbed nav.
- [`UnderlinePanels`](https://primer.style/product/components/underline-panels) — tabbed content panels (already used in the challenge sandbox).
- [`Stack`](https://primer.style/product/components/stack) — the responsive flow primitive for almost all spacing/layout.

### Containers & content
- [`Card`](https://primer.style/product/components/card) — the workhorse for dashboard tiles, skill cards, focus cards.
- [`Blankslate`](https://primer.style/product/components/blankslate) — **the canonical empty state** (no skills yet, no habits, no history). Use it; don't invent empties.
- [`Timeline`](https://primer.style/product/components/timeline) — learning history, activity feeds.
- [`TreeView`](https://primer.style/product/components/tree-view) — file manager in the challenge sandbox.
- [`Details`](https://primer.style/product/components/details) / progressive disclosure — collapsible hints, explanations.

### Status, metadata & stats (learning data)
- [`Label`](https://primer.style/product/components/label) + [`LabelGroup`](https://primer.style/product/components/label-group) — difficulty, language, topic tags.
- [`Token`](https://primer.style/product/components/token) — removable/clickable metadata chips (selected topics, skills).
- [`StateLabel`](https://primer.style/product/components/state-label) — strong status pills (challenge passed/failed, goal complete).
- [`CounterLabel`](https://primer.style/product/components/counter-label) — counts on nav/tabs (streak count, unread).
- [`ProgressBar`](https://primer.style/product/components/progress-bar) — skill mastery, goal/challenge completion.
- [`DataTable`](https://primer.style/product/components/data-table) — structured tabular data (history, leaderboards, insights tables); verify the current import/API before use.
- [`Pagination`](https://primer.style/product/components/pagination) — paging long histories/lists.
- [`RelativeTime`](https://primer.style/product/components/relative-time) — **"3 days ago"** done accessibly and locale-safe (note: this is the GitHub-native fix for the kind of date hydration bug we hit on `/skills`).
- [`Avatar`](https://primer.style/product/components/avatar) / [`AvatarStack`](https://primer.style/product/components/avatar-stack) — the signed-in GitHub user.

### Actions
- [`Button`](https://primer.style/product/components/button) (+ [`ButtonGroup`](https://primer.style/product/components/button-group)) — one `primary` per view; `default`/`invisible`/`danger` otherwise.
- [`IconButton`](https://primer.style/product/components/icon-button) — icon-only actions (needs `aria-label`).
- [`ActionList`](https://primer.style/product/components/action-list) / [`ActionMenu`](https://primer.style/product/components/action-menu) — menus of actions/options (overflow menus, "..." menus).
- [`ActionBar`](https://primer.style/product/components/action-bar) — toolbar of IconButtons with auto-overflow.
- [`SegmentedControl`](https://primer.style/product/components/segmented-control) — immediate single-pick toggles (difficulty filter, view switch).

### Forms (settings, challenge authoring, chat input)
- [`FormControl`](https://primer.style/product/components/form-control) — **always** wrap inputs; gives label + hint + validation wiring.
- [`TextInput`](https://primer.style/product/components/text-input) / [`Textarea`](https://primer.style/product/components/textarea) — text entry.
- [`Select`](https://primer.style/product/components/select) / [`Autocomplete`](https://primer.style/product/components/autocomplete) / [`SelectPanel`](https://primer.style/product/components/select-panel) — choosing from lists (language, topic).
- [`Checkbox`](https://primer.style/product/components/checkbox)(+Group) / [`Radio`](https://primer.style/product/components/radio)(+Group) / [`ToggleSwitch`](https://primer.style/product/components/toggle-switch) — toggles & choices (settings).

### Feedback, overlays & loading
- [`Banner`](https://primer.style/product/components/banner) — page-level important info (the AI-fallback / degraded notice). Replaces `Flash`.
- [`InlineMessage`](https://primer.style/product/components/inline-message) — inline result of an action.
- [`Dialog`](https://primer.style/product/components/dialog) / [`ConfirmationDialog`](https://primer.style/product/components/confirmation-dialog) — modal flows, destructive confirms (export, reset).
- [`Tooltip`](https://primer.style/product/components/tooltip) (use `text` prop) / [`Popover`](https://primer.style/product/components/popover) — contextual help.
- [`Spinner`](https://primer.style/product/components/spinner) — indeterminate waits (AI generation in-flight).
- [`SkeletonText`](https://primer.style/product/components/skeleton-text) / [`SkeletonBox`](https://primer.style/product/components/skeleton-box) / [`SkeletonAvatar`](https://primer.style/product/components/skeleton-avatar) — **perceived-performance placeholders** for the dashboard/skills loads that depend on GitHub + AI.

### Text primitives
[`Heading`](https://primer.style/product/components/heading), [`Text`](https://primer.style/product/components/text), [`Link`](https://primer.style/product/components/link), [`Truncate`](https://primer.style/product/components/truncate).

### UI patterns (workflow-level guidance — read before designing a flow)
Full index: https://primer.style/product/ui-patterns.

- [Empty states](https://primer.style/product/ui-patterns/empty-states) — first-run skills/habits/history.
- [Loading](https://primer.style/product/ui-patterns/loading) — when to use Spinner vs Skeleton vs progress.
- [**Degraded experiences**](https://primer.style/product/ui-patterns/degraded-experiences) — directly mirrors Flight School's graceful degradation when AI keys are absent; design the no-AI path as a first-class state, not an error.
- [Data visualization](https://primer.style/product/ui-patterns/data-visualization) — the `/insights` charts.
- [Forms](https://primer.style/product/ui-patterns/forms) — `/settings`, authoring, sign-in.
- [Navigation](https://primer.style/product/ui-patterns/navigation) — app nav model.
- [Saving](https://primer.style/product/ui-patterns/saving) — settings/habits persistence feedback.
- [Notification messaging](https://primer.style/product/ui-patterns/notification-messaging) — Banner vs InlineMessage vs Toast choice.
- [Progressive disclosure](https://primer.style/product/ui-patterns/progressive-disclosure) — hints, "explain more".
- [Feature onboarding](https://primer.style/product/ui-patterns/feature-onboarding) — guiding new learners.

## Principle 1 — Design tokens, never raw values

This is the single most important rule. **Never hardcode a hex color, a
pixel spacing, or a radius.** Every visual value comes from a Primer CSS
variable. Tokens are theme-aware (light/dark/high-contrast/colorblind all
work for free) and keep us pixel-consistent with github.com.

```css
/* ❌ NEVER — hardcoded values break theming + drift from GitHub */
.card {
  background: #ffffff;
  color: #1f2328;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 20px;
}

/* ✅ ALWAYS — functional tokens adapt to every theme */
.card {
  background-color: var(--bgColor-default);
  color: var(--fgColor-default);
  border: var(--borderWidth-thin) solid var(--borderColor-default);
  border-radius: var(--borderRadius-medium);
  padding: var(--base-size-20);
}
```

Hardcoded fallbacks (`var(--bgColor-default, #ffffff)`) are tolerated in
this repo's existing module CSS, but the token must come first and the
fallback must be the real Primer value for that token. Prefer no fallback
in new code.

### Color: use *functional* tokens, not *base* palette scales

Primer has two layers. Use the **functional** layer in product UI — it
encodes intent and themes correctly. Reach for base scales (`--base-color-*`)
essentially never.

| Role | Token | Use for |
|---|---|---|
| Primary text | `--fgColor-default` | Headings, body copy |
| Secondary text | `--fgColor-muted` | Captions, metadata, helper text |
| Link / interactive | `--fgColor-accent` | Links, active states |
| Page background | `--bgColor-default` | Cards, primary surfaces |
| Subtle background | `--bgColor-muted` | Inset panels, code blocks |
| App canvas | `--bgColor-inset` | The page behind cards |
| Default border | `--borderColor-default` | Card/control borders |
| Subtle border | `--borderColor-muted` | Dividers, table lines |
| Success / done | `--fgColor-success`, `--bgColor-success-muted` | Completed states |
| Attention / warn | `--fgColor-attention` | Warnings, streak risk |
| Danger | `--fgColor-danger` | Destructive actions, errors |

Semantic states (success/attention/danger/done) each have a matched set of
tokens — use the set, don't mix a success foreground with a neutral
background. Note the suffixes: foreground is plain
(`--fgColor-success`), but backgrounds and borders take `-muted` or
`-emphasis` (e.g. `--bgColor-success-muted`, `--borderColor-success-emphasis`,
`--borderColor-attention-muted`, `--borderColor-danger-emphasis`). There is
no bare `--borderColor-success`; always include the suffix.

Primary action green is `--button-primary-bgColor-rest` (#1f883d in light).
Let the `Button` component own button colors — don't re-derive them.

### Spacing: the 4-based scale

All spacing, margins, padding, and gaps come from `--base-size-*`
(multiples of 4: `2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64…`).
Layout gaps can use the Stack scale: `--stack-gap-condensed` (8px),
`--stack-gap-normal` (16px), `--stack-gap-spacious` (24px).

Rhythm rule of thumb: `8px` inside tight groups, `16px` between related
elements, `24px` between sections, `≥32px` between major regions. Consistent
rhythm is most of what makes a layout feel "designed".

### Radius & borders

- `--borderRadius-small` (3px) — tags, small chips
- `--borderRadius-medium` (6px, the default) — cards, buttons, inputs
- `--borderRadius-large` (12px) — large surfaces, modals, hero cards
- `--borderRadius-full` — pills, avatars
- Border width: `--borderWidth-thin` (1px) default; `--borderWidth-thick` (2px) for emphasis.

**GitHub leans on borders, not drop shadows.** Define surfaces with a 1px
`--borderColor-default` and a subtle `--bgColor-*` change. Reserve shadows
(`--shadow-*` / overlay shadows) for genuinely floating layers — menus,
dialogs, popovers. A page full of drop shadows reads as "not GitHub".

### Typography

Use Primer's type shorthands; don't invent font sizes.

| Token | Use |
|---|---|
| `--text-display-shorthand` | Big hero/marketing display |
| `--text-title-shorthand-large` | Page titles (h1) |
| `--text-title-shorthand-medium` | Section titles (h2) |
| `--text-title-shorthand-small` | Card/sub-section titles (h3) |
| `--text-body-shorthand-large` (16px) | Comfortable body / lead |
| `--text-body-shorthand-medium` (14px) | **Default body** — the workhorse |
| `--text-body-shorthand-small` (12px) | Metadata, captions |
| `--text-caption-shorthand` | Fine print |
| `--text-codeInline-shorthand` / `--text-codeBlock-shorthand` | Code |

Font stacks: always reference the token, never a literal font list — sans
via `--fontStack-sansSerif`, mono via `--fontStack-monospace`. Current
Primer may lead the sans stack with `"Mona Sans"` and fall back to the
system UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", …`); using
the token means you get whatever GitHub ships without hardcoding it. Body weight is
~400; semibold (600) for emphasis and headings. Don't use bold (700) for
running text. Line-height comes baked into the shorthands — don't override.

## Principle 2 — Color with restraint (the GitHub feel)

GitHub's brand is **mostly neutral with small, deliberate moments of color.**
The brand guideline is an ~80 / 10 / 5 / 5 split: ~80% black-or-white, ~10%
neutral gray, ~5% GitHub Green, ~5% a single accent. Translated to product UI:

- The canvas, cards, and most text are neutral tokens.
- Color carries **meaning**: accent for interactive, success/attention/danger
  for state. Don't decorate with color.
- One accent at a time. Don't put green, blue, and purple in the same view
  competing for attention.

GitHub brand palette (for **marketing surfaces and illustration only** — in
product UI you use functional tokens, not these raw hexes):

- **GitHub Green** `#0FBF3E` — the hero brand color.
- Neutrals Gray 1–6 (`#F2F5F3` → `#101411`) ground everything.
- **Copilot Purple** `#8534F3` — Copilot/AI-themed marketing moments.
- **Security Blue** `#3094FF` — security-themed marketing moments.

Flight School is a learning product with heavy Copilot/AI involvement, so
purple is an appropriate accent for AI-specific surfaces — but apply it the
brand way: sparingly, over neutral backgrounds, never clashing with green.

The brand typeface is **Mona Sans**. In product UI you get it (or the system
fallback) automatically through `--fontStack-sansSerif` — don't set
`font-family: "Mona Sans"` by hand. Only reach for Mona Sans explicitly on
approved marketing/expressive surfaces, and only in its standard width.

## Principle 3 — Mobile-first & responsive (non-negotiable)

Every page must be beautiful and fully usable from 320px up. Design the
narrow layout first, then enhance for wider viewports.

Primer breakpoint tokens (use these, don't invent pixel queries):

| Token | Width | Typical use |
|---|---|---|
| `--breakpoint-xsmall` | 320px | Smallest phones |
| `--breakpoint-small` | 544px | Large phones |
| `--breakpoint-medium` | 768px | Tablets — common 1→2 column switch |
| `--breakpoint-large` | 1012px | Laptops |
| `--breakpoint-xlarge` | 1280px | Desktops |
| `--breakpoint-xxlarge` | 1400px | Max content width cap |

Rules:

- **No fixed pixel widths that can't shrink.** Multi-column grids must
  collapse to a single column on narrow viewports (the existing
  `two-column-layout.module.css` collapses at 900px — prefer the
  `--breakpoint-large`/`medium` token going forward).
- **Touch targets ≥ 44×44px** on coarse pointers. Primer controls already
  meet this; custom tap targets must too (`--base-size-44` / `min-height`).
  Primer ships `size-coarse`/`size-fine` token sets for pointer-aware sizing.
- **Fluid type & spacing:** scale down section padding on small screens
  (`--base-size-16` instead of `--base-size-24`, etc.). Never let a desktop
  layout cause horizontal scroll on mobile.
- **Reflow, don't shrink-to-fit:** sidebars stack above/below content,
  tables scroll or become cards, nav collapses.
- **Dense data on narrow screens:** don't squeeze a wide `DataTable` to fit.
  Either let the data region scroll horizontally with a visible affordance,
  or restructure each row into a stacked card. Prefer cards for the most
  important mobile views.
- Test every change at **375px, 768px, and 1280px** minimum.

```css
.layout {
  display: grid;
  grid-template-columns: 1fr; /* mobile-first: single column */
  gap: var(--stack-gap-normal);
  padding: var(--base-size-16);
}

/* Custom properties can't be used inside a media-query condition, so write
   the breakpoint's rem value and name the token in a comment. */
@media (min-width: 48rem) /* --breakpoint-medium */ {
  .layout {
    grid-template-columns: 320px 1fr;
    gap: var(--base-size-24);
    padding: var(--base-size-24);
  }
}
```

## Principle 4 — What makes it *beautiful*

Polish is the sum of small disciplines:

- **Clear hierarchy.** One obvious primary action per view. Size, weight,
  and color guide the eye top-to-bottom. If everything is bold, nothing is.
- **Generous, consistent whitespace.** Honour the spacing scale; don't
  crowd. Breathing room reads as quality.
- **Alignment & rhythm.** Edges line up; repeated cards share identical
  padding and gap. Use a grid.
- **Restraint.** Fewer borders, fewer shadows, fewer colors than you think.
- **Complete states.** Every data view needs: loading (skeleton/Spinner),
  empty (friendly Octicon + one-line guidance + a primary action), and
  error (Banner with a recovery action). Empty states are a design
  opportunity, not an afterthought.
- **Purposeful motion.** Subtle, fast (≤200ms), and easing-based. Always
  wrap in `@media (prefers-reduced-motion: reduce)`. Never animate to
  decorate.
- **Octicons, used canonically.** Match the iconography instructions; size
  via the documented scale (12/16/20). Icons reinforce meaning, never
  replace a label on their own for critical actions.
- **Reuse Primer components.** Before building anything custom, check if
  Primer has it (Button, Label, Token, Banner, Dialog, ActionList,
  UnderlinePanels, DataTable, Avatar, Timeline, Spinner, etc.). A custom
  component is a last resort and must visually match its Primer peers.

## Principle 5 — Accessibility is part of "first-class"

Not optional, not a follow-up. Match https://primer.style/accessibility.

- **Contrast ≥ WCAG AA** (4.5:1 text, 3:1 large text / UI). Functional
  tokens are designed to pass — another reason not to hardcode colors.
- **Visible focus** on every interactive element via the focus tokens
  (`--outline-focus-width`, `--outline-focus-offset`, and the focus outline
  color token; Primer components apply these by default). Verify the exact
  current token names at primer.style/product/primitives. Never
  `outline: none` without an equal-or-better replacement.
- **Color is never the only signal** — pair it with an icon, label, or
  shape (relevant for our success/streak/difficulty states).
- **Semantic HTML + ARIA:** real `<button>`/`<a>`, landmarks, labelled
  controls, `alt` text. Primer components handle most of this — don't
  defeat them.
- **Keyboard:** every action reachable and operable; logical tab order;
  Escape closes overlays.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.

## How to apply this skill

1. **Reach for a Primer component first.** Fetch its current API from
   https://primer.style/product/components if unsure.
2. **Style only with tokens** (Principle 1). If you're typing a hex or a raw
   px value, stop and find the token.
3. **Match existing module-CSS patterns** in the repo (see
   `two-column-layout.module.css`, `*.module.css`) so new work is consistent.
4. **Design mobile-first**, then layer breakpoints (Principle 3).
5. **Add all states** — loading, empty, error (Principle 4).
6. **Verify:** screenshot at 375 / 768 / 1280; check contrast and focus;
   confirm dark theme still works (tokens make this free).
7. When the brand/marketing voice matters, fetch https://brand.github.com.

## Anti-patterns (reject these)

| ❌ Anti-pattern | ✅ Do instead |
|---|---|
| Hardcoded hex / px / radius | Functional Primer tokens |
| Base palette scales in product UI | Functional (intent) tokens |
| Drop shadows to define every card | 1px border + bg token; shadows only for floating layers |
| Multiple accent colors in one view | One accent; neutrals dominate (80/10/5/5) |
| Fixed-width layouts | Fluid grids that collapse at breakpoints |
| Tap targets < 44px on mobile | `--base-size-44` min, coarse-pointer sizing |
| Custom component that Primer already ships | Use the Primer component |
| `outline: none` with no replacement | Keep the Primer focus ring |
| Inventing font sizes | Type shorthands (`--text-*-shorthand-*`) |
| Off-scale spacing (`13px`, `17px`) | Nearest `--base-size-*` step |
| Color as the only state signal | Color + icon/label |
| Skipping empty/loading/error states | Design all three |

## Validation checklist (before you call UI work done)

- [ ] Zero hardcoded colors / spacing / radii (tokens only).
- [ ] Functional color tokens; semantic states use matched triplets.
- [ ] Reuses Primer components where they exist.
- [ ] Beautiful and usable at 375px, 768px, 1280px (no horizontal scroll).
- [ ] Touch targets ≥ 44px on coarse pointers.
- [ ] Loading, empty, and error states all designed.
- [ ] WCAG AA contrast; visible focus ring; color not the sole signal.
- [ ] Works in light AND dark theme (verify, don't assume).
- [ ] Motion respects `prefers-reduced-motion`.
- [ ] Icons follow `iconography.instructions.md`.
- [ ] Checked against the latest Primer/brand docs for anything non-trivial.

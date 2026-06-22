---
name: ux-ui
description: Build admin UI pages that follow the TailAdmin design system exactly. Use whenever the user asks to build, redesign, restyle, or audit any admin page, dashboard, form, table, card, or component — even if they don't explicitly say "TailAdmin" or "ux/ui". Also use when the user references the TailAdmin template, wants consistent styling across owner/admin pages, or pastes a screenshot of an admin page to fix. This skill is the source of truth for design tokens, component patterns, and layout conventions.
---

# ux-ui — TailAdmin Design System Skill

This skill is the single source of truth for building admin UI that matches the TailAdmin template (`tailadmin-free-tailwind-dashboard-template`). Use it before writing any admin JSX/CSS — never hand-write class strings by guessing; always pull the canonical class string from the reference docs.

## When to use

Trigger this skill for any of these:
- Building or redesigning an owner/admin/dashboard page (hero, stat cards, tables, forms, modals, profile/detail pages)
- Styling a new component that should match existing admin pages
- Auditing an admin page for visual consistency
- The user mentions TailAdmin, dashboard template, "match the design system", or pastes a screenshot of an admin screen to fix

Do NOT trigger for: customer-facing pages (viewer app), marketing pages, emails — those have their own design language.

## How to use

1. **Identify what you're building** from the list below, then read the matching reference file for the exact, copy-pasteable class strings and structure.
2. **Pull tokens from `references/design-tokens.md`** — never invent color/radius/shadow/spacing values. If a token isn't in the table, it doesn't exist in this design system.
3. **Match the surrounding code's idiom** — if the codebase already imports a `Panel`/`Fact`/`Notice` helper from `ui.tsx`, reuse it; do not redefine those classes locally. The reference class strings are for building NEW components or fixing drift, not for duplicating existing wrappers.

## Component → reference map

| Building / fixing... | Read this reference first |
|---|---|
| A whole page (shell, grid, breadcrumb, sections) | `references/page-layout.md` |
| Stat / metric cards, KPI tiles, trend pills | `references/components.md` → "Stat / metric card" |
| Chart cards, panels with header + body | `references/components.md` → "Chart card" + "Card with header/body band" |
| Data tables (with toolbar, status pills, avatars) | `references/components.md` → "Data table card" |
| Profile / detail pages (identity hero, field grid) | `references/components.md` → "Profile / detail page" |
| Forms (inputs, selects, textarea, checkbox, toggle, field layout) | `references/forms.md` |
| Modals (overlay, panel, footer actions) | `references/components.md` → "Modal" |
| Badges, status pills, buttons | `references/components.md` → "Badge" / "Button" |
| Colors, radius, shadow, typography, spacing, heights | `references/design-tokens.md` |
| Dark mode setup, menu nav utilities, gotchas | `references/conventions.md` |

## Core principles (apply always)

1. **One design system, no drift.** Every admin card is `rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]`. Every section title is `text-lg font-semibold text-gray-800 dark:text-white/90`. Every form card title is `text-base font-medium`. If you see a drifted local copy, migrate it to the canonical helper or class string.

2. **Tone-coded, not colored ad-hoc.** Status uses four semantic families: `success` / `warning` / `error` / `blue-light` (info). Each has `-50` bg, `-500/15` dark bg, `-600` light text, `-500`/`-400` dark text. Never use raw colors (`red-500`, `green-500`) for status — always the semantic token.

3. **Dark mode is translucent.** Card surfaces in dark mode are `dark:bg-white/[0.03]` over a `dark:bg-gray-900` body — NOT opaque gray. Page bg is `bg-gray-50` light / `bg-gray-900` dark.

4. **Content max-width is `max-w-(--breakpoint-2xl)`** (= 1536px) with `p-4 md:p-6` padding. The page chrome (sidebar + header + main) is already provided by the app shell — your page content goes inside `<main>`'s container.

5. **Form fields use `h-11` inputs, `mb-1.5 block text-sm font-medium text-gray-700` labels, and `rounded-lg` (NOT `rounded-2xl`) controls.** Inputs focus to `focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10`.

6. **Spacing rhythm:** page sections stack with `space-y-6`; grids use `gap-4 md:gap-6`; form fields stack with `space-y-6` inside the body band.

7. **When the codebase has a shared `ui.tsx`** exporting `Panel`, `PanelHeader`, `PanelBody`, `Fact`, `Notice`, `Field`, `primaryActionClass`, `secondaryActionClass`, formatters — **use those imports**. They already encode the design system. Only drop to raw class strings (from the reference docs) when building something `ui.tsx` doesn't cover.

## Quick decision rules

- **Card vs panel vs hero:** a "card" is the default surface (`rounded-2xl border bg-white`). A "hero/next-action banner" tints the whole card border+bg by tone (e.g. `rounded-2xl border border-warning-500 bg-warning-50 dark:bg-warning-500/10`). A "stat strip" is a row of small facts (`rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]`).
- **Table on desktop vs cards on mobile:** wrap the `<table class="min-w-full">` in `hidden lg:block`, and provide a `lg:hidden` stacked-card fallback. Never make admins scroll a 960px-wide table on a phone.
- **Empty/loading/error states are mandatory.** Every data-driven section needs a skeleton (`animate-pulse rounded-2xl border`), an empty state (icon + heading + CTA), and an error state (`Notice tone="error"` + retry button). See `references/conventions.md`.
- **Primary action is `bg-brand-500` filled; secondary is `border border-gray-300 bg-white` outline.** Never use `bg-blue-500` or other raw colors for primary.

## Output checklist before finishing

- [ ] Every class string came from a reference doc or the codebase's `ui.tsx` — none invented.
- [ ] Status colors use semantic tokens (`success`/`warning`/`error`/`blue-light`), not raw colors.
- [ ] Dark mode uses translucent `dark:bg-white/[0.03]` for cards (or matches `ui.tsx` Panel).
- [ ] Inputs are `h-11 rounded-lg`, labels are `text-sm font-medium text-gray-700`.
- [ ] Section titles are `text-lg font-semibold`; form card titles are `text-base font-medium`.
- [ ] Empty/loading/error states exist for every async section.
- [ ] No drifted local copies of `Panel`/`Fact`/`Notice`/`Field`/formatters — all imported from `ui.tsx` where one exists.

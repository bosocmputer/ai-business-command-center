# Conventions & Gotchas — TailAdmin

## Dark mode setup

Dark mode = `.dark` class on `<body>`, persisted to localStorage. In the AI-Business Next.js codebase, this is handled by the `ThemeProvider` / `OwnerV2TailAdminLayout` — don't reimplement. To style for dark, just add `dark:` variants.

**Critical:** card surfaces in dark mode are **translucent** `dark:bg-white/[0.03]` over a `dark:bg-gray-900` body — NOT opaque dark gray. Exception: `chart-02` inner card uses opaque `dark:bg-gray-900`.

## Sidebar / nav menu utilities

Use the `@utility` classes (defined in TailAdmin's CSS), never hand-write sidebar nav classes:
- `menu-item` / `menu-item-active` / `menu-item-inactive`
- `menu-item-icon-active` / `menu-item-icon-inactive`
- `menu-item-arrow` / `menu-item-arrow-active` / `menu-item-arrow-inactive`
- `menu-dropdown-item` / `menu-dropdown-item-active` / `menu-dropdown-item-inactive`

In the AI-Business codebase, the sidebar is `OwnerV2Sidebar.tsx` — edit there, don't rebuild.

## Scrollbar utilities
- `custom-scrollbar` — thin styled scrollbar (1.5px track, rounded-full gray-200 thumb, #344054 in dark). Use on scrollable lists, modal bodies, code blocks.
- `no-scrollbar` — hides scrollbars entirely. Use on horizontal scrollers where the scrollbar would clutter.

## Status color consistency

Four semantic families: `success`, `warning`, `error`, `blue-light` (info). Each has `-50` light bg, `-500/15` dark bg, `-600` light text, `-500` dark text.

**Warning gotcha:** `warning-400` does NOT exist in the theme. Dark warning text is always `dark:text-orange-400`, never `dark:text-warning-400`.

**Never use raw colors** (`red-500`, `green-500`, `blue-500`) for status. Always the semantic token. `brand-500` is reserved for the primary action accent, not status.

## `shadow-default` is undefined
`shadow-default` appears in some markup but is NOT defined in the theme. It resolves to Tailwind's default shadow, which is inconsistent with the rest of the system. **Avoid it — use `shadow-theme-xs`** for cards/inputs/toolbar buttons.

## Card title hierarchy
- **Content/data card title (h3):** `text-lg font-semibold text-gray-800 dark:text-white/90`
- **Form card title (h3):** `text-base font-medium text-gray-800 dark:text-white/90` ← lighter
- **Modal title (h4):** `text-2xl font-semibold`
- **Page title (h2):** `text-xl font-semibold`

Don't mix these up — a form card with `text-lg font-semibold` looks wrong next to data cards.

## Empty / loading / error states (mandatory)

Every async data-driven section needs all three:

1. **Loading skeleton:** `animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]` with inner placeholder bars. Match the real layout's proportions so there's no layout shift on load.

2. **Empty state:** icon tile (`flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400`) + heading (`text-base font-semibold text-gray-800 dark:text-white/90`) + description (`text-sm text-gray-500 dark:text-gray-400`) + primary CTA (`primaryActionClass` link). Never just "No data."

3. **Error state:** `<Notice tone="error" title text>` (from `ui.tsx`) + a retry button (`<Button onClick={() => load()}>รีเฟรช</Button>`). Never a blank red box with no recovery path.

## Responsive table → cards

Desktop `<table>` should be `hidden lg:block`; provide a `lg:hidden` stacked-card fallback for mobile. Never make an admin scroll a 960px+ table on a phone. Each mobile card mirrors one row: name + status badge at top, then the key fields as small facts, then a full-width primary action.

## Form submit button states

- Disabled until valid: `disabled={!canSubmit}` with a help line under it explaining the blocker (e.g. "ปุ่มบันทึกเปิดเมื่อข้อมูลเปลี่ยนและไม่มีข้อมูลลับในหมายเหตุ").
- In-flight: label changes to "กำลังบันทึก..." and button disabled.
- Success: ephemeral `<Notice tone="success">` toast, then reload data.
- Error: `<Notice tone="error">` with the server message, button re-enables.

## Don't reinvent shared components

The AI-Business codebase has `apps/web/src/components/owner-v2/ui.tsx` exporting:
- `Panel`, `PanelHeader` (title/description/action), `PanelBody` (spaced)
- `Notice` (tone/title/text), `InlineNotice` (title/message/tone — legacy, prefer Notice)
- `Fact` (label/value/tone), `Field` (label/help/children)
- `primaryActionClass`, `secondaryActionClass`
- `formatDateTime`, `formatRunStatus`, `formatLineDeliveryStatus`, `formatTenantStatus`, `tenantStatusColor`

**Use these imports.** Only drop to raw class strings (from the other reference docs) when `ui.tsx` doesn't cover what you're building. If you find a drifted local copy of `Panel`/`Fact`/`Notice`/`Field`, migrate it to the `ui.tsx` import — that's a recurring bug pattern in this codebase.

## `<include>` tags

TailAdmin's HTML partials use `<include src="...">` (webpack build-time). In the Next.js codebase this is N/A — components are React. Ignore `<include>` when reading the template; treat the partial contents as the reference.

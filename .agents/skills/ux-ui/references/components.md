# Components — TailAdmin

Canonical component patterns with copy-pasteable class strings. Source files in `partials/`.

## Stat / metric card
Source: `partials/metric-group/metric-group-01.html`.

Grid wrapper: `<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6">`

Card: `rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6`

Icon tile: `flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800` (icon `fill-gray-800 dark:fill-white/90`)

Label: `<span class="text-sm text-gray-500 dark:text-gray-400">`
Value: `<h4 class="mt-2 text-title-sm font-bold text-gray-800 dark:text-white/90">` (30px)

Trend pill UP: `flex items-center gap-1 rounded-full bg-success-50 py-0.5 pl-2 pr-2.5 text-sm font-medium text-success-600 dark:bg-success-500/15 dark:text-success-500`
Trend pill DOWN: same with `bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500`.

> In the AI-Business codebase, the shared `Fact` component (`ui.tsx`) renders the label/value/tone-badge version of this — use `<Fact label value tone>` for inline facts. Use the full metric card above for dashboard KPIs.

## Card (default surface)
`rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]`

Padding depends on content:
- Metric/data: `p-5 md:p-6`
- Chart: `px-5 pt-5 sm:px-6 sm:pt-6` (no bottom padding — chart fills)
- Form: header band + body band (see `forms.md`)

> The codebase's `<Panel>` from `ui.tsx` is this card with `px-4 pb-4 pt-4 sm:px-6`. Use `<Panel>` + `<PanelHeader title description action>` + `<PanelBody spaced>` instead of hand-writing.

## Chart card with header + kebab dropdown
Source: `partials/chart/chart-01.html`.

Outer: `overflow-hidden rounded-2xl border border-gray-200 bg-white px-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6`

Header row: `<div class="flex items-center justify-between">`
Title: `<h3 class="text-lg font-semibold text-gray-800 dark:text-white/90">`
Kebab dropdown panel: `absolute right-0 z-40 w-40 p-2 space-y-1 bg-white border border-gray-200 top-full rounded-2xl shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark`
Dropdown item: `flex w-full px-3 py-2 font-medium text-left text-gray-500 rounded-lg text-theme-xs hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300`

Body scroll wrapper: `<div class="max-w-full overflow-x-auto custom-scrollbar">`

## Summary card with footer stat strip
Source: `partials/chart/chart-02.html`. Two-tone: outer `rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-white/[0.03]`, inner `shadow-default rounded-2xl bg-white px-5 pb-11 pt-5 dark:bg-gray-900 sm:px-6 sm:pt-6` (⚠ `shadow-default` is undefined — use `shadow-theme-xs`).

Footer stat strip: `<div class="flex items-center justify-center gap-5 px-6 py-3.5 sm:gap-8 sm:py-5">`
Stat label: `mb-1 text-center text-theme-xs text-gray-500 dark:text-gray-400 sm:text-sm`
Stat value: `flex items-center justify-center gap-1 text-base font-semibold text-gray-800 dark:text-white/90 sm:text-lg`
Vertical divider between stats: `<div class="h-7 w-px bg-gray-200 dark:bg-gray-800"></div>`

## Data table card (variant 1 — with toolbar)
Source: `partials/table/table-01.html`.

Outer: `overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6`

Toolbar row: `<div class="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">`
Toolbar outline button: `inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200`

Scroll wrapper: `<div class="w-full overflow-x-auto">`
Table: `<table class="min-w-full">`
Header row: `<tr class="border-gray-100 border-y dark:border-gray-800">`
Header cell: `<th class="py-3"><div class="flex items-center"><p class="font-medium text-gray-500 text-theme-xs dark:text-gray-400">{label}</p></div></th>`
Body: `<tbody class="divide-y divide-gray-100 dark:divide-gray-800">`
Body cell: `<td class="py-3"><div class="flex items-center"> ... </div></td>`

Cell variants:
- Thumbnail + name: `flex items-center gap-3` → `h-[50px] w-[50px] overflow-hidden rounded-md` thumb + name `<p class="font-medium text-gray-800 text-theme-sm dark:text-white/90">` + sub `<span class="text-gray-500 text-theme-xs dark:text-gray-400">`
- Plain text: `<p class="text-gray-500 text-theme-sm dark:text-gray-400">`
- Status pill: see Badge section below

## Data table card (variant 2 — avatars)
Source: `partials/table/table-06.html`. Note: uses `rounded-xl` (not `rounded-2xl`).

Outer: `overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]`
Header row: `<tr class="border-b border-gray-100 dark:border-gray-800">`
Header cell: `<th class="px-5 py-3 sm:px-6"><div class="flex items-center"><p class="font-medium text-gray-500 text-theme-xs dark:text-gray-400">{label}</p></div></th>`
Body cell: `<td class="px-5 py-4 sm:px-6">`

Avatar + name cell: `flex items-center gap-3` → `w-10 h-10 overflow-hidden rounded-full` avatar + `<span class="block font-medium text-gray-800 text-theme-sm dark:text-white/90">` name + `<span class="block text-gray-500 text-theme-xs dark:text-gray-400">` role

Avatar group (overlapping): `<div class="flex -space-x-2">` with each `w-6 h-6 overflow-hidden border-2 border-white rounded-full dark:border-gray-900`.

## Profile / detail page
Source: `profile.html`.

Outer page card: `rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6`
Section title: `<h3 class="mb-5 text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-7">`
Inner sub-card: `p-5 mb-6 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6`

Identity header (inside first sub-card):
- Container: `flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between`
- Avatar: `w-20 h-20 overflow-hidden border border-gray-200 rounded-full dark:border-gray-800`
- Name `<h4>`: `mb-2 text-lg font-semibold text-center text-gray-800 dark:text-white/90 xl:text-left`
- Meta row: `flex flex-col items-center gap-1 text-center xl:flex-row xl:gap-3 xl:text-left`
- Meta item: `<p class="text-sm text-gray-500 dark:text-gray-400">`
- Meta divider: `<div class="hidden h-3.5 w-px bg-gray-300 dark:bg-gray-700 xl:block"></div>`
- Outline edit button: `flex w-full items-center justify-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 lg:inline-flex lg:w-auto`

2-col key/value field grid: `<div class="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-7 2xl:gap-x-32">`
Field label: `<p class="mb-2 text-xs leading-normal text-gray-500 dark:text-gray-400">`
Field value: `<p class="text-sm font-medium text-gray-800 dark:text-white/90">`

## Modal
Source: `partials/profile/profile-info-modal.html`.

Overlay: `fixed inset-0 flex items-center justify-center p-5 overflow-y-auto z-99999`
Backdrop: `fixed inset-0 h-full w-full bg-gray-400/50 backdrop-blur-[32px]`
Panel: `no-scrollbar relative w-full max-w-[700px] overflow-y-auto rounded-3xl bg-white p-4 dark:bg-gray-900 lg:p-11`
Close button: `transition-color absolute right-5 top-5 z-999 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:bg-white/[0.05] dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-300`
Title `<h4>`: `mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90`
Subtitle: `mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7`
Sub-section `<h5>`: `mb-5 text-lg font-medium text-gray-800 dark:text-white/90 lg:mb-6`
Scrollable body: `custom-scrollbar h-[450px] overflow-y-auto px-2`
Field grid: `grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2`
Footer actions: `flex items-center gap-3 px-2 mt-6 lg:justify-end`
Cancel: `flex w-full justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] sm:w-auto`
Save: `flex w-full justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 sm:w-auto`

## Badge (all colors)
Source: `partials/badge/badge-03.html`. Shared base: `inline-flex items-center justify-center gap-1 rounded-full py-0.5 pl-2 pr-2.5 text-sm font-medium`

| Variant | Color classes |
|---|---|
| Primary | `bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400` |
| Success | `bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500` |
| Error | `bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500` |
| Warning | `bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400` |
| Info | `bg-blue-light-50 text-blue-light-500 dark:bg-blue-light-500/15 dark:text-blue-light-500` |
| Light | `bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-white/80` |
| Dark | `bg-gray-500 text-white dark:bg-white/5 dark:text-white` |

Compact table status pill: `rounded-full bg-{tone}-50 px-2 py-0.5 text-theme-xs font-medium text-{tone}-600 dark:bg-{tone}-500/15 dark:text-{tone}-500` (warning uses `dark:text-orange-400`).

> The codebase's `<Badge color size>` from `@/components/ui/badge/Badge` implements this. Use it.

## Button
Source: `partials/buttons/`.

Primary: `inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-white transition rounded-lg bg-brand-500 shadow-theme-xs hover:bg-brand-600`
Primary large: add `px-5 py-3.5`
Compact primary (modal save): `flex w-full justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 sm:w-auto`

Outline (border variant, most common): `inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200`
Outline (ring variant): `ring-1 ring-inset ring-gray-300` instead of `border border-gray-300`.

Ghost: no dedicated partial. Closest = menu-dropdown items. Not a first-class variant.

> The codebase exports `primaryActionClass` and `secondaryActionClass` from `ui.tsx` — use those constants (they match the compact outline pattern with `sm:w-auto`).

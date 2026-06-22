# Design Tokens — TailAdmin

The authoritative token tables. Copy values verbatim; never invent tokens. All extracted from `/Users/nontawatwongnuk/dev/tailadmin-free-tailwind-dashboard-template/src/css/style.css` unless noted.

## Colors

### Brand scale (primary)
`brand-500 #465fff` ← **primary** · `brand-50 #ecf3ff` (badge bg) · `brand-300 #9cb9ff` (focus border) · `brand-600 #3641f5` (hover) · `brand-800 #252dae` (dark focus border) · `brand-400 #7592ff` (dark text) · `brand-950 #161950` (auth panel bg).

### Status families (semantic — use these, never raw reds/greens)
| Family | main (-500) | text (-600) | badge bg (-50) | dark bg (-500/15) | dark text |
|---|---|---|---|---|---|
| success | `#12b76a` | `#039855` | `#ecfdf3` | `dark:bg-success-500/15` | `dark:text-success-500` |
| error | `#f04438` | `#d92d20` | `#fef3f2` | `dark:bg-error-500/15` | `dark:text-error-500` |
| warning | `#f79009` | `#dc6803` | `#fffaeb` | `dark:bg-warning-500/15` | **`dark:text-orange-400`** (warning-400 doesn't exist) |
| info (blue-light) | `#0ba5ec` | `#0086c9` | `#f0f9ff` | `dark:bg-blue-light-500/15` | `dark:text-blue-light-500` |

### Neutrals (gray)
`50 #f9fafb` (page bg) · `100 #f2f4f7` (subtle) · `200 #e4e7ec` (borders/dividers) · `300 #d0d5dd` · `400 #98a2b3` (placeholder) · `500 #667085` (secondary text) · `700 #344054` (body text) · `800 #1d2939` (headings) · `900 #101828` · `gray-dark #1a2231` (dark dropdown panels: `dark:bg-gray-dark`).

### Usage roles
| Role | Light | Dark |
|---|---|---|
| Page bg | `bg-gray-50` | `bg-gray-900` |
| Card surface | `bg-white` | `dark:bg-white/[0.03]` (translucent) — OR `dark:bg-gray-900` (chart-02 inner) |
| Card border | `border-gray-200` | `dark:border-gray-800` |
| Subtle inner | `bg-gray-100` / `bg-gray-50` | `dark:bg-gray-800` / `dark:bg-gray-900` |
| Divider | `border-gray-100` / `divide-gray-100` | `dark:border-gray-800` / `dark:divide-gray-800` |
| Strong divider | `bg-gray-200` | `dark:bg-gray-800` |
| Body text | `text-gray-800` | `dark:text-white/90` |
| Secondary/muted | `text-gray-500` | `dark:text-gray-400` |
| Placeholder | `text-gray-400` | `dark:placeholder:text-white/30` |
| Label | `text-gray-700` | `dark:text-gray-400` |
| Disabled | `text-gray-300` | `dark:text-gray-700` |

## Radius
| Element | Class |
|---|---|
| Card / dropdown (default) | `rounded-2xl` |
| Modal panel | `rounded-3xl` |
| Input / select / textarea / button / segmented container | `rounded-lg` |
| Table card variant 2 | `rounded-xl` |
| Badge / status pill / trend pill / avatar (round) | `rounded-full` |
| Product thumbnail / checkbox box | `rounded-md` |
| Icon tile (metric) | `rounded-xl` |
| Radio box | `rounded-full` (inner dot `h-2 w-2 rounded-full`) |

## Shadow
| Role | Token |
|---|---|
| Resting (inputs, cards, toolbar buttons) | `shadow-theme-xs` |
| Toggle knob, slider | `shadow-theme-sm` |
| Header dropdown | `shadow-theme-md` |
| Notification/user dropdown | `shadow-theme-lg` |
| Focus glow | `shadow-focus-ring` (`0 0 0 4px rgba(70,95,255,.12)`) |
| ⚠ `shadow-default` | **undefined** in theme — appears in markup only. Avoid; use `shadow-theme-xs`. |

## Typography (Outfit font)
| Element | Classes | Size |
|---|---|---|
| Page title (breadcrumb h2) | `text-xl font-semibold` | |
| Card / section title (h3) | `text-lg font-semibold text-gray-800 dark:text-white/90` | |
| **Form card title (h3)** | `text-base font-medium text-gray-800 dark:text-white/90` | ← lighter than content card |
| Modal title (h4) | `text-2xl font-semibold` | |
| Modal sub-section (h5) | `text-lg font-medium` | |
| Stat value | `text-title-sm font-bold` | 30px |
| Footer stat value | `text-base font-semibold sm:text-lg` | |
| Form label | `mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400` | |
| Field value (profile) | `text-sm font-medium` | |
| Table header | `text-theme-xs font-medium text-gray-500` | 12px |
| Table primary cell | `text-theme-sm font-medium text-gray-800` | 14px |
| Table secondary cell | `text-theme-sm text-gray-500` | 14px |
| Body / subtitle | `text-sm` or `text-theme-sm` | |
| Muted meta | `text-xs` / `text-theme-xs` | |

### Custom font-size tokens
`text-title-2xl` 72/90 · `text-title-xl` 60/72 · `text-title-lg` 48/60 · `text-title-md` 36/44 · `text-title-sm` 30/38 · `text-theme-xl` 20/30 · `text-theme-sm` 14/20 · `text-theme-xs` 12/18.

## Spacing rhythm
| Context | Class |
|---|---|
| Main content padding | `p-4 md:p-6` |
| Default card padding | `p-5 md:p-6` (metric) / `px-5 pt-5 sm:px-6 sm:pt-6` (chart) |
| Form card header band | `px-5 py-4 sm:px-6 sm:py-5` |
| Form card body band | `p-5 sm:p-6` (with `border-t border-gray-100 dark:border-gray-800` separating header) |
| Page grid gap | `gap-4 md:gap-6` |
| Metric inner grid | `gap-4 md:gap-6` |
| Form 2-col outer | `gap-6` / modal fields `gap-x-6 gap-y-5` |
| Stacked card rhythm | `space-y-6` |
| Form fields stack | `space-y-6` (inside body band) |
| Profile field grid | `gap-4 lg:gap-7 2xl:gap-x-32` |
| Table toolbar → table | `mb-4` |
| Table cell vertical | `py-3` (variant 1) / `px-5 py-4 sm:px-6` (variant 2) |
| Breadcrumb bottom | `mb-6` |
| Section title bottom | `mb-5 lg:mb-7` (profile) / `mb-4` (sidebar group) |

## Heights
| Element | Class |
|---|---|
| Text input / select / date | `h-11` (44px) |
| Button (primary/outline) | `px-4 py-3` (~44px) or `px-5 py-3.5` (large) |
| Compact button (toolbar/modal) | `px-4 py-2.5` |
| Icon button (header/social/close) | `h-11 w-11` |
| Metric icon tile | `h-12 w-12 rounded-xl` |
| Avatar — table | `w-10 h-10 rounded-full` |
| Avatar — profile identity | `w-20 h-20 rounded-full` |
| Avatar — notification | `h-10 w-full max-w-10` |
| Avatar group item | `w-6 h-6 rounded-full border-2 border-white dark:border-gray-900` |
| Product thumbnail | `h-[50px] w-[50px] rounded-md` |
| Toggle track / knob | `h-6 w-11` / `h-5 w-5` |
| Checkbox / radio box | `h-5 w-5` |
| Radio inner dot | `h-2 w-2` |
| Meta divider | `h-3.5 w-px` (profile) / `h-7 w-px` (stat strip) |
| Sidebar | `w-[290px]` (collapsed `lg:w-[90px]`), `h-screen` |

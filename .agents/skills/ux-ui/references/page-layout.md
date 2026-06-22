# Page Layout — TailAdmin

How to structure an admin page. Source: `index.html`, `profile.html`, `form-elements.html`, `partials/header.html`, `partials/sidebar.html`, `partials/breadcrumb.html`.

## App shell (provided by app layout — don't rebuild)

The chrome is already in the codebase's app shell (sidebar + header + main container). Your page content goes inside `<main>`'s container. For reference, the shell is:

```
<div class="flex h-screen overflow-hidden">
  <aside class="sidebar ..."> ... </aside>
  <div class="relative flex flex-col flex-1 overflow-x-hidden overflow-y-auto">
    <header class="sticky top-0 z-99999 ... bg-white lg:border-b dark:bg-gray-900"> ... </header>
    <main>
      <div class="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">
        <!-- YOUR PAGE CONTENT HERE -->
      </div>
    </main>
  </div>
</div>
```

The container is `p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6` (= max 1536px). Don't add another max-width wrapper inside — use the full container width.

## Page title bar / breadcrumb

Pattern from `partials/breadcrumb.html`:
```
<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <h2 class="text-xl font-semibold text-gray-800 dark:text-white/90">{Page Title}</h2>
  <nav>
    <ol class="flex items-center gap-1.5">
      <li><a class="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400" href="/owner-v2">หน้าแรก</a></li>
      <!-- chevron separator -->
      <li class="text-sm text-gray-800 dark:text-white/90">{Current Page}</li>
    </ol>
  </nav>
</div>
```

In the AI-Business codebase, this is provided by `<OwnerV2Shell title subtitle>` — use it, don't hand-build.

## Dashboard grid system

The 12-column grid (`index.html:46`):
```
<div class="grid grid-cols-12 gap-4 md:gap-6">
```

Common col-span splits:
| Pattern | Classes |
|---|---|
| Main + sidebar (7/5) | left `col-span-12 space-y-6 xl:col-span-7`, right `col-span-12 xl:col-span-5` |
| Full-width row | `col-span-12` |
| Map + table (5/7) | `col-span-12 xl:col-span-5` + `col-span-12 xl:col-span-7` |

Below `xl`, everything stacks to full width. No sub-grids inside columns — components stack via the parent `gap` or `space-y-6`.

## Detail page (profile.html pattern)

Single column, NOT a 12-col grid. Structure:
1. Breadcrumb / title bar (via `<OwnerV2Shell>`)
2. **Outer container card** (`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6`) with a section title `<h3 class="mb-5 text-lg font-semibold ... lg:mb-7">`
3. Inside: stacked inner sub-cards (`p-5 mb-6 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6`), last one drops `mb-6`.

The identity header goes in the first sub-card (see `components.md` → "Profile / detail page").

## Form page (form-elements.html pattern)

Two-column layout (`form-elements.html:53`):
```
<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
  <div class="space-y-6"> <!-- left column of form cards --> </div>
  <div class="space-y-6"> <!-- right column of form cards --> </div>
</div>
```

Each form card is the header-band + body-band split (see `forms.md`).

## Spacing rules recap
- Top of page content: title bar `mb-6`, then sections.
- Between sections: `space-y-6` on the wrapper, OR `gap-4 md:gap-6` on a grid.
- Inside a card: header band, then body band separated by `border-t border-gray-100 dark:border-gray-800`.
- Form fields inside body band: `space-y-6`.

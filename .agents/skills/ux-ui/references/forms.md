# Forms — TailAdmin

Source: `partials/form-elements.html`. The AI-Business codebase's `owner-v2-input` CSS utility (in `globals.css`) already encodes the input classes — use `className="owner-v2-input"` for inputs/selects/textareas.

## Form card (header band + body band)
```
<div class="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
  <div class="px-5 py-4 sm:px-6 sm:py-5">
    <h3 class="text-base font-medium text-gray-800 dark:text-white/90">{Form Title}</h3>
  </div>
  <div class="space-y-6 border-t border-gray-100 p-5 sm:p-6 dark:border-gray-800">
    <!-- fields -->
  </div>
</div>
```

> Form card titles are `text-base font-medium` (NOT `text-lg font-semibold` like content cards). This is the consistent differentiator.

Two-column form layout: `<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">` with `<div class="space-y-6">` per column. OR inside a single card body: `<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">`.

## Field label
`<label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">`
Required asterisk: `<span class="text-error-500">*</span>`
Help text below field: `<p class="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">`

> The codebase's `<Field label help>` from `ui.tsx` wraps label + children + help. Use it.

## Text input
```
<input class="owner-v2-input" />
```
Expands to: `h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800`

Disabled variant: add `disabled:border-gray-100 disabled:bg-gray-50 disabled:placeholder:text-gray-300 dark:disabled:border-gray-800 dark:disabled:bg-white/[0.03]`.
Error variant: swap `border-gray-300` → `border-error-300`, focus → `focus:ring-error-500/10 dark:focus:border-error-700`, append `<p class="text-theme-xs text-error-500">`.

## Select (with chevron)
```
<div class="relative z-20 bg-transparent">
  <select class="owner-v2-input appearance-none pr-11"> ... </select>
  <span class="pointer-events-none absolute top-1/2 right-4 z-30 -translate-y-1/2 text-gray-500 dark:text-gray-400">
    <svg><!-- chevron down --></svg>
  </span>
</div>
```
The select needs `appearance-none pr-11` (overrides the native arrow + reserves chevron space). Options: `<option class="text-gray-700 dark:bg-gray-900 dark:text-gray-400">`.

## Textarea
```
<textarea class="owner-v2-input min-h-28" rows="6"></textarea>
```
Same classes as input but NO `h-11` (height comes from rows/content). `min-h-28` gives a sensible floor.

## Checkbox (custom styled)
```
<label class="flex cursor-pointer items-center text-sm font-medium text-gray-700 select-none dark:text-gray-400">
  <div class="relative">
    <input type="checkbox" class="sr-only" />
    <div class="mr-3 flex h-5 w-5 items-center justify-center rounded-md border-[1.25px] border-gray-300 dark:border-gray-700">
      <span><!-- check svg, opacity-0 when unchecked --></span>
    </div>
  </div>
  Label text
</label>
```
Checked state: box `border-brand-500 bg-brand-500`, check svg `opacity-100`.

> For React, a simpler approach: `<input type="checkbox" class="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500" />` — this is what the codebase uses in practice (e.g. SignInForm). Prefer this for React components rather than the Alpine-style custom box.

## Radio
Same shell as checkbox but box is `rounded-full` and contains an inner dot `<span class="h-2 w-2 rounded-full bg-white">` (or `bg-white dark:bg-[#171f2e]` when unchecked).

## Toggle switch
```
<label class="flex cursor-pointer items-center gap-3 text-sm font-medium text-gray-700 select-none dark:text-gray-400">
  <div class="relative">
    <input type="checkbox" class="sr-only" />
    <div class="block h-6 w-11 rounded-full bg-gray-200 dark:bg-white/10"></div>  <!-- bg-brand-500 when on -->
    <div class="shadow-theme-sm absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white duration-300 ease-linear translate-x-0"></div>  <!-- translate-x-full when on -->
  </div>
  Label text
</label>
```
Track `h-6 w-11 rounded-full`; knob `h-5 w-5 rounded-full bg-white shadow-theme-sm` translating `translate-x-full` when on.

## Form validation feedback
- Inline error under a field: `<p class="text-theme-xs text-error-500">{message}</p>` (border also turns error-toned).
- Form-level error banner: `<Notice tone="error" title title text>` (from `ui.tsx`).
- Disable submit until valid: `disabled={!canSubmit}` on the primary button, with a help line explaining why.

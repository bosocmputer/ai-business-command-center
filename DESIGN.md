# Design

## System

AI-Business Command Center uses a restrained product UI based on the existing TailAdmin-style design system in `apps/web/src/app/globals.css`. The default surface is light, with dark mode support already present in the component vocabulary. Use the existing `Outfit` font stack, gray scale, brand blue, success, warning, and error tokens.

## Color

- Background: `bg-gray-50` for app surfaces, `bg-white` for panels.
- Text: `text-gray-900` for primary, `text-gray-600` or `text-gray-500` for secondary copy.
- Brand: use `brand-500/600` for primary action, selected state, and small state emphasis only.
- Status: use success, warning, and error tokens for readiness and test results.
- Customer dashboard should say "ข้อมูลจาก SML" and should not expose `sml_postgres` or `sml_javaws`.

## Typography

- Product UI uses fixed type sizes, not fluid hero typography.
- Page titles use `text-2xl font-semibold`; panel titles use `text-base` or `text-lg`.
- Labels and compact metadata use `text-xs` or `text-sm`.
- Keep long Thai helper text to 65 to 75 characters per line where possible.

## Layout

- Owner/Admin uses a sidebar plus content panels.
- Core owner flows should be full-width task surfaces, not hidden in modal-first flows.
- SML connection setup uses a cockpit layout: tenant list, selected tenant form, and test/status summary.
- Customer dashboard opens with executive metrics first, then drilldown reports and document detail.
- Tables must become mobile cards at narrow widths and must not force horizontal overflow.

## Components

- Use existing `Badge`, `Button`, `Input`, `Label`, table, and owner helper components where possible.
- Cards should use radius `rounded-xl` or lower, with borders and restrained shadows.
- Forms require inline validation/help text, visible disabled states, and clear action labels.
- Skeleton loading states are preferred over centered spinners.

## Motion

Use only short state transitions already present in Tailwind classes. Avoid decorative page-load choreography. Respect reduced motion by avoiding animation-dependent content.

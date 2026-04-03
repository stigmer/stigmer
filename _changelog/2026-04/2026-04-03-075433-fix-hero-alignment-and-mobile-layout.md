# Fix Hero Section Alignment and Mobile Layout

**Date**: April 3, 2026

## Summary

Aligned the hero section's container padding with the site-wide pattern so the logo and navigation buttons vertically align with the hero content edges. Fixed several mobile layout issues including horizontal scroll, shrink-wrapped CTA buttons, and a duplicate logo in the navigation drawer.

## Problem Statement

The hero section was the sole exception to the container padding pattern used consistently across the header, footer, and every other content section. This caused the hero content to be inset differently from the header at responsive breakpoints, creating a visible misalignment between the logo and the start of hero content.

### Pain Points

- Header used `px-4 sm:px-6 lg:px-8` while hero used only `px-4`, causing 8px misalignment at `sm` and 16px at `lg`
- Mobile CTA buttons ("Start Free", "Read the Docs") shrink-wrapped to text width instead of filling the column
- Page-level horizontal scroll on narrow mobile viewports
- Duplicate logo in the mobile navigation drawer (already visible in the fixed header behind it)

## Solution

Four targeted fixes in three files, all within the site marketing shell. No new files, no dependency changes, no architectural impact.

## Implementation Details

### Hero container padding (Hero.tsx)

Moved `px-4` from the `<section>` element to the inner `max-w-7xl` container and added responsive padding `sm:px-6 lg:px-8`. This matches the exact pattern used by Header, Footer, Capabilities, HowItWorks, UseCases, and WhyItWorks.

### Mobile CTA buttons (Hero.tsx)

Changed the button wrapper from `items-start` to `items-stretch sm:items-start`. In the mobile column layout, `items-stretch` makes buttons fill the available width. At `sm`+, `items-start` restores content-width sizing when buttons sit side-by-side.

### Horizontal scroll prevention (HomePage.tsx)

Added `overflow-x-hidden` to the `HomePage` root wrapper. Scoped to the marketing page only (docs layout is unaffected).

### Duplicate logo removal (MobileMenu.tsx)

Removed the `Logo` component from the mobile drawer header and changed alignment from `justify-between` to `justify-end`. Cleaned up the unused `Logo` import.

## Benefits

- Pixel-perfect vertical alignment between header and hero content at all breakpoints
- Polished mobile CTA buttons that communicate intentional design
- No accidental horizontal scroll on any mobile viewport width
- Cleaner mobile drawer with no redundant elements

## Impact

Marketing homepage only. No changes to docs layout, shared components, or build configuration.

---

**Status**: Production Ready

# Header Navigation Declutter: Resources Dropdown and Icon-Only Externals

**Date**: April 25, 2026

## Summary

Reduced the site header from 10 visible navigation items to 7 by grouping secondary content pages (Use Cases, Blog, Download) into a "Resources" dropdown and converting GitHub/Discord links from text to icon-only buttons. This applies Hick's Law and progressive disclosure to reduce cognitive load for first-time visitors.

## Problem Statement

The site header accumulated items organically as new pages were added (Use Cases, Blog, Download, Discord). Every link occupied equal visual weight, violating established navigation design principles.

### Pain Points

- 10 simultaneous choices in a single horizontal bar (Hick's Law violation -- more options = slower orientation)
- GitHub and Discord rendered as full text links despite having universally recognizable icons
- Secondary content pages (Blog, Download) had the same visual prominence as primary destinations (Docs, Pricing)
- Crowded layout at the `md` breakpoint (768px-1024px), where all 10 items competed for horizontal space

## Solution

Two structural changes to the header:

1. **Icon-only external links** -- GitHub and Discord rendered as icon buttons with `aria-label` attributes (matching the existing footer pattern)
2. **Resources dropdown** -- Use Cases, Blog, and Download grouped under a single "Resources" trigger, implemented with `@base-ui/react` Menu primitives

## Implementation Details

**Navigation config** (`constants.ts`): Replaced the flat `NAV_LINKS` array with a structured config -- `NAV_PRIMARY` for top-level items (Docs, Pricing) and `NAV_RESOURCES` as a named group with typed `NavLink` and `NavGroup` interfaces.

**Header dropdown** (`Header.tsx`): Added `ResourcesDropdown` using `@base-ui/react` `Menu.Root`, `Menu.Trigger`, `Menu.Portal`, `Menu.Positioner`, `Menu.Popup`, and `Menu.LinkItem`. Renders with `Next.js Link` via the `render` prop for client-side navigation. Non-modal (`modal={false}`) to avoid blocking page interaction. Styled with existing design tokens and CSS transition animations (`data-[starting-style]`/`data-[ending-style]`).

**Mobile menu** (`MobileMenu.tsx`): Kept as a flat list (no nested dropdowns -- an anti-pattern on mobile). Reordered to match new priority: primary links first, then "Resources" group with a section label, then "Community" group (GitHub with icon, Discord with icon), then Sign In. Section labels use the same `text-xs font-mono uppercase tracking-wider` style as footer section headers for visual consistency.

**Icon map** (`icon.tsx`): Added `ChevronDown` from lucide-react for the dropdown trigger indicator.

## Benefits

- Reduced decision count from 10 to 7 visible items on desktop (3 text links + 2 icon buttons + 2 CTA buttons)
- Icon buttons cluster visually as a single unit, further reducing perceived complexity
- All pages remain fully discoverable -- nothing was removed, only reorganized
- Mobile menu gains visual grouping that makes the information hierarchy clearer
- Built with `@base-ui/react` (already a dependency) -- no new packages, full keyboard navigation and focus management out of the box

## Impact

- **Marketing site visitors**: Cleaner header with faster visual parsing and clearer primary actions (Docs, Pricing, Start Free)
- **Mobile users**: Better organized drawer with section labels matching footer structure
- **Accessibility**: Dropdown follows WAI-ARIA menu pattern; icon-only buttons have descriptive `aria-label` values; keyboard navigation works via arrow keys, Escape, and Enter

## Related Work

- Previous: Discord link addition (`2026-04-03-100430`)
- Previous: Download page creation (`2026-04-24-200337`)
- Previous: Sales CTA link strategy (`2026-04-24-204511`)

---

**Status**: Production Ready

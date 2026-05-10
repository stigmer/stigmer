# Resource Card Icons and Input Visibility

**Date**: May 9, 2026

## Summary

Restored resource icons on workbench cards, introduced a `--stgm-input-bg` design token for visible form input backgrounds, and fixed SVG icon rendering in the new `ResourceAvatar` component.

## Problem Statement

Three visual issues degraded the Console's resource management experience:

### Pain Points

- Resource cards on library list pages (Agents, MCP Servers) lost their icons during the Phase 1 workbench refactor — cards showed only text with no visual identity
- Form inputs in wizard steps were nearly invisible in dark mode — `bg-background` on inputs matched the page background (`oklch(0.145)` vs `oklch(0.145)`), making it impossible to see where to type without clicking
- Seedpack SVG icons (Lucide strokes + brand logos) rendered poorly when used as `<img>` with `object-cover` — transparent backgrounds caused dark fills to disappear, and edge-to-edge sizing looked cramped

## Solution

### 1. ResourceAvatar component

New `sdk/react/src/resource-workbench/components/ResourceAvatar.tsx`:
- Renders icon image when `iconUrl` is present, using a `bg-muted` circular container with `object-contain` at 80% size for proper SVG display
- Falls back to a colored initial avatar (deterministic color from slug hash) when no icon URL
- Renders nothing for skills (user requirement: skills don't have icons)
- Wired into `DefaultCardContent` and `DefaultRowContent` in `ResourceWorkbench.tsx`

### 2. Input background design token

Added `--stgm-input-bg` to the theme token system:
- Light mode: matches `--stgm-card` (white — inputs already visible)
- Dark mode: `oklch(0.205 0 0)` (card-level gray — clearly distinct from the `0.145` page background)
- Mapped as `--color-input-bg` in the Tailwind theme → `bg-input-bg` utility class
- Added to all 5 theme presets (corporate, fintech, friendly, monochrome, startup)
- Applied to all wizard step inputs: `IdentityStep`, `CapabilitiesStep`, `IdentityTransportStep`, `EnvironmentAuthStep`

## Implementation Details

**Token layer** (`sdk/theme`):
- `tokens.css`: new `--stgm-input-bg` in both `:root` and `[data-stgm-color-mode="dark"]`
- All 5 preset files: `--stgm-input-bg` matching each preset's card color for visual consistency

**Tailwind mapping** (`sdk/react/src/styles.css`):
- `--color-input-bg: var(--stgm-input-bg)` inside `@theme inline`

**Components** (`sdk/react/src`):
- New `ResourceAvatar.tsx` with image + initial fallback + hidden mode
- `ResourceWorkbench.tsx`: import `ApiResourceKind` to detect skills, use `ResourceAvatar` in both default card and row renderers
- 4 wizard step files: `bg-background` → `bg-input-bg` on all form controls

## Benefits

- Resource cards now show icons (actual image or colored initial), giving instant visual identity to agents and MCP servers
- Form inputs are clearly visible in dark mode — users can see input boundaries without clicking
- Token-based approach means platform builders can override `--stgm-input-bg` for their own themes
- SVG icons render correctly regardless of fill color or background transparency

## Impact

- **Users**: Immediate visual improvement on library pages and creation wizards
- **Platform builders**: New `--stgm-input-bg` token available for theme customization, new `ResourceAvatar` component exported for reuse
- **SDK**: Non-breaking additions — `ResourceAvatar`, `ResourceAvatarProps` exported from `@stigmer/react`

## Related Work

- Phase 1 Resource Workbench (introduced the default card/row renderers that were missing icons)
- Phase 3 Creation Wizards (introduced the wizard form steps that had invisible inputs)

---

**Status**: ✅ Production Ready

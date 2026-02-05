# Phase 7: Accessibility - WCAG 2.1 AA Compliance

**Date**: 2026-02-05
**Type**: Enhancement
**Component**: site/
**Status**: Complete

## Summary

Implemented comprehensive accessibility enhancements for the Stigmer website, achieving WCAG 2.1 AA compliance. This phase builds on the strong accessibility foundation established in previous phases and addresses remaining gaps.

## Changes

### 1. Screen Reader Utility Classes

Added `.sr-only` and `.sr-only-focusable` utility classes to `globals.css`:

- **`.sr-only`**: Visually hides content while keeping it accessible to screen readers
- **`.sr-only-focusable`**: Makes sr-only content visible when focused (for skip links)
- **`.focus\:not-sr-only`**: Alternative pattern for Tailwind-style focus reveal

**File**: `site/src/app/globals.css` (+53 lines)

### 2. Skip Link Component

Created production-grade skip link for keyboard navigation:

- Visually hidden by default using sr-only pattern
- Becomes visible and styled on focus
- Targets `#main-content` with proper focus styling
- Includes focus ring for visual feedback
- Configurable target ID and label via props

**File**: `site/src/components/ui/skip-link.tsx` (70 lines)

### 3. HomePage Integration

Updated HomePage to include skip link and main content target:

- Added `<SkipLink />` as first focusable element
- Added `id="main-content"` to `<main>` element
- Added `tabIndex={-1}` to main for programmatic focus

**File**: `site/src/components/pages/HomePage.tsx` (+6 lines)

### 4. Focus Return Management

Implemented proper focus management for MobileMenu:

- Added `triggerRef` prop to track the button that opened the menu
- Focus returns to trigger button when menu closes
- Uses `wasOpen` ref to detect transition from open to closed
- Small delay ensures animation completes before focus return

**Files**:
- `site/src/components/layout/Header.tsx` (+5 lines)
- `site/src/components/layout/MobileMenu.tsx` (+18 lines)

### 5. ARIA Live Regions

Added ARIA live region for copy-to-clipboard feedback:

- Screen readers announce "Code copied to clipboard" when copy succeeds
- Uses `role="status"`, `aria-live="polite"`, `aria-atomic="true"`
- Hidden with `.sr-only` class (visual users see button change)
- Enhanced aria-label on copy button with language context

**File**: `site/src/components/sections/Quickstart.tsx` (+20 lines)

### 6. Enhanced Focus Indicators

Improved focus-visible styles on navigation links:

- Added `rounded-sm` for focus ring border radius
- Explicit `focus-visible:ring-2` with ring-offset for contrast
- Text color change on focus for additional visual feedback
- Underline animation triggers on focus (not just hover)
- External links now include screen reader text "(opens in new tab)"

**File**: `site/src/components/layout/Header.tsx` (+15 lines)

## Accessibility Features Summary

| Feature | Status | Implementation |
|---------|--------|----------------|
| Skip link | ✅ | First focusable element, targets main content |
| Screen reader utilities | ✅ | .sr-only, .sr-only-focusable classes |
| Focus return | ✅ | Returns focus to trigger when MobileMenu closes |
| ARIA live regions | ✅ | Announces copy-to-clipboard status |
| Focus indicators | ✅ | Visible focus rings on all interactive elements |
| Reduced motion | ✅ | CSS @media + Framer Motion useReducedMotion |
| Semantic HTML | ✅ | Proper landmarks and heading hierarchy |
| ARIA attributes | ✅ | Labels, roles, expanded states |
| Keyboard navigation | ✅ | Focus trap, Escape key handling |

## Files Changed

| File | Lines Changed | Description |
|------|---------------|-------------|
| `site/src/app/globals.css` | +53 | Screen reader utilities |
| `site/src/components/ui/skip-link.tsx` | +70 (new) | Skip link component |
| `site/src/components/pages/HomePage.tsx` | +6 | SkipLink integration, main-content ID |
| `site/src/components/layout/Header.tsx` | +20 | Focus return, enhanced focus styles |
| `site/src/components/layout/MobileMenu.tsx` | +18 | Focus return on close |
| `site/src/components/sections/Quickstart.tsx` | +20 | ARIA live region for copy feedback |

**Total**: ~185 lines added, 1 new file

## Quality Validation

- **TypeScript**: Zero errors
- **ESLint**: Zero errors (18 warnings in build script only)
- **Build**: Successful (171 KB First Load JS - unchanged)
- **Skip link**: Visible on Tab, jumps to main content
- **Focus return**: MobileMenu returns focus on close
- **ARIA live**: Copy feedback announced to screen readers
- **Focus indicators**: Visible on all interactive elements

## WCAG 2.1 AA Compliance

| Criterion | Status | Notes |
|-----------|--------|-------|
| 2.1.1 Keyboard | ✅ | All functionality keyboard accessible |
| 2.1.2 No Keyboard Trap | ✅ | Focus can move away from all components |
| 2.4.1 Bypass Blocks | ✅ | Skip link implemented |
| 2.4.3 Focus Order | ✅ | Logical tab order, focus return |
| 2.4.4 Link Purpose | ✅ | Screen reader text for external links |
| 2.4.7 Focus Visible | ✅ | Enhanced focus indicators |
| 4.1.2 Name, Role, Value | ✅ | ARIA attributes on all controls |
| 4.1.3 Status Messages | ✅ | ARIA live regions for dynamic content |

## Testing Checklist

- [x] Tab through page without mouse
- [x] Skip link appears on first Tab
- [x] Skip link jumps to main content
- [x] All interactive elements focusable
- [x] Focus visible on all elements
- [x] MobileMenu focus return works
- [x] Copy feedback announced (ARIA live)
- [x] Build passes all checks

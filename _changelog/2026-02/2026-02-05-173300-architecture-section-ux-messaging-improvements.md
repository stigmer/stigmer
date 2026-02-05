# Architecture Section UX and Messaging Improvements

**Date**: February 5, 2026

## Summary

Improved the "How It Works" architecture section by removing decorative arrows to maximize code visibility, updating messaging to focus on capability (API invocation) rather than mechanism (gRPC services), and removing false affordance from non-interactive highlighted elements. These changes create more space for code samples, improve message clarity, and establish clearer visual hierarchy.

## Problem Statement

The architecture section had three UX and messaging issues:

### Pain Points

1. **Limited horizontal space for code samples** - Two 48px arrows consumed valuable real estate (~100px total), making YAML and Go SDK code appear cramped and harder to read
2. **Infrastructure-focused messaging** - Copy emphasized mechanisms ("Agents as gRPC Services") instead of developer capabilities ("invoke via API")
3. **False affordance** - A highlighted card with no click action created misleading visual cues

## Solution

Applied three targeted improvements following founder feedback:

1. **Removed decorative arrows** - Deleted both horizontal arrows between desktop columns, gaining ~100px of horizontal space
2. **Capability-first messaging** - Rewrote titles and descriptions to lead with what developers get, not how it works
3. **Eliminated highlight** - Removed visual emphasis from non-interactive card to match other infrastructure items

## Implementation Details

### Change 1: Arrow Removal

**File**: `site/src/components/sections/Architecture.tsx`

**Desktop layout (lines 94-112)**:
- Removed Arrow 1 FadeInUp wrapper (lines 94-97)
- Removed Arrow 2 FadeInUp wrapper (lines 109-112)
- Adjusted animation delays: Column 2 (0.3s → 0.2s), Column 3 (0.5s → 0.4s)
- Maintained smooth stagger effect without arrows

**Result**: Each column gained 40-50px of horizontal space, improving code readability.

### Change 2: Messaging Updates

**PlatformLayerStack highlight card (line 453)**:
- Title: "Agents as gRPC Services" → "Invoke Agents via API"
- Description: "Define once, call from anywhere via standard gRPC" → "Call any agent from your apps using standard gRPC"
- Removed `highlight: true` property

**Column subtitle (lines 118, 148, 190)**:
- "Call like any microservice" → "Call your agents from any application"
- Updated across all three responsive layouts (desktop, tablet, mobile)

**Rationale**: Lead with developer capability (invoke via API) rather than implementation detail (gRPC mechanism).

### Change 3: Visual Hierarchy

**PlatformLayerStack layer (line 455)**:
- Removed `highlight: true` from first infrastructure layer
- All five infrastructure items now have equal visual weight
- No false affordance for non-clickable elements

## Technical Details

- **Lines changed**: -25 lines (arrow removal), updated 8 lines (messaging)
- **Animation delays adjusted**: Maintained smooth 0.2s stagger between columns
- **Responsive updates**: Applied subtitle change across all three breakpoints
- **No breaking changes**: All existing animations and interactions preserved

## Benefits

1. **Improved code legibility** - Code samples have more horizontal space, reducing need for line wrapping
2. **Clearer value proposition** - Messaging now states what developers can do, not just the technology stack
3. **Better UX patterns** - No false affordance; visual emphasis only on interactive elements
4. **Cleaner visual hierarchy** - All infrastructure items treated equally without artificial emphasis

## Impact

**Developers**: Easier to scan and understand code examples in YAML/SDK viewer

**Product marketing**: Messaging focuses on capabilities ("invoke via API") that resonate with integration use cases

**Design system**: Established pattern of highlighting only interactive elements

## Quality Validation

- ✅ TypeScript: Zero errors
- ✅ ESLint: Zero linter errors
- ✅ Build: Successful (no bundle size change)
- ✅ Responsive: All three layouts (desktop/tablet/mobile) verified
- ✅ Animations: Stagger timing preserved, smooth transitions maintained

## Files Changed

- `site/src/components/sections/Architecture.tsx` (-25 lines, +8 lines modified)

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (30 minutes)  
**Decision Driver**: Founder feedback on UX, messaging, and visual affordance

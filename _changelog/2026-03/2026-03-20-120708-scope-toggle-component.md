# ScopeToggle Component — First UI Building Block for Library

**Date**: March 20, 2026

## Summary

Added the `ScopeToggle` component to `@stigmer/react` as the first UI component in the new `library/` module. This controlled segmented control toggles between "Org" (organization-only resources) and "All" (including public/platform resources), providing the scope-switching UI that Library list pages will use alongside search inputs. Also fixed a gap where `ResourceListScope` was not importable from the top-level `@stigmer/react` barrel.

## Problem Statement

The Library feature needs a UI control for switching between viewing only the user's organization resources versus all accessible resources. The data hooks (T01.1–T01.4) already accept a `scope: ResourceListScope` parameter, but no UI component existed to drive it.

### Pain Points

- No scope-switching UI for Library list pages
- The `library/` module in `@stigmer/react` did not exist — needed to be bootstrapped for cross-resource UI components
- `ResourceListScope` type was not importable from the top-level `@stigmer/react` barrel, which platform builders need to type their state variables

## Solution

Built `ScopeToggle` as a domain-specific controlled component in the new `sdk/react/src/library/` module. The component uses the WAI-ARIA Radio Group pattern with roving tabindex for accessibility, and is styled entirely through `--stgm-*` design tokens via semantic Tailwind classes.

## Implementation Details

### New Files

- **`sdk/react/src/library/ScopeToggle.tsx`** — Controlled segmented control rendering `[Org] [All]` pills inside a recessed `bg-muted` track. Active pill uses `bg-background shadow-sm` for an elevated appearance. Implements `role="radiogroup"` with `role="radio"` children, roving tabindex (Arrow keys navigate and select, Tab enters/exits). Props: `value`, `onChange`, `disabled?`, `className?`.
- **`sdk/react/src/library/index.ts`** — Barrel exports for the new `library/` module, including re-export of `ResourceListScope` from `../search`.

### Modified Files

- **`sdk/react/src/index.ts`** — Added Library section to top-level barrel, exporting `ScopeToggle`, `ScopeToggleProps`, and `ResourceListScope`.

### Architecture Decision

Chose to build `ScopeToggle` as a domain-specific component rather than a generic `SegmentedControl<T>`. A segmented control is a general UI primitive, but `ScopeToggle` is semantically about the Stigmer concept of resource scope. Premature abstraction would add API surface without a concrete second use case. Extraction to a generic component is straightforward later if needed.

## Benefits

- Platform builders can now embed a scope toggle in their own resource browsers with two lines: `const [scope, setScope] = useState("org")` and `<ScopeToggle value={scope} onChange={setScope} />`
- Full keyboard accessibility (WAI-ARIA Radio Group pattern)
- Theme-compatible: all visuals flow through `--stgm-*` tokens, works in any host application theme
- `ResourceListScope` is now importable from `@stigmer/react` directly

## Impact

- **`@stigmer/react`**: New `library/` module established. First cross-resource UI component available for platform builders.
- **Platform builders**: Can now use `ScopeToggle` and `ResourceListScope` from the top-level package import.
- **Console (client-apps/web)**: No changes yet — consumption happens in T01.6+ when `ResourceListView` composes `ScopeToggle`.

## Related Work

- T01.1–T01.4: Data hooks that accept the `scope` parameter this component drives
- T01.6 (next): `ResourceListView` will be the first consumer of `ScopeToggle`
- DD-003: Design decision documenting flat list with scope toggle over grouped lists
- Project: `20260320.01.library-and-artifacts-flow`

---

**Status**: ✅ Production Ready
**Timeline**: Session 4 of library-and-artifacts-flow project

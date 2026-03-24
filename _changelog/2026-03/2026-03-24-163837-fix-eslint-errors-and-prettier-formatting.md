# Fix ESLint Errors and Prettier Formatting Violations

**Date**: March 24, 2026

## Summary

Resolved all ESLint errors and Prettier formatting violations that caused `make check` to fail. Three React lint errors in the web console were fixed, and the CLI docs generation pipeline was updated to produce Prettier-compliant output so the `format-docs-check` gate passes without manual intervention.

## Problem Statement

Running `make check` failed at two gates:

1. **ESLint** (`npm run lint -w client-apps/web`): 3 errors and 1 warning across two files
2. **Prettier** (`format-docs-check`): 22 CLI docs files failed formatting check because `gen-cli-docs` produces compact markdown that doesn't match Prettier's `--prose-wrap always` output

### Pain Points

- CI gate could not pass due to React hooks violations and formatting drift
- The `gen-cli-docs` Go generator produced unformatted markdown tables and unwrapped prose, which Prettier would then reformat — a mismatch that would recur on every codegen run
- The `useStaticRouteParam` hook triggered cascading renders via synchronous `setState` inside a `useEffect`

## Solution

Fixed the three React lint errors directly, replaced the opacity modifier with the correct design token, and added a Prettier formatting post-step to the `gen-cli-docs` Makefile target so generated docs are always CI-ready.

## Implementation Details

### OidcAuthProvider.tsx — Conditional Hooks (2 errors + 1 warning)

The component had an early `return` for the callback-error state placed _before_ two `useMemo` hooks, violating React's rules-of-hooks (hooks must be called in the same order every render). Moved both `useMemo` calls above the early return so they execute unconditionally.

Additionally, the error-state button used `hover:bg-primary/90` (an opacity modifier on a design-token color), which the project's custom `stigmer/no-token-opacity-modifiers` ESLint rule flags. Replaced with `hover:bg-primary-hover`, the dedicated hover token used consistently across `button.tsx`, `OrgGate.tsx`, and `not-found.tsx`.

### useStaticRouteParam.ts — setState in Effect (1 error)

The hook used `useState` + `useEffect` to resolve a route parameter, calling `setResolved(raw)` synchronously inside the effect body. The `react-hooks/set-state-in-effect` rule correctly flags this as a cascading-render risk. Since the resolved value is purely derived from `raw` and `window.location`, replaced the entire `useState`/`useEffect` pattern with a single `useMemo` that computes the value synchronously — eliminating the effect, the extra state, and the unnecessary render cycle.

### Makefile — Prettier Post-Step for gen-cli-docs

The Go docs generator (`cmd/gen-cli-docs`) produces compact markdown tables and unwrapped prose. Rather than reimplementing Prettier's formatting algorithm in Go, added `npx prettier --write --prose-wrap always` as a post-step in the root Makefile's `gen-cli-docs` target. This ensures generated CLI docs are always Prettier-compliant when `format-docs-check` runs during `make check`.

## Benefits

- `make check` passes cleanly (exit code 0, all 1264 tests green)
- No more recurring formatting drift between codegen and Prettier — the pipeline self-formats
- Eliminated a cascading-render pattern in `useStaticRouteParam`
- Design-token consistency: all primary-button hover states now use the same `hover:bg-primary-hover` token

## Impact

- **CI/CD**: Unblocks the `make check` gate for all developers
- **Web console**: Cleaner React code with correct hook ordering and no unnecessary re-renders
- **Docs pipeline**: CLI docs generation is now fully automated end-to-end without manual Prettier runs

---

**Status**: ✅ Production Ready

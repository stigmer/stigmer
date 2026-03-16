# Fix Turbopack `.js` Extension Resolution

**Date**: March 16, 2026

## Summary

Removed `.js` extensions from all relative imports across `@stigmer/sdk` and `@stigmer/react`, fixing the root cause in the Go codegen template so regenerated code stays clean. This unblocked `next build` which was failing with 41 Turbopack errors.

## Problem Statement

All relative imports in the TypeScript SDK and React packages used `.js` extensions (e.g., `from "./errors.js"`), following the strict Node.js ESM convention. While correct for standalone `tsc` compilation, Turbopack does not resolve `.js` specifiers to `.ts` source files for workspace packages consumed via `transpilePackages`.

### Pain Points

- `next build` failed with 41 module resolution errors in Turbopack
- Production deployments of the web console were blocked
- The codegen pipeline was producing imports with `.js` extensions, meaning every `make codegen` run would reintroduce the problem

## Solution

Removed `.js` extensions from import specifiers everywhere: the Go codegen template (root cause), the regenerated output, and all handwritten source files. Both tsconfigs already used `"moduleResolution": "bundler"`, so extensionless imports resolve correctly in `tsc`, Turbopack, webpack, and Vite.

## Implementation Details

### Codegen template (`tools/codegen/generator/sdk_client_ts.go`)

Updated 15 import-path emission sites:
- `imports.addValue("./errors", ...)` and `imports.addType("./types", ...)` for per-resource client files
- `fmt.Fprintf` format strings for `client.ts` barrel imports and re-exports
- Hardcoded export lines for `types` and `errors` re-exports

### Regenerated files (`sdk/typescript/src/gen/`)

Ran `make codegen` to wipe and regenerate all 20 files with clean extensionless imports.

### Handwritten SDK files (6 files, ~50 imports)

`stigmer.ts`, `index.ts`, `transport.ts`, `errors.ts`, `search.ts`, `internal/interceptors.ts`

### Handwritten React files (21 files, ~68 imports)

All hooks, components, and barrel exports across `agent/`, `session/`, and `agent-execution/` domains.

## Benefits

- `next build` compiles successfully with Turbopack (0 errors, 2.1s)
- Future `make codegen` runs produce clean imports automatically
- Import convention is now consistent with `"moduleResolution": "bundler"` across the entire SDK surface

## Impact

- **Web console**: Unblocked for production deployment
- **SDK consumers**: No API or behavioral change; bundler-based consumers resolve extensionless imports identically
- **Codegen pipeline**: Self-healing; new resource additions will not reintroduce the issue

## Related Work

- Session 2 (TypeScript SDK codegen): Introduced the `.js` convention during initial code generation
- Session 4 (React consolidation): Propagated the convention to handwritten React files
- Session 5 (Cleanup + release pipeline): Identified the Turbopack issue as a pre-existing blocker

---

**Status**: Production Ready
**Timeline**: Single session (~15 minutes)

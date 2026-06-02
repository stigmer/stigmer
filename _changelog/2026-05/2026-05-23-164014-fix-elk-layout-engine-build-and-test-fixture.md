# Fix ELK Layout Engine Build Error and Test Fixture

**Date**: May 23, 2026

## Summary

Fixed a `next build` failure caused by missing ambient type declarations for the optional `elkjs` peer dependency, and corrected a stale test fixture in `execution-graph.test.ts` that was missing newly-required `WorkflowGraphDocument` fields.

## Problem Statement

After the T03 (ELK Layout Pipeline) work landed as part of the workflow UX implementation project, `make local` failed during the `client-apps/web` Next.js production build with:

```
Type error: Cannot find module 'elkjs/lib/elk-api.js' or its corresponding type declarations.
```

### Pain Points

- `make local` completely broken — no web console build possible
- The ambient `.d.ts` declarations for `elkjs` subpath imports existed but were invisible to the Next.js compiler
- A separate test fixture in `execution-graph.test.ts` was also stale, causing 3 test failures in the SDK

## Solution

Two targeted fixes:

1. **Build fix**: Added a `/// <reference path="./elkjs.d.ts" />` triple-slash directive in `elk-layout-engine.ts` to explicitly link the ambient module declarations to the file that uses them.

2. **Test fix**: Added the missing `namespace` and `version` fields to both the inline `WorkflowGraphDocument` object literal and the YAML fixture string in `execution-graph.test.ts`.

## Implementation Details

### Why the build broke

- `elk-layout-engine.ts` dynamically imports `elkjs/lib/elk-api.js` and `elkjs/lib/elk.bundled.js`
- `elkjs` is an optional peer dependency — a sibling `elkjs.d.ts` file provides ambient module declarations so TypeScript can resolve these imports without the package installed
- The web app's `next.config.ts` uses `transpilePackages: ["@stigmer/react", ...]` to compile the SDK source directly
- In that compilation context, the standalone `.d.ts` file was never included in the TypeScript program — ambient declarations only take effect when explicitly referenced
- The `/// <reference path>` directive ensures the declarations travel with the file regardless of which project's tsconfig drives compilation

### Why the test broke

- The `WorkflowGraphDocument` interface was extended with required `namespace` and `version` fields (likely during T03 or T04 work)
- The test fixture in `execution-graph.test.ts` was not updated to include these fields
- TypeScript caught the object literal mismatch; the YAML fixture caused a runtime `requireString()` validation error

## Benefits

- `make local` builds successfully again
- All 776 SDK tests pass (67 test files, zero failures)
- SDK typecheck clean
- No regressions — the fix is purely additive (a directive and two fields)

## Impact

- **Developers**: Unblocks local development workflow for anyone running `make local`
- **CI**: Fixes the production build gate for `client-apps/web`

## Related Work

- Part of the **20260523.02.workflow-ux-implementation** project
- T03: ELK Layout Pipeline introduced the affected files
- Design Decision 002: ELK over Dagre established `elkjs` as an optional peer dependency

---

**Status**: ✅ Production Ready

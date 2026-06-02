# Expression Interpolation: Phase 1→2 Injection Prevention

**Date**: May 23, 2026

## Summary

Hardened the two-phase expression interpolation pipeline to prevent Phase 1 strict expression results from being re-interpreted by Phase 2 embedded interpolation. This closes a data-dependent expression injection vector where external data (webhook payloads, API responses) flowing through `$context` could be unintentionally evaluated if it contained `${ ... }` patterns.

## Problem Statement

After the embedded expression interpolation feature was implemented, a code review identified that Phase 1 strict expressions (whole-value `${ expr }`) could resolve to strings containing `${ ... }` syntax — for example, if a previous task's output stored a template string. Phase 2 would then re-interpret those patterns, violating the principle of least surprise and creating a potential injection vector.

### Pain Points

- External data flowing through `$context` could contain `${ ... }` patterns that would be evaluated
- Users could not safely pass template-like strings between tasks without risk of re-evaluation
- The behavior was data-dependent and non-deterministic from the workflow author's perspective

## Solution

- Track which paths were resolved in Phase 1 via a `Set<string>`
- Pass `skipPaths` to Phase 2's collection traversal
- Phase 2 skips any path that Phase 1 already substituted, preventing re-interpolation
- Added inline documentation for the tilde `~` composite key separator and parser limitations

## Implementation Details

- `resolveConfigExpressions` now builds `phase1Paths: Set<string>` from `collectExpressions` keys
- `resolveEmbeddedExpressions` accepts an optional `skipPaths` parameter (defaults to empty set for backward compatibility)
- `collectEmbeddedFromValue` checks `skipPaths.has(path)` before extracting expressions
- Added test proving that a Phase 1 result containing `${ $env.SECRET }` is NOT re-interpolated
- Added test for deeply nested array-of-object traversal paths (`steps[0].label`)
- Added JSDoc documenting the known brace-depth parser limitation with jq string literals

## Impact

Security hardening for the workflow expression engine. No breaking changes — the `skipPaths` parameter defaults to an empty set, so all existing call sites (including `resolveEmbeddedExpressions` called directly) continue to work unchanged.

---

**Status**: ✅ Production Ready

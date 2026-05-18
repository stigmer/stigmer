# Fix FGA ListObjects Missing Context Parameters

**Date**: May 18, 2026

## Summary

Fixed a critical production error where OpenFGA's `ListObjects` API was failing with `validation_error: missing context parameters '[allow]'` whenever conditional wildcard tuples (`allow_public`) existed in the store. The fix passes `{"allow": false}` evaluation context on all `ListObjects` and `ListUsers` calls, allowing FGA to evaluate the condition (result: false, wildcards suppressed) instead of throwing an error.

## Problem Statement

After the `allow_public` conditional wildcard model was introduced on May 12, the Agents Library page and other org-scoped list views started failing with "Something went wrong" errors for any user whose FGA store contained public visibility tuples.

### Pain Points

- All org-scoped resource listing broken (Agents, Workflows, Skills, MCP Servers)
- Error: `failed to evaluate relationship condition: 'allow_public' - tuple 'agent:agt_XXX#viewer@identity_account:*' is missing context parameters '[allow]'`
- `SearchHandler` → `IamPolicyListAuthorizedResourceIdsHandler` → FGA `ListObjects` call chain completely broken
- Only the `crossOrgPublic=true` path (which bypasses FGA) continued working

## Solution

The root cause was an incorrect assumption documented in the FGA model: "ListObjects calls for org-only scope omit the context so wildcards are inactive." In reality, OpenFGA requires context parameters to be present for evaluation — omitting them causes a hard `validation_error`, not a graceful "condition evaluates to false."

The fix adds `.context(Map.of("allow", false))` to both `ClientListObjectsRequest` and `ClientListUsersRequest` builders. This:

1. Provides the required `allow` parameter so FGA can evaluate the `allow_public` condition
2. Condition evaluates to `false` → wildcard tuple does not match
3. Only org-level grants are returned (matching the original design intent)
4. The `crossOrgPublic=true` path (which bypasses FGA entirely) is unaffected

## Implementation Details

### Production Fixes (stigmer-cloud)

| File | Change |
|------|--------|
| `IamPolicyListAuthorizedResourceIdsHandler.java` | Added `.context(Map.of("allow", false))` to `ClientListObjectsRequest` |
| `IamPolicyListAuthorizedPrincipalIdsHandler.java` | Added `.context(Map.of("allow", false))` to `ClientListUsersRequest` |
| `agent.fga` | Corrected misleading model comment |
| `SearchHandler.java` | Updated inline comments to reflect fixed behavior |

### Tests Added

| File | Coverage |
|------|----------|
| `IamPolicyListAuthorizedResourceIdsHandlerTest.java` (cloud) | Unit test verifying `allow: false` context is set |
| `fga_model_test.go` (OSS) | Integration test: `TestFGAModel_ListObjectsWithConditionalTuples` exercising all three scenarios (no context → error, allow=false → wildcard inactive, allow=true → wildcard expands) |

### Key Asymmetry Discovered

| FGA API | Behavior with Missing Context |
|---------|-------------------------------|
| `Check` (single tuple) | Returns HTTP 400 → interpreted as "denied" |
| `ListObjects` (evaluates all tuples) | Fails entire call with `validation_error` |
| `ListUsers` (evaluates all tuples) | Same as ListObjects |

This asymmetry was the core reason the existing `Check`-only integration tests passed while production `ListObjects` calls failed.

## Benefits

- Agents Library page and all org-scoped list views restored
- Preventive fix on `ListUsers` path (would have failed the same way)
- FGA model comments now accurately document required behavior
- New integration test prevents this class of regression permanently

## Impact

- **Users**: All org-scoped resource listings now work correctly for organizations that have public resources
- **Affected views**: Agents Library, Workflows, Skills, MCP Servers (any `ListObjects` path)
- **Repos**: stigmer-cloud (production fix), stigmer (integration test)

## Related Work

- [FGA Public Visibility Tuples Investigation](../../stigmer-cloud/_changelog/2026-05/2026-05-18-fga-public-visibility-tuples-investigation.md) — the manual CLI fix for the 85 missing tuples (separate issue, same feature)
- `TestFGAModel_PublicVisibilityCondition` — existing Check-only test that didn't catch this

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (investigation + fix + tests)

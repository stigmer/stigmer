# MCP Server: Test Coverage Baseline (T11-B)

**Date**: February 19, 2026

## Summary

Ran a thorough test coverage analysis across all 12 packages in the `mcp-server/` module, established a per-function coverage baseline, classified every gap as meaningful or acceptable, and filled the two real gaps with targeted tests. Coverage rose from 71.7% to 72.7% overall, with the `internal/domains` package improving from 83.3% to 88.9%. This is the pre-flight check before T11-A (write/mutation operations).

## Problem Statement

The MCP server had no coverage baseline. Before extending the server with mutation tools (T11-A), it was important to know the health of the existing test suite — not to chase a number, but to ensure no real correctness gaps existed that could silently break once write operations were added.

### Pain Points

- `MarshalJSON` in `internal/domains/jsonutil.go` was at 0% — the serialization boundary used by every single tool handler had zero direct tests
- The search `Handler`'s org-scoped error message branch was untested — a path exercised when a caller scopes a search to an org and the server returns an error
- No documented record of which untested paths were intentionally skipped vs. accidentally missed

## Solution

Ran `go test -race -coverprofile` across all packages, analyzed every uncovered function and branch individually, and applied the principle: test code that has real branching logic or serialization boundaries; skip defensive error paths that are physically unreachable with the current implementation.

## Implementation Details

### New file: `internal/domains/jsonutil_test.go`

Three tests for `MarshalJSON`:

1. `TestMarshalJSON_validMessage` — serializes a real proto message and verifies the output is valid JSON with correct field values
2. `TestMarshalJSON_usesProtoNames` — asserts `UseProtoNames: true` is enforced (snake_case output, not camelCase), which is contractually relied upon by every MCP tool handler
3. `TestMarshalJSON_nilMessage` — confirms nil input produces `{}` rather than a panic or error

### Updated file: `internal/domains/search/tools_test.go`

Added `TestHandler_grpcErrorWithOrg` — exercises the org-scoped error description branch in `Handler`:

```go
if input.Org != "" {
    desc = fmt.Sprintf("search results in org %q", input.Org)
}
```

The existing `TestHandler_grpcError` only exercised the default `"search results"` description. The new test sets `Org: "acme"` and verifies the error message includes the org name, confirming the enriched description reaches the user.

### Intentionally accepted gaps

Every remaining uncovered path was analyzed and documented in the session checkpoint. Key accepted gaps:

| Path | Reason skipped |
|------|---------------|
| `MarshalJSON` error return (25%) | `protojson.Marshal` does not fail on valid proto messages |
| URI parsers' `url.Parse` error | Go's `url.Parse` is too permissive to trigger with any realistic input |
| URI parsers' empty-org guard | Unreachable — `splitPathSegments` uses `strings.Trim` which never returns empty segments |
| All `Fetch` marshal error paths | Same as `MarshalJSON` error path |
| `enrichSearchResponse` JSON round-trip errors | Impossible to fail: protojson-marshaled bytes are always valid JSON |
| `server.New/registerTools/registerResources` (0%) | Orchestration wiring with no branching logic — testing validates the SDK |
| `ServeStdio/ServeHTTP` (0%) | Require live transports; validated via manual and integration testing |
| `requestLogger/shortID` (0%) | Trivial middleware; `crypto/rand` read never fails |
| `serveBoth/initLogger` (0%) | Top-level concurrency harness; needs real transport setup |

## Benefits

- `MarshalJSON` now has direct tests that would catch any future regression in proto serialization options (e.g., if `UseProtoNames` were accidentally removed, `TestMarshalJSON_usesProtoNames` fails immediately)
- Org-scoped error messages are verified end-to-end through the full handler path
- Every coverage gap is now documented and reasoned about — future developers understand which gaps are intentional

## Impact

- No production code changes — purely test additions
- 4 new test cases across 2 files
- Coverage: 71.7% → 72.7% overall; `internal/domains`: 83.3% → 88.9%
- All 12 packages passing under `-race`; `go vet` clean

## Related Work

- [2026-02-18: MCP Server Scaffolding](2026-02-18-124027-mcp-server-stigmer-scaffolding.md) — T01, initial structure
- [2026-02-18: MCP Server Test Suite](2026-02-18-130941-mcp-server-test-suite.md) — T03, test infrastructure established
- [2026-02-19: MCP Server MCP Servers Domain](2026-02-19-153732-mcp-server-mcpservers-domain.md) — T10, last feature session before coverage baseline
- Next: T11-A — Write operations (`apply_*` and `delete_*` mutation tools)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes

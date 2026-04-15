# Close All Apply Gaps — 6 New Resource Kinds (T02)

**Date**: April 15, 2026

## Summary

Implemented `ApplyHandler` for all 6 remaining resource kinds in the Stigmer CLI — IdentityProvider, Environment, AgentInstance, WorkflowInstance, OAuthApp, and Session — closing every apply gap and bringing the CLI to full declarative coverage. Extracted shared YAML-to-JSON conversion into a reusable `pkg/yamlutil` package, eliminating duplication across 5 existing loaders.

## Problem Statement

After T01 established the generic `ApplyHandler` framework and CI guards, 6 resource kinds still lacked `stigmer apply -f` support. The apply coverage test (`apply_coverage_test.go`) explicitly excluded them, meaning users couldn't manage these resources declaratively.

### Pain Points

- Users had to use the web UI or raw API calls to manage IdentityProvider, Environment, AgentInstance, WorkflowInstance, OAuthApp, and Session resources
- The `yamlMapToJSON` and `convertYAMLValue` utility functions were copy-pasted across 5 loader packages
- No CLI type-system or verb-support entries existed for the new resources, so they were invisible to `stigmer get`, `stigmer delete`, and tab completion

## Solution

Implemented each resource as a full-stack CLI domain package following the established pattern: loader (YAML-to-proto unmarshaling), apply_handler (create-or-update via gRPC), get, delete, and display. Registered every resource in the type system, verb support matrix, apply ordering, and handler registry.

## Implementation Details

### Phase 0 — Shared Utility Extraction

- Created `client-apps/cli/pkg/yamlutil/convert.go` with `MapToJSON` and `ConvertValue`
- Created unit tests in `convert_test.go` (nested maps, slices, mixed types)
- Updated 5 existing loaders (`agent`, `mcpserver`, `workflow`, `organization`, `project`) to import from `pkg/yamlutil`, removing ~160 lines of duplicated code

### Phase 1–6 — Resource Domain Packages

For each resource kind, created:

| File | Purpose |
|------|---------|
| `loader.go` | YAML → proto unmarshaling via `pkg/yamlutil` + `protojson` |
| `loader_test.go` | Round-trip YAML parse → proto field assertions |
| `apply_handler.go` | `ApplyHandler` implementation with `DryRun`/`Apply` |
| `get.go` | `GetFromBackend` (by ID or reference where supported) |
| `delete.go` | `DeleteFromBackend` |
| `display.go` | `DisplayApplyResult` (table formatting, field redaction) |

### Resource-Specific Decisions

| Resource | RPC Delete Pattern | Verb Support | Secrets |
|----------|-------------------|--------------|---------|
| IdentityProvider | `ApiResourceDeleteInput` | apply, get, list, delete | — |
| Environment | `ApiResourceDeleteInput` | apply, get, list, delete | Secret values `[REDACTED]` |
| AgentInstance | `AgentInstanceId` wrapper | apply, get, list, delete | — |
| WorkflowInstance | `WorkflowInstanceId` wrapper | apply, get, delete (no list) | — |
| OAuthApp | `ApiResourceDeleteInput` | apply, get, list, delete | `client_secret` `[REDACTED]` |
| Session | `SessionId` wrapper | apply, get, list, delete | — |

### Type System & CI Guard Updates

- Added all 6 kinds to `cliRelevantKinds` in `types/registry.go`
- Added verb entries in `types/verb_support.go` (WorkflowInstance explicitly omits `VerbList`)
- Added dependency ordering in `applier/order.go` (Environment → IdP → OAuthApp → AgentInstance → WorkflowInstance → Session)
- Registered handlers in `apply_file.go:newApplyHandlerRegistry()`
- Removed all 6 kinds from `applyExcludedKinds` in `apply_coverage_test.go`
- Fixed alias collision in `types/aliases.go` — compound names no longer steal short aliases from parent types
- Updated test expectations across `registry_test.go`, `routing_test.go`, and `verb_support_test.go`

### Session Package Integration

The `session` package had pre-existing `get.go`, `display.go`, and `list.go` files with established APIs. New files (`loader.go`, `apply_handler.go`, `delete.go`) were integrated alongside the existing code without breaking the established contracts.

### Draft Commands Deferred

Draft commands for the new resources were initially planned but deferred — the backend system agents required to support them do not exist yet. This will be addressed in a future task.

## Benefits

- **Full declarative coverage**: All CLI-relevant resource kinds now support `stigmer apply -f`
- **Zero apply exclusions**: The CI guard test now enforces 100% coverage with no exceptions
- **DRY codebase**: YAML-to-JSON utility extracted, eliminating ~160 lines of duplication
- **Robust alias resolution**: Compound resource names coexist cleanly with simpler parent types
- **Security awareness**: Environment secrets and OAuthApp client_secret are redacted in output

## Impact

- **CLI users**: Can now declaratively manage all resource types via YAML manifests
- **CI pipeline**: Apply coverage guard enforces that new resource kinds must ship with handlers
- **Developer experience**: Adding future resources follows a clear, documented pattern with shared utilities

## Related Work

- T01: Generic ApplyHandler framework + CI guards (prerequisite — completed 2026-04-15)
- GitHub Issue #122
- Pre-existing test failure in `pkg/display/proto_test.go` identified but not addressed (unrelated)

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours (single session)

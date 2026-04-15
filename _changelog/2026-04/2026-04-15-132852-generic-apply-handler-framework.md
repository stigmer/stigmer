# Generic ApplyHandler Framework for CLI File-Apply Pipeline

**Date**: April 15, 2026

## Summary

Extracted a generic `ApplyHandler` interface from the CLI's hardcoded per-kind apply dispatch, replacing a manual 4-case `switch` statement with a registry-based lookup and a unified `executeApply` pipeline. Added CI guard tests that fail when a proto-defined Apply RPC lacks a corresponding CLI handler, preventing silent coverage gaps as the platform grows.

## Problem Statement

The CLI's `stigmer apply -f` command used a manual `switch` on `ProtoKind` in `applyResourceItem` to dispatch to per-kind handler functions. Each handler (`applyOrganization`, `applyAgent`, `applyWorkflow`, `applyMcpServer`) duplicated the same load -> validate -> org-warn -> dry-run -> apply -> display pipeline with only the types differing.

### Pain Points

- Adding a new apply-capable kind required touching `apply_file.go` (switch case), `apply_file_handlers.go` (handler + 2 display builders), and hoping you didn't forget — no CI enforcement
- 12 proto kinds define `rpc apply` but only 4 had CLI handlers; the gap was invisible
- ~280 lines of duplicated per-kind handler + display code in `apply_file_handlers.go`
- Apply ordering was embedded in `apply_file.go` with no reuse path for the declarative apply pipeline

## Solution

Introduced a new `internal/cli/applier/` package with three files:

- **`handler.go`** — `ApplyHandler` interface (7 methods: `Kind`, `LoadFromBytes`, `Validate`, `Metadata`, `Apply`, `BuildDryRunResult`, `BuildApplyResult`) and `ApplyResult` struct
- **`registry.go`** — `Registry` with explicit `Register`/`Get`/`All`/`RegisteredKinds` (no `init()`)
- **`order.go`** — `DefaultApplyOrder` map + generic `SortByApplyOrder[T]` function

Each of the 4 existing kinds (agent, mcpserver, workflow, organization) got an `apply_handler.go` adapter in its domain package that wraps existing `LoadFromBytes`/`Validate`/`Apply` functions and absorbs the `build*Result` display logic from the old monolithic handlers file.

## Implementation Details

### New Package: `internal/cli/applier/`

The `ApplyHandler` interface uses `proto.Message` for type-agnostic dispatch while each handler internally type-asserts to its concrete proto. The `Metadata()` method enables the framework to handle org mismatch warnings, org injection, and reference building — three operations that were previously duplicated in every handler.

### Unified Pipeline: `executeApply`

Replaces 4 per-kind handler functions with a single generic function:
load -> validate -> org handling -> dry-run branch -> apply -> display -> collect MCP servers

### CI Guard Tests (4 tests)

- `TestAllApplyableKindsAreCovered` — every proto kind with Apply RPC must be registered or explicitly excluded
- `TestNoOrphanedExclusions` — prevents stale exclusions lingering after proto changes
- `TestNoDoubleRegistration` — catches implemented handlers whose exclusion wasn't cleaned up
- `TestRegisteredHandlersMatchVerbSupport` — ensures handler registry stays in sync with the verb support matrix

The exclusion list has 2 permanent entries (`execution_context`, `project`) and 6 temporary entries for kinds T02 will implement.

### Files Changed

**New (8 files):**
- `internal/cli/applier/handler.go`, `registry.go`, `order.go`
- `internal/cli/{agent,mcpserver,workflow,organization}/apply_handler.go`
- `cmd/stigmer/root/apply_coverage_test.go`

**Modified (4 files):**
- `cmd/stigmer/root/apply_file.go` — registry-based dispatch, `executeApply` pipeline
- `cmd/stigmer/root/apply_file_handlers.go` — reduced from ~316 lines to ~36 (shared helpers only)
- `cmd/stigmer/root/apply_file_handlers_test.go` — updated to use handler-based API
- `cmd/stigmer/root/apply_declarative.go` — updated to use `applier.SortByApplyOrder`

**Net:** -228 lines (185 added, 413 removed) across production code

## Benefits

- **Zero-cost extensibility**: Adding a new apply-capable kind is now implement `ApplyHandler` + register — no switch statements to modify
- **CI-enforced coverage**: Impossible to add a proto Apply RPC without the test suite catching the gap
- **No duplicated orchestration**: Org handling, dry-run branching, and display rendering happen once in the framework
- **Type-safe adapters**: Each handler wraps its existing domain functions with no changes to the original code
- **Shared ordering**: Both file-apply and declarative-apply paths use the same `SortByApplyOrder` function

## Impact

- **CLI developers** (T02): Can implement 6 new resource kinds (IdentityProvider, OAuthApp, Environment, AgentInstance, WorkflowInstance, Session) by following the established handler pattern
- **Platform reliability**: CI guard prevents silent regressions when new Apply RPCs are added to protos
- **Code maintainability**: One pipeline to understand instead of four duplicated handler functions

## Related Work

- Part of CLI Modernization project (T01 of 4 tasks)
- Enables T02: Close All Apply Gaps (6 new resource kinds)
- Issue #122: IdentityProvider apply support (blocked on T02, unblocked by this framework)

---

**Status**: Production Ready
**Timeline**: Single session

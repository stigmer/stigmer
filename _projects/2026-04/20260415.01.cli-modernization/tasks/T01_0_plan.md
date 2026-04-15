# Task T01: Generic ApplyHandler Framework + CI Guards

**Created**: 2026-04-15
**Status**: PENDING REVIEW
**Type**: Refactoring + Feature Development

## Objective

Extract a generic `ApplyHandler` interface from the existing per-kind apply code, then add CI test guards that fail when a resource with an Apply RPC is missing from the CLI. This is foundational — all subsequent apply work builds on it.

## Background

The CLI currently has 4 hardcoded apply handlers in a manual `switch` statement in `apply_file.go`:
- Organization, Agent, Workflow, McpServer

But 13 resource kinds have `apply` RPCs on the backend. Adding 6 more as individual switch cases would be unsustainable. We need a generic handler interface first.

## Task Breakdown

### Step 1: Define `ApplyHandler` interface

Create `internal/cli/applier/handler.go`:

```go
type ApplyHandler interface {
    Kind() apiresourcekind.ApiResourceKind
    LoadFromBytes(raw []byte) (proto.Message, error)
    Validate(msg proto.Message) error
    Apply(ctx context.Context, conn grpc.ClientConnInterface, orgID string, msg proto.Message, dryRun bool) (*ApplyResult, error)
    DisplayDryRun(msg proto.Message)
    DisplaySuccess(msg proto.Message, created bool)
}
```

Create `internal/cli/applier/registry.go` — handler registry with `Register()` and `Get()`.

### Step 2: Refactor existing 4 handlers

Convert `agent/applier.go`, `mcpserver/applier.go`, `workflow/applier.go`, `organization/applier.go` to implement the `ApplyHandler` interface. Each registers itself via `init()` or explicit registration in the command setup.

### Step 3: Simplify `applyResourceItem` dispatch

Replace the manual switch in `cmd/stigmer/root/apply_file.go` with:

```go
func applyResourceItem(item applyItem, fctx *fileApplyContext) (*apiresource.ApiResourceReference, error) {
    handler, ok := applier.Get(item.typeInfo.ProtoKind)
    if !ok {
        return nil, fmt.Errorf("apply not implemented for %s", item.typeInfo.DisplayName)
    }
    return executeApply(handler, item, fctx)
}
```

Where `executeApply` is the generic load -> validate -> org-fill -> dry-run-or-apply -> display pipeline.

### Step 4: CI guard tests

Create `cmd/stigmer/root/apply_coverage_test.go` with three tests:

1. **`TestAllApplyableKindsAreRegistered`** — iterates all kinds with apply RPCs, fails if missing from CLI registry (with explicit exclusion list for `execution_context` etc.)
2. **`TestAllRegisteredKindsHaveApplyHandler`** — every kind in `cliRelevantKinds` with `VerbApply: true` has a registered `ApplyHandler`
3. **`TestVerbSupportMatchesRegisteredKinds`** — extends existing tests for full coverage

The exclusion list (with justifications):
```go
var applyExcludedKinds = map[apiresourcekind.ApiResourceKind]string{
    apiresourcekind.ApiResourceKind_execution_context: "ephemeral, auto-managed per execution",
}
```

### Step 5: Verify existing tests still pass

Run all existing apply-path tests to ensure the refactor is clean.

## Files Changed

- `internal/cli/applier/handler.go` (NEW)
- `internal/cli/applier/registry.go` (NEW)
- `internal/cli/agent/applier.go` (REFACTOR to implement interface)
- `internal/cli/mcpserver/applier.go` (REFACTOR)
- `internal/cli/workflow/applier.go` (REFACTOR)
- `internal/cli/organization/applier.go` (REFACTOR)
- `cmd/stigmer/root/apply_file.go` (SIMPLIFY dispatch)
- `cmd/stigmer/root/apply_file_handlers.go` (SIMPLIFY — move per-kind logic to domain packages)
- `cmd/stigmer/root/apply_coverage_test.go` (NEW)

## Success Criteria

- [ ] `ApplyHandler` interface defined and documented
- [ ] All 4 existing handlers implement the interface
- [ ] `applyResourceItem` uses generic dispatch (no more `switch`)
- [ ] CI guard test exists and currently passes (4 handlers registered, 6 kinds flagged as TODO via exclusion or expected-failure)
- [ ] All existing apply tests pass
- [ ] `go vet ./...` and `go test ./...` clean

## Next Task Preview

**T02: Close all apply gaps** — Implement ApplyHandler for the 6 missing resource kinds (IdentityProvider, OAuthApp, Environment, AgentInstance, WorkflowInstance, Session).

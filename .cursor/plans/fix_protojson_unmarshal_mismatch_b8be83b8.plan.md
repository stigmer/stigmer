---
name: Fix protojson unmarshal mismatch
overview: Fix the same serialization format mismatch (`protojson.Unmarshal` vs `proto.Unmarshal`) that was recently patched in `list_by_session.go` but remains in 5 other domain controller files, causing `stigmer list sessions` and other list operations to silently return empty results.
todos:
  - id: fix-session-list
    content: Fix protojson.Unmarshal -> proto.Unmarshal in session/controller/list.go (direct cause of the reported bug)
    status: completed
  - id: fix-filter-by-agent
    content: Fix protojson.Unmarshal -> proto.Unmarshal in session/controller/steps/filter_by_agent_instance.go
    status: completed
  - id: fix-agentinstance-get
    content: Fix protojson.Unmarshal -> proto.Unmarshal in agentinstance/controller/get_by_agent.go
    status: completed
  - id: fix-agentexecution-list
    content: Fix protojson.Unmarshal -> proto.Unmarshal in agentexecution/controller/list.go
    status: completed
  - id: fix-workflowexecution-list
    content: Fix protojson.Unmarshal -> proto.Unmarshal in workflowexecution/controller/list.go
    status: completed
  - id: verify-build
    content: Run go build and go vet to verify all changes compile correctly
    status: completed
isProject: false
---

# Fix `protojson.Unmarshal` Mismatch Across Domain Controllers

## Root Cause

The SQLite store persists all resources as **binary protobuf** via `proto.Marshal` ([store.go:471](backend/libs/go/store/sqlite/store.go)):

```go
data, err := proto.Marshal(msg)
```

But several domain controllers try to deserialize the data using `protojson.Unmarshal` (JSON protobuf), which will always fail on binary data. The error is **silently swallowed** (logged as a warning, record skipped), so the list returns empty results with no user-visible error.

This was already fixed once in [list_by_session.go](backend/services/stigmer-server/pkg/domain/agentexecution/controller/list_by_session.go) (see [changelog](/_changelog/2026-02/2026-02-24-230339-fix-session-resume-unmarshal-bug.md)), but the same bug persists in 5 other files.

## Affected Files

All files below use `protojson.Unmarshal` where they should use `proto.Unmarshal`:

1. **[session/controller/list.go:94](backend/services/stigmer-server/pkg/domain/session/controller/list.go)** -- **This is the direct cause of `stigmer list sessions` returning "No sessions found"**
2. **[session/controller/steps/filter_by_agent_instance.go:66](backend/services/stigmer-server/pkg/domain/session/controller/steps/filter_by_agent_instance.go)** -- Used by `listByAgent` RPC
3. **[agentinstance/controller/get_by_agent.go:99](backend/services/stigmer-server/pkg/domain/agentinstance/controller/get_by_agent.go)** -- Agent instance lookup by agent ID
4. **[agentexecution/controller/list.go:105](backend/services/stigmer-server/pkg/domain/agentexecution/controller/list.go)** -- Agent execution listing
5. **[workflowexecution/controller/list.go:39](backend/services/stigmer-server/pkg/domain/workflowexecution/controller/list.go)** -- Workflow execution listing

## Fix

For each file:

- Change `protojson.Unmarshal(d, msg)` to `proto.Unmarshal(d, msg)`
- Update the import from `google.golang.org/protobuf/encoding/protojson` to `google.golang.org/protobuf/proto` (or remove the `protojson` import if it becomes unused)

## Verification

- Run `go build ./...` to confirm compilation
- Run `go vet ./...` to confirm no issues
- Manually test `stigmer list sessions` to confirm sessions now appear


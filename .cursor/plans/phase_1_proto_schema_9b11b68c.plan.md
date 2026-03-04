---
name: Phase 1 Proto Schema
overview: "Modify the proto schema to support multiple workspace entries per session: add WorkspaceEntry message, replace singular workspace_source with repeated workspace_entries on SessionSpec, and regenerate all stubs."
todos:
  - id: modify-workspace-proto
    content: Add WorkspaceEntry message to workspace.proto and update WorkspaceSource doc comment
    status: completed
  - id: modify-spec-proto
    content: Remove workspace_source field 6, add repeated WorkspaceEntry workspace_entries field 7 on SessionSpec
    status: completed
  - id: update-agentexec-comment
    content: Update workspace_source reference in agentexecution/v1/spec.proto docstring
    status: completed
  - id: regenerate-stubs
    content: Run make protos to regenerate Go and Python stubs
    status: completed
  - id: verify-stubs
    content: Verify generated Go and Python stubs contain correct types and fields
    status: completed
isProject: false
---

# Phase 1: Proto Schema + Code Generation

## Design Decisions


| Decision                  | Choice                     | Rationale                                                                                                            |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Field name on SessionSpec | `workspace_entries`        | Matches `WorkspaceEntry` type, future-proof, no naming mismatch across 5 language stubs                              |
| Wrapper message           | **No** `Workspace` wrapper | YAGNI -- wrapper would have one field; session IS the workspace container; adding wrapper later is trivial if needed |
| Reserved fields           | **None**                   | Clean break, no backward compat; `workspace_source` treated as never existed                                         |
| New field number          | 7 (not reusing 6)          | Protobuf best practice -- avoids silent wire-format conflicts with any residual serialized data                      |
| `WorkspaceSource` message | **Unchanged**              | Remains a clean "source definition" type; `WorkspaceEntry` adds identity on top                                      |


## Changes

### 1. Add `WorkspaceEntry` to `[workspace.proto](apis/ai/stigmer/agentic/session/v1/workspace.proto)`

Add after the `WorkspaceSource` message:

```protobuf
message WorkspaceEntry {
  string name = 1 [(buf.validate.field).string.min_len = 1];
  WorkspaceSource source = 2 [(buf.validate.field).required = true];
}
```

- `name`: required, auto-derived by CLI from repo name or dir basename. Used as subdirectory name in cloud mode.
- `source`: required, reuses the existing `WorkspaceSource` oneof (git or local).

Update the `WorkspaceSource` doc comment to remove the reference to "When workspace_source is absent on SessionSpec" since that field is going away.

### 2. Replace singular field in `[spec.proto](apis/ai/stigmer/agentic/session/v1/spec.proto)`

**Remove** line 34:

```
WorkspaceSource workspace_source = 6;
```

**Add** in its place:

```protobuf
repeated WorkspaceEntry workspace_entries = 7;
```

With an updated comment explaining the multi-entry semantics and that an empty list means no workspace (empty workspace directory, existing default behavior).

Remove the `workspace.proto` import ONLY if `WorkspaceEntry` is the only type used -- but since `WorkspaceEntry` is defined in `workspace.proto`, the import stays.

### 3. Update comment in `[agentexecution/v1/spec.proto](apis/ai/stigmer/agentic/agentexecution/v1/spec.proto)`

Line ~244 references `workspace_source` in a docstring. Update to reference `workspace_entries` with a local path entry.

### 4. Regenerate stubs

From the repo root:

```bash
make protos
```

This runs `buf lint`, `buf format`, then `buf generate` for both Go and Python templates. Output lands in:

- Go: `apis/stubs/go/ai/stigmer/agentic/session/v1/`
- Python: `apis/stubs/python/stigmer/ai/stigmer/agentic/session/v1/`

### 5. Verify generated stubs

After generation, confirm:

- `workspace.pb.go` contains `WorkspaceEntry` struct with `Name` and `Source` fields
- `spec.pb.go` contains `WorkspaceEntries []*WorkspaceEntry` on `SessionSpec` (no `WorkspaceSource` field)
- `workspace_pb2.py` and `.pyi` contain `WorkspaceEntry` class
- `spec_pb2.py` and `.pyi` reference `workspace_entries` repeated field

### 6. Expected breakage (deferred to later phases)

Phase 1 intentionally breaks downstream consumers. These are fixed in subsequent phases:

**Go CLI (Phase 2):**

- `run_workspace.go` -- `parseWorkspaceSource()` references removed type path
- `run_agent_exec.go` -- `WorkspaceSource` field on structs
- `run.go` -- `localWorkspaceRoot()` signature
- `run_create.go` -- `createSessionForAgent()` signature
- `run_attachments.go` -- `ProcessFiles()` single root
- `draft_handler.go` -- workspace source pass-through

**Python backend (Phase 3):**

- `execute_graphton.py` -- `HasField("workspace_source")`, `session.spec.workspace_source`
- `provisioner.py` -- `provision(workspace_source=...)` signature

**stigmer-cloud stubs (deferred):**

- Generated stubs in stigmer-cloud are NOT regenerated in Phase 1. They will be regenerated when stigmer-cloud needs to consume the new schema.

## Files touched


| File                                                   | Action                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `apis/ai/stigmer/agentic/session/v1/workspace.proto`   | Add `WorkspaceEntry` message, update `WorkspaceSource` comment            |
| `apis/ai/stigmer/agentic/session/v1/spec.proto`        | Remove field 6, add field 7 (`repeated WorkspaceEntry workspace_entries`) |
| `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` | Update docstring comment                                                  |
| `apis/stubs/go/...` (auto-generated)                   | Regenerated by `make protos`                                              |
| `apis/stubs/python/...` (auto-generated)               | Regenerated by `make protos`                                              |



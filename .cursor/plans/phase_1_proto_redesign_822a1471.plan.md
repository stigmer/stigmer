---
name: Phase 1 Proto Redesign
overview: Transform ProjectSpec from a heavyweight container of full embedded resources into a lightweight reference-based membership tracker. Remove the `runtime` field and `ProjectRuntime` enum entirely. Add a `members` field using the existing `ApiResourceReference` type. No backward compatibility preserved.
todos:
  - id: spec-proto
    content: "Rewrite spec.proto: remove 5 imports, remove runtime + 4 embedded resource fields, add ApiResourceReference import, add members field, renumber fields to 1/2/3, rewrite all comments"
    status: completed
  - id: delete-enum
    content: Delete enum.proto (ProjectRuntime enum no longer needed)
    status: completed
  - id: api-proto-comments
    content: "Update api.proto: rewrite Project message comment and example YAML for declarative + SDK tracks"
    status: completed
  - id: status-proto-comments
    content: "Update status.proto: rewrite ReconciliationSummary and ProjectStatus comments for reference-based model"
    status: completed
  - id: regen-stubs
    content: "Regenerate stubs: cd apis && make build — verify buf lint, buf format, Go/Python stub generation all pass"
    status: completed
isProject: false
---

# Phase 1: ProjectSpec Proto Redesign

## Scope

Phase 1 is **proto-only**. We change the proto files, delete the enum, regenerate stubs, and verify proto compilation. Downstream Go/Python code **will break** — that is expected and will be addressed in Phase 2 (backend) and Phase 3/4 (CLI).

## Current State

[spec.proto](apis/ai/stigmer/agentic/project/v1/spec.proto) currently has:

- `ProjectRuntime runtime = 1` (required, rejects UNSPECIFIED)
- `string entry_point = 2`
- `string description = 3`
- `repeated Agent agents = 10`
- `repeated Workflow workflows = 11`
- `repeated McpServer mcp_servers = 12`
- `repeated Skill skills = 13`

Plus 5 imports (4 resource types + enum.proto).

## Target State

```protobuf
message ProjectSpec {
  string entry_point = 1;
  string description = 2;
  repeated ApiResourceReference members = 3;
}
```

- `entry_point` (optional): When set, CLI infers SDK runtime from file extension (`.go` / `.py` / `.ts`). When absent, project is declarative.
- `description` (optional): Human-readable project description.
- `members`: Server-side membership list. Populated by CLI after individually applying resources. Used for orphan pruning (previous members minus current members = orphans).

**Field renumbering rationale**: No backward compatibility needed (no users, no stored data to preserve). Clean sequential numbering (1, 2, 3) is better than leaving gaps (skip 1, keep 2, 3, use 4+). Fresh start.

---

## File-by-File Changes

### 1. [spec.proto](apis/ai/stigmer/agentic/project/v1/spec.proto) — Core change

**Remove:**

- All 5 imports (agent, workflow, mcpserver, skill, enum)
- `runtime` field (field 1)
- `agents` field (field 10)
- `workflows` field (field 11)
- `mcp_servers` field (field 12)
- `skills` field (field 13)

**Add:**

- Import `ai/stigmer/commons/apiresource/io.proto` (for `ApiResourceReference`)
- `repeated ApiResourceReference members = 3`

**Modify:**

- `entry_point`: renumber 2 -> 1, rewrite comment to explain it as the SDK/declarative signal
- `description`: renumber 3 -> 2
- Rewrite `ProjectSpec` message-level comment to describe the new model

### 2. [enum.proto](apis/ai/stigmer/agentic/project/v1/enum.proto) — Delete entirely

`ProjectRuntime` enum is no longer needed. Runtime is inferred from `entry_point` file extension by the CLI. This file is only imported by `spec.proto` (verified), so deletion is safe.

### 3. [api.proto](apis/ai/stigmer/agentic/project/v1/api.proto) — Comment update

- Update the `Project` message doc comment to describe both declarative and SDK tracks
- Update the example YAML to show the new minimal declarative form (no `runtime`, no `entry_point`)
- Add a second example showing SDK form (with `entry_point: main.go`)
- No structural changes to the `Project` message itself

### 4. [status.proto](apis/ai/stigmer/agentic/project/v1/status.proto) — Comment update only

- Update `ReconciliationSummary` comments to reflect that reconciliation is now reference-based (set-difference on members), not spec-diffing on embedded objects
- Update `ProjectStatus` comments accordingly
- `ResourceChangeRecord` stays as-is — `kind + slug + resource_id` is still the right shape for reporting orphan deletions
- **No structural changes** — the message shape works for the new model

### 5. Regenerate stubs

Run `cd apis && make build` (which runs lint, format, and generates Go + Python stubs). Verify:

- `buf lint` passes
- `buf format` passes
- Go stubs generate without errors
- Python stubs generate without errors

Note: Downstream Go code (backend reconciliation, CLI) will fail to compile. That is expected and addressed in subsequent phases.

---

## What is NOT in scope for Phase 1

- Backend reconciliation logic changes (Phase 2)
- CLI declarative track implementation (Phase 3)
- CLI SDK track adaptation (Phase 4)
- Fixing downstream Go compilation errors (Phases 2-4)
- Any `command.proto` or `query.proto` structural changes (RPCs remain the same)

---

## Risk: Comment quality

The proto comments in this codebase are thorough and well-crafted (they serve as living documentation). The rewritten comments must maintain this quality bar — they should explain the "why", not just the "what", and include usage examples where appropriate.